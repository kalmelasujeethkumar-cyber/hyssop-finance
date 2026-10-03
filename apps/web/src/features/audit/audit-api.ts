import { useQuery } from '@tanstack/react-query';
import {
  TRANSACTION_PAGE_SIZE_DEFAULT,
  TRANSACTION_PAGE_SIZE_MAX,
  type ApiPagination,
  type AuditHistoryFilters,
  type AuditHistoryResponse,
} from '@hyssop/contracts';
import { useApiClient } from '../../app/providers/ApiClientProvider';

/**
 * Audit history data access.
 *
 * Authority: `docs/02-ARCHITECTURE.md` - the browser reads a projection and never computes
 * authoritative state. The trail itself is append-only and is written by the operations that change
 * a record; this module only ever *reads* it, so there is no mutation here for a screen to call.
 *
 * The filter vocabulary is deliberately not restated here. `AUDIT_ACTION_FILTER_OPTIONS` and
 * `AUDIT_ENTITY_TYPE_FILTER_OPTIONS` come from the shared contract, which is the same list the API
 * validates a filter against. A second copy here would be a place for the dropdown and the server's
 * accepted values to drift apart, and the failure would be silent: the screen would offer a filter
 * the API then refuses.
 *
 * Nothing here computes a financial figure. Rows and the pagination block are passed through from
 * the server's own response, so the counts and any amount shown in a snapshot are the ones the API
 * decided.
 */

export const AUDIT_HISTORY_QUERY_KEY = ['audit-history'] as const;

export interface AuditHistoryQueryInput {
  /** `null` means "no filter"; an empty string is normalised to `null` so it is never sent. */
  readonly action?: string | null;
  readonly entityType?: string | null;
  /** Inclusive `YYYY-MM-DD` Asia/Kolkata business date. */
  readonly from?: string | null;
  readonly to?: string | null;
  readonly page?: number;
  readonly pageSize?: number;
}

export function useAuditHistory(input: AuditHistoryQueryInput) {
  const api = useApiClient();

  return useQuery<AuditHistoryResponse, Error>({
    // The whole criteria object is part of the key, so two different filters cannot share a cached
    // page: an admin who narrows the trail must never see the previous, wider result.
    queryKey: [AUDIT_HISTORY_QUERY_KEY[0], input],
    queryFn: async () => {
      const params = new URLSearchParams();

      // Only criteria that were actually chosen are sent. The API treats an absent filter as
      // open-ended and a blank one as a value outside its vocabulary, so an empty string must never
      // reach the wire.
      if (input.action != null && input.action !== '') {
        params.set('action', input.action);
      }
      if (input.entityType != null && input.entityType !== '') {
        params.set('entityType', input.entityType);
      }
      if (input.from != null && input.from !== '') {
        params.set('from', input.from);
      }
      if (input.to != null && input.to !== '') {
        params.set('to', input.to);
      }
      if (input.page !== undefined) {
        params.set('page', String(Math.max(1, Math.trunc(input.page))));
      }
      if (input.pageSize !== undefined) {
        params.set('pageSize', String(clampAuditPageSize(input.pageSize)));
      }

      const query = params.toString();

      return api.get<AuditHistoryResponse>(
        query === '' ? '/audit-events' : `/audit-events?${query}`,
      );
    },
    // The trail only grows when an operation records a change, and those screens do not navigate
    // here afterwards, so a short window is enough to avoid a refetch on every render without
    // risking a stale view that matters.
    staleTime: 30_000,
  });
}

/**
 * Clamps a requested page size to the shared list bounds.
 *
 * `TRANSACTION_PAGE_SIZE_MAX` is the same bound every other list in this application uses, and the
 * API refuses a larger `pageSize` with a validation error. Clamping here means a hand-edited URL
 * shows a valid page instead of an error screen.
 *
 * Exported so the screen's own "per page" control and the request it triggers agree on one clamped
 * value; a second clamp in the page would be a second answer to the same question.
 */
export function clampAuditPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize)) {
    return TRANSACTION_PAGE_SIZE_DEFAULT;
  }

  return Math.max(1, Math.min(pageSize, TRANSACTION_PAGE_SIZE_MAX));
}

/** The echoed criteria, with every absent filter reported as `null` rather than `undefined`. */
export function normalizeAuditFilters(filters: AuditHistoryFilters): AuditHistoryFilters {
  return {
    action: filters.action ?? null,
    entityType: filters.entityType ?? null,
    from: filters.from ?? null,
    to: filters.to ?? null,
  };
}

/**
 * The pagination block, clamped to something a control can actually navigate.
 *
 * A `page` past the end of the result is pulled back to the last reachable page so the pager never
 * shows "Page 9 of 3", and `totalPages` is never below 1 so a "next" control cannot point at page 0.
 */
export function normalizeAuditPagination(pagination: ApiPagination): ApiPagination {
  const pageSize = clampAuditPageSize(pagination.pageSize);
  const totalItems = Math.max(0, Math.trunc(pagination.totalItems));
  const totalPages = Math.max(1, Math.trunc(pagination.totalPages));
  const page = Math.max(1, Math.min(Math.trunc(pagination.page), totalPages));

  return { page, pageSize, totalItems, totalPages };
}
