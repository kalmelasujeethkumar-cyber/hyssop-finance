import { useHealth } from './use-health';

/**
 * Connectivity status for the API. It reports only what the health contract
 * defines and never presents a financial value.
 */
export function HealthCard() {
  const { report, errorMessage, requestId, isLoading, refetch } = useHealth();

  return (
    <section
      aria-labelledby="health-heading"
      data-testid="health-card"
      className="rounded-xl border border-border-default bg-surface p-6"
    >
      <h2 id="health-heading" className="text-section-title font-bold text-text-primary">
        API connectivity
      </h2>

      {isLoading ? (
        <p className="mt-3 text-supporting text-text-secondary" role="status">
          Checking the API…
        </p>
      ) : null}

      {!isLoading && report !== undefined ? (
        <div className="mt-3 space-y-1" data-testid="health-status" data-state="connected">
          <p className="text-supporting font-semibold text-success-700">
            <span aria-hidden="true">● </span>
            Connected
          </p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-supporting text-text-secondary">
            <dt className="font-medium text-text-primary">Service</dt>
            <dd>{report.service}</dd>
            <dt className="font-medium text-text-primary">API version</dt>
            <dd>{report.version}</dd>
            <dt className="font-medium text-text-primary">Uptime</dt>
            <dd>{report.uptimeSeconds} seconds</dd>
          </dl>
        </div>
      ) : null}

      {!isLoading && errorMessage !== undefined ? (
        <div className="mt-3 space-y-3" data-testid="health-status" data-state="unavailable">
          <p className="text-supporting font-semibold text-danger-700">
            <span aria-hidden="true">● </span>
            Unavailable
          </p>
          <p className="text-supporting text-text-secondary" role="alert">
            {errorMessage}
          </p>
          {requestId === undefined ? null : (
            <p className="text-supporting text-text-secondary">
              Request reference: <code>{requestId}</code>
            </p>
          )}
          <button
            type="button"
            onClick={refetch}
            className="rounded-md border border-blue-600 bg-blue-600 px-4 py-2 text-supporting font-semibold text-text-inverse transition-colors hover:bg-blue-700 active:bg-blue-700"
          >
            Retry connectivity check
          </button>
        </div>
      ) : null}
    </section>
  );
}
