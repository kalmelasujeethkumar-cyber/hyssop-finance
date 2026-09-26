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
