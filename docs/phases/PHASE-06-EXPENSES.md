# PHASE 06 — EXPENSES

## Objective

Implement expenses with the initial and custom category set, exact amounts, payment methods, business dates, audit history, correction, and reason-required void behavior.

## Scope

- Electricity, Water, Church Maintenance, Repairs, Church Programs, Food, Decoration, Equipment, Cleaning, Transport, Charity / Help, and Other categories.
- Admin-created custom categories with safe rename and deactivation behavior.
- `HY-EXP-000001` reference allocation.
- Expense list, detail, create, edit, search, filter, and void flows.
- Optional receipt attachment hooks used later by Phase 07.

## Prerequisites

- Phases 01 through 05 complete.
- `01-REQUIREMENTS.md`, `05-DATABASE-SPEC.md`, `06-API-SPEC.md`, and `07-SECURITY-RULES.md` reread.
- Shared transaction and audit behavior from Phase 05 is available.

## Expected files and modules

- Expense and category API modules and services.
- Category management and validation.
- Expense forms, lists, detail, and status views.
- Expense, category, and browser tests.

## Implementation requirements

- Require a valid active category and positive exact amount.
- Enforce that expenses cannot carry income type or contribution period.
- Support Cash, UPI, and Bank Transfer expense methods.
- Write edit and void audit events atomically.
- Preserve referenced categories and transactions when deactivating or renaming a category.
- Show an explicit optional-receipt state.

## Prohibited shortcuts

- No client-only expense records or hard-coded category totals.
- No silent deletion of expenses or categories used in history.
- No dead category, filter, void, or receipt control.
- No category that bypasses the documented initial set or custom-category rules.

## Acceptance criteria

- Every initial category is available and usable.
- Custom categories can be created and managed safely.
- Expenses calculate correctly in totals and payment-method balances.
- Edits and voids produce accurate audit records.
- Missing receipts are shown as **Receipt Missing** until a document exists.

## Tests required

- Amount, category, method, and type validation unit tests.
- Expense create, edit, void, category, and audit integration tests.
- Database reconciliation tests for expenses and balances.
- Browser tests for create, filter, edit, void confirmation, and missing-receipt state.

## Documentation updates required

Record category lifecycle rules, validation, and any approved change to the initial set.

## Git completion gate

Pass the applicable quality gate including database and browser tests; inspect secrets; commit; push; verify; record the hash.

## Rollback and recovery

Use additive or corrective changes only. Do not delete expense history or shared database data to recover from a failed migration.

## Completion checklist

- [ ] Initial and custom categories work.
- [ ] Expense create, edit, and void work.
- [ ] Method balances and totals reconcile.
- [ ] Audit and missing-receipt state are verified.
- [ ] Tests, documentation, and Git gate complete.
