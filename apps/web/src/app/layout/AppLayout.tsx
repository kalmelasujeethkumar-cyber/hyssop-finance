import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../../features/auth/SessionProvider';

/**
 * Semantic application shell with the primary navigation.
 *
 * Authority: `docs/03-UI-UX-RULES.md`: use navigation landmarks, keep the current section
 * identifiable, provide an accessible narrow-viewport navigation, keep page titles and
 * important status visible without relying on colour alone, and avoid page-level horizontal
 * overflow.
 *
 * **Only sections that exist are listed.** The rules name Dashboard, Members, Income,
 * Expenses, Documents, Reports, Audit History, and Settings as the eventual navigation, but
 * the same rules forbid presenting unimplemented behaviour as a completed feature, and no
 * dead control or `Coming Soon` placeholder is permitted. Dashboard, Members, Income,
 * Expenses, Reports, Search, Audit History, and Settings are all implemented; the build-status
 * screen answers what is still outstanding. Receipts are attached from an expense or income
 * record rather than having their own section, because a standalone document list would have
 * nothing to show that the transaction it belongs to does not already show.
 *
 * The Receipt / Document and Audit reports are reached *inside* Reports, as report choices
 * rather than separate navigation items, because `docs/01-REQUIREMENTS.md` `REQ-REPORT-001`
 * defines them as reports. Listing them beside Dashboard as their own sections would give one
 * feature two addresses and let the two drift.
 */
export function AppLayout() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <a
        href="#main-content"
        className="skip-link rounded-md bg-blue-600 px-4 py-2 text-supporting font-semibold text-text-inverse"
      >
        Skip to main content
      </a>

      <header className="print-hidden border-b border-border-default bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-section-title font-bold tracking-tight text-text-primary">
                HYSSOP FINANCE
              </p>
              <p className="text-supporting text-text-secondary">
                Church financial management · Asia/Kolkata · INR
              </p>
            </div>

            <div className="flex items-center gap-3">
              <SessionControls />
              {/*
                The narrow-viewport navigation toggle. `aria-expanded` and `aria-controls`
                tie it to the drawer it opens, and the drawer is always present in the DOM so
                the control is never a button that reveals nothing.
              */}
              <button
                type="button"
                className="rounded-md border border-border-strong bg-surface px-3 py-1 text-supporting font-semibold text-text-primary md:hidden"
                aria-expanded={isMenuOpen}
                aria-controls="primary-navigation"
                onClick={() => {
                  setIsMenuOpen((previous) => !previous);
                }}
              >
                {isMenuOpen ? 'Close menu' : 'Menu'}
              </button>
            </div>
          </div>

          <nav
            id="primary-navigation"
            aria-label="Primary"
            className={`${isMenuOpen ? 'block' : 'hidden'} md:block`}
          >
            <ul className="flex flex-col gap-1 md:flex-row md:items-center md:gap-4">
              <NavigationItem to="/" end onNavigate={() => setIsMenuOpen(false)}>
                Dashboard
              </NavigationItem>
              <NavigationItem to="/members" onNavigate={() => setIsMenuOpen(false)}>
                Members
              </NavigationItem>
              <NavigationItem to="/income" onNavigate={() => setIsMenuOpen(false)}>
                Income
              </NavigationItem>
              <NavigationItem to="/expenses" onNavigate={() => setIsMenuOpen(false)}>
                Expenses
              </NavigationItem>
              <NavigationItem to="/reports" onNavigate={() => setIsMenuOpen(false)}>
                Reports
              </NavigationItem>
              <NavigationItem to="/search" onNavigate={() => setIsMenuOpen(false)}>
                Search
              </NavigationItem>
              <NavigationItem to="/audit-history" onNavigate={() => setIsMenuOpen(false)}>
                Audit History
              </NavigationItem>
              <NavigationItem to="/settings" onNavigate={() => setIsMenuOpen(false)}>
                Settings
              </NavigationItem>
              <NavigationItem to="/foundation" onNavigate={() => setIsMenuOpen(false)}>
                Status
              </NavigationItem>
            </ul>
          </nav>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Outlet />
      </main>

      <footer className="print-hidden border-t border-border-default bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-4 text-supporting text-text-secondary">
          Member, contribution, income, expense, receipt, and report records are stored in the
          HYSSOP FINANCE database, together with an append-only record of every change made to them.
        </div>
      </footer>
    </div>
  );
}

/**
 * One navigation link.
 *
 * The active section is marked with `aria-current="page"` and is underlined and bolded, so
 * the current position is conveyed by more than colour. The link is a router link, not an
 * anchor, so navigating does not reload the page and lose the session bootstrap.
 */
function NavigationItem({
  to,
  end,
  onNavigate,
  children,
}: {
  readonly to: string;
  readonly end?: boolean | undefined;
  readonly onNavigate: () => void;
  readonly children: string;
}) {
  return (
    <li>
      <NavLink
        to={to}
        end={end ?? false}
        onClick={onNavigate}
        className={({ isActive }) =>
          `block rounded-md px-3 py-2 text-supporting font-semibold ${
            isActive
              ? 'bg-blue-100 text-blue-700 underline'
              : 'text-text-primary hover:bg-surface-subtle'
          }`
        }
      >
        {children}
      </NavLink>
    </li>
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
    <div className="flex flex-wrap items-center gap-3">
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
