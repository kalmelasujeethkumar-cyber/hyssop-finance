/**
 * Connectivity contract for `GET /api/v1/health`.
 *
 * Owned by `docs/06-API-SPEC.md`. The report intentionally carries no configuration
 * values, dependency versions, filesystem paths, or credentials.
 */

export const HEALTH_SERVICE_NAME = 'hyssop-finance-api';

export interface HealthReport {
  readonly status: 'ok';
  readonly service: string;
  readonly version: string;
  readonly uptimeSeconds: number;
  readonly timestamp: string;
}

export function isHealthReport(value: unknown): value is HealthReport {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    candidate['status'] === 'ok' &&
    typeof candidate['service'] === 'string' &&
    candidate['service'].length > 0 &&
    typeof candidate['version'] === 'string' &&
    typeof candidate['uptimeSeconds'] === 'number' &&
    Number.isFinite(candidate['uptimeSeconds']) &&
    candidate['uptimeSeconds'] >= 0 &&
    typeof candidate['timestamp'] === 'string'
  );
}
