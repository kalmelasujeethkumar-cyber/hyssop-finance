/**
 * Shared financial transaction contract.
 *
 * Owned by `docs/06-API-SPEC.md` and shaped by `docs/01-REQUIREMENTS.md`
 * (`REQ-FIN-001` to `REQ-FIN-024`, `REQ-DOC-010` to `REQ-DOC-014`) and
 * `docs/05-DATABASE-SPEC.md`. Both applications depend on this module, so an income
 * payload, an expense payload, a receipt, and an audit event cannot drift between the API
 * and the browser.
 *
 * Four rules are load-bearing here and are the reason income and expenses share one file
 * rather than defining their own vocabulary:
 *
 * - **One canonical transaction shape.** `docs/02-ARCHITECTURE.md` requires a single
 *   canonical representation for income and expense so that reference, audit, void, and
 *   document behaviour cannot diverge between the two modules. `TransactionSummary` is
 *   that one shape; `IncomeSummary` and `ExpenseSummary` extend it with only the fields
 *   that are genuinely type-specific.
 * - **Money crosses the boundary as a decimal string.** `amount` is a string such as
 *   `"1000.00"`, never a JSON number, because `REQ-FIN-021` and the database spec require
 *   exact paise arithmetic and a double cannot represent every paise value. Internal paise
 *   is never exposed, as `docs/06-API-SPEC.md` states.
 * - **A transaction has two identifiers, as a member does.** `id` is the UUID that keys a
 *   URL and an `If-Match` edit; `referenceId` (`HY-INC-000001`, `HY-EXP-000001`) is the
 *   human-readable reference the Admin reads, searches, and quotes on a receipt. The
 *   reference is immutable.
 * - **Void is a state, not a deletion.** `status` is `ACTIVE` or `VOIDED`, and a voided row
 *   keeps its identity, its history, and its amount so it stays auditable while being
 *   excluded from every active total (`REQ-FIN-016` to `REQ-FIN-020`).
 */

/** The locked application name, rendered on every receipt (`REQ-DOC-010`). */
export const APPLICATION_NAME = 'HYSSOP FINANCE';

/** Fixed demo currency. `docs/06-API-SPEC.md` returns it but it is never mutable. */
export const CURRENCY = 'INR';

export const TRANSACTION_TYPES = ['INCOME', 'EXPENSE'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** `docs/01-REQUIREMENTS.md` `REQ-INCOME-001`, exhaustive and closed. */
export const INCOME_TYPES = [
  'MEMBER_CONTRIBUTION',
  'OFFERING',
  'DONATION',
  'ANONYMOUS_DONATION',
] as const;

export type IncomeType = (typeof INCOME_TYPES)[number];

/** `REQ-INCOME-002` and `REQ-EXP-003`: the same three methods on both sides of the ledger. */
export const PAYMENT_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** The only two transaction states. A transaction is never physically deleted. */
export const TRANSACTION_STATUSES = ['ACTIVE', 'VOIDED'] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const CATEGORY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

/** The documented attachment states (`AVAILABLE`, `REMOVED`, plus authorized `VOIDED`). */
export const DOCUMENT_STATES = ['AVAILABLE', 'REMOVED', 'VOIDED'] as const;

export type DocumentState = (typeof DOCUMENT_STATES)[number];

/** Sortable transaction list fields. Ordering always ends with `referenceId` for determinism. */
export const TRANSACTION_SORT_FIELDS = [
  'businessDate',
  'amount',
  'referenceId',
  'createdAt',
] as const;

export type TransactionSortField = (typeof TRANSACTION_SORT_FIELDS)[number];

export type TransactionSortDirection = 'asc' | 'desc';

export const TRANSACTION_PAGE_SIZE_DEFAULT = 20;
export const TRANSACTION_PAGE_SIZE_MAX = 100;

/** `financial_transaction.description` is optional free text. */
export const TRANSACTION_DESCRIPTION_MAX_LENGTH = 200;

/** `financial_transaction.notes` is optional free text. */
export const TRANSACTION_NOTES_MAX_LENGTH = 2000;

/** `REQ-FIN-017`: a void reason is required, and it is stored, so its length is bounded. */
export const VOID_REASON_MAX_LENGTH = 500;

/** The accepted reference shape, shared so the UI can validate before submitting. */
export const TRANSACTION_REFERENCE_PREFIXES = ['HY-INC-', 'HY-EXP-'] as const;

export const TRANSACTION_REFERENCE_PATTERN = /^HY-(?:INC|EXP)-\d{6}$/;

/**
 * The exact INR amount shape accepted at the API boundary.
 *
 * A positive decimal with at most two fraction digits, no sign, no exponent, and no digit
 * grouping. `REQ-FIN-021` requires an ambiguous value to be rejected rather than rounded,
 * and `parsePaise` in the API enforces exactly this shape.
 */
export const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export const MONEY_FORMAT_MESSAGE =
  'Enter an amount such as 500 or 500.00, with at most two decimal places.';

/** The accepted `YYYY-MM-DD` business-date shape (`Asia/Kolkata` accounting date). */
export const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const BUSINESS_DATE_FORMAT_MESSAGE = 'Enter a business date as YYYY-MM-DD.';

/** The business years the ledger accepts, matching the contribution-period path range. */
export const MIN_BUSINESS_YEAR = 1970;
export const MAX_BUSINESS_YEAR = 9999;

/**
 * A contributor named on a transaction.
 *
 * Present only when a member legitimately applies: a member contribution always has one,
 * an offering or donation may have one, and an anonymous donation must have none
 * (`REQ-INCOME-005`). This type therefore cannot describe an anonymous donor.
 */
export interface TransactionContributor {
  readonly id: string;
  readonly referenceId: string;
  readonly name: string;
}

/** The expense category named on a transaction, active or historically inactive. */
export interface TransactionCategoryRef {
  readonly id: string;
  readonly name: string;
  /**
   * The category's status at read time.
   *
   * Preserved on a historical transaction so an expense filed under a since-deactivated
   * category still shows the label it was recorded with, and so the UI can explain why the
   * category is no longer selectable.
   */
  readonly status: CategoryStatus;
}

/** The member-month a member contribution was recorded against. */
export interface TransactionContributionPeriodRef {
  readonly id: string;
  readonly year: number;
  readonly month: number;
}

/**
 * One transaction, in the single canonical shape shared by income and expenses.
 *
 * Type-specific fields are nullable rather than absent, so one payload type can honestly
 * describe both kinds of record: `incomeType` is set only for income, `category` only for
 * an expense, and `member`/`contributionPeriod` only where they legitimately apply.
 */
export interface TransactionSummary {
  readonly id: string;
  readonly referenceId: string;
  readonly type: TransactionType;
  readonly incomeType: IncomeType | null;
  /** Exact INR decimal string, for example `"1000.00"`. Never a number. */
  readonly amount: string;
  readonly currency: typeof CURRENCY;
  readonly paymentMethod: PaymentMethod;
  readonly status: TransactionStatus;
  /** `YYYY-MM-DD` Asia/Kolkata accounting date. */
  readonly businessDate: string;
  readonly description: string | null;
  readonly notes: string | null;
  readonly member: TransactionContributor | null;
  readonly category: TransactionCategoryRef | null;
  readonly contributionPeriod: TransactionContributionPeriodRef | null;
  /** Non-null exactly when `status` is `VOIDED`. */
  readonly voidReason: string | null;
  readonly voidedAt: string | null;
  /** Number of associated document records, including removed ones. Phase 07 uploads them. */
  readonly documentCount: number;
  /** The optimistic-lock revision that an edit must present through `If-Match`. */
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A flat audit snapshot. Every value is a string, number, boolean, or null. */
export type AuditSnapshotValue = string | number | boolean | null;

export type AuditSnapshot = Readonly<Record<string, AuditSnapshotValue>>;

/** The audit actions a transaction's history can contain. */
export const TRANSACTION_AUDIT_ACTIONS = [
  'TRANSACTION_CREATED',
  'TRANSACTION_UPDATED',
  'TRANSACTION_VOIDED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_REMOVED',
] as const;

export type TransactionAuditAction = (typeof TRANSACTION_AUDIT_ACTIONS)[number];

/**
 * One entry of a transaction's audit trail.
 *
 * `before` and `after` are the full snapshots the repository wrote, so a correction shows
 * the previous and new values and a void shows the transition to `VOIDED` together with the
 * reason (`REQ-FIN-015`, `REQ-FIN-019`). The actor is included because an unattributable
 * change to a financial record is not acceptable (`docs/07-SECURITY-RULES.md`).
 */
export interface TransactionAuditEventView {
  readonly id: string;
  readonly action: string;
  /** The Admin who performed the action; `null` only for a system-origin event. */
  readonly actorDisplayName: string | null;
  readonly occurredAt: string;
  readonly reason: string | null;
  readonly requestId: string | null;
  readonly before: AuditSnapshot | null;
  readonly after: AuditSnapshot | null;
}

/**
 * The receipt projection for an income transaction.
 *
 * Authority: `REQ-DOC-010` to `REQ-DOC-014` and the `GET /transactions/:id/receipt` entry
 * in `docs/06-API-SPEC.md`. It is generated from persisted transaction data, not a stored
 * image, so a corrected amount is reflected on the next render.
 *
 * `receivedFrom` is `null` for an anonymous donation and carries no alternative identity
 * field: there is deliberately no way to express a donor for that income type, so the
 * privacy rule in `REQ-INCOME-005` cannot be violated by a future edit to this contract.
 * A voided transaction still has a receipt, marked `VOIDED`, and excluded from active
 * totals by its status rather than by being withheld (`REQ-DOC-013`).
 */
export interface TransactionReceiptView {
  readonly applicationName: typeof APPLICATION_NAME;
  readonly referenceId: string;
  readonly amount: string;
  readonly currency: typeof CURRENCY;
  readonly incomeType: IncomeType;
  readonly paymentMethod: PaymentMethod;
  readonly businessDate: string;
  readonly receivedFrom: TransactionContributor | null;
  readonly status: TransactionStatus;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  /** When this projection was generated, for a printed copy. */
  readonly issuedAt: string;
}

/** The documented idempotency header for every create and mutation request. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export const IDEMPOTENCY_KEY_MISSING_MESSAGE =
  'An Idempotency-Key header is required for this request.';

export function isTransactionType(value: unknown): value is TransactionType {
  return typeof value === 'string' && (TRANSACTION_TYPES as readonly string[]).includes(value);
}

export function isIncomeType(value: unknown): value is IncomeType {
  return typeof value === 'string' && (INCOME_TYPES as readonly string[]).includes(value);
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function isTransactionStatus(value: unknown): value is TransactionStatus {
  return typeof value === 'string' && (TRANSACTION_STATUSES as readonly string[]).includes(value);
}

export function isTransactionSortField(value: unknown): value is TransactionSortField {
  return (
    typeof value === 'string' && (TRANSACTION_SORT_FIELDS as readonly string[]).includes(value)
  );
}

export function isTransactionSortDirection(value: unknown): value is TransactionSortDirection {
  return value === 'asc' || value === 'desc';
}

export function isTransactionReferenceId(value: unknown): value is string {
  return typeof value === 'string' && TRANSACTION_REFERENCE_PATTERN.test(value);
}

/**
 * A human-readable label for an income type.
 *
 * The API returns the raw enum value and the browser owns presentation, but the *wording*
 * is a product decision rather than a styling one, so it lives in the shared contract and
 * both applications cannot describe the same income type differently.
 */
export const INCOME_TYPE_LABELS: Readonly<Record<IncomeType, string>> = {
  MEMBER_CONTRIBUTION: 'Member Contribution',
  OFFERING: 'Offering',
  DONATION: 'Donation',
  ANONYMOUS_DONATION: 'Anonymous Donation',
};

/** A human-readable label for a payment method, using the fixed INR demo wording. */
export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank Transfer',
};

export const PAYMENT_METHOD_OPTIONS: readonly PaymentMethod[] = PAYMENT_METHODS;

/**
 * Whether an income type requires a member.
 *
 * `REQ-INCOME-003`: Member Contribution requires a member. `REQ-INCOME-006`: Anonymous
 * Donation must not carry one. Offering and Donation may optionally identify a member, so
 * they are neither required nor forbidden.
 */
export const INCOME_TYPES_REQUIRING_MEMBER: readonly IncomeType[] = ['MEMBER_CONTRIBUTION'];

/**
 * Whether an income type forbids a member.
 *
 * `REQ-INCOME-005` and `REQ-INCOME-006`. The API rejects a member on an anonymous donation
 * and the browser omits the control, so identity cannot be recorded by either path.
 */
export const INCOME_TYPES_FORBIDDING_MEMBER: readonly IncomeType[] = ['ANONYMOUS_DONATION'];

/** Whether an income type may only ever be anonymous. Symmetric with the rule above. */
export function isAnonymousIncomeType(incomeType: IncomeType): boolean {
  return INCOME_TYPES_FORBIDDING_MEMBER.includes(incomeType);
}

export function incomeTypeRequiresMember(incomeType: IncomeType): boolean {
  return INCOME_TYPES_REQUIRING_MEMBER.includes(incomeType);
}

/**
 * The server-owned neutral description for an anonymous donation.
 *
 * `REQ-INCOME-006`: the API assigns this rather than accepting Admin free text, so a name
 * typed into a description box cannot end up stored, displayed on a receipt, returned by a
 * search, or written to a CSV cell. The Admin can still add a private note, which is
 * covered by the same rule and is therefore also cleared for this income type.
 */
export const ANONYMOUS_DONATION_DESCRIPTION = 'Anonymous Donation';

/** Presentation for the fixed status vocabulary. `VOIDED` is never shown as an active total. */
export const TRANSACTION_STATUS_LABELS: Readonly<Record<TransactionStatus, string>> = {
  ACTIVE: 'Active',
  VOIDED: 'Voided',
};
