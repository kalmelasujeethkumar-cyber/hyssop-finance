import { isRouteErrorResponse, useRevalidator, useRouteError } from 'react-router-dom';

export function RouteErrorPage() {
  const error = useRouteError();
  const revalidator = useRevalidator();

  return (
    <div className="space-y-4" role="alert">
      <h1 className="text-page-title font-bold text-text-primary">Something went wrong</h1>
      <p className="text-supporting text-text-secondary">
        {isRouteErrorResponse(error) && error.status === 404
          ? 'The requested screen could not be loaded.'
          : 'This screen could not be loaded. No financial data was affected.'}
      </p>
      <button
        type="button"
        onClick={() => {
          void revalidator.revalidate();
        }}
        className="rounded-md border border-blue-600 bg-blue-600 px-4 py-2 text-supporting font-semibold text-text-inverse transition-colors hover:bg-blue-700 active:bg-blue-700"
      >
        Try again
      </button>
    </div>
  );
}
