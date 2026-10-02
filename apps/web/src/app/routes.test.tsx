import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ApiClient, ApiRequestOptions } from '../lib/api-client';
import { renderRoute } from '../test/render';
import {
  clientFailingWith,
  clientResolvingWith,
  HEALTH_REPORT,
  serverFailure,
  stubApiClient,
  transportFailure,
  unauthenticated,
} from '../test/stub-client';

describe('application shell routing', () => {
  it('lands a signed-in Admin on the dashboard', async () => {
    renderRoute({ client: stubApiClient() });

    // The dashboard is the index route, because `docs/03-UI-UX-RULES.md` makes it the landing
    // screen. A test that lands on the build-status screen instead would mean the real financial
    // summary had been demoted.
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('HYSSOP FINANCE')).toBeInTheDocument();
  });

  it('shows the build-status screen at its own address', async () => {
    renderRoute({ path: '/foundation', client: stubApiClient() });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Foundation' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'API connectivity' })).toBeInTheDocument();
  });

  it('exposes a skip link and a main landmark for keyboard and screen-reader use', async () => {
    renderRoute({ client: stubApiClient() });

    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });

    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });

  it('names the features that are not built yet instead of showing placeholder figures', async () => {
    renderRoute({ path: '/foundation', client: stubApiClient() });

    await screen.findByRole('heading', { level: 1, name: 'Foundation' });

    // The screen has to say what does not exist, so the Pastor is not left believing a
    // missing screen is a broken one. Settings are what remains once Reports and Search
    // shipped in Phase 09.
    expect(
      screen.getByRole('heading', { level: 2, name: 'What is not in this build yet' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Settings screens are not implemented/)).toBeVisible();
    // No financial table, because none is calculated for this screen.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('offers navigation only to the sections that are implemented', async () => {
    renderRoute({ client: stubApiClient() });

    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });

    // A link to a screen that does not exist would be a dead control. Dashboard, Members,
    // Income, Expenses, Reports, Search, and the status screen are the sections built so
    // far, so they are the only links offered. Settings arrives in a later phase and is
    // still absent here, which is what keeps this assertion honest.
    const navigation = screen.getByRole('navigation', { name: 'Primary' });

    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Dashboard', 'Members', 'Income', 'Expenses', 'Reports', 'Search', 'Status']);
    expect(within(navigation).queryByRole('link', { name: /Settings/ })).not.toBeInTheDocument();
  });

  it('shows a not-found screen for an unknown address and returns home from it', async () => {
    const user = userEvent.setup();

    renderRoute({ path: '/no-such-screen', client: stubApiClient() });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Back to dashboard' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    });
  });

  it('sends an unauthenticated visitor from any product address to the sign-in screen', async () => {
    renderRoute({ path: '/no-such-screen', client: stubApiClient({ session: unauthenticated }) });

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Page not found' }),
    ).not.toBeInTheDocument();
  });
});

describe('connectivity status', () => {
  // The connectivity card lives on the status screen, so these cases render `/foundation`. The
  // dashboard does not show API health: a financial screen that reported its own transport as a
  // banner would put an infrastructure detail beside every figure.
  it('shows the connected state with the reported service details', async () => {
    renderRoute({ path: '/foundation', client: clientResolvingWith(HEALTH_REPORT) });

    const status = await screen.findByTestId('health-status');

    expect(status).toHaveAttribute('data-state', 'connected');
    expect(status).toHaveTextContent('Connected');
    expect(screen.getByText(HEALTH_REPORT.service)).toBeInTheDocument();
    expect(screen.getByText(HEALTH_REPORT.version)).toBeInTheDocument();
  });

  it('shows the unavailable state and a working retry control when the API is unreachable', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const base = stubApiClient();
    const client: ApiClient = {
      get: <TData,>(path: string): Promise<TData> => {
        if (path !== '/health') {
          return base.get<TData>(path);
        }
        attempt += 1;
        return attempt === 1
          ? Promise.reject(transportFailure)
          : Promise.resolve(HEALTH_REPORT as TData);
      },
      post: <TData,>(path: string, body?: unknown, options?: ApiRequestOptions) =>
        base.post<TData>(path, body, options),
      patch: <TData,>(path: string, body?: unknown, options?: ApiRequestOptions) =>
        base.patch<TData>(path, body, options),
      put: <TData,>(path: string, body?: unknown, options?: ApiRequestOptions) =>
        base.put<TData>(path, body, options),
      delete: <TData,>(path: string, body?: unknown, options?: ApiRequestOptions) =>
        base.delete<TData>(path, body, options),
      getList: <TItem,>(path: string, options?: ApiRequestOptions) =>
        base.getList<TItem>(path, options),
      upload: <TData,>(path: string, form: FormData, options?: ApiRequestOptions) =>
        base.upload<TData>(path, form, options),
      getText: (path: string, options?: ApiRequestOptions) => base.getText(path, options),
    };

    renderRoute({ path: '/foundation', client });

    const status = await screen.findByTestId('health-status');
    expect(status).toHaveAttribute('data-state', 'unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent('The API could not be reached.');

    await user.click(screen.getByRole('button', { name: 'Retry connectivity check' }));

    await waitFor(() => {
      expect(screen.getByTestId('health-status')).toHaveAttribute('data-state', 'connected');
    });
    expect(attempt).toBe(2);
  });

  it('shows the request reference when the API reports a failure', async () => {
    renderRoute({ path: '/foundation', client: clientFailingWith(serverFailure) });

    const status = await screen.findByTestId('health-status');

    expect(status).toHaveAttribute('data-state', 'unavailable');
    expect(screen.getByText('An unexpected error occurred. Please try again.')).toBeInTheDocument();
    expect(screen.getByText(serverFailure.requestId)).toBeInTheDocument();
  });
});
