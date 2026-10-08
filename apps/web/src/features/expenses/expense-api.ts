import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BUSINESS_DATE_FORMAT_MESSAGE,
  EXPENSE_CATEGORY_NAME_MAX_LENGTH,
  EXPENSE_REASON_NAME_MAX_LENGTH,
  MONEY_FORMAT_MESSAGE,
  PAYMENT_METHODS,
  TRANSACTION_DESCRIPTION_MAX_LENGTH,
  TRANSACTION_NOTES_MAX_LENGTH,
  VENDOR_MAX_LENGTH,
  isPaymentMethod,
  type ExpenseCategoryView,
  type ExpenseReasonView,
  type ExpenseSummary,
  type PaymentMethod,
  type TransactionSummary,
} from '@hyssop/contracts';
import { useApiClient } from '../../app/providers/ApiClientProvider';
import { ApiTransportError } from '../../lib/api-client';
import { saveCsvTextFile } from '../../lib/csv-download';
import { useSession } from '../auth/SessionProvider';
import { invalidateTransactionDependents } from '../transactions/transaction-api';

/**
 * Expense form and category data access.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-EXP-001` to `REQ-EXP-005` and
 * `docs/phases/PHASE-06-EXPENSES.md`. An expense is created through `POST /api/v1/expenses`;
 * the list, detail, correction, void, and audit behaviour is the shared transaction contract in
 * `../transactions/transaction-api` and is deliberately not reimplemented per expense.
 *
 * The three rules that are genuinely expense-specific are enforced here as well as by the API:
 *
 * - A category is required. `REQ-EXP-004` states an expense must reference exactly one category,
 *   and the browser cannot offer "no category" at all, so the empty state is not a valid
 *   selection to recover from.
 * - A reason is required, and it must belong to the chosen category. `REQ-EXP-005` makes the reason
 *   the second axis of classification, so the picker is scoped to the selected category and is
 *   cleared whenever the category changes. Keeping a reason that belonged to the previous category
 *   would be offering a value the server refuses, which is a dead control.
 * - The category picker is built from `GET /api/v1/expenses/categories`, which the API
 *   documents as the *active* categories. That is why a deactivated category disappears from the
 *   dropdown instead of appearing greyed out and then being refused: a control that submits a
 *   value the server rejects is a dead control.
 *
 * An expense is never sent a member or an income type, so those keys are absent from the request
 * body entirely. A value that is never sent cannot be stored or misread, which is stronger than
 * asking the server to strip it.
 */

export const EXPENSE_CATEGORIES_QUERY_KEY = ['expense-categories'] as const;
export const EXPENSE_REASONS_QUERY_KEY = ['expense-reasons'] as const;
export const EXPENSE_CATEGORIES_PATH = '/expenses/categories';
export const EXPENSE_REASONS_PATH = '/expenses/reasons';
export const EXPENSE_EXPORT_PATH = '/reports/expense-transactions/export.csv';

export const EXPENSE_LIST_DEFAULTS = {
  page: 1,
  pageSize: 20,
  sort: 'businessDate',
  direction: 'desc',
} as const;

export interface ExpenseFormValues {
  readonly categoryId: string;
  readonly expenseReasonId: string;
  readonly amount: string;
  readonly paymentMethod: PaymentMethod;
  readonly businessDate: string;
  readonly description: string;
  readonly notes: string;
  readonly vendor: string;
}

export const EMPTY_EXPENSE_FORM: ExpenseFormValues = {
  categoryId: '',
  expenseReasonId: '',
  amount: '',
  paymentMethod: 'CASH',
  businessDate: '',
  description: '',
  notes: '',
  vendor: '',
};

export interface ExpenseFieldErrors {
  readonly categoryId?: string;
  readonly expenseReasonId?: string;
  readonly amount?: string;
  readonly paymentMethod?: string;
  readonly businessDate?: string;
  readonly description?: string;
  readonly notes?: string;
  readonly vendor?: string;
}

export const PAYMENT_METHOD_CHOICES: readonly PaymentMethod[] = PAYMENT_METHODS;

const ZERO_AMOUNTS: readonly string[] = ['0', '0.0', '0.00'];

/**
 * Validates the expense fields in the browser.
 *
 * Mirrors the API's shape rules with the shared contract constants rather than a second copy
 * written here, so the browser cannot disagree with the server about what a valid amount or date
 * looks like. The API validates everything again; this only saves a round trip and puts the
 * message next to the field that caused it.
 */
export function validateExpenseFields(values: ExpenseFormValues): ExpenseFieldErrors {
  const errors: {
    categoryId?: string;
    expenseReasonId?: string;
    amount?: string;
    paymentMethod?: string;
    businessDate?: string;
    description?: string;
    notes?: string;
    vendor?: string;
  } = {};

  if (values.categoryId.trim() === '') {
    errors.categoryId = 'Choose a category.';
  }

  if (values.expenseReasonId.trim() === '') {
    // Reported against the reason, not the category, so the message lands next to the control the
    // Admin has to act on. Choosing a category is a separate, already-satisfied action.
    errors.expenseReasonId = 'Choose a reason.';
  }

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

  if (values.description.trim().length > TRANSACTION_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description must be ${TRANSACTION_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  if (values.notes.trim().length > TRANSACTION_NOTES_MAX_LENGTH) {
    errors.notes = `Notes must be ${TRANSACTION_NOTES_MAX_LENGTH} characters or fewer.`;
  }

  // The vendor is optional (`REQ-EXP-007`), so only its length is checked. The value is trimmed,
  // and the API caps it at the same shared constant rather than a second copy written here.
  if (values.vendor.trim().length > VENDOR_MAX_LENGTH) {
    errors.vendor = `Vendor must be ${VENDOR_MAX_LENGTH} characters or fewer.`;
  }

  return errors;
}

export function hasExpenseFieldErrors(errors: ExpenseFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Builds the create body.
 *
 * Only the keys `docs/06-API-SPEC.md` defines for `POST /api/v1/expenses` are sent, and blank
 * optional text is omitted rather than sent empty. The amount is passed as the exact decimal
 * string the Admin typed: no `Number` conversion happens here, because `Number('1.10')` is the
 * float 1.1 and the difference between 110 and 110.00000000000001 paise is exactly what
 * `docs/01-REQUIREMENTS.md` forbids. The API parses the string into integer paise.
 */
export function expenseRequestBody(values: ExpenseFormValues): {
  categoryId: string;
  expenseReasonId: string;
  amount: string;
  paymentMethod: PaymentMethod;
  businessDate: string;
  description?: string;
  notes?: string;
  vendor?: string;
} {
  const description = values.description.trim();
  const notes = values.notes.trim();
  const vendor = values.vendor.trim();

  return {
    categoryId: values.categoryId.trim(),
    expenseReasonId: values.expenseReasonId.trim(),
    amount: values.amount.trim(),
    paymentMethod: values.paymentMethod,
    businessDate: values.businessDate.trim(),
    ...(description === '' ? {} : { description }),
    ...(notes === '' ? {} : { notes }),
    ...(vendor === '' ? {} : { vendor }),
  };
}

/**
 * Narrows a shared transaction to an expense.
 *
 * `TransactionSummary.category` is nullable because income has no category, so the *shape* of an
 * expense is not proven by `type` alone. Checking the category and the derived `hasReceipt`
 * together is what makes the narrowing honest: a record claiming `EXPENSE` with no category, or
 * with no receipt state at all, is not something this screen should render as a normal expense
 * because `REQ-EXP-004` and `REQ-DOC-003` would both be silently unanswerable.
 */
export function isExpenseSummary(record: TransactionSummary): record is ExpenseSummary {
  return (
    record.type === 'EXPENSE' &&
    record.category !== null &&
    typeof (record as { readonly hasReceipt?: unknown }).hasReceipt === 'boolean'
  );
}

/**
 * Finds a category by id, for seeding the picker and the edit form.
 *
 * Returns `undefined` rather than a placeholder when the category is not in the active list.
 * That happens legitimately: the expense was filed under a category that has since been
 * deactivated, and its id is real but is not offered for a new entry. The caller shows the
 * retained label from the transaction and does not silently substitute a different category.
 */
export function findExpenseCategory(
  categories: readonly ExpenseCategoryView[],
  categoryId: string | undefined,
): ExpenseCategoryView | undefined {
  if (categoryId === undefined) {
    return undefined;
  }

  return categories.find((category) => category.id === categoryId);
}

/**
 * The label to show for an expense's category, including the deactivated case.
 *
 * A historical expense under a deactivated category must still read correctly, so the name is
 * shown with an explicit "inactive" note rather than being blanked or replaced. The note is
 * state, not a design flourish: without it the Admin cannot tell a typo apart from a category
 * that was retired.
 */
export function expenseCategoryLabel(
  categories: readonly ExpenseCategoryView[],
  category: ExpenseSummary['category'],
): string {
  const known = findExpenseCategory(categories, category.id);

  if (category.status === 'INACTIVE' || known?.status === 'INACTIVE') {
    return `${category.name} (inactive)`;
  }

  return category.name;
}

/** Validates a custom category name. Shared with the Phase 10 Settings screen. */
export function validateCategoryName(name: string): string | undefined {
  if (name.trim() === '') {
    return 'Enter a category name.';
  }

  if (name.trim().length > EXPENSE_CATEGORY_NAME_MAX_LENGTH) {
    return `Name must be ${EXPENSE_CATEGORY_NAME_MAX_LENGTH} characters or fewer.`;
  }

  return undefined;
}

/**
 * Validates a custom reason name.
 *
 * Same rules as `validateCategoryName`, taken from the shared
 * `EXPENSE_REASON_NAME_MAX_LENGTH`, so the two custom-name dialogs on this screen cannot drift
 * apart or disagree with the API's own limit.
 */
export function validateReasonName(name: string): string | undefined {
  if (name.trim() === '') {
    return 'Enter a reason name.';
  }

  if (name.trim().length > EXPENSE_REASON_NAME_MAX_LENGTH) {
    return `Name must be ${EXPENSE_REASON_NAME_MAX_LENGTH} characters or fewer.`;
  }

  return undefined;
}

/**
 * Finds a reason by id within a category's reasons, for seeding the picker and the edit form.
 *
 * Scoped by category on purpose. An id is unique on its own, but the picker only ever holds one
 * category's reasons, so a lookup that ignored the category could surface a reason belonging to a
 * category the form is not currently set to -- which is precisely the mismatch the API refuses.
 */
export function findExpenseReason(
  reasons: readonly ExpenseReasonView[],
  categoryId: string | undefined,
  reasonId: string | undefined,
): ExpenseReasonView | undefined {
  if (categoryId === undefined || reasonId === undefined) {
    return undefined;
  }

  return reasons.find((reason) => reason.id === reasonId && reason.categoryId === categoryId);
}

/**
 * The label to show for an expense's reason, including the deactivated case.
 *
 * Same reasoning as `expenseCategoryLabel`: a historical expense whose reason has been deactivated
 * must still name the reason it was actually filed under, with an explicit note, because an Admin
 * reconciling a receipt needs to see that this is a retained label and not a stale one. The
 * reason's `name` is not edited by deactivation, so showing it plainly is truthful.
 */
export function expenseReasonLabel(
  reasons: readonly ExpenseReasonView[],
  reason: ExpenseSummary['expenseReason'],
): string {
  const known = findExpenseReason(reasons, reason.categoryId, reason.id);

  if (reason.status === 'INACTIVE' || known?.status === 'INACTIVE') {
    return `${reason.name} (inactive)`;
  }

  return reason.name;
}

/**
 * The active reasons, as the documented plain data array.
 *
 * `enabled: false` when no category is chosen rather than firing a request that the API documents as
 * invalid: `GET /api/v1/expenses/reasons` requires `categoryId`, so the only honest states before a
 * category exists are "not asked yet" and "asked and answered". `retry: false` and a one-minute
 * `staleTime` match `useExpenseCategories`, and the key includes the category so switching
 * categories cannot briefly paint the previous category's reasons under the new one.
 */
export function useExpenseReasons(categoryId: string | undefined) {
  const client = useApiClient();

  return useQuery({
    queryKey: [...EXPENSE_REASONS_QUERY_KEY, categoryId ?? ''],
    queryFn: ({ signal }) =>
      client.get<readonly ExpenseReasonView[]>(
        // `URLSearchParams` rather than string concatenation: the category id is a UUID and needs
        // no escaping, but this is the one place a value is interpolated into a query string, and
        // the encoder is the correct answer for whatever that value turns out to be.
        `${EXPENSE_REASONS_PATH}?${new URLSearchParams({ categoryId: categoryId ?? '' }).toString()}`,
        { signal },
      ),
    enabled: categoryId !== undefined && categoryId !== '',
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * The active categories, as the documented plain data array.
 *
 * `retry: false` and a one-minute `staleTime` because this is a bounded configuration list that
 * changes rarely: a create or a deactivation invalidates it explicitly, and a screen should not
 * refetch it on every focus and re-render the picker under the Admin's cursor.
 */
export function useExpenseCategories() {
  const client = useApiClient();

  return useQuery({
    queryKey: EXPENSE_CATEGORIES_QUERY_KEY,
    queryFn: ({ signal }) =>
      client.get<readonly ExpenseCategoryView[]>(EXPENSE_CATEGORIES_PATH, { signal }),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateExpense() {
  const client = useApiClient();
  const { withCsrf } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      readonly values: ExpenseFormValues;
      readonly idempotencyKey: string;
    }) => {
      if (input.idempotencyKey === '') {
        return Promise.reject(new ApiTransportError('No idempotency key was prepared.'));
      }

      return withCsrf((csrfToken) =>
        client.post<ExpenseSummary>('/expenses', expenseRequestBody(input.values), {
          csrfToken,
          // Sent on every create, as `docs/06-API-SPEC.md` requires. The key belongs to this one
          // submission, so a double submit or a retry records one expense, not two.
          idempotencyKey: input.idempotencyKey,
        }),
      );
    },
    onSuccess: () => {
      // A new expense changes the list, the counts, the category totals, and the audit view, so
      // every cached view that depends on the ledger is invalidated rather than patched.
      invalidateTransactionDependents(queryClient);
    },
  });
}

/**
 * A custom category created from the expense screen.
 *
 * `REQ-EXP-002` lets the Admin add a category the initial set does not contain. Creating it here
 * means the next expense can be filed under it without a detour to a Settings screen that Phase
 * 10 owns; the full Settings management UI is deliberately not built in this phase.
 */
export function useCreateExpenseCategory() {
  const client = useApiClient();
  const { withCsrf } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { readonly name: string; readonly idempotencyKey: string }) => {
      if (input.idempotencyKey === '') {
        return Promise.reject(new ApiTransportError('No idempotency key was prepared.'));
      }

      return withCsrf((csrfToken) =>
        client.post<ExpenseCategoryView>(
          EXPENSE_CATEGORIES_PATH,
          { name: input.name.trim() },
          { csrfToken, idempotencyKey: input.idempotencyKey },
        ),
      );
    },
    onSuccess: () => {
      // Only the category list changes here. A new category has no transactions yet, so the
      // expense list, the detail, and the audit trail are all still correct.
      void queryClient.invalidateQueries({ queryKey: EXPENSE_CATEGORIES_QUERY_KEY });
    },
  });
}

/**
 * A custom reason created from the expense screen, scoped to the category currently chosen.
 *
 * Mirrors `useCreateExpenseCategory`. The category id travels with the request rather than being
 * inferred server-side, because a reason is meaningless without its category and the server
 * creates the reason inside the category the form is actually showing. On success the reason list
 * is invalidated so the newly created reason is immediately selectable, and it is returned to the
 * caller so the form can select it without a second round trip.
 */
export function useCreateExpenseReason() {
  const client = useApiClient();
  const { withCsrf } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      readonly categoryId: string;
      readonly name: string;
      readonly idempotencyKey: string;
    }) => {
      if (input.idempotencyKey === '') {
        return Promise.reject(new ApiTransportError('No idempotency key was prepared.'));
      }

      if (input.categoryId.trim() === '') {
        return Promise.reject(new ApiTransportError('Choose a category before adding a reason.'));
      }

      return withCsrf((csrfToken) =>
        client.post<ExpenseReasonView>(
          EXPENSE_REASONS_PATH,
          { categoryId: input.categoryId.trim(), name: input.name.trim() },
          { csrfToken, idempotencyKey: input.idempotencyKey },
        ),
      );
    },
    onSuccess: (created) => {
      // A new reason has no transactions yet, so only the reason list is stale.
      void queryClient.invalidateQueries({ queryKey: EXPENSE_REASONS_QUERY_KEY });
      return created;
    },
  });
}

/**
 * The filters that drive the expense CSV download.
 *
 * Deliberately the same shape the list screen sends to `GET /api/v1/transactions`, so the file and
 * the table describe the same rows. `categoryId` is required by the export route, which is why the
 * download control is only offered once a category is chosen -- an export with no category would
 * be a whole-ledger download, a different action with different authorization and volume
 * consequences, and it is not what this button claims to do.
 */
export interface ExpenseExportFilters {
  readonly categoryId: string;
  readonly search?: string;
  readonly status?: string;
  readonly paymentMethod?: string;
  readonly from?: string;
  readonly to?: string;
  readonly minAmount?: string;
  readonly maxAmount?: string;
  readonly sort?: string;
  readonly direction?: string;
}

/**
 * Builds the export query, omitting empty optional filters.
 *
 * Sending `search=` or `from=` as empty strings would be a request the API has to interpret, and
 * an empty `from` is not the same as no lower bound. Omitting the key entirely is the only form
 * that is unambiguous.
 */
export function expenseExportQuery(filters: ExpenseExportFilters): Record<string, string> {
  const query: Record<string, string> = { categoryId: filters.categoryId };

  for (const key of [
    'search',
    'status',
    'paymentMethod',
    'from',
    'to',
    'minAmount',
    'maxAmount',
    'sort',
    'direction',
  ] as const) {
    const value = filters[key]?.trim();

    if (value !== undefined && value !== '') {
      query[key] = value;
    }
  }

  return query;
}

/**
 * Downloads the filtered expense CSV.
 *
 * Uses `client.getText` rather than a plain `<a href>` or `window.open` because the route is behind
 * the session cookie and returns `text/csv` as an attachment. Navigating to it directly would dump
 * a raw CSV (or a raw error body) into a tab instead of a download, and an expired session would
 * produce a page the UI cannot explain. `getText` already maps a failed request back to the
 * documented JSON error envelope, so the refusal and the session expiry arrive as real messages
 * beside the button rather than as a browser dialog.
 *
 * A `>10,000`-row result is refused by the API against `CSV_EXPORT_MAX_ROWS`, so this cannot silently
 * produce a truncated file; the message is surfaced verbatim.
 */
export function useDownloadExpenseCsv() {
  const client = useApiClient();

  return useMutation({
    mutationFn: async (filters: ExpenseExportFilters) => {
      if (filters.categoryId.trim() === '') {
        throw new ApiTransportError('Choose a category before downloading expenses.');
      }

      const query = expenseExportQuery(filters);
      const search = new URLSearchParams(query).toString();
      const download = await client.getText(
        search === '' ? EXPENSE_EXPORT_PATH : `${EXPENSE_EXPORT_PATH}?${search}`,
      );

      saveCsvTextFile(download.text, download.filename, 'expense-transactions.csv');

      return download.filename ?? 'expense-transactions.csv';
    },
  });
}
