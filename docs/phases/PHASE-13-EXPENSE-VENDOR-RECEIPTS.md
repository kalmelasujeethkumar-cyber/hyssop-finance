# PHASE 13 — EXPENSE VENDOR AND RECEIPTS

## Document Responsibility

- Owns: the optional structured Vendor field on expenses, the Record Expense receipt selection control, and the honest create-then-attach upload workflow they introduce.
- Does not own: reusable document storage implementation (Phase 07), expense commands and categories (Phase 06), authoritative calculation (Phase 08), or requirement definitions.
- Primary owned requirements: `REQ-EXP-006`–`REQ-EXP-010`, `REQ-DOC-015`–`REQ-DOC-022`.
- Consumed requirements: `REQ-EXP-001`–`REQ-EXP-005` and `REQ-DOC-001`–`REQ-DOC-014` for the expense and document contracts this phase extends; `REQ-AUTH-*`, `REQ-FIN-001`–`REQ-FIN-024`, and `REQ-SECURITY-*` guards apply unchanged.
- Authority references: `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `03-UI-UX-RULES.md`, `05-DATABASE-SPEC.md`, `06-API-SPEC.md`, `07-SECURITY-RULES.md`, `10-TEST-PLAN.md`, and `14-TRACEABILITY-MATRIX.md`.
- Deliverables: a nullable `vendor` column with database and API contracts, expense list/detail/CSV vendor display, the Record Expense `Vendor (optional)` field, the `Receipt / Document (optional)` selection control, and the two-step attach flow with idempotent retry.
- Out of scope: a second upload system, a vendor search/filter scope, vendor correction in the web UI, or any change to the money or authorization rules.
- Handoff: Phase 12 receives an extended expense-record workflow for regression QA; Phase 07's document lifecycle and audit behavior must be unchanged.
- Acceptance evidence: `TEST-EXP-001`, `TEST-DOC-001`, `TEST-DOC-002`, `TEST-EXPORT-001`, `TEST-FIN-003`, and `TEST-SEC-001`.

## Phase Metadata

- Status: `IMPLEMENTED — LOCAL QUALITY GATE PASSED; GIT GATE PENDING`. The complete local gate passed on 2026-10-08 (see `docs/runtime/TEST-RESULTS.md`); nothing has been committed or pushed, and the Git gate is not closed because commit/push/deploy requires explicit authorization per `AGENTS.md`.
- Preconditions: Phases 01–12 complete; expense (`REQ-EXP-001`–`REQ-EXP-005`) and document (`REQ-DOC-001`–`REQ-DOC-014`) contracts stable; the Phase 07 storage abstraction available.
- Handoff rule: an attachment never exists without the expense it belongs to; a retry never duplicates the expense or the document.

## Objective

Add an optional structured Vendor field to expenses and an optional receipt selection control to Record Expense so a non-technical pastor can record whom the church bought from and attach the receipt when recording, while preserving exact-money persistence, the reason-required void, idempotent submission, and existing document privacy and audit rules.

## Scope

- A nullable `vendor` column on expenses with `VENDOR_MAX_LENGTH` (120) validation, trim-on-write, null-for-empty normalization, and a void-time database freeze.
- Vendor appears in the expense list, expense detail, correction DTO (API-level only), and the detailed expense CSV; income creation and correction refuse a vendor.
- The Record Expense form gains `Vendor (optional)` and `Receipt / Document (optional)` controls with the exact spec strings from `docs/03-UI-UX-RULES.md`.
- A selected receipt is uploaded through the existing validated transaction-document path after the expense is created (`REQ-DOC-017`), with an honest `PendingReceiptAttach` state (`idle`/`uploading`/`failed`), a retry, and "Finish without the receipt" (`REQ-DOC-019`).
- Idempotent retry of the whole submission duplicates neither the expense nor the document (`REQ-DOC-018`).

## Prerequisites

- Phases 01 through 12 complete.
- `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `03-UI-UX-RULES.md`, `05-DATABASE-SPEC.md`, `06-API-SPEC.md`, and `07-SECURITY-RULES.md` reread.
- The Phase 07 `useUploadDocument`/`useAttachDocument`, `DOCUMENT_UPLOAD_ACCEPT`, `validateDocumentFile`, and `transactionDocumentsPath` hooks are available.

## Expected files and modules

- Database migration `20261007120000_expense_vendor` (column, check, index) and `20261008120000_expense_vendor_void_guard` (immutability guard).
- API DTO/service vendor support in the expense create, correction, read, and CSV contracts.
- Fake-ledger and API/database test support for the vendor.
- Record Expense form controls and the `PendingReceiptAttach` two-step attach flow.
- Component, API, database, and browser test updates.

## Implementation requirements

- The vendor is optional; existing expenses without one remain valid without backfill (`REQ-EXP-007`).
- The vendor stores a distinct value and never replaces Description or Notes (`REQ-EXP-008`).
- `undefined` leaves the vendor untouched on correction; `null`/empty clears it to `NULL`; income always resolves to `NULL`.
- The database guard `hy_financial_transaction_guard_update` raises `HY_FIN_VOIDED_TRANSACTION_IMMUTABLE` when any part of a voided transaction, including its vendor, is edited.
- The receipt selection reuses the validated document pipeline; no parallel upload path exists (`REQ-DOC-016`).
- Form-chosen receipts remain private and audited exactly as any other document (`REQ-DOC-021`, `REQ-DOC-022`).
- The expense detail's existing receipt/document functionality stays available (`REQ-DOC-020`).

## Prohibited shortcuts

- No fake totals, hard-coded vendor values, or vendor stored only client-side.
- No raw receipt bytes in PostgreSQL and no new unvalidated upload endpoint.
- No silent category/reason/audit behavior change and no weakened void immutability.
- No web UI vendor correction field (the UI correction form is intentionally unchanged).
- No removal of the existing detail receipt panel to make the form control "simpler".

## Acceptance criteria

- An expense can be recorded with, without, or by clearing a vendor; every response and CSV shows the true stored value.
- Income create and correction reject a vendor with a field-level `400`.
- A voided expense's vendor is frozen; editing it returns the voided-transaction conflict.
- Selecting a receipt creates the expense first, then uploads and associates the document; a failed attach reports honestly and retries without duplication.
- The complete local quality gate passes with the evidence recorded in `docs/runtime/TEST-RESULTS.md`.

## Tests required

- API tests: vendor create/list/detail projection, trim, absent-to-null, length rejection, correction change/clear/omission, income refusal, idempotency-key mismatch, and voided-vendor conflict.
- Database tests: vendor stores and reads, SQL `NULL` vs `''`, correction rewrite, and the void-time freeze.
- Component tests: form labels/hints/placeholders and the receipt selection state.
- Regression: the full `test:api`, `test:web`, `test:db`, and `test:e2e` suites pass from the beginning.

## Documentation updates required

- `05-DATABASE-SPEC.md`: vendor column, check, normalization, `NULL` semantics, and the void freeze; migration list updated.
- `10-TEST-PLAN.md`: coverage rows for `TEST-EXP-001`, `TEST-DOC-001`, `TEST-DOC-002`, `TEST-EXPORT-001`, `TEST-FIN-003`, and `TEST-SEC-001` extended; the Document testing section describes the selection control.
- `14-TRACEABILITY-MATRIX.md`: Phase 13 registered as an implemented primary owner with the final verification cells.
- Runtime records: `DECISIONS.md`, `ISSUES.md`, `CURRENT-STATE.md`, `TEST-RESULTS.md`, and `PHASE-HISTORY.md`.

## Git completion gate

The local quality gate has passed. The Git gate (inspect status, diff, review staged files, guard secrets, commit intended files, push to `origin`, verify the hash, record it) remains `PENDING` because commit/push/deploy is not authorized in this phase; it is an explicit next action after the working tree is reviewed.

## Rollback and recovery

Use additive or corrective changes only. The vendor migrations are additive (`ADD COLUMN`, `CREATE OR REPLACE FUNCTION`); do not delete expense history or shared document data to recover from a failed migration.

## Completion checklist

- [ ] Vendor field persists, displays, and exports; income refuses it.
- [ ] Voided-vendor immutability holds at the database and API.
- [ ] Record Expense selection attaches through the shared document path with honest recoverable failure.
- [ ] Retry duplicates neither expense nor document.
- [ ] Documentation and traceability are consistent.
- [ ] Local quality gate evidence is recorded; Git gate recorded as pending authorization.