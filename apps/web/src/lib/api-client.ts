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
  /**
   * Fetches a `text/*` body as text rather than as a JSON envelope.
   *
   * `docs/06-API-SPEC.md` serves `GET /reports/:reportId/export.csv` as a raw `text/csv` body with
   * an `attachment` `Content-Disposition`, not inside the `{ data }` envelope. It exists as its own
   * method rather than as a flag on `get` because the two differ in what they may expect on the
   * wire: a JSON read that is handed a CSV body is a contract failure, and a text read that is
   * handed an envelope is one too. Two named methods make each failure explicit.
   *
   * A **failed** CSV request still answers the documented JSON error envelope, so failures are
   * mapped to {@link ApiClientError} here rather than surfacing as an unreadable string.
   */
  getText(path: string, options?: ApiRequestOptions): Promise<ApiTextDownload>;
}

/** A non-JSON body plus the filename the server declared for it. */
export interface ApiTextDownload {
  readonly text: string;
  /**
   * The filename from the server's `Content-Disposition`, or `undefined` when it sent none.
   *
   * The API owns the export filename because it includes the report's own period bounds. A
   * caller with no declared filename must choose its own rather than presenting the server's
   * absence as an intended name.
   */
  readonly filename: string | undefined;
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
   * Performs the request and returns the raw response with the request id it was sent under.
   *
   * Both `request` and `sendText` share this, so header construction, credential handling, and
   * the abort message exist in exactly one place and cannot drift. What each caller does with the
   * body is left to the caller, because that is the one thing that genuinely differs: JSON reads
   * unwrap an envelope, and a CSV read must not.
   */
  async function sendRequest(
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
  ): Promise<{ readonly response: Response; readonly requestId: string }> {
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

    try {
      return {
        response: await doFetch(url, {
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
        }),
        requestId,
      };
    } catch (error: unknown) {
      throw new ApiTransportError(
        error instanceof Error && error.name === 'AbortError'
          ? 'The request was cancelled.'
          : 'The API could not be reached.',
      );
    }
  }

  /**
   * Turns a non-`2xx` response into the documented error.
   *
   * Shared by the JSON and text paths so a failed CSV export reports the same
   * {@link ApiClientError} — with the same request id — as a failed JSON read, instead of handing a
   * report screen a raw `{ "error": … }` string to display.
   */
  async function throwForStatus(response: Response, requestId: string): Promise<never> {
    const payload: unknown = await readJson(response);

    if (isApiErrorBody(payload)) {
      const { code, message, requestId: serverRequestId, fields } = payload.error;

      throw new ApiClientError(
        response.status,
        code,
        message,
        serverRequestId,
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

  /** Performs a request and returns the raw parsed JSON body, success or failure. */
  async function request(
    method: Method,
    path: string,
    body: unknown,
    options: ApiRequestOptions,
    rawBody = false,
  ): Promise<unknown> {
    const { response, requestId } = await sendRequest(method, path, body, options, rawBody);

    if (!response.ok) {
      await throwForStatus(response, requestId);
    }

    return readJson(response);
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

  /**
   * A text read.
   *
   * The body is returned verbatim: no envelope is unwrapped, because a CSV export is the whole
   * payload. Only the *failure* path parses JSON, and only to produce the documented error.
   */
  async function sendText(path: string, options: ApiRequestOptions = {}): Promise<ApiTextDownload> {
    const { response, requestId } = await sendRequest('GET', path, undefined, options);

    if (!response.ok) {
      await throwForStatus(response, requestId);
    }

    return { text: await response.text(), filename: declaredFilename(response) };
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
    getText: (path: string, options: ApiRequestOptions = {}): Promise<ApiTextDownload> =>
      sendText(path, options),
  };
}

/**
 * The filename from a `Content-Disposition` header, or `undefined`.
 *
 * The API sends `attachment; filename="hyssop-income-2026-09-01-to-2026-09-30.csv"`, and the report
 * period is baked into that name by the server, so the browser does not get to invent one. A
 * `filename*=` RFC 5987 form is read first because it is the only form that can carry a non-ASCII
 * name, and `filename=` remains the fallback for the plain-ASCII names this API produces today.
 *
 * Anything unparseable yields `undefined` rather than a guess: a caller that receives nothing will
 * fall back to a name it states openly, whereas a half-parsed `Content-Disposition` would produce a
 * file called `attachment` or `filename="hyssop`.
 */
function declaredFilename(response: Response): string | undefined {
  const header = response.headers.get('Content-Disposition');

  if (header === null) {
    return undefined;
  }

  const extended = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  const plain = /filename="?([^";]+)"?/i.exec(header);
  const raw = extended?.[1] ?? plain?.[1];

  if (raw === undefined) {
    return undefined;
  }

  const decoded = extended === null ? raw.trim() : safeDecode(raw.trim());

  return decoded === '' ? undefined : decoded;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed percent-escape is the server's header being wrong, not a reason to refuse the
    // export the Admin asked for. The raw value is still better than no name at all.
    return value;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
