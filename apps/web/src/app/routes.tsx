import type { RouteObject } from 'react-router-dom';
import { RequireSession } from './auth/RequireSession';
import { RouteErrorPage } from './errors/RouteErrorPage';
import { AppLayout } from './layout/AppLayout';
import { DashboardPage } from '../pages/DashboardPage';
import { ExpenseDetailPage } from '../pages/ExpenseDetailPage';
import { ExpensesPage } from '../pages/ExpensesPage';
import { FoundationPage } from '../pages/FoundationPage';
import { IncomeDetailPage } from '../pages/IncomeDetailPage';
import { IncomePage } from '../pages/IncomePage';
import { LoginPage } from '../pages/LoginPage';
import { MemberDetailPage } from '../pages/MemberDetailPage';
import { MembersPage } from '../pages/MembersPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { ReportsPage } from '../pages/ReportsPage';
import { SearchPage } from '../pages/SearchPage';
import { TransactionReceiptPage } from '../pages/TransactionReceiptPage';

/**
 * The single route definition used by the browser and by the UI tests, so both
 * exercise the same tree. Only screens that exist are routable.
 *
 * Authority: `docs/06-API-SPEC.md` — "every route except health and the authentication routes
 * requires a live session". The guard therefore wraps the whole product area, not just the
 * dashboard: a not-found screen and the application shell are part of that area, and showing
 * them to a visitor who is not signed in would imply access the API does not grant.
 *
 * The dashboard is the index route, because `docs/03-UI-UX-RULES.md` makes it the landing screen
 * for a signed-in Admin. The build-status screen keeps its own address rather than disappearing:
 * it answers "what is not built yet", which is still a question worth one click, and deleting it
 * would take the API connectivity diagnostic with it.
 *
 * A member is addressed by the internal `id`, not by the visible `HY-MEM-0001` reference,
 * because `docs/06-API-SPEC.md` defines the member routes with a UUID path parameter and
 * rejects a reference there. The reference is what the Admin reads; the UUID is what
 * addresses the record.
 */
export function buildRoutes(): RouteObject[] {
  return [
    {
      path: '/',
      element: (
        <RequireSession>
          <AppLayout />
        </RequireSession>
      ),
      errorElement: <RouteErrorPage />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'foundation', element: <FoundationPage /> },
        { path: 'members', element: <MembersPage /> },
        { path: 'members/:memberId', element: <MemberDetailPage /> },
        { path: 'income', element: <IncomePage /> },
        { path: 'income/:transactionId', element: <IncomeDetailPage /> },
        { path: 'expenses', element: <ExpensesPage /> },
        { path: 'expenses/:transactionId', element: <ExpenseDetailPage /> },
        { path: 'transactions/:transactionId/receipt', element: <TransactionReceiptPage /> },
        { path: 'reports', element: <ReportsPage /> },
        { path: 'search', element: <SearchPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
    {
      path: '/login',
      element: (
        <main id="main-content" className="mx-auto w-full max-w-5xl px-6 py-8">
          <LoginPage />
        </main>
      ),
      errorElement: <RouteErrorPage />,
    },
  ];
}
