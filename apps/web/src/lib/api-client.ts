import {
  CSRF_TOKEN_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  isApiErrorBody,
  isApiListEnvelope,
  isApiSuccessEnvelope,
  REQUEST_ID_HEADER,
  type ApiErrorCode,
  type ApiFieldIssue,
  type ApiPagination,
} from '@hyssop/contracts';
import { createRequestId } from './request-id';

export interface ApiRequestOptions {
  readonly signal?: AbortSignal;
  /** Sent as `X-CSRF-Token`. Required by the API for every state-changing request. */
  readonly csrfToken?: string;
  /** Sent as `If-Match` for an optimistic-locking update. */
  readonly ifMatch?: string;
  /**
   * Sent as `Idempotency-Key` for every create and mutation.
   *
   * `docs/06-API-SPEC.md` requires one, and a financial write without it is the failure this
   * project cares about most: a double submit or a retry after a timeout would record the same
   * contribution twice. The key is generated once per *user intent* and reused across retries
   * of that intent, which is the only way a retry is recognised as the same operation.
   */
  readonly idempotencyKey?: string;
}

export interface ApiClient {
  get<TData>(path: string, options?: ApiRequestOptions): Promise<TData>;
  post<TData>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<TData>;
  patch<TData>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<TData>;
  put<TData>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<TData>;
  /**
   * A `DELETE` that carries a request body.
   *
   * Present as its own method because `docs/06-API-SPEC.md` documents document removal as
   * `DELETE /documents/:id` with a required `reason`. A removal is audited, so the reason has to
   * travel in the request rather than being guessed from the absence of a record.
   */
  delete<TData>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<TData>;
  /** Returns the `data` array and the `pagination` block of a list response. */
  getList<TItem>(path: string, options?: ApiRequestOptions): Promise<ApiListPage<TItem>>;
  /**
   * Posts a `multipart/form-data` body.
   *
   * Separate from `post` because `post` sets `Content-Type: application/json` and serialises the
   * body. A multipart body must not set `Content-Type` at all: the value has to include the
   * boundary the browser generated, and hard-coding `multipart/form-data` without it produces a
   * body the server cannot parse.
   */
  upload<TData>(path: string, form: FormData, options?: ApiRequestOptions): Promise<TData>;
}

export interface ApiListPage<TItem> {
  readonly items: readonly TItem[];
  readonly pagination: ApiPagination;
}

/** An error the API reported in the documented error envelope. */
export class ApiClientError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly requestId: string,
    /**
     * The `error.fields` block of a `VALIDATION_FAILED` response.
     *
     * Carried through so a form can show a server-side rejection against the field it
     * belongs to, as `docs/06-API-SPEC.md` intends. It is `undefined` for every other
     * error code, so a screen cannot mistake an unrelated failure for a field problem.
     */
    public readonly fields?: readonly ApiFieldIssue[],
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/** A transport, timeout, or contract failure that the API did not describe. */
export class ApiTransportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ApiTransportError';
  }
}

export interface ApiClientConfig {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly createRequestId?: () => string;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Methods that may carry a request body. */
const METHODS_WITH_BODY: readonly Method[] = ['POST', 'PATCH', 'PUT', 'DELETE'];

export function createApiClient(config: ApiClientConfig): ApiClient {
  const doFetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const nextRequestId = config.createRequestId ?? createRequestId;
  const baseUrl = config.baseUrl.replace(/\/+$/, '');

  /**
   * Performs the request and returns the raw parsed body.
   *
   * Both `send` and `sendList` share this, so error mapping, request IDs, credential
   * handling, and the abort message exist in exactly one place and cannot drift.
   */
  async function request(
    method: Method,
    path: string,
    body: unknown,
    options: ApiRequestOptions,
    /**
     * The body is already a `BodyInit` (a `FormData`) and must be sent untouched.
     *
     * `Content-Type` is then left unset on purpose: the browser has to append the multipart
     * boundary it generated, and any value set here would either override it or produce a boundary
     * the server cannot parse.
     */
    rawBody = false,
  ): Promise<unknown> {
    const requestId = nextRequestId();
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const hasBody = METHODS_WITH_BODY.includes(method) && body !== undefined;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      [REQUEST_ID_HEADER]: requestId,
    };

    if (hasBody && !rawBody) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.csrfToken !== undefined) {
      headers[CSRF_TOKEN_HEADER] = options.csrfToken;
    }
    if (options.ifMatch !== undefined) {
      headers['If-Match'] = options.ifMatch;
    }
    if (options.idempotencyKey !== undefined) {
      headers[IDEMPOTENCY_KEY_HEADER] = options.idempotencyKey;
    }

    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers,
        // The session lives in an HTTP-only cookie the browser must send back, including
        // when the API is on a different origin during local development. No token is ever
        // read from or written to browser storage.
        credentials: 'include',
        ...(hasBody
          ? {
              body: rawBody
                ? // Only ever a `FormData`, supplied by `upload`.
                  (body as BodyInit)
                : JSON.stringify(body),
            }
          : {}),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (error: unknown) {
      throw new ApiTransportError(
        error instanceof Error && error.name === 'AbortError'
          ? 'The request was cancelled.'
          : 'The API could not be reached.',
      );
    }

    const payload: unknown = await readJson(response);

    if (!response.ok) {
      if (isApiErrorBody(payload)) {
        const { code, message, requestId, fields } = payload.error;

        throw new ApiClientError(
          response.status,
          code,
          message,
          requestId,
          // Only forwarded when the envelope actually carried it, so an absent block stays
          // `undefined` rather than becoming an empty array a screen would have to guess about.
          fields,
        );
      }

      throw new ApiClientError(
        response.status,
        'INTERNAL_ERROR',
        'The API returned an unexpected error.',
        response.headers.get(REQUEST_ID_HEADER) ?? requestId,
      );
    }

    return payload;
  }

  /**
   * Extracts the `data` block of a success envelope.
   *
   * Shared by the JSON and multipart paths so a malformed success body is rejected identically,
   * whichever transport produced it.
   */
  function unwrapSuccess<TData>(payload: unknown): TData {
    if (!isApiSuccessEnvelope<TData>(payload)) {
      throw new ApiTransportError('The API returned an unexpected response shape.');
    }

    return payload.data;
  }

  async function send<TData>(
    method: Method,
    path: string,
    body: unknown,
    options: ApiRequestOptions,
  ): Promise<TData> {
    return unwrapSuccess<TData>(await request(method, path, body, options));
  }

  async function sendList<TItem>(
    path: string,
    options: ApiRequestOptions = {},
  ): Promise<ApiListPage<TItem>> {
    const payload = await request('GET', path, undefined, options);

    if (!isApiListEnvelope<TItem>(payload)) {
      throw new ApiTransportError('The API returned an unexpected list response shape.');
    }

    return { items: payload.data, pagination: payload.pagination };
  }

  async function sendUpload<TData>(
    path: string,
    form: FormData,
    options: ApiRequestOptions = {},
  ): Promise<TData> {
    const payload = await request('POST', path, form, options, true);

    return unwrapSuccess<TData>(payload);
  }

  return {
    get: <TData>(path: string, options: ApiRequestOptions = {}): Promise<TData> =>
      send<TData>('GET', path, undefined, options),
    post: <TData>(path: string, body?: unknown, options: ApiRequestOptions = {}): Promise<TData> =>
      send<TData>('POST', path, body, options),
    patch: <TData>(path: string, body?: unknown, options: ApiRequestOptions = {}): Promise<TData> =>
      send<TData>('PATCH', path, body, options),
    put: <TData>(path: string, body?: unknown, options: ApiRequestOptions = {}): Promise<TData> =>
      send<TData>('PUT', path, body, options),
    delete: <TData>(
      path: string,
      body?: unknown,
      options: ApiRequestOptions = {},
    ): Promise<TData> => send<TData>('DELETE', path, body, options),
    getList: <TItem>(path: string, options: ApiRequestOptions = {}): Promise<ApiListPage<TItem>> =>
      sendList<TItem>(path, options),
    upload: <TData>(
      path: string,
      form: FormData,
      options: ApiRequestOptions = {},
    ): Promise<TData> => sendUpload<TData>(path, form, options),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
