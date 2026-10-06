import {
  ANONYMOUS_DONATION_DESCRIPTION,
  CURRENCY,
  isAnonymousIncomeType,
  type AuditSnapshot,
  type ExpenseSummary,
  type TransactionAuditEventView,
  type TransactionReceiptView,
  type TransactionSummary,
} from '@hyssop/contracts';
import { formatPaise } from '../common/money/paise';
import { formatBusinessDate } from '../common/time/business-date';
import type { AuditEventRecord } from '../database/audit/audit-event.repository';
import type { TransactionWithRelations } from '../database/transactions/transaction.repository';

/**
 * The one place a persisted transaction becomes an API payload.
 *
 * `docs/02-ARCHITECTURE.md` requires a single canonical representation across income and
 * expenses so document, audit, void, and reference behaviour cannot diverge. Every read
 * path — list, detail, correction response, void response, receipt — goes through this
 * mapper, so a field cannot be present on one screen and missing on another.
 *
 * Two conversions are not cosmetic:
 *
 * - **Paise becomes a decimal string.** `formatPaise` is the strict, rounding-free
 *   formatter, so the amount on the wire is provably the stored amount. It is never turned
 *   into a JSON number anywhere in this file.
 * - **An anonymous donation is stripped of every identity-bearing field.** The repository
 *   already refuses to store a member or Admin free text for that income type, so the stored
 *   row cannot be wrong. This is a second, independent barrier on the way out: even a
 *   malformed row that reached the database by some other route cannot be projected into a
 *   payload, a receipt, a search result, or a CSV cell that names a donor
 *   (`REQ-INCOME-005`, `REQ-INCOME-006`).
 */
export function toTransactionSummary(row: TransactionWithRelations): TransactionSummary {
  const anonymous = row.incomeType !== null && isAnonymousIncomeType(row.incomeType);

  return {
    id: row.id,
    referenceId: row.referenceId,
    type: row.transactionType,
    incomeType: row.incomeType,
    amount: formatPaise(row.amountPaise),
    currency: CURRENCY,
    paymentMethod: row.paymentMethod,
    status: row.status,
    businessDate: formatBusinessDate(row.businessDate),
    description: anonymous ? ANONYMOUS_DONATION_DESCRIPTION : row.description,
    notes: anonymous ? null : row.notes,
    member: anonymous || row.member === null ? null : row.member,
    category: row.category,
    expenseReason: row.expenseReason,
    contributionPeriod: row.contributionPeriod,
    voidReason: row.voidReason,
    voidedAt: row.voidedAt === null ? null : row.voidedAt.toISOString(),
    documentCount: row._count.documents,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * An expense, in the shared transaction shape with the category and reason made non-null.
 *
 * `ExpenseSummary` is a narrowing of `TransactionSummary`, not a second transaction type, so
 * the projection is the shared one plus the guarantees `REQ-EXP-004`, `REQ-EXP-005`, and
 * `REQ-DOC-003` make about an expense. The category and reason are read from the same relations
 * the ledger already carries, and `hasReceipt` is *derived* from the attached document rows
 * rather than stored, so it cannot drift from reality: an expense with no available document
 * honestly reports `hasReceipt: false` and the browser says **Receipt Missing** instead of showing
 * an empty control that looks like a broken upload.
 *
 * `hasReceipt` counts only `AVAILABLE` documents while `documentCount` counts every record. A
 * receipt that was removed under `REQ-DOC-006` keeps its row for the audit trail, but it is no
 * longer a receipt the Admin can open, so reporting `true` would send them to a `410 Gone`.
 */
export function toExpenseSummary(row: TransactionWithRelations): ExpenseSummary {
  if (row.transactionType !== 'EXPENSE' || row.category === null || row.expenseReason === null) {
    // The database `CHECK` constraint makes an expense without a category or reason
    // unrepresentable, and the service refuses an expense on an income route. The guard keeps the
    // *type* honest if either check is ever bypassed, so the narrow contract cannot be satisfied
    // with a fabricated value.
    throw new Error(
      'An expense can only be projected for an expense transaction with a category and a reason.',
    );
  }

  return {
    ...toTransactionSummary(row),
    category: row.category,
    expenseReason: row.expenseReason,
    hasReceipt: row.documents.length > 0,
  };
}

/**
 * A transaction's audit trail.
 *
 * The actor is included because an unattributable change to a financial record is not
 * acceptable (`docs/07-SECURITY-RULES.md`). The actor's internal UUID is not, because a
 * history view needs a name and exposing an internal key adds nothing to the Admin.
 */
/**
 * Projects a transaction using the narrowest shape that is honest for it.
 *
 * The choice of shape belongs in one place, because every path that returns a single transaction
 * has to make it: an expense carries two guarantees the shared shape cannot express — a
 * non-null category (`REQ-EXP-004`) and a derived `hasReceipt` (`REQ-DOC-003`) — and the expense
 * screen deliberately refuses to render without them rather than showing an empty control.
 *
 * Returning an expense as a plain `TransactionSummary` is not merely lossy, it is unusable: the
 * browser would have to guess whether the missing keys mean "no receipt" or "an older API", and
 * `REQ-DOC-003` requires it to say **Receipt Missing** instead. So an expense row is projected as
 * `ExpenseSummary` and every other row as `TransactionSummary`, which is exactly the shared shape
 * plus the guarantees an expense can actually make.
 *
 * `ExpenseSummary` extends `TransactionSummary`, so the declared return type stays honest for both
 * branches and a caller that only needs the shared fields is unaffected.
 */
export function toTransactionView(row: TransactionWithRelations): TransactionSummary {
  return row.transactionType === 'EXPENSE' ? toExpenseSummary(row) : toTransactionSummary(row);
}

export function toAuditEventViews(
  records: readonly AuditEventRecord[],
): readonly TransactionAuditEventView[] {
  return records.map((record) => ({
    id: record.id,
    action: record.action,
    actorDisplayName: record.actorDisplayName,
    occurredAt: record.occurredAt.toISOString(),
    reason: record.reason,
    requestId: record.requestId,
    before: toAuditSnapshot(record.before),
    after: toAuditSnapshot(record.after),
  }));
}

/**
 * The receipt projection for an income transaction.
 *
 * Authority: `REQ-DOC-010` to `REQ-DOC-014`. It is generated from the persisted row every
 * time it is requested rather than stored as an image, so a corrected amount is reflected on
 * the next render and a receipt can never be a stale picture of an old value.
 *
 * `receivedFrom` is populated only when a member legitimately applies. There is no other
 * identity field in this shape, so an anonymous donation cannot reveal a donor even if a
 * future change tried to add one — the rule is expressed as an absent value rather than as a
 * value that has to be suppressed.
 *
 * A voided income transaction still produces a receipt. `REQ-DOC-013` allows the demo to
 * retain the authorized historical receipt, and it is marked `VOIDED` with its reason; the
 * row is excluded from active totals by its status, not by withholding the document.
 */
export function toReceiptView(
  row: TransactionWithRelations,
  now: Date = new Date(),
): TransactionReceiptView {
  const anonymous = row.incomeType !== null && isAnonymousIncomeType(row.incomeType);

  if (row.transactionType !== 'INCOME' || row.incomeType === null) {
    // Reached only if a caller asks for a receipt on a non-income row. The service rejects
    // the request first; this guard keeps the projection total if that check is ever bypassed.
    throw new Error('A receipt can only be projected for an income transaction.');
  }

  return {
    applicationName: 'HYSSOP FINANCE',
    referenceId: row.referenceId,
    amount: formatPaise(row.amountPaise),
    currency: CURRENCY,
    incomeType: row.incomeType,
    paymentMethod: row.paymentMethod,
    businessDate: formatBusinessDate(row.businessDate),
    receivedFrom: anonymous || row.member === null ? null : row.member,
    status: row.status,
    voidedAt: row.voidedAt === null ? null : row.voidedAt.toISOString(),
    voidReason: anonymous ? null : row.voidReason,
    issuedAt: now.toISOString(),
  };
}

/**
 * Narrows a stored audit payload to the flat snapshot shape the contract describes.
 *
 * The repository writes flat snapshots of strings, numbers, booleans, and nulls, so anything
 * else — a JSON `null` column, an object from a future writer — is normalized to `null`
 * rather than being cast into a type it does not have. A history view showing "no previous
 * value" is honest; one showing a half-parsed object is not.
 */
function toAuditSnapshot(value: unknown): AuditSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string | number | boolean | null] =>
      entry[1] === null ||
      typeof entry[1] === 'string' ||
      typeof entry[1] === 'number' ||
      typeof entry[1] === 'boolean',
  );

  return Object.fromEntries(entries);
}
