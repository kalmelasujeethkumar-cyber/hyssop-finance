import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { AppProviders } from '../app/providers/AppProviders';
import { buildRoutes } from '../app/routes';
import type { ApiClient } from '../lib/api-client';

export interface RenderRouteOptions {
  readonly path?: string;
  readonly client: ApiClient;
}

/**
 * Renders the real route tree and the real provider stack, so UI tests and the browser
 * exercise the same routes, the same session bootstrap, and the same API client shape.
 */
export function renderRoute({ path = '/', client }: RenderRouteOptions): RenderResult {
  const router = createMemoryRouter(buildRoutes(), { initialEntries: [path] });
  // Mirrors the query defaults in `src/main.tsx` so a test observes the same caching
  // behaviour as the browser. A test still gets a fresh cache per render, which is what
  // isolates tests from one another; forcing `gcTime: 0` on top of that would instead evict
  // a cached response the moment a component remounts and make a test see a request the
  // real application would not make.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AppProviders client={client}>
        <RouterProvider router={router} />
      </AppProviders>
    </QueryClientProvider>,
  );
}
