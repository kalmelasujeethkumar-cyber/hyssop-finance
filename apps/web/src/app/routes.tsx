import type { RouteObject } from 'react-router-dom';
import { RouteErrorPage } from './errors/RouteErrorPage';
import { AppLayout } from './layout/AppLayout';
import { FoundationPage } from '../pages/FoundationPage';
import { NotFoundPage } from '../pages/NotFoundPage';

/**
 * The single route definition used by the browser and by the UI tests, so both
 * exercise the same tree. Only screens that exist are routable.
 */
export function buildRoutes(): RouteObject[] {
  return [
    {
      path: '/',
      element: <AppLayout />,
      errorElement: <RouteErrorPage />,
      children: [
        { index: true, element: <FoundationPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ];
}
