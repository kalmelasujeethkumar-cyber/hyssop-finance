import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RootErrorBoundary } from './RootErrorBoundary';

function ExplodingView(): never {
  throw new Error('render failed with sensitive detail');
}

describe('RootErrorBoundary', () => {
  it('shows a safe recovery message instead of the thrown error detail', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <RootErrorBoundary>
        <ExplodingView />
      </RootErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The application could not start');
    expect(alert).not.toHaveTextContent('sensitive detail');
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });

  it('reloads the page when the recovery control is used', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: assign },
    });

    const user = userEvent.setup();

    render(
      <RootErrorBoundary>
        <ExplodingView />
      </RootErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Reload the page' }));

    expect(assign).toHaveBeenCalled();
  });
});
