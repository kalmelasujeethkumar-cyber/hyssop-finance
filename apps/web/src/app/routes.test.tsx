import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '../test/render';
import {
  clientFailingWith,
  clientResolvingWith,
  HEALTH_REPORT,
  serverFailure,
  transportFailure,
} from '../test/stub-client';

describe('foundation shell routing', () => {
  it('renders the application identity and the foundation screen', () => {
    renderRoute({ client: clientResolvingWith(HEALTH_REPORT) });

    expect(screen.getByText('HYSSOP FINANCE')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Foundation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'API connectivity' })).toBeInTheDocument();
  });

  it('exposes a skip link and a main landmark for keyboard and screen-reader use', () => {
    renderRoute({ client: clientResolvingWith(HEALTH_REPORT) });

    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });

  it('states that no financial data exists instead of showing placeholder figures', () => {
    renderRoute({ client: clientResolvingWith(HEALTH_REPORT) });

    expect(
      screen.getByText(/No member, income, or expense data is stored or displayed yet\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a not-found screen for an unknown address and returns home from it', async () => {
    const user = userEvent.setup();

    renderRoute({ path: '/no-such-screen', client: clientResolvingWith(HEALTH_REPORT) });

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Back to foundation' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Foundation' })).toBeInTheDocument();
    });
  });
});

describe('connectivity status', () => {
  it('shows the connected state with the reported service details', async () => {
    renderRoute({ client: clientResolvingWith(HEALTH_REPORT) });

    const status = await screen.findByTestId('health-status');

    expect(status).toHaveAttribute('data-state', 'connected');
    expect(status).toHaveTextContent('Connected');
    expect(screen.getByText(HEALTH_REPORT.service)).toBeInTheDocument();
    expect(screen.getByText(HEALTH_REPORT.version)).toBeInTheDocument();
  });

  it('shows the unavailable state and a working retry control when the API is unreachable', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const client = {
      get: <TData,>(path: string): Promise<TData> => {
        if (path !== '/health') {
          throw new Error(`The stub client was called with an unexpected path: ${path}`);
        }
        attempt += 1;
        return attempt === 1
          ? Promise.reject(transportFailure)
          : Promise.resolve(HEALTH_REPORT as TData);
      },
    };

    renderRoute({ client });

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
    renderRoute({ client: clientFailingWith(serverFailure) });

    const status = await screen.findByTestId('health-status');

    expect(status).toHaveAttribute('data-state', 'unavailable');
    expect(screen.getByText('An unexpected error occurred. Please try again.')).toBeInTheDocument();
    expect(screen.getByText(serverFailure.requestId)).toBeInTheDocument();
  });
});
