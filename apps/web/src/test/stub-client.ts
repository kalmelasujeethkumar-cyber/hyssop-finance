import {
  HEALTH_SERVICE_NAME,
  type AdminProfile,
  type CsrfTokenResult,
  type CurrentSessionResult,
  type HealthReport,
  type LoginResult,
  type LogoutResult,
  type SessionContext,
} from '@hyssop/contracts';
import { ApiClientError, ApiTransportError, type ApiClient } from '../lib/api-client';

export const HEALTH_REPORT: HealthReport = {
  status: 'ok',
  service: HEALTH_SERVICE_NAME,
  version: '0.1.0',
  uptimeSeconds: 42,
  timestamp: '2026-09-26T09:15:00.000Z',
};

export const ADMIN_PROFILE: AdminProfile = {
  id: '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  identifier: 'admin',
  displayName: 'Demo Admin',
};

export const SESSION_CONTEXT: SessionContext = {
  issuedAt: '2026-09-26T12:00:00.000Z',
  expiresAt: '2026-09-26T20:00:00.000Z',
};

export const SESSION_RESULT: CurrentSessionResult = {
  admin: ADMIN_PROFILE,
  session: SESSION_CONTEXT,
};

export const CSRF_TOKEN_RESULT: CsrfTokenResult = {
  csrfToken: 'b'.repeat(43),
  expiresAt: '2026-09-26T12:15:00.000Z',
};

export const LOGIN_RESULT: LoginResult = {
  admin: ADMIN_PROFILE,
  session: SESSION_CONTEXT,
  csrfToken: 'b'.repeat(43),
};

export const transportFailure = new ApiTransportError('The API could not be reached.');

export const serverFailure = new ApiClientError(
  503,
  'INTERNAL_ERROR',
  'An unexpected error occurred. Please try again.',
  '3f0a1b2c-4d5e-4f60-8a71-9b2c3d4e5f60',
);

export const unauthenticated = new ApiClientError(
  401,
  'UNAUTHENTICATED',
  'Your session is missing or has expired. Please sign in again.',
  '4a1b2c3d-5e6f-4a7b-8c8d-9e0f1a2b3c4e',
);

export const invalidCredentials = new ApiClientError(
  401,
  'INVALID_CREDENTIALS',
  'The identifier or password is incorrect.',
  '5b2c3d4e-6f7a-4b8c-8d9e-0f1a2b3c4d5e',
);

export const csrfFailed = new ApiClientError(
  403,
  'CSRF_FAILED',
  'The security token for this request is missing or invalid. Please reload and try again.',
  '6c3d4e5f-7a8b-4c9d-8e9f-0a1b2c3d4e5f',
);

export interface RecordedCall {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body: unknown;
  readonly csrfToken: string | undefined;
}

export interface StubApiClient extends ApiClient {
  readonly calls: RecordedCall[];
}

/**
 * A recording client the UI tests drive.
 *
 * Each documented path gets its own answer so a test can state exactly what the API
 * returned, and any unexpected call fails loudly instead of silently resolving, which is
 * how a test proves the browser only asks for routes that exist.
 */
export function stubApiClient(
  options: {
    readonly session?: CurrentSessionResult | Error;
    readonly health?: HealthReport | Error;
    readonly csrf?: CsrfTokenResult | Error;
    readonly login?: LoginResult | Error;
    readonly logout?: 'success' | Error;
    /** Reported as `LogoutResult.revoked`; defaults to the normal signed-in sign-out. */
    readonly revokedOnLogout?: boolean;
  } = {},
): StubApiClient {
  const calls: RecordedCall[] = [];
  const session = options.session ?? SESSION_RESULT;
  const health = options.health ?? HEALTH_REPORT;
  const csrf = options.csrf ?? CSRF_TOKEN_RESULT;
  const login = options.login ?? LOGIN_RESULT;
  // Tracks whether a session exists, the way a real API does. `/auth/me` reports the
  // live session state, so a successful `login` makes it succeed from then on. Without this,
  // a stubbed `/auth/me` that always answers "unauthenticated" would contradict the login it
  // just accepted and race the browser back to the sign-in screen.
  let isSignedIn = session === SESSION_RESULT;

  return {
    calls,
    get<TData>(path: string): Promise<TData> {
      calls.push({ method: 'GET', path, body: undefined, csrfToken: undefined });

      if (path === '/auth/me') {
        if (isSignedIn) {
          return settle<TData>(SESSION_RESULT);
        }

        return settle<TData>(session);
      }
      if (path === '/auth/csrf') {
        return settle<TData>(csrf);
      }
      if (path === '/health') {
        return settle<TData>(health);
      }

      throw new Error(`The stub client was called with an unexpected path: ${path}`);
    },
    post<TData>(path: string, body?: unknown, options2?: { csrfToken?: string }): Promise<TData> {
      calls.push({ method: 'POST', path, body, csrfToken: options2?.csrfToken });

      if (path === '/auth/login') {
        const result = settle<TData>(login);

        if (login !== undefined && !(login instanceof Error)) {
          isSignedIn = true;
        }

        return result;
      }
      if (path === '/auth/logout') {
        if (options.logout !== undefined && options.logout !== 'success') {
          return Promise.reject(options.logout);
        }

        isSignedIn = false;

        // The real endpoint answers `200` with the canonical envelope, which the real client
        // unwraps into `LogoutResult`. Returning that shape here is deliberate: an empty
        // object would let a test pass against a contract the API does not actually honour.
        const result: LogoutResult = { revoked: options.revokedOnLogout ?? true };

        return Promise.resolve(result as TData);
      }

      throw new Error(`The stub client was called with an unexpected path: ${path}`);
    },
  };
}

function settle<TData>(
  value: CurrentSessionResult | HealthReport | CsrfTokenResult | LoginResult | Error,
): Promise<TData> {
  return value instanceof Error ? Promise.reject(value) : Promise.resolve(value as TData);
}

/**
 * Stands in for the real client on a signed-in screen, so the foundation tests still reach
 * the product screen now that it is behind authentication.
 */
export function clientResolvingWith(report: HealthReport = HEALTH_REPORT): ApiClient {
  return stubApiClient({ health: report });
}

export function clientFailingWith(error: Error): ApiClient {
  return stubApiClient({ health: error });
}
