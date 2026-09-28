import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MEMBER_NAME_MAX_LENGTH,
  MEMBER_NOTES_MAX_LENGTH,
  MEMBER_PAGE_SIZE_DEFAULT,
  MEMBER_PAGE_SIZE_MAX,
  MEMBER_SEARCH_MAX_LENGTH,
  normalizePhone,
  phoneFormatMessage,
  type ContributionPeriodSummary,
  type ContributionPeriodView,
  type MemberDetail,
  type MemberSortDirection,
  type MemberSortField,
  type MemberSummary,
} from '@hyssop/contracts';
import { useApiClient } from '../../app/providers/ApiClientProvider';
import { ApiClientError, ApiTransportError } from '../../lib/api-client';
import { useSession } from '../auth/SessionProvider';

/**
 * Member and contribution-period data access for the browser.
 *
 * Every read and every write goes through the real API client and a real endpoint. There
 * is no member data held in this module, so a screen cannot pass by rendering something
 * the server never sent, and there is no "total" that is not derived from a response.
 *
 * The pure helpers (`memberListPath`, `validateMemberFields`, `parseExpectedAmount`) are
 * exported separately from the hooks because they carry the rules the browser can check
 * before a request, and those rules come from the shared contract so the browser cannot
 * disagree with the API about them.
 */

export const MEMBER_LIST_QUERY_KEY = ['members', 'list'] as const;
export const MEMBER_DETAIL_QUERY_KEY = ['members', 'detail'] as const;
export const CONTRIBUTION_SUMMARY_QUERY_KEY = ['contribution-periods', 'summary'] as const;

export interface MemberListFilters {
  readonly search: string;
  readonly page: number;
  readonly pageSize: number;
  readonly sort: MemberSortField;
  readonly direction: MemberSortDirection;
}

/** The API's own documented defaults, so an unfiltered list matches the server exactly. */
export const MEMBER_LIST_DEFAULTS: MemberListFilters = {
  search: '',
  page: 1,
  pageSize: MEMBER_PAGE_SIZE_DEFAULT,
  sort: 'name',
  direction: 'asc',
};

export interface MemberFieldErrors {
  readonly name?: string;
  readonly phone?: string;
  readonly notes?: string;
}

/** The editable member fields, shared by the create and edit forms. */
export interface MemberFormValues {
  readonly name: string;
  readonly phone: string;
  readonly notes: string;
}

export const EMPTY_MEMBER_FORM: MemberFormValues = { name: '', phone: '', notes: '' };

/**
 * Validates the member fields in the browser.
 *
 * `REQ-MEM-005` requires the *same* phone rule in the UI, the API, and the database, so
 * the rule is the shared `normalizePhone` from `@hyssop/contracts` rather than a second
 * copy written here. This is a convenience that lets the Admin see a problem before a
 * round trip; the API still validates, and the API is the enforcement point.
 *
 * A blank optional field is omitted from the request rather than sent as an empty string,
 * because the API treats a missing value as "no phone" and an empty string is a value that
 * still has to be normalized.
 */
export function validateMemberFields(
  values: Pick<MemberFormValues, 'name' | 'phone' | 'notes'>,
): MemberFieldErrors {
  const errors: { name?: string; phone?: string; notes?: string } = {};
  const name = values.name.trim();

  if (name === '') {
    errors.name = 'A member name is required.';
  } else if (name.length > MEMBER_NAME_MAX_LENGTH) {
    errors.name = `A member name must be ${MEMBER_NAME_MAX_LENGTH} characters or fewer.`;
  }

  const phoneMessage = phoneFormatMessage(values.phone);

  if (phoneMessage !== undefined) {
    errors.phone = `Enter a phone number with 7 to 15 digits. ${phoneMessage}.`;
  }

  if (values.notes.trim().length > MEMBER_NOTES_MAX_LENGTH) {
    errors.notes = `Notes must be ${MEMBER_NOTES_MAX_LENGTH} characters or fewer.`;
  }

  return errors;
}

export function hasFieldErrors(errors: MemberFieldErrors): boolean {
  return errors.name !== undefined || errors.phone !== undefined || errors.notes !== undefined;
}

/**
 * Builds the request body from the form.
 *
 * Blank optional fields are omitted, which is what makes "clear the phone" work: an empty
 * input is absent from the request and the API stores `null`, rather than submitting `""`.
 */
export function memberRequestBody(values: Pick<MemberFormValues, 'name' | 'phone' | 'notes'>): {
  name: string;
  phone?: string;
  notes?: string;
} {
  const phone = normalizePhone(values.phone);
  const notes = values.notes.trim();

  return {
    name: values.name.trim(),
    ...(phone === null ? {} : { phone }),
    ...(notes === '' ? {} : { notes }),
  };
}

/**
 * Builds the documented list query string.
 *
 * Only `search` is omitted when empty; the paging and sorting values are always sent so
 * the request states the complete intent, and a stale or wrong page cannot be hidden by
 * relying on a server default.
 */
export function memberListPath(filters: MemberListFilters): string {
  const query = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    sort: filters.sort,
    direction: filters.direction,
  });
  const search = filters.search.trim();

  if (search !== '') {
    query.set('search', search);
  }

  return `/members?${query.toString()}`;
}

/** Clamps a requested page size into the range the API accepts. */
export function clampPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return MEMBER_PAGE_SIZE_DEFAULT;
  }

  return Math.min(pageSize, MEMBER_PAGE_SIZE_MAX);
}

/** Keeps a search box within the documented length so the API is not sent an invalid filter. */
export function clampSearch(search: string): string {
  return search.slice(0, MEMBER_SEARCH_MAX_LENGTH);
}

export function useMemberList(filters: MemberListFilters) {
  const client = useApiClient();

  return useQuery({
    // The key carries every filter, so changing the search, the sort, or the page
    // necessarily requests a different result instead of reusing the previous one.
    queryKey: [...MEMBER_LIST_QUERY_KEY, filters],
    queryFn: ({ signal }) => client.getList<MemberSummary>(memberListPath(filters), { signal }),
    retry: false,
    // The Admin is actively changing the criteria; briefly showing the previous page is
    // less confusing than an empty table, and the row count is labelled as updating.
    placeholderData: (previous) => previous,
    // Matches the application default and the health query. A shorter window would mark the
    // result stale the instant it arrived and fire a second identical request on every
    // visit, which is wasted work rather than fresher data.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useMemberDetail(memberId: string | undefined) {
  const client = useApiClient();

  return useQuery({
    queryKey: [...MEMBER_DETAIL_QUERY_KEY, memberId],
    queryFn: ({ signal }) => client.get<MemberDetail>(`/members/${memberId ?? ''}`, { signal }),
    enabled: memberId !== undefined,
    retry: false,
  });
}

export function useContributionSummary(year: number, month: number) {
  const client = useApiClient();

  return useQuery({
    queryKey: [...CONTRIBUTION_SUMMARY_QUERY_KEY, year, month],
    queryFn: ({ signal }) =>
      client.get<ContributionPeriodSummary>(
        `/contribution-periods/summary?year=${year}&month=${month}`,
        { signal },
      ),
    retry: false,
  });
}

export function useCreateMember() {
  const client = useApiClient();
  const { withCsrf } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: MemberFormValues) =>
      withCsrf((csrfToken) =>
        client.post<MemberSummary>('/members', memberRequestBody(values), { csrfToken }),
      ),
    onSuccess: () => {
      // The new member changes both the list and the result count, so the cached list is
      // invalidated rather than patched, and a stale count is never shown.
      void queryClient.invalidateQueries({ queryKey: MEMBER_LIST_QUERY_KEY });
    },
  });
}

/**
 * Audited edit with an optimistic lock.
 *
 * The revision the form was loaded with travels in `If-Match`, exactly as
 * `docs/06-API-SPEC.md` requires. It is never an editable field and never read from
 * component state, so the browser cannot claim a revision it did not actually read, and a
 * conflicting edit is rejected by the API rather than silently overwriting.
 */
export function useUpdateMember(memberId: string | undefined) {
  const client = useApiClient();
  const { withCsrf } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: MemberFormValues & { readonly revision: number }) => {
      if (memberId === undefined) {
        return Promise.reject(new ApiTransportError('No member was selected.'));
      }

      return withCsrf((csrfToken) =>
        client.patch<MemberSummary>(`/members/${memberId}`, memberRequestBody(input), {
          csrfToken,
          ifMatch: `"${input.revision}"`,
        }),
      );
    },
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: MEMBER_LIST_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: MEMBER_DETAIL_QUERY_KEY });
      // The detail cache is also updated directly so the screen shows the new revision
      // immediately; `revision` is what the next edit would send as `If-Match`, so a
      // stale value here would produce a conflict against an edit that just succeeded.
      queryClient.setQueryData<MemberDetail>([...MEMBER_DETAIL_QUERY_KEY, memberId], (previous) =>
        previous === undefined ? previous : { ...previous, ...updated },
      );
    },
  });
}

export interface PeriodFormValues {
  readonly year: number;
  readonly month: number;
  /** Blank means "use the amount the church configured as the default". */
  readonly amount: string;
}

export const DEFAULT_PERIOD_FORM: PeriodFormValues = { year: 0, month: 0, amount: '' };

/**
 * The years the period form accepts, matching the range the API accepts in a period path.
 */
export const MIN_PERIOD_YEAR = 1970;
export const MAX_PERIOD_YEAR = 9999;

/**
 * The outcome of validating the expected amount.
 *
 * The three cases are separate types rather than a `string | undefined` because the two
 * string cases are not interchangeable: an accepted amount and a rejection message are both
 * strings, so a caller that tested `typeof result === 'string'` would treat every valid
 * amount as an error, show the typed amount as the error text, and refuse to save. That is
 * exactly what happened here, and a helper test that only checked the returned value would
 * not have caught it. A `kind` field makes the branch the caller writes the only branch
 * available.
 */
export type ParsedExpectedAmount =
  /** The field was left blank: the API applies the configured default. */
  | { readonly kind: 'blank' }
  /** A valid decimal INR string, at most two decimal places. */
  | { readonly kind: 'amount'; readonly value: string }
  /** The text cannot be an amount; `message` is shown against the field. */
  | { readonly kind: 'invalid'; readonly message: string };

/**
 * Validates the expected amount the Admin typed.
 *
 * The API accepts a decimal INR string with at most two decimal places, so the browser
 * applies the identical shape. Leaving it blank is allowed and meaningful: the API then
 * opens the period at the configured `DEFAULT_MONTHLY_CONTRIBUTION_PAISE` value, which is
 * the behaviour the phase document requires. Sending an empty string would be an invalid
 * amount instead, so a blank field is reported as `blank` and the caller omits
 * `expectedPaise` entirely.
 */
export function parseExpectedAmount(amount: string): ParsedExpectedAmount {
  const trimmed = amount.trim();

  if (trimmed === '') {
    return { kind: 'blank' };
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    return {
      kind: 'invalid',
      message: 'Enter an amount such as 500 or 500.00, with at most two decimal places.',
    };
  }

  return { kind: 'amount', value: trimmed };
}

/**
 * Validates the year the Admin typed into the contribution-period form.
 *
 * The value is validated as text on purpose. A controlled number field that only stores
 * values inside the accepted range cannot represent an intermediate state, so clearing the
 * field or fixing one digit silently snaps it back and the Admin is unable to correct a
 * typo at all. Keeping the raw text and validating it here means every keystroke is
 * accepted, and the problem is reported once, at the point the Admin asks to save.
 *
 * Returns the year, or a message to show against the field.
 */
export function parsePeriodYear(year: string): number | string {
  const trimmed = year.trim();

  if (!/^\d{4}$/.test(trimmed)) {
    return 'Enter a four-digit year, for example 2026.';
  }

  const value = Number.parseInt(trimmed, 10);

  if (value < MIN_PERIOD_YEAR || value > MAX_PERIOD_YEAR) {
    return `Enter a year between ${MIN_PERIOD_YEAR} and ${MAX_PERIOD_YEAR}.`;
  }

  return value;
}

/**
 * A validated period write.
 *
 * `expectedPaise` is `undefined` when the Admin left the amount blank, which is the
 * request that asks the API to apply the configured default. Validation happens in the
 * form through `parseExpectedAmount`, so this hook never invents a local error to render
 * and only ever reports what the API answered.
 */
export interface SetPeriodRequest {
  readonly year: number;
  readonly month: number;
  readonly expectedPaise?: string;
}

export function useSetContributionPeriod(memberId: string | undefined) {
  const client = useApiClient();
  const { withCsrf } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: SetPeriodRequest) => {
      if (memberId === undefined) {
        return Promise.reject(new ApiTransportError('No member was selected.'));
      }

      return withCsrf((csrfToken) =>
        client.put<ContributionPeriodView>(
          `/contribution-periods/${memberId}/${request.year}/${request.month}`,
          // An omitted amount is what asks the API to apply the configured default. Sending
          // `expectedPaise: undefined` would be dropped by JSON serialization anyway, but
          // building the body conditionally makes the intent explicit and reviewable.
          request.expectedPaise === undefined ? {} : { expectedPaise: request.expectedPaise },
          { csrfToken },
        ),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MEMBER_DETAIL_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: CONTRIBUTION_SUMMARY_QUERY_KEY });
    },
  });
}

/**
 * Turns a thrown value into what a screen shows, and nothing more.
 *
 * A `409` is separated from other failures because it is not an error message to show: it
 * means the member changed since the form was loaded, and the only safe next step is to
 * reload and re-enter the edit. `docs/07-SECURITY-RULES.md` forbids exposing internals, so
 * an unrecognized error is given a generic message rather than its own text.
 */
export function describeMemberFailure(error: unknown): MemberFailure {
  if (error instanceof ApiClientError) {
    if (error.status === 409) {
      return { conflict: true };
    }

    if (error.status === 400 && error.code === 'VALIDATION_FAILED') {
      // A locally-raised validation message is carried on a `400`; show it verbatim.
      return { errorMessage: error.message, conflict: false };
    }

    return { errorMessage: error.message, conflict: false };
  }

  if (error instanceof ApiTransportError) {
    return { errorMessage: error.message, conflict: false };
  }

  return { errorMessage: 'Something went wrong. Please try again.', conflict: false };
}

export interface MemberFailure {
  readonly errorMessage?: string;
  readonly conflict: boolean;
}

/**
 * Reads the field-level issues out of an API validation error.
 *
 * `docs/06-API-SPEC.md` returns `error.fields` for a validation failure. The browser uses
 * it so a server-side rejection is shown against the field it belongs to, not as one
 * undifferentiated message. An unknown field is ignored rather than attached to the first
 * input, which would be a lie about where the problem is.
 */
export function fieldIssuesOf(error: unknown): MemberFieldErrors {
  if (!(error instanceof ApiClientError) || error.fields === undefined) {
    return {};
  }

  const issues: { name?: string; phone?: string; notes?: string } = {};

  for (const issue of error.fields) {
    if (issue.field === 'name' || issue.field === 'phone' || issue.field === 'notes') {
      issues[issue.field] = issue.message;
    }
  }

  return issues;
}
