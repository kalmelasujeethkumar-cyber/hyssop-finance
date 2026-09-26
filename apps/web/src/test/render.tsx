import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ApiClientProvider } from '../app/providers/ApiClientProvider';
import { buildRoutes } from '../app/routes';
import type { ApiClient } from '../lib/api-client';

export interface RenderRouteOptions {
  readonly path?: string;
  readonly client: ApiClient;
}

/** Renders the real route tree, so UI tests and the browser exercise the same routes. */
export function renderRoute({ path = '/', client }: RenderRouteOptions): RenderResult {
  const router = createMemoryRouter(buildRoutes(), { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <RouterProvider router={router} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}
