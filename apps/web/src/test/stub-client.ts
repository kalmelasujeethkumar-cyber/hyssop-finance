import { HEALTH_SERVICE_NAME, type HealthReport } from '@hyssop/contracts';
import { ApiClientError, ApiTransportError, type ApiClient } from '../lib/api-client';

export const HEALTH_REPORT: HealthReport = {
  status: 'ok',
  service: HEALTH_SERVICE_NAME,
  version: '0.1.0',
  uptimeSeconds: 42,
  timestamp: '2026-09-26T09:15:00.000Z',
};

export const transportFailure = new ApiTransportError('The API could not be reached.');

export const serverFailure = new ApiClientError(
  503,
  'INTERNAL_ERROR',
  'An unexpected error occurred. Please try again.',
  '3f0a1b2c-4d5e-4f60-8a71-9b2c3d4e5f60',
);

/**
 * Stands in for the real client, which already unwraps the success envelope, and
 * asserts that the UI only requests the documented health path.
 */
export function clientResolvingWith(report: HealthReport = HEALTH_REPORT): ApiClient {
  return {
    get: <TData>(path: string): Promise<TData> => {
      assertHealthPath(path);
      return Promise.resolve(report as TData);
    },
  };
}

export function clientFailingWith(error: Error): ApiClient {
  return {
    get: <TData>(path: string): Promise<TData> => {
      assertHealthPath(path);
      return Promise.reject(error);
    },
  };
}

function assertHealthPath(path: string): void {
  if (path !== '/health') {
    throw new Error(`The stub client was called with an unexpected path: ${path}`);
  }
}
