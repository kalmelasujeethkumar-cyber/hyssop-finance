import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, type ReactNode } from 'react';
import { SESSION_QUERY_KEY, SessionProvider } from '../../features/auth/SessionProvider';
import { ApiClientError, type ApiClient, type ApiRequestOptions } from '../../lib/api-client';
import { ApiClientContext } from './ApiClientProvider';

/**
 * The provider stack the browser and every UI test mount, in one place, so a test cannot
 * accidentally provide an API client without a session and pass because of it.
 */
export function AppProviders({
  client,
  children,
}: {
  readonly client: ApiClient;
  readonly children: ReactNode;
}) {
  const queryClient = useQueryClient();

  const onSessionExpired = useCallback(() => {
    // The API, not the browser, decided the session is gone. Drop the cached identity so the
    // guard sends the Admin back to sign-in, and keep the error so the calling screen can
    // still report what happened.
    queryClient.setQueryData(SESSION_QUERY_KEY, null);
  }, [queryClient]);

  const sessionAwareClient = useMemo<ApiClient>(
    () => ({
      get: <TData,>(path: string, options?: ApiRequestOptions) =>
        watchForSessionExpiry(client.get<TData>(path, options), onSessionExpired),
      post: <TData,>(path: string, body?: unknown, options?: ApiRequestOptions) =>
        watchForSessionExpiry(client.post<TData>(path, body, options), onSessionExpired),
      patch: <TData,>(path: string, body?: unknown, options?: ApiRequestOptions) =>
        watchForSessionExpiry(client.patch<TData>(path, body, options), onSessionExpired),
      put: <TData,>(path: string, body?: unknown, options?: ApiRequestOptions) =>
        watchForSessionExpiry(client.put<TData>(path, body, options), onSessionExpired),
      delete: <TData,>(path: string, body?: unknown, options?: ApiRequestOptions) =>
        watchForSessionExpiry(client.delete<TData>(path, body, options), onSessionExpired),
      getList: <TItem,>(path: string, options?: ApiRequestOptions) =>
        watchForSessionExpiry(client.getList<TItem>(path, options), onSessionExpired),
      // A session can expire while an upload is in flight exactly as it can while a read is, so the
      // upload path needs the same expiry watch rather than leaving it to fail silently.
      upload: <TData,>(path: string, form: FormData, options?: ApiRequestOptions) =>
        watchForSessionExpiry(client.upload<TData>(path, form, options), onSessionExpired),
      // A CSV export is a protected read of a non-JSON body, so an expired session must reset the
      // identity here too. Without it, the export would fail with a `401` the report screen could
      // only report as "the export failed" while the Admin sat in a shell that looks signed in.
      getText: (path: string, options?: ApiRequestOptions) =>
        watchForSessionExpiry(client.getText(path, options), onSessionExpired),
    }),
    [client, onSessionExpired],
  );

  return (
    <ApiClientContext.Provider value={sessionAwareClient}>
      <SessionProvider>{children}</SessionProvider>
    </ApiClientContext.Provider>
  );
}

/**
 * Turns a `401` from any protected route into a session reset.
 *
 * `INVALID_CREDENTIALS` is deliberately excluded: a rejected sign-in is a 401 too, and it
 * must stay on the sign-in screen rather than resetting an already-empty session.
 */
async function watchForSessionExpiry<TData>(
  request: Promise<TData>,
  onSessionExpired: () => void,
): Promise<TData> {
  try {
    return await request;
  } catch (error: unknown) {
    if (
      error instanceof ApiClientError &&
      error.status === 401 &&
      error.code !== 'INVALID_CREDENTIALS'
    ) {
      onSessionExpired();
    }

    throw error;
  }
}
