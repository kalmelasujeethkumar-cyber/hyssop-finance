import { useQuery } from '@tanstack/react-query';
import type { HealthReport } from '@hyssop/contracts';
import { useApiClient } from '../../app/providers/ApiClientProvider';
import { ApiClientError, ApiTransportError } from '../../lib/api-client';

export const HEALTH_QUERY_KEY = ['health'] as const;

export interface HealthState {
  readonly report?: HealthReport;
  readonly errorMessage?: string;
  readonly requestId?: string;
  readonly isLoading: boolean;
  readonly refetch: () => void;
}

export function useHealth(): HealthState {
  const client = useApiClient();

  const query = useQuery({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: ({ signal }) => client.get<HealthReport>('/health', { signal }),
    retry: false,
    staleTime: 30_000,
  });

  if (query.data === undefined) {
    return {
      ...(query.error === undefined ? {} : describeFailure(query.error)),
      isLoading: query.isPending,
      refetch: () => {
        void query.refetch();
      },
    };
  }

  return {
    report: query.data,
    isLoading: query.isPending,
    refetch: () => {
      void query.refetch();
    },
  };
}

function describeFailure(error: unknown): { errorMessage: string; requestId?: string } {
  if (error instanceof ApiClientError) {
    return { errorMessage: error.message, requestId: error.requestId };
  }

  if (error instanceof ApiTransportError) {
    return { errorMessage: error.message };
  }

  return { errorMessage: 'The connectivity check failed unexpectedly.' };
}
