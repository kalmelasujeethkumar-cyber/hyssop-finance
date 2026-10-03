import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../../features/auth/SessionProvider';
import { UnsavedWorkProvider, useUnsavedWorkStatus } from '../providers/UnsavedWorkProvider';

/**
 * The application shell: a desktop sidebar, a collapsible navigation rail, and an accessible
 * mobile drawer.
 *
 * Authority: `docs/03-UI-UX-RULES.md` — use a desktop sidebar for the primary navigation, allow it
 * to collapse without hiding access to a required section, provide a clear mobile drawer, keep the
 * current section identifiable, keep status visible without relying on colour alone, and avoid
 * page-level horizontal overflow. `docs/01-REQUIREMENTS.md` `REQ-RESP-002` and `REQ-RESP-003` make
 * the sidebar, the collapse, and the mobile drawer explicit requirements.
 *
 * **Only sections that exist are listed.** The rules name Dashboard, Members, Income,
 * Expenses, Documents, Reports, Audit History, and Settings as the eventual navigation, but
 * the same rules forbid presenting unimplemented behaviour as a completed feature, and no
 * dead control or `Coming Soon` placeholder is permitted. Dashboard, Members, Income,
 * Expenses, Reports, Search, Audit History, and Settings are all implemented; the build-status
 * screen answers what is still outstanding. Receipts are attached from an expense or income
 * record rather than having their own section, because a standalone document list would have
 * nothing to show that the transaction it belongs to does not already show. That deviation from
 * the literal navigation list is recorded in `docs/runtime/DECISIONS.md`.
 *
 * The Receipt / Document and Audit reports are reached *inside* Reports, as report choices
 * rather than separate navigation items, because `docs/01-REQUIREMENTS.md` `REQ-REPORT-001`
 * defines them as reports. Listing them beside Dashboard as their own sections would give one
 * feature two addresses and let the two drift.
 */

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'hyssop.navigation.sidebar-collapsed';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true, icon: 'dashboard' },
  { to: '/members', label: 'Members', end: false, icon: 'members' },
  { to: '/income', label: 'Income', end: false, icon: 'income' },
  { to: '/expenses', label: 'Expenses', end: false, icon: 'expenses' },
  { to: '/reports', label: 'Reports', end: false, icon: 'reports' },
  { to: '/search', label: 'Search', end: false, icon: 'search' },
  { to: '/audit-history', label: 'Audit History', end: false, icon: 'audit' },
  { to: '/settings', label: 'Settings', end: false, icon: 'settings' },
  { to: '/foundation', label: 'Status', end: false, icon: 'status' },
] as const;

type NavIconName = (typeof NAV_ITEMS)[number]['icon'];

/**
 * Path data for the small navigation glyphs.
 *
 * They exist only so a collapsed rail is still legible: a rail of labels hidden behind `sr-only`
 * with nothing visible beside them would be a row of blank controls. The glyphs are decorative —
 * every link keeps its text as an accessible name — so they are marked `aria-hidden` and never
 * carry meaning on their own.
 */
const ICON_PATHS: Record<NavIconName, readonly string[]> = {
  dashboard: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  members: [
    'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1',
    'M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
    'M21 19v-1a4 4 0 0 0-3-3.87',
    'M16 4.13a4 4 0 0 1 0 7.75',
  ],
  income: ['M12 3v12', 'M8 11l4 4 4-4', 'M4 21h16'],
  expenses: ['M12 21V9', 'M8 13l4-4 4 4', 'M4 3h16'],
  reports: [
    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
    'M14 3v5h5',
    'M9 13h6',
    'M9 17h6',
  ],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-3.5-3.5'],
  audit: ['M12 8v4l3 2', 'M3.05 11a9 9 0 1 1 .5 4', 'M3 4v5h5'],
  settings: [
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M3 12h2',
    'M19 12h2',
    'M12 3v2',
    'M12 19v2',
  ],
  status: ['M3 12h4l3-8 4 16 3-8h4'],
};

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    // A browser that blocks storage must still render a usable shell; the collapse simply
    // starts expanded and does not persist, which is honest rather than a broken control.
    return false;
  }
}

export function AppLayout() {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(readStoredCollapsed);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  /*
   * The mobile drawer is a disclosure, not a full modal dialog, but it still needs the same
   * keyboard courtesy: focus moves into the navigation on open, `Escape` closes it, and focus
   * returns to the control that opened it. Body scroll is locked while it is open so the page
   * behind it cannot scroll away under the drawer.
   */
  useEffect(() => {
    if (!isMobileNavOpen) {
      return undefined;
    }

    drawerRef.current?.querySelector<HTMLElement>('nav a')?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsMobileNavOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      menuButtonRef.current?.focus();
    };
  }, [isMobileNavOpen]);

  function toggleCollapsed(): void {
    setIsCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // Storage being unavailable only means the choice is not remembered, not that the
        // control failed; the sidebar still collapses for this session.
      }

      return next;
    });
  }

  function closeMobileNav(): void {
    setIsMobileNavOpen(false);
  }

  return (
    <UnsavedWorkProvider>
      <div className="flex min-h-screen flex-col bg-canvas">
        <a
          href="#main-content"
          className="skip-link rounded-md bg-blue-600 px-4 py-2 text-supporting font-semibold text-text-inverse"
        >
          Skip to main content
        </a>

        <header className="print-hidden border-b border-border-default bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
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
              tie it to the drawer it opens, and the drawer is always in the DOM so the
              control is never a button that reveals nothing.
            */}
              <button
                type="button"
                ref={menuButtonRef}
                className="rounded-md border border-border-strong bg-surface px-3 py-1 text-supporting font-semibold text-text-primary md:hidden"
                aria-expanded={isMobileNavOpen}
                aria-controls="primary-navigation"
                onClick={() => {
                  setIsMobileNavOpen((previous) => !previous);
                }}
              >
                {isMobileNavOpen ? 'Close menu' : 'Menu'}
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-1">
          {isMobileNavOpen ? (
            <div
              className="print-hidden fixed inset-0 z-30 bg-black/30 md:hidden"
              aria-hidden="true"
              onClick={closeMobileNav}
            />
          ) : null}

          {/*
          One sidebar element serves both layouts: a sticky column on a wide viewport and a
          slide-in drawer below `md`. Keeping a single navigation landmark means there is never a
          second copy of the links to reach with a keyboard or to announce twice.
        */}
          <aside
            ref={drawerRef}
            className={`print-hidden ${
              isMobileNavOpen ? 'flex' : 'hidden'
            } fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] flex-col border-r border-border-default bg-surface p-3 md:sticky md:top-0 md:z-auto md:flex md:h-fit md:max-w-none md:self-start ${
              isCollapsed ? 'md:w-20' : 'md:w-64'
            }`}
          >
            <nav id="primary-navigation" aria-label="Primary" className="flex-1 overflow-y-auto">
              <ul className="flex flex-col gap-1">
                {NAV_ITEMS.map((item) => (
                  <NavigationItem
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    icon={item.icon}
                    collapsed={isCollapsed}
                    onNavigate={closeMobileNav}
                  >
                    {item.label}
                  </NavigationItem>
                ))}
              </ul>
            </nav>

            <button
              type="button"
              className="mt-3 hidden items-center justify-center gap-2 rounded-md border border-border-default bg-surface-subtle px-3 py-2 text-supporting font-semibold text-text-secondary hover:bg-surface md:inline-flex"
              aria-pressed={isCollapsed}
              aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              onClick={toggleCollapsed}
            >
              <span aria-hidden="true">{isCollapsed ? '»' : '«'}</span>
              <span className={isCollapsed ? 'sr-only' : ''}>
                {isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              </span>
            </button>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <main
              id="main-content"
              className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
            >
              <Outlet />
            </main>

            <footer className="print-hidden border-t border-border-default bg-surface">
              <div className="mx-auto w-full max-w-6xl px-4 py-4 text-supporting text-text-secondary sm:px-6">
                Member, contribution, income, expense, receipt, and report records are stored in the
                HYSSOP FINANCE database, together with an append-only record of every change made to
                them.
              </div>
            </footer>
          </div>
        </div>
      </div>
    </UnsavedWorkProvider>
  );
}

/**
 * One navigation link.
 *
 * The active section is marked with `aria-current="page"` and is underlined and bolded, so
 * the current position is conveyed by more than colour. The link is a router link, not an
 * anchor, so navigating does not reload the page and lose the session bootstrap. The label is
 * always rendered — as `sr-only` when the rail is collapsed — so the link keeps its accessible
 * name and never becomes a glyph with no purpose.
 */
function NavigationItem({
  to,
  end,
  icon,
  collapsed,
  onNavigate,
  children,
}: {
  readonly to: string;
  readonly end: boolean;
  readonly icon: NavIconName;
  readonly collapsed: boolean;
  readonly onNavigate: () => void;
  readonly children: string;
}) {
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        onClick={onNavigate}
        title={children}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-md px-3 py-2 text-supporting font-semibold ${
            isActive
              ? 'bg-blue-100 text-blue-700 underline'
              : 'text-text-primary hover:bg-surface-subtle'
          } ${collapsed ? 'md:justify-center md:gap-0' : ''}`
        }
      >
        <NavIcon name={icon} />
        <span className={collapsed ? 'sr-only' : ''}>{children}</span>
      </NavLink>
    </li>
  );
}

function NavIcon({ name }: { readonly name: NavIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICON_PATHS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
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
  const { isDirty, requestConfirmation } = useUnsavedWorkStatus();
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (status !== 'authenticated' || admin === null) {
    return null;
  }

  async function handleSignOut(): Promise<void> {
    // Signing out ends the session before it navigates, so the warning has to come first: a
    // post-navigation blocker would leave the Admin signed out but still on the page.
    if (isDirty) {
      const confirmed = await requestConfirmation({
        title: 'Sign out with unsaved changes?',
        message: 'You have unsaved changes. Signing out will discard them.',
        confirmLabel: 'Sign out and discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      });
      if (!confirmed) {
        return;
      }
    }

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
