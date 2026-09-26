# PHASE 04 — Members

## Document Responsibility

- Owns: member identity, references, contact validation, search, editing, contribution periods, and derived contribution status for member views.
- Does not own: income or expense transaction creation, dashboard aggregation, or requirement definitions.
- Primary owned requirements: `REQ-MEM-001`–`REQ-MEM-006`, `REQ-CONTRIB-001`–`REQ-CONTRIB-004`.
- Consumed requirements: `REQ-AUTH-*`, `REQ-CONTRIB-005`, `REQ-CONTRIB-006`, `REQ-DASH-014`, `REQ-RESP-004`, and `REQ-RESP-005`.
- Authority references: `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `05-DATABASE-SPEC.md`, `06-API-SPEC.md`, `10-TEST-PLAN.md`, and `14-TRACEABILITY-MATRIX.md`.
- Deliverables: member create/read/update, reference allocation, member search, period configuration, and derived status/history projections.
- Out of scope: member deletion/deactivation, income creation, and full report aggregation.
- Handoff: Phase 05 creates member-contribution income against these periods; Phase 08 consumes the same derived status.
- Acceptance evidence: `TEST-MEM-001`, `TEST-CONTRIB-001`, and the member portion of `TEST-E2E-001`.

## Phase Metadata

- Status: `NOT STARTED`; requires authenticated API and Phase 02 persistence.
- Preconditions: Phases 01–03 complete; no real personal data.
- Handoff rule: “CRUD” in this phase means create, read, and update; financial history is never deleted.

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
- Use the default monthly contribution from the initialized `app_setting` record when opening a new period. The full Settings interface is delivered in Phase 10.
- Record member edits in audit history and enforce the member `revision` optimistic-lock value on updates.

## Prohibited shortcuts

- No client-only members, in-memory data, or seeded hard-coded totals.
- No replacing transaction history with a single `paid_amount` field.
- No dead search, filter, sort, or pagination control.
- No permanent member deletion that would break financial history.

## Acceptance criteria

- The Admin can create, search, view, and edit a member.
- Periods can be created or updated with an expected amount.
- PAID, PARTIALLY PAID, and NOT PAID states match active transaction totals.
- Member history and the canonical contribution projection agree with the database; full report reconciliation is verified in Phase 09.
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
