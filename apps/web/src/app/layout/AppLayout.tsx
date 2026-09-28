import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../../features/auth/SessionProvider';

/**
 * Semantic application shell. It intentionally contains no product navigation:
 * every navigation target would have to work, and no product screen exists yet.
 *
 * The only control it adds is sign-out, and it is rendered only for a confirmed session, so
 * there is no dead control for a visitor who is not signed in.
 */
export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <a
        href="#main-content"
        className="skip-link rounded-md bg-blue-600 px-4 py-2 text-supporting font-semibold text-text-inverse"
      >
        Skip to main content
      </a>

      <header className="border-b border-border-default bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-4">
          <p className="text-section-title font-bold tracking-tight text-text-primary">
            HYSSOP FINANCE
          </p>
          <p className="text-supporting text-text-secondary">
            Church financial management · Asia/Kolkata · INR
          </p>
          <SessionControls />
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-border-default bg-surface">
        <div className="mx-auto max-w-5xl px-6 py-4 text-supporting text-text-secondary">
          Foundation build. No member, income, or expense data is stored or displayed yet.
        </div>
      </footer>
    </div>
  );
}

/**
 * Shows who is signed in and provides the sign-out control.
 *
 * The sign-out result is reported honestly: a failure leaves the Admin signed in, because
 * the server may still hold a live session, and the message says what to do next.
 */
function SessionControls() {
  const { status, admin, signOut } = useSession();
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (status !== 'authenticated' || admin === null) {
    return null;
  }

  async function handleSignOut(): Promise<void> {
    setIsSigningOut(true);
    setErrorMessage(null);

    try {
      await signOut();
      // Fire-and-forget: awaiting a data-router navigation here would keep the control
      // disabled, so it is explicitly marked as ignored instead of left floating.
      void navigate('/login', { replace: true });
    } catch {
      setErrorMessage('Sign out did not complete. Please try again.');
      setIsSigningOut(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <p className="text-supporting text-text-secondary">
        Signed in as <span className="font-semibold text-text-primary">{admin.displayName}</span> (
        {admin.identifier})
      </p>
      <button
        type="button"
        onClick={() => {
          void handleSignOut();
        }}
        disabled={isSigningOut}
        className="rounded-md border border-border-strong bg-surface px-3 py-1 text-supporting font-semibold text-text-primary disabled:bg-surface-subtle"
      >
        {isSigningOut ? 'Signing out…' : 'Sign out'}
      </button>
      {errorMessage === null ? null : (
        <p role="alert" className="text-supporting font-semibold text-danger-700">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
