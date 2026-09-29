/**
 * Income contract.
 *
 * Owned by `docs/06-API-SPEC.md` (`POST /api/v1/income` and the income-type filter of
 * `GET /api/v1/transactions`) and shaped by `docs/01-REQUIREMENTS.md` `REQ-INCOME-001` to
 * `REQ-INCOME-006`.
 *
 * **There is deliberately no `IncomeSummary` type.** A financial transaction has exactly one
 * canonical shape — `TransactionSummary` in `./transactions` — and
 * `docs/02-ARCHITECTURE.md` requires income and expenses to share it so that reference,
 * correction, void, audit, and receipt behaviour cannot diverge between them. The
 * `GET /api/v1/transactions` entry of `docs/06-API-SPEC.md` defines no separate income response,
 * and the derived member-month status is already owned by the contribution-period reads that
 * Phase 04 delivers. Inventing a second transaction payload here would create exactly the
 * second source of truth the architecture forbids.
 *
 * What income *does* own is the type vocabulary (`IncomeType` and its labels, in
 * `./transactions`, because both applications must spell these four values identically) and the
 * documented filter surface below, which is what the browser sends and the API validates.
 */

import type { ContributionStatus } from './members';

export type { ContributionStatus };

/** Income list defaults shared by the API and the browser so an unfiltered list matches. */
export const INCOME_LIST_DEFAULTS = {
  page: 1,
  pageSize: 20,
  sort: 'businessDate',
  direction: 'desc',
} as const;

/**
 * The income filters `docs/06-API-SPEC.md` requires the transaction list to support for
 * income rows. Each one is validated and maps to a single indexed column, so a filter
 * cannot inject arbitrary query structure.
 */
export interface IncomeListFilters {
  readonly search: string;
  readonly page: number;
  readonly pageSize: number;
  readonly sort: 'businessDate' | 'amount' | 'referenceId' | 'createdAt';
  readonly direction: 'asc' | 'desc';
  readonly status: 'ACTIVE' | 'VOIDED' | '';
  readonly paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER' | '';
  readonly incomeType: 'MEMBER_CONTRIBUTION' | 'OFFERING' | 'DONATION' | 'ANONYMOUS_DONATION' | '';
  readonly from: string;
  readonly to: string;
  readonly memberId: string;
  readonly minAmount: string;
  readonly maxAmount: string;
}

/** The documented income list query, shared so the browser cannot invent a parameter. */
export const INCOME_FILTER_KEYS = [
  'search',
  'page',
  'pageSize',
  'sort',
  'direction',
  'status',
  'paymentMethod',
  'incomeType',
  'from',
  'to',
  'memberId',
  'minAmount',
  'maxAmount',
] as const;
