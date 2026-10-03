import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Link, Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { UnsavedWorkProvider, useUnsavedWork, useUnsavedWorkStatus } from './UnsavedWorkProvider';

/**
 * Guard checks for `REQ-RESP-008` and `REQ-RESP-009`.
 *
 * These render the provider inside a real data router, because `useBlocker` only works with one,
 * and drive it exactly as a form does: a component registers itself through `useUnsavedWork`, then
 * an in-app link and an explicit confirmation are exercised. The provider's `requestConfirmation`
 * is the same path the shell uses to warn before sign-out.
 */
function DirtyForm() {
  const [value, setValue] = useState('');
  useUnsavedWork(value !== '');

  return (
    <input
      aria-label="Note"
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
      }}
    />
  );
}

function PageB() {
  return <p>Page B</p>;
}

function SignOutButton() {
  const { requestConfirmation } = useUnsavedWorkStatus();
  const [result, setResult] = useState('idle');

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void requestConfirmation({
            title: 'Sign out?',
            message: 'You have unsaved changes. Signing out will discard them.',
            confirmLabel: 'Sign out',
          }).then((confirmed) => {
            setResult(confirmed ? 'confirmed' : 'cancelled');
          });
        }}
      >
        Sign out
      </button>
      <output aria-label="sign-out result">{result}</output>
    </>
  );
}

function Layout() {
  return (
    <UnsavedWorkProvider>
      <Link to="/b">Go to B</Link>
      <SignOutButton />
      <Outlet />
    </UnsavedWorkProvider>
  );
}

function renderGuard() {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Layout />,
        children: [
          { path: 'a', element: <DirtyForm /> },
          { path: 'b', element: <PageB /> },
        ],
      },
    ],
    { initialEntries: ['/a'] },
  );

  return render(<RouterProvider router={router} />);
}

describe('unsaved work guard', () => {
  it('does not block navigation while every registered form is clean', async () => {
    const user = userEvent.setup();
    renderGuard();

    await user.click(screen.getByRole('link', { name: 'Go to B' }));

    expect(await screen.findByText('Page B')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('blocks navigation while a form is dirty and keeps the page on "Keep editing"', async () => {
    const user = userEvent.setup();
    renderGuard();

    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'half a thought');
    await user.click(screen.getByRole('link', { name: 'Go to B' }));

    expect(
      await screen.findByRole('dialog', { name: 'Leave with unsaved changes?' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('half a thought');
    expect(screen.queryByText('Page B')).not.toBeInTheDocument();
  });

  it('leaves and discards the dirty form when the destructive action is confirmed', async () => {
    const user = userEvent.setup();
    renderGuard();

    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'half a thought');
    await user.click(screen.getByRole('link', { name: 'Go to B' }));
    await screen.findByRole('dialog', { name: 'Leave with unsaved changes?' });

    await user.click(screen.getByRole('button', { name: 'Leave and discard' }));

    expect(await screen.findByText('Page B')).toBeInTheDocument();
  });

  it('resolves requestConfirmation to true only after the destructive action is confirmed', async () => {
    const user = userEvent.setup();
    renderGuard();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Sign out?' })).getByRole('button', {
        name: 'Sign out',
      }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText('sign-out result')).toHaveTextContent('confirmed');
    });
  });

  it('resolves requestConfirmation to false when the Admin cancels', async () => {
    const user = userEvent.setup();
    renderGuard();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));

    await waitFor(() => {
      expect(screen.getByLabelText('sign-out result')).toHaveTextContent('cancelled');
    });
  });
});
