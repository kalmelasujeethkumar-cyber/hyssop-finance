/**
 * Member and contribution-period contract.
 *
 * Owned by `docs/06-API-SPEC.md` and shaped by `docs/01-REQUIREMENTS.md`
 * (`REQ-MEM-001` to `REQ-MEM-006`, `REQ-CONTRIB-001` to `REQ-CONTRIB-004`) and
 * `docs/05-DATABASE-SPEC.md`. Both applications depend on this module, so a member
 * payload or a contribution status cannot drift between the API and the browser.
 *
 * Two rules are load-bearing here and are the reason this file exists:
 *
 * - A member has two identifiers, and they do different jobs. `id` is the opaque UUID
 *   that keys a URL and an `If-Match` edit; `referenceId` (`HY-MEM-0001`) is the
 *   human-readable member ID that the Admin reads, searches, and quotes. `referenceId` is
 *   immutable, so a member keeps the same visible ID through every edit, while `id` is
 *   never displayed and is safe to change representation without a product change. The
 *   browser does need `id` to address the member, so the rule is *display* the reference,
 *   not *conceal* the UUID (`REQ-MEM-001`, `docs/05-DATABASE-SPEC.md` on an immutable
 *   `reference_id`).
 * - A contribution period carries only the *expected* amount. `receivedPaise` and
 *   `remainingPaise` are derived from active `MEMBER_CONTRIBUTION` transactions, and
 *   `status` is derived from those. They are never accepted from a client, so the
 *   ledger stays the single source of truth (`REQ-CONTRIB-003`, `REQ-CONTRIB-004`).
 */

/** `docs/05-DATABASE-SPEC.md`: `member` stores identity, contact, and notes only. */
export const MEMBER_NAME_MAX_LENGTH = 120;
export const MEMBER_NOTES_MAX_LENGTH = 2000;
export const MEMBER_PHONE_MAX_LENGTH = 15;

export const MEMBER_SEARCH_MAX_LENGTH = 100;

export const MEMBER_PAGE_SIZE_DEFAULT = 20;
export const MEMBER_PAGE_SIZE_MAX = 100;

/** The documented reference format, shared so the UI can validate before submitting. */
export const MEMBER_REFERENCE_PREFIX = 'HY-MEM-';
export const MEMBER_REFERENCE_PATTERN = /^HY-MEM-\d{4}$/;

export const CONTRIBUTION_STATUSES = ['PAID', 'PARTIALLY PAID', 'NOT PAID'] as const;

export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

/** Sortable list fields. Ordering is always completed by `referenceId` for determinism. */
export const MEMBER_SORT_FIELDS = ['name', 'referenceId', 'createdAt'] as const;

export type MemberSortField = (typeof MEMBER_SORT_FIELDS)[number];

export type MemberSortDirection = 'asc' | 'desc';

export interface MemberSummary {
  readonly id: string;
  readonly referenceId: string;
  readonly name: string;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemberDetail extends MemberSummary {
  /** The member's periods for the requested year, newest month first. */
  readonly contributionPeriods: readonly ContributionPeriodView[];
  /** Active member-contribution transactions, newest business date first. */
  readonly transactions: readonly MemberTransactionView[];
}

/**
 * One configured expected amount for a month, with the derived ledger state beside it.
 *
 * `receivedPaise` and `remainingPaise` are decimal INR strings, not numbers, so the
 * browser cannot lose precision and both applications format money identically.
 */
export interface ContributionPeriodView {
  readonly id: string;
  readonly year: number;
  readonly month: number;
  readonly expectedPaise: string;
  readonly receivedPaise: string;
  readonly remainingPaise: string;
  readonly status: ContributionStatus;
}

/**
 * A read-only projection of one member-contribution transaction.
 *
 * Phase 05 owns creating and editing transactions, so this shape only ever *reads*
 * them, and it deliberately omits void and edit controls.
 */
export interface MemberTransactionView {
  readonly id: string;
  readonly referenceId: string;
  readonly amountPaise: string;
  readonly paymentMethod: string;
  readonly businessDate: string;
  /** Nullable, because `financial_transaction.description` is optional in the schema. */
  readonly description: string | null;
  readonly status: 'ACTIVE' | 'VOIDED';
}

/** Totals across many members for one period, used by the contribution summary. */
export interface ContributionPeriodSummary {
  readonly year: number;
  readonly month: number;
  readonly configured: number;
  readonly paid: number;
  readonly partiallyPaid: number;
  readonly notPaid: number;
  readonly expectedTotalPaise: string;
  readonly receivedTotalPaise: string;
  readonly remainingTotalPaise: string;
}

export function isContributionStatus(value: unknown): value is ContributionStatus {
  return typeof value === 'string' && (CONTRIBUTION_STATUSES as readonly string[]).includes(value);
}

export function isMemberSortField(value: unknown): value is MemberSortField {
  return typeof value === 'string' && (MEMBER_SORT_FIELDS as readonly string[]).includes(value);
}

export function isMemberSortDirection(value: unknown): value is MemberSortDirection {
  return value === 'asc' || value === 'desc';
}

export function isMemberReferenceId(value: unknown): value is string {
  return typeof value === 'string' && MEMBER_REFERENCE_PATTERN.test(value);
}
