/**
 * Expense and expense-category contract.
 *
 * Owned by `docs/06-API-SPEC.md` (`POST /api/v1/expenses`, `GET /api/v1/expenses`, and the
 * category routes) and shaped by `docs/01-REQUIREMENTS.md` `REQ-EXP-001` to `REQ-EXP-004`
 * and `REQ-DOC-003`.
 *
 * As with income, an expense is the shared canonical transaction shape; only the category
 * is genuinely expense-specific. An expense always carries exactly one category, so unlike
 * `TransactionSummary` the override below is a narrowing rather than a widening, and a
 * screen cannot render an expense with no category or with an income type.
 */

import type { CategoryStatus, TransactionSummary } from './transactions';

/**
 * One expense transaction.
 *
 * `category` is non-null because `REQ-EXP-004` requires an expense to reference exactly one
 * existing active category, and the database `CHECK` constraint enforces the same rule, so a
 * persisted expense without a category is not representable. The category's *current*
 * status is still returned rather than dropped, so an expense filed under a category that
 * has since been deactivated keeps its label and the UI can explain why the category is no
 * longer offered for a new entry.
 */
export interface ExpenseSummary extends TransactionSummary {
  readonly category: NonNullable<TransactionSummary['category']>;
  /**
   * The attachment state for this expense.
   *
   * `REQ-DOC-003`: an expense may legitimately have no receipt, and the interface must say
   * **Receipt Missing** rather than showing an empty control. This is *derived* from the
   * attached document rows on every read, never stored, so it cannot drift from reality: a
   * `false` here and a `documentCount` of zero are the same fact read two ways, and the browser
   * renders `RECEIPT_MISSING_LABEL` for it.
   *
   * Phase 07 owns attaching, previewing, and removing documents. Until that subsystem exists
   * nothing can set this to `true` through the product, and an expense honestly reports
   * `false` rather than the interface pretending a receipt exists.
   */
  readonly hasReceipt: boolean;
}

/**
 * The exact words `REQ-DOC-003` requires for an expense with no receipt.
 *
 * Stated once, here, because it is a required product string rather than a design choice: the
 * interface must *clearly show **Receipt Missing***, and a screen that improvised its own
 * wording would no longer be provably compliant. The API and the browser therefore cannot
 * disagree about the phrase, and no expense can render an empty control that looks like a
 * broken upload.
 */
export const RECEIPT_MISSING_LABEL = 'Receipt Missing';

/** One expense category, as offered for selection or as retained on history. */
export interface ExpenseCategoryView {
  readonly id: string;
  readonly name: string;
  readonly status: CategoryStatus;
  /**
   * Whether the category is part of the seeded initial set (`REQ-EXP-001`) rather than
   * Admin-created (`REQ-EXP-002`).
   *
   * Retained because a system category is a documented product set while a custom one is
   * the Admin's own configuration, and Phase 10's Settings screen will present them
   * differently.
   */
  readonly isSystem: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `docs/05-DATABASE-SPEC.md`: a category name is unique case-insensitively and bounded. */
export const EXPENSE_CATEGORY_NAME_MAX_LENGTH = 80;

/** The filters `GET /api/v1/expenses` supports, matching the income list filters. */
export interface ExpenseListFilters {
  readonly search: string;
  readonly page: number;
  readonly pageSize: number;
  readonly sort: 'businessDate' | 'amount' | 'referenceId' | 'createdAt';
  readonly direction: 'asc' | 'desc';
  readonly status: 'ACTIVE' | 'VOIDED' | '';
  readonly paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER' | '';
  readonly categoryId: string;
  readonly from: string;
  readonly to: string;
  readonly minAmount: string;
  readonly maxAmount: string;
}
