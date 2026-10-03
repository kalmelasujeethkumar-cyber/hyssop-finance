/**
 * Shared audit history contract for the Audit History screen.
 *
 * Owned by `docs/06-API-SPEC.md` ("`GET /api/v1/audit-events` - paginated, filterable audit
 * history") and shaped by `docs/01-REQUIREMENTS.md` `REQ-AUDIT-001` and `REQ-AUDIT-002`,
 * `docs/07-SECURITY-RULES.md`, and `docs/03-UI-UX-RULES.md`. Both applications depend on this
 * module so the event shape, the filter vocabulary, and the detail flattening cannot drift
 * between the API that reads the append-only trail and the browser that renders it.
 *
 * The audit trail is already stored and already projected for the Phase 09 Audit report. This
 * module adds only what a *screen* needs on top of that same read, and it adds no second
 * audit system:
 *
 * - **Plain-language labels are server-decided.** `REQ-AUDIT-002` requires a viewer to be able to
 *   tell what changed and who changed it, and the audience is a non-technical pastor
 *   (`AGENTS.md` "Product constraints"). A raw `TRANSACTION_VOIDED` is not that. `actionLabel`
 *   and `entityLabel` are therefore part of the payload, chosen by the API through the tables
 *   below, so the browser renders text rather than inventing it. The raw code is still sent
 *   alongside, because `docs/06-API-SPEC.md` lists it as an audit column and it is what a
 *   support conversation needs.
 * - **`before`/`after` are flattened, safe, renderable fields.** The stored snapshots are
 *   arbitrary JSON. Sending them raw and letting the browser stringify them would put the
 *   decision about what an Admin may see in the layer with the least authority, which is exactly
 *   what `docs/07-SECURITY-RULES.md` forbids. The API flattens each snapshot into ordered
 *   label/value fields and redacts a sensitive key before it leaves the process, so the browser
 *   can only ever render a string it was given.
 * - **"Not recorded" is distinguishable from "recorded as empty".** A creation has no `before`,
 *   and `docs/03-UI-UX-RULES.md` requires state to be honest. `beforeRecorded`/`afterRecorded`
 *   answer that separately from the field list, so a blank panel never implies the change had
 *   nothing in it.
 * - **Date bounds arrive as Asia/Kolkata business dates.** Every Admin-entered date in this
 *   application is a `YYYY-MM-DD` Asia/Kolkata accounting date, so the filter is one too and
 *   the echoed `filters.from`/`filters.to` populate the date inputs unchanged. The bounds are
 *   then applied to `occurred_at` as inclusive instants inside that business day, so the morning
 *   of the first day is not silently excluded.
 */

import type { ApiPagination } from './api-envelope';
import type { AuditReportAction } from './reports';

/**
 * The `audit_event.entity_type` values this application writes.
 *
 * These are the values `apps/api/src/database/audit/audit-event.repository.ts` uses, and the
 * column is a `VARCHAR(50)` rather than a database enum, so the list lives in the shared
 * contract where the writer, the filter, and the screen all read it. It is a closed list because
 * a filter value outside it is a `VALIDATION_FAILED` rather than a filter that silently matches
 * nothing.
 */
export const AUDIT_ENTITY_TYPES = [
  'financial_transaction',
  'member',
  'contribution_period',
  'expense_category',
  'transaction_document',
  'app_setting',
  'session',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export function isAuditEntityType(value: unknown): value is AuditEntityType {
  return typeof value === 'string' && (AUDIT_ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * What each audited thing is called for the Admin.
 *
 * `Sign-In` rather than `Session` for the `session` entity type: the recorded events are a
 * successful sign-in, a failed sign-in, and a sign-out, and a viewer should not have to learn the
 * word "session" to read them.
 */
export const AUDIT_ENTITY_TYPE_LABELS: Readonly<Record<AuditEntityType, string>> = {
  financial_transaction: 'Transaction',
  member: 'Member',
  contribution_period: 'Contribution Period',
  expense_category: 'Expense Category',
  transaction_document: 'Receipt / Document',
  app_setting: 'Setting',
  session: 'Sign-In',
};

/**
 * The label for an `entity_type` the list does not know.
 *
 * Falls back to the stored value rather than to an empty string or a guess, so an event written
 * by a version that used another entity type still shows *something* true.
 */
export function auditEntityTypeLabel(entityType: string): string {
  return AUDIT_ENTITY_TYPE_LABELS[entityType as AuditEntityType] ?? entityType;
}

/**
 * Every audited action in plain language.
 *
 * The keys are exactly the database's `AuditAction` enum values, which are also
 * {@link AUDIT_REPORT_ACTIONS} in `./reports`; reusing that type rather than declaring a parallel
 * union means a filter value the API accepts is always an action the database can hold.
 *
 * The wording is chosen for a viewer who did not choose the system: an edit is "corrected", a
 * void is "voided with a reason", a contribution period is "contribution expectation set". The
 * nouns stay the Admin's own - rupee amounts and reference ids stay as they are.
 */
export const AUDIT_ACTION_LABELS: Readonly<Record<AuditReportAction, string>> = {
  TRANSACTION_CREATED: 'Transaction recorded',
  TRANSACTION_UPDATED: 'Transaction corrected',
  TRANSACTION_VOIDED: 'Transaction voided',
  DOCUMENT_UPLOADED: 'Receipt or document attached',
  DOCUMENT_REMOVED: 'Receipt or document removed',
  MEMBER_CREATED: 'Member added',
  MEMBER_UPDATED: 'Member corrected',
  CATEGORY_CREATED: 'Expense category added',
  CATEGORY_UPDATED: 'Expense category corrected',
  SETTING_UPDATED: 'Setting changed',
  CONTRIBUTION_PERIOD_SET: 'Contribution expectation set',
  LOGIN_SUCCEEDED: 'Signed in',
  LOGIN_FAILED: 'Sign-in refused',
  LOGOUT: 'Signed out',
};

/** The label for an action outside {@link AUDIT_ACTION_LABELS}; see {@link auditEntityTypeLabel}. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action as AuditReportAction] ?? action;
}

/** The offered action filters, as label/value pairs for the screen's filter control. */
export const AUDIT_ACTION_FILTER_OPTIONS: readonly {
  readonly value: string;
  readonly label: string;
}[] = Object.keys(AUDIT_ACTION_LABELS).map((action) => ({
  value: action,
  label: AUDIT_ACTION_LABELS[action as AuditReportAction],
}));

/** The offered entity-type filters, as label/value pairs for the screen's filter control. */
export const AUDIT_ENTITY_TYPE_FILTER_OPTIONS: readonly {
  readonly value: string;
  readonly label: string;
}[] = AUDIT_ENTITY_TYPES.map((entityType) => ({
  value: entityType,
  label: AUDIT_ENTITY_TYPE_LABELS[entityType],
}));

/**
 * Paging bounds are the shared transaction bounds, `TRANSACTION_PAGE_SIZE_DEFAULT` and
 * `TRANSACTION_PAGE_SIZE_MAX`, exactly as the Phase 09 audit report query already uses them.
 * They are not restated here: a second pair of constants for the same "page of a list" would be
 * a place for the audit list and the transaction list to disagree about how big a page is.
 *
 * One field of a stored audit snapshot, flattened for display.
 *
 * `key` is the stored path (`enabledPaymentMethods[0]`, `nested.note`), so it is stable enough
 * to assert against in a test and to let the screen group fields without re-deriving the path.
 * `label` is the plain-language name. `value` is always a string already safe to render, or
 * `null` when the stored value was `null` - which is different from an absent field, which
 * produces no entry at all.
 *
 * `redacted` marks a field whose value was withheld. The field is still listed, with the
 * documented redaction marker as its value, so a viewer can see that something was there without
 * seeing it: silently dropping the field would misrepresent the snapshot as incomplete.
 */
export interface AuditDetailField {
  readonly key: string;
  readonly label: string;
  readonly value: string | null;
  readonly redacted: boolean;
}

/** One audit event as the Audit History screen renders it. */
export interface AuditEventRow {
  readonly id: string;
  /** The stored action code, as `docs/06-API-SPEC.md` lists it for the audit columns. */
  readonly action: string;
  readonly actionLabel: string;
  readonly entityType: string;
  readonly entityLabel: string;
  readonly entityReference: string | null;
  readonly actorDisplayName: string | null;
  readonly occurredAt: string;
  /** Required for a void or a removal; `null` for events the specification does not require one for. */
  readonly reason: string | null;
  /** The correlation id, so a viewer can quote one value when asking for help. */
  readonly requestId: string | null;
  readonly before: readonly AuditDetailField[];
  readonly after: readonly AuditDetailField[];
  /** Whether a snapshot was recorded at all, as distinct from recorded-but-empty. */
  readonly beforeRecorded: boolean;
  readonly afterRecorded: boolean;
}

/** The filters the screen sent, echoed so it shows what it is looking at. */
export interface AuditHistoryFilters {
  readonly action: string | null;
  readonly entityType: string | null;
  /** Inclusive `YYYY-MM-DD` Asia/Kolkata business date, or `null` for an open-ended read. */
  readonly from: string | null;
  readonly to: string | null;
}

/** `GET /api/v1/audit-events` - the Admin-wide trail, newest first. */
export interface AuditHistoryResponse {
  readonly filters: AuditHistoryFilters;
  readonly rows: readonly AuditEventRow[];
  readonly pagination: ApiPagination;
}
