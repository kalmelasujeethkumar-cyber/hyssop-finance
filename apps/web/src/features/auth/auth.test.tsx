import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../../lib/api-client';
import { renderRoute } from '../../test/render';
import {
  ADMIN_PROFILE,
  clientResolvingWith,
  CSRF_TOKEN_RESULT,
  invalidCredentials,
  LOGIN_RESULT,
  stubApiClient,
  transportFailure,
  unauthenticated,
} from '../../test/stub-client';

describe('protected route access', () => {
  it('shows the sign-in screen and no financial screen when there is no session', async () => {
    renderRoute({ client: stubApiClient({ session: unauthenticated }) });

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Foundation' })).not.toBeInTheDocument();
  });

  it('never stores a session token in browser storage', async () => {
    const client = stubApiClient({ session: unauthenticated });

    renderRoute({ client });
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('sends the sign-in attempt to the documented routes with a pre-authentication token', async () => {
    const user = userEvent.setup();
    const client = stubApiClient({ session: unauthenticated, login: LOGIN_RESULT });

    renderRoute({ client });
    await user.type(await screen.findByLabelText(/Admin identifier/i), 'admin');
    await user.type(screen.getByLabelText(/^Password/i), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('heading', { level: 1, name: 'Foundation' });

    const login = client.calls.find((call) => call.path === '/auth/login');
    expect(login).toBeDefined();
    expect(login?.body).toEqual({ identifier: 'admin', password: 'correct horse battery' });
    expect(login?.csrfToken).toBe(CSRF_TOKEN_RESULT.csrfToken);
    expect(client.calls.map((call) => call.path)).toEqual([
      '/auth/me',
      '/auth/csrf',
      '/auth/login',
      '/health',
    ]);
  });

  it('reports the failure the API returned without revealing which value was wrong', async () => {
    const user = userEvent.setup();

    renderRoute({ client: stubApiClient({ session: unauthenticated, login: invalidCredentials }) });
    await user.type(await screen.findByLabelText(/Admin identifier/i), 'admin');
    await user.type(screen.getByLabelText(/^Password/i), 'wrong-password-here');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The identifier or password is incorrect.');
    expect(alert).not.toHaveTextContent(/password is wrong|unknown identifier/i);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('discards the attempted password when sign-in fails', async () => {
    const user = userEvent.setup();

    renderRoute({ client: stubApiClient({ session: unauthenticated, login: invalidCredentials }) });
    await user.type(await screen.findByLabelText(/Admin identifier/i), 'admin');
    await user.type(screen.getByLabelText(/^Password/i), 'wrong-password-here');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('alert');
    expect(screen.getByLabelText(/^Password/i)).toHaveValue('');
  });

  it('prevents a duplicate sign-in submission while one is in flight', async () => {
    const user = userEvent.setup();
    let releaseLogin: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    const client = stubApiClient({ session: unauthenticated });
    const slowClient = {
      ...client,
      post: <TData,>(path: string, body?: unknown, options?: { csrfToken?: string }) => {
        if (path === '/auth/login') {
          return pending.then(() => client.post<TData>(path, body, options));
        }

        return client.post<TData>(path, body, options);
      },
    };

    renderRoute({ client: slowClient });
    const button = await screen.findByRole('button', { name: 'Sign in' });
    await user.type(screen.getByLabelText(/Admin identifier/i), 'admin');
    await user.type(screen.getByLabelText(/^Password/i), 'correct horse battery');

    await user.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    });
    await user.click(screen.getByRole('button', { name: 'Signing in…' }));

    releaseLogin();

    await screen.findByRole('heading', { level: 1, name: 'Foundation' });
    expect(client.calls.filter((call) => call.path === '/auth/login')).toHaveLength(1);
  });

  it('does not claim the session is anonymous when the API cannot be reached', async () => {
    renderRoute({ client: stubApiClient({ session: transportFailure }) });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign-in status unavailable' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password/i)).not.toBeInTheDocument();
  });
});

describe('session lifecycle', () => {
  it('shows who is signed in only after the API confirmed the session', async () => {
    renderRoute({ client: clientResolvingWith() });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Foundation' }),
    ).toBeInTheDocument();
    expect(screen.getByText(ADMIN_PROFILE.displayName)).toBeInTheDocument();
    expect(screen.getByText(/Demo Admin/)).toBeInTheDocument();
  });

  it('returns to the sign-in screen after a sign-out that the API accepted', async () => {
    const user = userEvent.setup();
    const client = stubApiClient();

    renderRoute({ client });
    await screen.findByRole('heading', { level: 1, name: 'Foundation' });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Foundation' })).not.toBeInTheDocument();
    expect(client.calls.filter((call) => call.path === '/auth/logout')).toHaveLength(1);
  });

  it('keeps the Admin signed in and says so when sign-out fails', async () => {
    const user = userEvent.setup();
    const client = stubApiClient({ logout: transportFailure });

    renderRoute({ client });
    await screen.findByRole('heading', { level: 1, name: 'Foundation' });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sign out did not complete. Please try again.');
    expect(screen.getByRole('heading', { level: 1, name: 'Foundation' })).toBeInTheDocument();
  });

  it('returns to the sign-in screen when a protected route reports the session is gone', async () => {
    const base = stubApiClient();
    // The bootstrap succeeds, so the product screen is shown, and the protected call that
    // follows reports that the session no longer exists. The API, not the browser, decides.
    const client: ApiClient = {
      get: <TData,>(path: string, options?: { signal?: AbortSignal }) =>
        path === '/health' ? Promise.reject(unauthenticated) : base.get<TData>(path, options),
      post: <TData,>(path: string, body?: unknown, options?: { csrfToken?: string }) =>
        base.post<TData>(path, body, options),
    };

    renderRoute({ client });

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Foundation' })).not.toBeInTheDocument();
  });
});
