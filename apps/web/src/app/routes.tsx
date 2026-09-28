import type { RouteObject } from 'react-router-dom';
import { RequireSession } from './auth/RequireSession';
import { RouteErrorPage } from './errors/RouteErrorPage';
import { AppLayout } from './layout/AppLayout';
import { FoundationPage } from '../pages/FoundationPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';

/**
 * The single route definition used by the browser and by the UI tests, so both
 * exercise the same tree. Only screens that exist are routable.
 *
 * Authority: `docs/06-API-SPEC.md` — every route except health and the authentication routes
 * requires a live session. The guard therefore wraps the whole product area, not just the
 * dashboard: a not-found screen and the application shell are part of that area, and showing
 * them to a visitor who is not signed in would imply access the API does not grant.
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
        { index: true, element: <FoundationPage /> },
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
