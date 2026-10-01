import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  BUSINESS_DATE_FORMAT_MESSAGE,
  MONEY_FORMAT_MESSAGE,
  TRANSACTION_PAGE_SIZE_DEFAULT,
  TRANSACTION_PAGE_SIZE_MAX,
  TRANSACTION_SORT_FIELDS,
  isPaymentMethod,
  isTransactionStatus,
  type PaymentMethod,
  type TransactionAuditEventView,
  type TransactionReceiptView,
  type TransactionSortDirection,
  type TransactionSortField,
  type TransactionStatus,
  type TransactionSummary,
} from '@hyssop/contracts';
import { useApiClient } from '../../app/providers/ApiClientProvider';
import { ApiClientError, ApiTransportError } from '../../lib/api-client';
import { useSession } from '../auth/SessionProvider';
import { CONTRIBUTION_SUMMARY_QUERY_KEY, MEMBER_DETAIL_QUERY_KEY } from '../members/member-api';

/**
 * Shared transaction data access for income and expenses.
 *
 * Authority: `docs/02-ARCHITECTURE.md` — the frontend may hold an API client, typed
 * contracts, a query cache, and presentation formatting, and must not calculate authoritative
 * financial totals. Everything here is a typed call to a real endpoint; there is no local
 * transaction store, so a screen cannot render a record the server never sent, and no
 * "balance" is derived in the browser.
 *
 * The pure helpers are exported separately from the hooks because they carry the rules the
 * browser can check *before* a request, using the shared contract constants so the browser
 * cannot disagree with the API. The API remains the enforcement point; the browser copy only
 * saves the Admin a round trip.
 */

export interface TransactionListFilters {
  readonly search: string;
  readonly page: number;
  readonly pageSize: number;
  readonly sort: TransactionSortField;
  readonly direction: TransactionSortDirection;
  readonly status: TransactionStatus | '';
  readonly paymentMethod: PaymentMethod | '';
  readonly from: string;
  readonly to: string;
  readonly minAmount: string;
  readonly maxAmount: string;
}

/** The API's own documented defaults, so an unfiltered list matches the server exactly. */
export const TRANSACTION_LIST_DEFAULTS: TransactionListFilters = {
  search: '',
  page: 1,
  pageSize: TRANSACTION_PAGE_SIZE_DEFAULT,
  sort: 'businessDate',
  direction: 'desc',
  status: '',
  paymentMethod: '',
  from: '',
  to: '',
  minAmount: '',
  maxAmount: '',
};

export const TRANSACTION_LIST_QUERY_KEY = ['transactions', 'list'] as const;
export const TRANSACTION_DETAIL_QUERY_KEY = ['transactions', 'detail'] as const;
export const TRANSACTION_AUDIT_QUERY_KEY = ['transactions', 'audit'] as const;
export const TRANSACTION_RECEIPT_QUERY_KEY = ['transactions', 'receipt'] as const;

/**
 * The cached views that every transaction write makes stale.
 *
 * A member contribution is a ledger row *and* an input to the member's derived contribution
 * status: `receivedPaise`, `remainingPaise`, and PAID / PARTIALLY PAID / NOT PAID are computed
 * by the API from the active member-contribution transactions and are never stored on the
 * period (`REQ-CONTRIB-002`, `REQ-CONTRIB-003`). A create, a correction, and a void therefore
 * all change the member screen, and leaving its cache alone showed a month the Admin had just
 * paid in full as `Not paid` until a full page reload — a screen contradicting the ledger, which
 * the state-honesty rule forbids. The member's own transaction history changes for the same
 * reason.
 *
 * The set lives here, in the shared transaction layer, rather than in each caller so the three
 * mutations cannot drift apart and reopen the same hole. The member *list* is deliberately not
 * invalidated: it shows only the member ID, name, phone, and date added, none of which a
 * transaction can change.
 */
export function invalidateTransactionDependents(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: TRANSACTION_LIST_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: TRANSACTION_DETAIL_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: TRANSACTION_AUDIT_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: TRANSACTION_RECEIPT_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: CONTRIBUTION_SUMMARY_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: MEMBER_DETAIL_QUERY_KEY });
}

/**
 * Extra query keys a screen adds to narrow a list.
 *
 * The transaction list is one endpoint filtered by `type`, `incomeType`, or `categoryId`
 * rather than a separate endpoint per kind, so the narrowing is expressed as extra parameters
 * rather than as a different path.
 */
export type TransactionQueryExtras = Readonly<Record<string, string>>;

/**
 * Builds the documented list query string.
 *
 * Every non-empty criterion is sent and every empty one is omitted, so the request states the
 * complete intent and an empty filter is never mistaken for a filter that matched nothing.
 * Paging and sorting are always sent so the request cannot be quietly reshaped by a server
 * default the browser does not know about.
 */
export function transactionListPath(
  filters: TransactionListFilters,
  path: string,
  extras: TransactionQueryExtras = {},
): string {
  const query = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    sort: filters.sort,
    direction: filters.direction,
  });

  if (filters.search.trim() !== '') {
    query.set('search', filters.search.trim());
  }
  if (filters.status !== '') {
    query.set('status', filters.status);
  }
  if (filters.paymentMethod !== '') {
    query.set('paymentMethod', filters.paymentMethod);
  }
  if (filters.from !== '') {
    query.set('from', filters.from);
  }
  if (filters.to !== '') {
    query.set('to', filters.to);
  }
  if (filters.minAmount.trim() !== '') {
    query.set('minAmount', filters.minAmount.trim());
  }
  if (filters.maxAmount.trim() !== '') {
    query.set('maxAmount', filters.maxAmount.trim());
  }

  for (const [name, value] of Object.entries(extras)) {
    if (value !== '') {
      query.set(name, value);
    }
  }

  return `${path}?${query.toString()}`;
}

/** Clamps a requested page size into the range the API accepts. */
export function clampTransactionPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return TRANSACTION_PAGE_SIZE_DEFAULT;
  }

  return Math.min(pageSize, TRANSACTION_PAGE_SIZE_MAX);
}

export function isTransactionSortFieldValue(value: string): value is TransactionSortField {
  return (TRANSACTION_SORT_FIELDS as readonly string[]).includes(value);
}

/** The status vocabulary the filter control offers, guarded before it is sent. */
export function isTransactionStatusValue(value: string): value is TransactionStatus {
  return isTransactionStatus(value);
}

/**
 * Generates an idempotency key for one user intent.
 *
 * A retry of the *same* intent must reuse the same key and a *new* intent must get a new one.
 * The key is therefore held by the form for as long as that form represents one intent and
 * replaced only after the write succeeds. Generating a fresh key on every render or every
 * click would make each request look new to the server, which is exactly the duplicate the
 * requirement exists to prevent.
 *
 * The fallback is a uniqueness aid for development and test environments only. It is not a
 * secret and is never used for anything security-bearing.
 */
export function createIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The editable fields of a correction, as the form holds them.
 *
 * `categoryId` is optional because the same form corrects both transaction types. An income row
 * cannot have a category and the API forbids the field there, so an income screen leaves it
 * `undefined` and the key is omitted from the request entirely. An expense screen sets it, which
 * is the one association `REQ-EXP-004` allows to change.
 */
export interface CorrectionFormValues {
  readonly amount: string;
  readonly paymentMethod: PaymentMethod;
  readonly businessDate: string;
  readonly description: string;
  readonly notes: string;
  readonly categoryId?: string;
}

export interface CorrectionFieldErrors {
  readonly amount?: string;
  readonly paymentMethod?: string;
  readonly businessDate?: string;
  readonly description?: string;
  readonly notes?: string;
  readonly categoryId?: string;
}

const ZERO_AMOUNTS: readonly string[] = ['0', '0.0', '0.00'];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates the correction fields in the browser.
 *
 * Mirrors the API's shape rules using the shared contract constants rather than a second copy
 * written here. A zero amount is rejected locally as well as by the API's `amount_paise > 0`
 * rule, with a message that says which rule failed rather than only "invalid".
 *
 * `categoryId` is checked only when the form supplies one, so income is unaffected. A supplied
 * value must still be a UUID: a truncated or edited value would otherwise be sent and be
 * rejected as a malformed id, which is a worse message than saying so next to the field.
 */
export function validateCorrectionFields(values: CorrectionFormValues): CorrectionFieldErrors {
  const errors: {
    amount?: string;
    paymentMethod?: string;
    businessDate?: string;
    categoryId?: string;
  } = {};
  const amount = values.amount.trim();

  if (amount === '') {
    errors.amount = 'Enter an amount.';
  } else if (ZERO_AMOUNTS.includes(amount)) {
    errors.amount = 'The amount must be greater than zero.';
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) {
    errors.amount = MONEY_FORMAT_MESSAGE;
  }

  if (!isPaymentMethod(values.paymentMethod)) {
    errors.paymentMethod = 'Choose a payment method.';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.businessDate.trim())) {
    errors.businessDate = BUSINESS_DATE_FORMAT_MESSAGE;
  }

  if (values.categoryId !== undefined && !UUID_PATTERN.test(values.categoryId.trim())) {
    errors.categoryId = 'Choose a category.';
  }

  return errors;
}

export function hasCorrectionErrors(errors: CorrectionFieldErrors): boolean {
  return (
    errors.amount !== undefined ||
    errors.paymentMethod !== undefined ||
    errors.businessDate !== undefined ||
    errors.categoryId !== undefined
  );
}

/** Validates a void reason. `REQ-FIN-017` requires a non-empty reason. */
export function validateVoidReason(reason: string): string | undefined {
  return reason.trim() === '' ? 'Enter a reason for voiding this transaction.' : undefined;
}

/**
 * Builds the correction body, omitting blank optional text.
 *
 * `categoryId` is included only when the form supplies a non-empty one, which is exactly the
 * expense case. Income leaves it undefined, so nothing changes for the existing flow and the
 * API never sees a category key it would have to reject. `null` is never sent: `REQ-EXP-004`
 * requires an expense to reference exactly one category, so a correction can move the category
 * but cannot strip it.
 */
export function correctionRequestBody(values: CorrectionFormValues): {
  amount?: string;
  paymentMethod: PaymentMethod;
  businessDate: string;
  description?: string;
  notes?: string;
  categoryId?: string;
} {
  const amount = values.amount.trim();
  const description = values.description.trim();
  const notes = values.notes.trim();
  const categoryId = values.categoryId?.trim() ?? '';

  return {
    ...(amount === '' ? {} : { amount }),
    paymentMethod: values.paymentMethod,
    businessDate: values.businessDate.trim(),
    ...(description === '' ? {} : { description }),
    ...(notes === '' ? {} : { notes }),
    ...(categoryId === '' ? {} : { categoryId }),
  };
}

export interface TransactionFailure {
  readonly errorMessage?: string;
  readonly conflict: boolean;
  /** Field-level issues from a `VALIDATION_FAILED` response, keyed by field name. */
  readonly fieldIssues: Readonly<Record<string, string>>;
}

const NO_FIELD_ISSUES: Readonly<Record<string, string>> = {};

/**
 * Turns a thrown value into what a screen shows, and nothing more.
 *
 * A `409` is separated from other failures because it is not an error message to show: it
 * means the transaction changed since the form was loaded, and the only safe next step is to
 * reload and re-enter the edit. `docs/07-SECURITY-RULES.md` forbids exposing internals, so an
 * unrecognized error is given a generic message rather than its own text.
 */
export function describeTransactionFailure(error: unknown): TransactionFailure {
  if (error instanceof ApiClientError) {
    if (error.status === 409) {
      return { conflict: true, fieldIssues: fieldIssuesByName(error) };
    }

    return { errorMessage: error.message, conflict: false, fieldIssues: fieldIssuesByName(error) };
  }

  if (error instanceof ApiTransportError) {
    return { errorMessage: error.message, conflict: false, fieldIssues: NO_FIELD_ISSUES };
  }

  return {
    errorMessage: 'Something went wrong. Please try again.',
    conflict: false,
    fieldIssues: NO_FIELD_ISSUES,
  };
}

/**
 * Reads the field-level issues out of an API validation error.
 *
 * `docs/06-API-SPEC.md` returns `error.fields` for a validation failure, so a server-side
 * rejection is shown against the field it belongs to. An unknown field keeps its own name
 * rather than being attached to the first input, which would be a lie about where the problem
 * is.
 */
export function fieldIssuesByName(error: unknown): Readonly<Record<string, string>> {
  if (!(error instanceof ApiClientError) || error.fields === undefined) {
    return NO_FIELD_ISSUES;
  }

  const issues: Record<string, string> = {};

  for (const issue of error.fields) {
    issues[issue.field] ??= issue.message;
  }

  return issues;
}

export function useTransactionList<TItem extends TransactionSummary = TransactionSummary>(
  filters: TransactionListFilters,
  path: string,
  extras: TransactionQueryExtras = {},
) {
  const client = useApiClient();

  return useQuery({
    // The key carries every filter, the path, and the narrowing keys, so moving between income
    // and expenses cannot show the previous screen's rows while the new request is in flight.
    queryKey: [...TRANSACTION_LIST_QUERY_KEY, path, filters, extras],
    queryFn: ({ signal }) =>
      client.getList<TItem>(transactionListPath(filters, path, extras), { signal }),
    retry: false,
    // The Admin is actively changing the criteria; briefly showing the previous page is less
    // confusing than an empty table, and the row count is labelled as updating.
    placeholderData: (previous) => previous,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useTransactionDetail(id: string | undefined) {
  const client = useApiClient();

  return useQuery({
    queryKey: [...TRANSACTION_DETAIL_QUERY_KEY, id],
    queryFn: ({ signal }) =>
      client.get<TransactionSummary>(`/transactions/${id ?? ''}`, { signal }),
    enabled: id !== undefined,
    retry: false,
  });
}

export function useTransactionAudit(id: string | undefined) {
  const client = useApiClient();

  return useQuery({
    queryKey: [...TRANSACTION_AUDIT_QUERY_KEY, id],
    queryFn: ({ signal }) =>
      client.get<readonly TransactionAuditEventView[]>(`/transactions/${id ?? ''}/audit`, {
        signal,
      }),
    enabled: id !== undefined,
    retry: false,
  });
}

export function useTransactionReceipt(id: string | undefined) {
  const client = useApiClient();

  return useQuery({
    queryKey: [...TRANSACTION_RECEIPT_QUERY_KEY, id],
    queryFn: ({ signal }) =>
      client.get<TransactionReceiptView>(`/transactions/${id ?? ''}/receipt`, { signal }),
    enabled: id !== undefined,
    retry: false,
  });
}

/**
 * An audited correction.
 *
 * The revision the form was loaded with travels in `If-Match` and the key in
 * `Idempotency-Key`, both supplied by the caller. Neither is ever read from component state the
 * Admin can type into, so the browser cannot claim a revision it did not read or reuse a key
 * across two different edits.
 */
export function useCorrectTransaction(id: string | undefined, idempotencyKey: string | undefined) {
  const client = useApiClient();
  const { withCsrf } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CorrectionFormValues & { readonly revision: number }) => {
      if (id === undefined || idempotencyKey === undefined) {
        return Promise.reject(new ApiTransportError('No transaction was selected.'));
      }

      return withCsrf((csrfToken) =>
        client.patch<TransactionSummary>(`/transactions/${id}`, correctionRequestBody(input), {
          csrfToken,
          ifMatch: `"${input.revision}"`,
          idempotencyKey,
        }),
      );
    },
    onSuccess: (updated) => {
      invalidateTransactionDependents(queryClient);
      // The detail cache is updated directly so the screen shows the new revision immediately.
      // `revision` is what the next edit sends as `If-Match`, so a stale value here would
      // produce a conflict against an edit that just succeeded.
      queryClient.setQueryData<TransactionSummary>(
        [...TRANSACTION_DETAIL_QUERY_KEY, id],
        (previous) => (previous === undefined ? previous : { ...previous, ...updated }),
      );
    },
  });
}

/**
 * A reason-required void.
 *
 * The row is preserved, so the screen must say so plainly rather than implying a deletion; the
 * Admin needs to know the record is still in the ledger's history and simply no longer counts
 * toward an active total.
 */
export function useVoidTransaction(id: string | undefined, idempotencyKey: string | undefined) {
  const client = useApiClient();
  const { withCsrf } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reason: string) => {
      if (id === undefined || idempotencyKey === undefined) {
        return Promise.reject(new ApiTransportError('No transaction was selected.'));
      }

      return withCsrf((csrfToken) =>
        client.post<TransactionSummary>(
          `/transactions/${id}/void`,
          { reason: reason.trim() },
          { csrfToken, idempotencyKey },
        ),
      );
    },
    onSuccess: (voided) => {
      invalidateTransactionDependents(queryClient);
      queryClient.setQueryData<TransactionSummary>(
        [...TRANSACTION_DETAIL_QUERY_KEY, id],
        (previous) => (previous === undefined ? previous : { ...previous, ...voided }),
      );
    },
  });
}
