import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { RootErrorBoundary } from './app/errors/RootErrorBoundary';
import { ApiClientProvider } from './app/providers/ApiClientProvider';
import { buildRoutes } from './app/routes';
import { createApiClient } from './lib/api-client';
import { apiBaseUrl } from './lib/env';
import './styles/theme.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

const apiClient = createApiClient({ baseUrl: apiBaseUrl });
const router = createBrowserRouter(buildRoutes());

const container = document.getElementById('root');

if (container === null) {
  throw new Error('The application root element is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>
          <RouterProvider router={router} />
        </ApiClientProvider>
      </QueryClientProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
