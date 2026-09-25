# PHASE 05 — Income

## Objective

Implement all locked income types with exact amounts, payment methods, member associations, business dates, audit history, correction, and reason-required void behavior.

## Scope

- Member Contribution, Offering, Donation, and Anonymous Donation.
- Cash, UPI, and Bank Transfer methods.
- `HY-INC-000001` reference allocation.
- Income list, detail, create, edit, search, and void flows.
- Idempotent creation and receipt data for eligible income.

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
- Support anonymous donation without identifying the contributor.
- Parse money exactly, reject non-positive and ambiguous values, and store paise.
- Write creation and edit audit events in the same database transaction as the change.
- Void requires a reason, preserves the row, and excludes it from active totals.
- Make retries safe with an idempotency key.

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
- Receipt data is accurate and printable where supported, showing HYSSOP FINANCE, the transaction reference, received from when applicable, amount, income type, payment method, and business date.

## Tests required

- Exact money, type, method, and period validation unit tests.
- Income create, edit, void, idempotency, and audit integration tests.
- Database reconciliation tests for income and method balances.
- Browser tests for each income type, edit, void confirmation, and receipt.

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
