import {
  CSRF_TOKEN_HEADER,
  isApiErrorBody,
  isApiSuccessEnvelope,
  REQUEST_ID_HEADER,
  type ApiErrorCode,
} from '@hyssop/contracts';
import { createRequestId } from './request-id';

export interface ApiRequestOptions {
  readonly signal?: AbortSignal;
  /** Sent as `X-CSRF-Token`. Required by the API for every state-changing request. */
  readonly csrfToken?: string;
}

export interface ApiClient {
  get<TData>(path: string, options?: ApiRequestOptions): Promise<TData>;
  post<TData>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<TData>;
}

/** An error the API reported in the documented error envelope. */
export class ApiClientError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly requestId: string,
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

type Method = 'GET' | 'POST';

export function createApiClient(config: ApiClientConfig): ApiClient {
  const doFetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const nextRequestId = config.createRequestId ?? createRequestId;
  const baseUrl = config.baseUrl.replace(/\/+$/, '');

  async function send<TData>(
    method: Method,
    path: string,
    body: unknown,
    options: ApiRequestOptions,
  ): Promise<TData> {
    const requestId = nextRequestId();
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const hasBody = method === 'POST' && body !== undefined;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      [REQUEST_ID_HEADER]: requestId,
    };

    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.csrfToken !== undefined) {
      headers[CSRF_TOKEN_HEADER] = options.csrfToken;
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
        ...(hasBody ? { body: JSON.stringify(body) } : {}),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (error: unknown) {
      throw new ApiTransportError(
        error instanceof Error && error.name === 'AbortError'
          ? 'The request was cancelled.'
          : 'The API could not be reached.',
      );
    }

    const responseRequestId = response.headers.get(REQUEST_ID_HEADER) ?? requestId;
    const payload: unknown = await readJson(response);

    if (!response.ok) {
      if (isApiErrorBody(payload)) {
        throw new ApiClientError(
          response.status,
          payload.error.code,
          payload.error.message,
          payload.error.requestId,
        );
      }

      throw new ApiClientError(
        response.status,
        'INTERNAL_ERROR',
        'The API returned an unexpected error.',
        responseRequestId,
      );
    }

    if (!isApiSuccessEnvelope<TData>(payload)) {
      throw new ApiTransportError('The API returned an unexpected response shape.');
    }

    return payload.data;
  }

  return {
    get: <TData>(path: string, options: ApiRequestOptions = {}): Promise<TData> =>
      send<TData>('GET', path, undefined, options),
    post: <TData>(path: string, body?: unknown, options: ApiRequestOptions = {}): Promise<TData> =>
      send<TData>('POST', path, body, options),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
