import {
  isApiErrorBody,
  isApiSuccessEnvelope,
  REQUEST_ID_HEADER,
  type ApiErrorCode,
} from '@hyssop/contracts';
import { createRequestId } from './request-id';

export interface ApiClient {
  get<TData>(path: string, options?: { readonly signal?: AbortSignal }): Promise<TData>;
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

export function createApiClient(config: ApiClientConfig): ApiClient {
  const doFetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const nextRequestId = config.createRequestId ?? createRequestId;
  const baseUrl = config.baseUrl.replace(/\/+$/, '');

  return {
    async get<TData>(path: string, options: { signal?: AbortSignal } = {}): Promise<TData> {
      const requestId = nextRequestId();
      const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

      let response: Response;
      try {
        response = await doFetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json', [REQUEST_ID_HEADER]: requestId },
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
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
