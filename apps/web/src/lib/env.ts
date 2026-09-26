/**
 * Browser-side configuration.
 *
 * Only `VITE_`-prefixed values reach the bundle, so server configuration can never
 * be exposed to the client. The default keeps the API same-origin, which the
 * dev and preview proxies forward; a split-origin deployment sets
 * `VITE_API_BASE_URL` explicitly.
 */
export const DEFAULT_API_BASE_URL = '/api/v1';

export class MissingApiBaseUrlError extends Error {
  public constructor() {
    super('VITE_API_BASE_URL must be configured for a deployed web build.');
    this.name = 'MissingApiBaseUrlError';
  }
}

export function resolveApiBaseUrl(rawBaseUrl: string | undefined, isDeployed: boolean): string {
  const configured = rawBaseUrl?.trim();

  if (configured !== undefined && configured !== '') {
    return stripTrailingSlashes(configured);
  }

  if (isDeployed) {
    throw new MissingApiBaseUrlError();
  }

  return DEFAULT_API_BASE_URL;
}

export const apiBaseUrl = resolveApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL,
  import.meta.env.PROD,
);

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}
