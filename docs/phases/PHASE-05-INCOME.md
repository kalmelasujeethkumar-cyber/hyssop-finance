# PHASE 05 — Income

## Document Responsibility

- Owns: all income commands and reads, income-type validation, income receipts, correction, void, and income-specific audit behavior.
- Does not own: dashboard aggregates, reusable document storage implementation, reports, or requirement definitions.
- Primary owned requirements: `REQ-INCOME-001`–`REQ-INCOME-006`, `REQ-DOC-010`–`REQ-DOC-014`, `REQ-FIN-015`–`REQ-FIN-020`, `REQ-FIN-022`, `REQ-FIN-024`.
- Consumed requirements: `REQ-AUTH-*`, `REQ-MEM-*`, `REQ-CONTRIB-001`–`REQ-CONTRIB-004`, `REQ-DASH-*`, `REQ-REPORT-*`, `REQ-EXPORT-*`, and `REQ-DOC-001`–`REQ-DOC-009` for association integration.
- Authority references: `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `05-DATABASE-SPEC.md`, `06-API-SPEC.md`, `07-SECURITY-RULES.md`, `10-TEST-PLAN.md`, and `14-TRACEABILITY-MATRIX.md`.
- Deliverables: income create/read/update/void, idempotent creation, receipts, and income audit history.
- Out of scope: a temporary upload system; Phase 07 owns the reusable `DocumentStorage` and document flows.
- Handoff: Phase 08 consumes the canonical aggregate; Phase 07 receives only the documented document-association interface.
- Acceptance evidence: `TEST-INCOME-001`, `TEST-FIN-002`, `TEST-FIN-003`, `TEST-DOC-001`, and `TEST-E2E-001`.

## Phase Metadata

- Status: `NOT STARTED`; requires Phases 01–04 complete.
- Preconditions: member contribution periods and shared transaction/idempotency contracts are available.
- Handoff rule: anonymous identity protection and exact money are enforced server-side, not only in forms.

## Objective

Implement all locked income types with exact amounts, payment methods, member associations, business dates, audit history, correction, and reason-required void behavior.

## Scope

- Member Contribution, Offering, Donation, and Anonymous Donation.
- Cash, UPI, and Bank Transfer methods.
- `HY-INC-000001` reference allocation.
- Income list, detail, create, edit, search, and void flows.
- Idempotent creation and receipt data for every income type.

## Prerequisites

- Phases 01 through 04 complete.
- `01-REQUIREMENTS.md`, `05-DATABASE-SPEC.md`, `06-API-SPEC.md`, and `07-SECURITY-RULES.md` reread.
- Member contribution periods are available where required.

## Expected files and modules

- Income and shared transaction API modules and services.
- Contribution-status and income-type validation.
- Income forms, lists, detail, receipt view, and print styles.
- Income, audit, and browser tests.

## Implementation requirements

- Require a member and contribution period for Member Contribution.
- Support anonymous donation without identifying the contributor, and reject identity-bearing free text for that type.
- Parse money exactly, reject non-positive and ambiguous values, and store paise.
- Write creation and edit audit events in the same database transaction as the change.
- Use the explicit transaction correction allow-list and revision conflict handling from the API and database specifications.
- Void requires a reason, preserves the row, and excludes it from active totals.
- Make retries safe with an idempotency key; enforce the 30-day retention and concurrent-key behavior in the database contract.

## Prohibited shortcuts

- No fake income totals, client-only records, or dead receipt/void buttons.
- No hard-coded payment-method balances.
- No silent deletion or silent overwrite of a financial value.
- No anonymous donation that leaks an unnecessary identity.

## Acceptance criteria

- Each income type is created and displayed correctly.
- Payment method and business date are stored exactly.
- Contribution status updates from the ledger.
- Edits show previous and new values in audit history.
- Void excludes the record from active totals while keeping it auditable.
- Receipt data is accurate and printable where supported for every income type, showing HYSSOP FINANCE, the transaction reference, received from when applicable, amount, income type, payment method, and business date. Anonymous receipts never expose identity, and a voided receipt is clearly marked historical.

## Tests required

- Exact money, type, method, and period validation unit tests.
- Income create, edit, void, idempotency, and audit integration tests.
- Database reconciliation tests for income and ending method balances, including prior-period history and negative method balances.
- Browser tests for each income type, edit, void confirmation, receipt, and anonymous identity protection.

## Documentation updates required

Record income contract details, receipt behavior, and any approved changes to validation or references.

## Git completion gate

Pass lint, typecheck, unit, integration, database, E2E, and build gates; inspect secrets; commit; push; verify; record the hash.

## Rollback and recovery

Correct faulty income logic with a focused commit and regression test. Never alter or delete existing financial rows to make a test pass.

## Completion checklist

- [ ] All four income types work.
- [ ] All three payment methods work.
- [ ] Edit audit and void reason are verified.
- [ ] Idempotency and receipt behavior are verified.
- [ ] Tests, documentation, and Git gate complete.
