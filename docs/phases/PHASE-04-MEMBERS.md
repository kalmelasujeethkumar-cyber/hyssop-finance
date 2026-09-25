# PHASE 04 — Members

## Objective

Implement member records, human-readable IDs, search, editing, and month-wise contribution expectations and derived status.

## Scope

- Member create, read, update, list, and search behavior.
- `HY-MEM-0001` reference allocation.
- Name, phone, and notes validation.
- Contribution periods with expected amount, year, and month.
- Derived PAID, PARTIALLY PAID, and NOT PAID status.
- Member detail and history shells backed by real API data.

## Prerequisites

- Phases 01 through 03 complete.
- `01-REQUIREMENTS.md`, `05-DATABASE-SPEC.md`, and `06-API-SPEC.md` reread.
- No real personal data is used.

## Expected files and modules

- Member and contribution-period API modules.
- Member repository and validation services.
- Members page, forms, search, filters, pagination, and detail views.
- Member and contribution tests.

## Implementation requirements

- Persist only identity, contact, and notes; do not store a permanent payment amount as the transaction history replacement.
- Enforce reference uniqueness and safe phone validation consistently.
- Derive received and remaining amounts from active member-contribution transactions.
- Use the default monthly contribution from the `app_setting` record created in Phase 02 when opening a new period. The full Settings interface is delivered in Phase 10.
- Record member edits in audit history.

## Prohibited shortcuts

- No client-only members, in-memory data, or seeded hard-coded totals.
- No replacing transaction history with a single `paid_amount` field.
- No dead search, filter, sort, or pagination control.
- No permanent member deletion that would break financial history.

## Acceptance criteria

- The Admin can create, search, view, and edit a member.
- Periods can be created or updated with an expected amount.
- PAID, PARTIALLY PAID, and NOT PAID states match active transaction totals.
- Member history and reports agree with the database.
- Invalid names, phones, periods, and references are rejected clearly.

## Tests required

- Member validation and reference unit tests.
- Member and period API integration tests against PostgreSQL.
- Search, sorting, pagination, and optimistic-edit tests.
- Member contribution derivation and audit tests.
- Browser create, search, edit, and status tests.

## Documentation updates required

Record validated phone rules, period semantics, and any decision affecting contribution derivation.

## Git completion gate

Pass the applicable quality gate including database and browser tests; inspect secrets; commit; push; verify; record the hash.

## Rollback and recovery

Use additive migrations or corrective commits. Do not delete members or financial data to fix a test. Stop if a change could destroy non-demo data.

## Completion checklist

- [ ] Member CRUD and search work.
- [ ] Reference allocation is safe.
- [ ] Contribution periods and statuses are correct.
- [ ] Member history is derived from transactions.
- [ ] Tests, documentation, and Git gate complete.
