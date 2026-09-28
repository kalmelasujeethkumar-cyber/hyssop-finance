import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import type {
  AdminProfile,
  CsrfTokenResult,
  CurrentSessionResult,
  LoginResult,
  SessionContext,
} from '@hyssop/contracts';
import { useApiClient } from '../../app/providers/ApiClientProvider';
import { ApiClientError } from '../../lib/api-client';

/**
 * Browser session state.
 *
 * Authority: `docs/06-API-SPEC.md` (the four `/api/v1/auth` routes) and
 * `docs/07-SECURITY-RULES.md` ("Do not use localStorage or sessionStorage for session
 * tokens", "The frontend must not perform client-side-only authorization").
 *
 * Two rules are encoded here and nowhere else:
 *
 * 1. **The browser holds no session token.** Authorization lives entirely in an HTTP-only
 *    cookie the script cannot read, and this module keeps no copy of it. The only secret it
 *    retains is the CSRF value, in a ref, which is worthless without the cookie.
 * 2. **The API decides, not the UI.** `status` is derived from `GET /api/v1/auth/me`; a
 *    protected route is shown because the server confirmed a live session, never because a
 *    value was cached in the browser.
 */
export const SESSION_QUERY_KEY = ['auth', 'session'] as const;

export type SessionStatus = 'checking' | 'authenticated' | 'anonymous' | 'unavailable';

export interface SignInCredentials {
  readonly identifier: string;
  readonly password: string;
}

export interface SessionState {
  readonly status: SessionStatus;
  readonly admin: AdminProfile | null;
  readonly session: SessionContext | null;
  /** Set when the session could not be established because the API was unreachable. */
  readonly bootstrapErrorMessage: string | null;
  readonly retryBootstrap: () => void;
  readonly signIn: (credentials: SignInCredentials) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  // A ref, not state: the CSRF value is consumed by sign-out and must never trigger a
  // re-render, be serialized into a snapshot, or reach browser storage.
  const csrfToken = useRef<string | null>(null);

  const query = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async ({ signal }): Promise<CurrentSessionResult | null> => {
      try {
        return await client.get<CurrentSessionResult>('/auth/me', { signal });
      } catch (error: unknown) {
        // "No session" is an expected answer, not a failure to report: it is what the login
        // screen is for. Anything else (unreachable API, server error) must stay visible.
        if (error instanceof ApiClientError && error.status === 401) {
          return null;
        }

        throw error;
      }
    },
    retry: false,
    // The session is security state, so it is never served from a stale cache.
    staleTime: 0,
    gcTime: 0,
  });

  const signIn = useCallback(
    async ({ identifier, password }: SignInCredentials): Promise<void> => {
      // The pre-authentication token is single-use and origin-bound, so a fresh one is
      // fetched for every attempt; the API rejects a replay.
      const preAuth = await client.get<CsrfTokenResult>('/auth/csrf');
      const result = await client.post<LoginResult>(
        '/auth/login',
        { identifier, password },
        { csrfToken: preAuth.csrfToken },
      );

      csrfToken.current = result.csrfToken;
      // Seeded from the sign-in response rather than refetched: the API just confirmed the
      // session, and the shapes are identical by contract.
      const established: CurrentSessionResult = {
        admin: result.admin,
        session: result.session,
      };

      queryClient.setQueryData(SESSION_QUERY_KEY, established);
    },
    [client, queryClient],
  );

  const signOut = useCallback(async (): Promise<void> => {
    const current = csrfToken.current;

    try {
      await client.post('/auth/logout', undefined, current === null ? {} : { csrfToken: current });
    } catch (error: unknown) {
      // The stored CSRF value can be rotated away underneath a long-lived tab. Refreshing it
      // once keeps the sign-out control working instead of stranding the user; a second
      // failure is reported honestly.
      if (!(error instanceof ApiClientError) || error.code !== 'CSRF_FAILED') {
        throw error;
      }

      const refreshed = await client.get<CsrfTokenResult>('/auth/csrf');

      await client.post('/auth/logout', undefined, { csrfToken: refreshed.csrfToken });
    }

    // Only after the API has confirmed the revocation: if the request failed the server may
    // still hold a live session, and clearing the browser's view of it would be a lie.
    csrfToken.current = null;
    queryClient.setQueryData(SESSION_QUERY_KEY, null);
  }, [client, queryClient]);

  const retryBootstrap = useCallback(() => {
    void query.refetch();
  }, [query.refetch]);

  const value = useMemo<SessionState>(() => {
    const data = query.data;
    const anonymous: SessionState = {
      status: 'anonymous',
      admin: null,
      session: null,
      bootstrapErrorMessage: null,
      retryBootstrap,
      signIn,
      signOut,
    };

    // An unreachable API is reported as its own state. Reporting it as "anonymous" would
    // show a login form that cannot possibly work and hide the real problem.
    if (query.isError) {
      return {
        ...anonymous,
        status: 'unavailable',
        bootstrapErrorMessage:
          query.error instanceof Error ? query.error.message : 'The session could not be checked.',
      };
    }

    if (data === undefined) {
      return { ...anonymous, status: 'checking' };
    }

    if (data === null) {
      return anonymous;
    }

    return {
      status: 'authenticated',
      admin: data.admin,
      session: data.session,
      bootstrapErrorMessage: null,
      retryBootstrap,
      signIn,
      signOut,
    };
  }, [query.data, query.error, query.isError, retryBootstrap, signIn, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const state = useContext(SessionContext);

  if (state === null) {
    throw new Error('useSession must be used inside a SessionProvider.');
  }

  return state;
}
