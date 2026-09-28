/**
 * Shared HTTP response contract.
 *
 * Owned by `docs/06-API-SPEC.md`. The API and the web client both depend on this
 * module so that a change to the envelope cannot drift between the two.
 */

export const REQUEST_ID_HEADER = 'x-request-id';

export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INVALID_CREDENTIALS',
  'CSRF_FAILED',
  'REQUEST_FAILED',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiSuccessEnvelope<TData> {
  readonly data: TData;
}

export interface ApiFieldIssue {
  readonly field: string;
  readonly message: string;
}

export interface ApiErrorDetail {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly requestId: string;
  readonly fields?: readonly ApiFieldIssue[];
}

export interface ApiErrorBody {
  readonly error: ApiErrorDetail;
}

export type ApiEnvelope<TData> = ApiSuccessEnvelope<TData> | ApiErrorBody;

/**
 * List paging metadata, returned beside `data` on every list response.
 *
 * `docs/06-API-SPEC.md` requires list responses to "also include `pagination`" and
 * "every list has deterministic ordering and pagination", but does not name the fields.
 * These are the minimum a client needs to render and control a pager, decided in
 * `DEC-068`:
 * - `page` is 1-based, so the first page is page 1 and there is no page zero.
 * - `pageSize` echoes the effective, already-clamped page size actually applied.
 * - `totalItems` is the count of matching rows across all pages, not the page length.
 * - `totalPages` is derived from `totalItems` and `pageSize`, and is `0` for an empty
 *   result so a client never has to special-case a division by zero.
 */
export interface ApiPagination {
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface ApiListEnvelope<TData> {
  readonly data: readonly TData[];
  readonly pagination: ApiPagination;
}

/**
 * Builds a list envelope, deriving `totalPages` so the two can never disagree.
 *
 * The arithmetic is total: `totalPages` is a whole number of pages that always covers
 * `totalItems`, so a client can compute the last page without trusting the server.
 */
export function list<TData>(
  data: readonly TData[],
  pagination: { readonly page: number; readonly pageSize: number; readonly totalItems: number },
): ApiListEnvelope<TData> {
  if (pagination.pageSize < 1) {
    throw new RangeError('A list envelope requires a page size of at least 1.');
  }

  return {
    data,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalItems: pagination.totalItems,
      totalPages: Math.ceil(pagination.totalItems / pagination.pageSize),
    },
  };
}

/**
 * Validates the whole `pagination` block, not just its types.
 *
 * A guard that accepted negative or zero counts would let a malformed response render a
 * nonsensical pager, so the ranges are checked here rather than in each screen.
 */
export function isApiPagination(value: unknown): value is ApiPagination {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const page = candidate['page'];
  const pageSize = candidate['pageSize'];
  const totalItems = candidate['totalItems'];
  const totalPages = candidate['totalPages'];

  if (
    !Number.isInteger(page) ||
    !Number.isInteger(pageSize) ||
    !Number.isInteger(totalItems) ||
    !Number.isInteger(totalPages) ||
    (page as number) < 1 ||
    (pageSize as number) < 1 ||
    (totalItems as number) < 0 ||
    (totalPages as number) < 0
  ) {
    return false;
  }

  // The counts must agree with each other. Accepting `totalPages: 99` beside 20 items would
  // let a pager render pages that do not exist, and accepting a page beyond the last one
  // would let the UI show an empty list while claiming results remain.
  if (totalPages !== Math.ceil((totalItems as number) / (pageSize as number))) {
    return false;
  }

  return (page as number) <= Math.max(1, totalPages);
}

/**
 * Validates a list envelope.
 *
 * Used by the browser so a list screen fails loudly on a malformed response instead of
 * rendering `undefined` rows from a payload the contract does not describe.
 */
export function isApiListEnvelope<TItem>(value: unknown): value is ApiListEnvelope<TItem> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (!Array.isArray(candidate['data']) || !isApiPagination(candidate['pagination'])) {
    return false;
  }

  // The returned rows must fit inside the page they claim to be. Without this check a
  // truncated response would pass validation and render as a complete-looking list.
  const { pageSize } = candidate['pagination'];

  return (candidate['data'] as unknown[]).length <= pageSize;
}

/** Builds the documented success envelope so both applications share one shape. */
export function success<TData>(data: TData): ApiSuccessEnvelope<TData> {
  return { data };
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}

export function isApiSuccessEnvelope<TData = unknown>(
  value: unknown,
): value is ApiSuccessEnvelope<TData> {
  return typeof value === 'object' && value !== null && 'data' in value;
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }

  const container: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  const detail: unknown = container['error'];

  if (typeof detail !== 'object' || detail === null) {
    return false;
  }

  const candidate = detail as Record<string, unknown>;
  const fields: unknown = candidate['fields'];

  const hasValidFields =
    fields === undefined ||
    (Array.isArray(fields) &&
      fields.every(
        (issue: unknown) =>
          typeof issue === 'object' &&
          issue !== null &&
          typeof (issue as Record<string, unknown>)['field'] === 'string' &&
          typeof (issue as Record<string, unknown>)['message'] === 'string',
      ));

  return (
    isApiErrorCode(candidate['code']) &&
    typeof candidate['message'] === 'string' &&
    typeof candidate['requestId'] === 'string' &&
    hasValidFields
  );
}
