# HYSSOP FINANCE — Traceability Matrix

## Document Responsibility

- Owns: the mapping from every required `REQ-*` identifier to exactly one primary implementation phase, governing authority, and verification identifiers.
- Does not own: product requirements, business formulas, architecture, schema, API contracts, test specifications, or readiness status.
- Referenced by: `AGENTS.md`, `docs/01-REQUIREMENTS.md`, `docs/10-TEST-PLAN.md`, all phase documents, and change control.
- Change rule: update the owning authority first, then this matrix; never renumber existing identifiers, create a second requirement definition, or add a second primary owner here.

## Audit rules

- Every identifier in `docs/01-REQUIREMENTS.md` must appear exactly once in the requirement register below.
- Every required requirement must have exactly one primary phase owner. A phase may consume another phase's requirement for integration, but it may not become a second primary owner.
- Every required requirement must have at least one verification identifier from `docs/10-TEST-PLAN.md`.
- Verification mapping is two-way consistent: every test identifier referenced here must also list the mapped requirement in its `docs/10-TEST-PLAN.md` coverage, and every test identifier in the test plan must be referenced by at least one requirement here.
- Orphan requirements, unmapped required requirements, multiple primary owners, and unresolved specification conflicts must all be `0` before the documentation gate passes.
- Phase documents may reference identifiers and describe implementation work; they do not redefine the requirements.

## Register totals

| Measure | Count |
|---|---:|
| Required `REQ-*` identifiers | 119 |
| Verification identifiers | 24 |
| Phases with a primary owner | 12 of 13; Phase 00 owns no product requirement |
| Orphan requirements | 0 |
| Unmapped required requirements | 0 |
| Multiple primary phase owners | 0 |
| Unresolved specification conflicts | 0 |

## Phase ownership map

| Phase | Primary requirement count | Responsibility boundary |
|---|---:|---|
| `PHASE-00-BOOTSTRAP` | 0 | Documentation constitution, ownership, traceability, and checkpoint only |
| `PHASE-01-FOUNDATION` | 3 | Workspace, toolchain, shells, and technology direction |
| `PHASE-02-DATABASE` | 5 | Exact persistence, money, constraints, and shared idempotency |
| `PHASE-03-AUTH` | 4 | Admin authentication, sessions, CSRF, and security events |
| `PHASE-04-MEMBERS` | 10 | Members, references, periods, and derived contribution status |
| `PHASE-05-INCOME` | 19 | Income commands, receipts, correction, void, and income audit |
| `PHASE-06-EXPENSES` | 5 | Expenses, categories, and missing-receipt state |
| `PHASE-07-DOCUMENTS` | 8 | Reusable storage, document lifecycle, and authorized access |
| `PHASE-08-DASHBOARD` | 31 | Canonical calculation projections and dashboard |
| `PHASE-09-REPORTS` | 8 | Reports, search, CSV, and print |
| `PHASE-10-AUDIT-SETTINGS` | 11 | Dedicated audit interface and demo settings |
| `PHASE-11-UI-INTEGRATION` | 13 | Integrated accessible responsive experience |
| `PHASE-12-FINAL-QA` | 2 | Complete evidence and deployment verification |
| **Total** | **119** | |

## Requirement register

| Requirement | Primary phase | Governing authority | Verification |
|---|---|---|---|
| `REQ-AUTH-001` | `PHASE-01-FOUNDATION` | `01-REQUIREMENTS` §Product and access | `TEST-RESP-001`, `TEST-E2E-001` |
| `REQ-AUTH-002` | `PHASE-03-AUTH` | `01-REQUIREMENTS` §Product and access | `TEST-AUTH-001`, `TEST-E2E-001` |
| `REQ-AUTH-003` | `PHASE-03-AUTH` | `01-REQUIREMENTS` §Product and access | `TEST-AUTH-001`, `TEST-AUTH-002`, `TEST-SEC-001` |
| `REQ-AUTH-004` | `PHASE-03-AUTH` | `01-REQUIREMENTS` §Product and access | `TEST-AUTH-001`, `TEST-AUTH-002`, `TEST-SEC-001` |
| `REQ-AUTH-005` | `PHASE-03-AUTH` | `01-REQUIREMENTS` §Product and access | `TEST-AUTH-001`, `TEST-E2E-001` |
| `REQ-AUTH-006` | `PHASE-01-FOUNDATION` | `01-REQUIREMENTS` §Product and access | `TEST-FIN-001`, `TEST-RESP-001` |
| `REQ-DASH-001` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-FIN-001` |
| `REQ-DASH-002` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-FIN-001` |
| `REQ-DASH-003` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-FIN-001` |
| `REQ-DASH-004` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-FIN-001` |
| `REQ-DASH-005` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-FIN-001` |
| `REQ-DASH-006` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-FIN-001` |
| `REQ-DASH-007` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-FIN-001` |
| `REQ-DASH-008` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-FIN-001` |
| `REQ-DASH-009` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-FIN-001` |
| `REQ-DASH-010` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-FIN-001` |
| `REQ-DASH-011` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-CONTRIB-001` |
| `REQ-DASH-012` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-FIN-001` |
| `REQ-DASH-013` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-FIN-001` |
| `REQ-DASH-014` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-001`, `TEST-E2E-001` |
| `REQ-DASH-015` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-002` |
| `REQ-DASH-016` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-002` |
| `REQ-DASH-017` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-002` |
| `REQ-DASH-018` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Dashboard and date filters | `TEST-DASH-002`, `TEST-MEM-001` |
| `REQ-MEM-001` | `PHASE-04-MEMBERS` | `01-REQUIREMENTS` §Members and history | `TEST-MEM-001`, `TEST-E2E-001` |
| `REQ-MEM-002` | `PHASE-04-MEMBERS` | `01-REQUIREMENTS` §Members and history | `TEST-MEM-001` |
| `REQ-MEM-003` | `PHASE-04-MEMBERS` | `01-REQUIREMENTS` §Members and history | `TEST-MEM-001`, `TEST-CONTRIB-001` |
| `REQ-MEM-004` | `PHASE-04-MEMBERS` | `01-REQUIREMENTS` §Members and history | `TEST-MEM-001`, `TEST-E2E-001` |
| `REQ-MEM-005` | `PHASE-04-MEMBERS` | `01-REQUIREMENTS` §Members and history | `TEST-MEM-001`, `TEST-FIN-003` |
| `REQ-MEM-006` | `PHASE-04-MEMBERS` | `01-REQUIREMENTS` §Members and history | `TEST-MEM-001`, `TEST-DASH-002` |
| `REQ-CONTRIB-001` | `PHASE-04-MEMBERS` | `01-REQUIREMENTS` §Core calculations | `TEST-CONTRIB-001` |
| `REQ-CONTRIB-002` | `PHASE-04-MEMBERS` | `01-REQUIREMENTS` §Core calculations | `TEST-CONTRIB-001` |
| `REQ-CONTRIB-003` | `PHASE-04-MEMBERS` | `01-REQUIREMENTS` §Core calculations | `TEST-CONTRIB-001` |
| `REQ-CONTRIB-004` | `PHASE-04-MEMBERS` | `01-REQUIREMENTS` §Core calculations | `TEST-CONTRIB-001` |
| `REQ-CONTRIB-005` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Core calculations | `TEST-CONTRIB-001`, `TEST-DASH-001` |
| `REQ-CONTRIB-006` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Core calculations | `TEST-CONTRIB-001`, `TEST-DASH-001` |
| `REQ-INCOME-001` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Financial records | `TEST-INCOME-001`, `TEST-E2E-001` |
| `REQ-INCOME-002` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Financial records | `TEST-INCOME-001`, `TEST-E2E-001` |
| `REQ-INCOME-003` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Financial records | `TEST-INCOME-001` |
| `REQ-INCOME-004` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Financial records | `TEST-INCOME-001` |
| `REQ-INCOME-005` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Financial records | `TEST-INCOME-001`, `TEST-SEC-001` |
| `REQ-INCOME-006` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Financial records | `TEST-INCOME-001`, `TEST-SEC-001` |
| `REQ-EXP-001` | `PHASE-06-EXPENSES` | `01-REQUIREMENTS` §Financial records | `TEST-EXP-001`, `TEST-E2E-001` |
| `REQ-EXP-002` | `PHASE-06-EXPENSES` | `01-REQUIREMENTS` §Financial records | `TEST-EXP-001`, `TEST-E2E-001` |
| `REQ-EXP-003` | `PHASE-06-EXPENSES` | `01-REQUIREMENTS` §Financial records | `TEST-EXP-001`, `TEST-E2E-001` |
| `REQ-EXP-004` | `PHASE-06-EXPENSES` | `01-REQUIREMENTS` §Financial records | `TEST-EXP-001`, `TEST-FIN-003` |
| `REQ-DOC-001` | `PHASE-07-DOCUMENTS` | `01-REQUIREMENTS` §Documents | `TEST-DOC-001`, `TEST-E2E-001` |
| `REQ-DOC-002` | `PHASE-07-DOCUMENTS` | `01-REQUIREMENTS` §Documents | `TEST-DOC-001` |
| `REQ-DOC-003` | `PHASE-06-EXPENSES` | `01-REQUIREMENTS` §Documents | `TEST-DOC-001`, `TEST-E2E-001` |
| `REQ-DOC-004` | `PHASE-07-DOCUMENTS` | `01-REQUIREMENTS` §Documents | `TEST-DOC-001`, `TEST-SEC-001` |
| `REQ-DOC-005` | `PHASE-07-DOCUMENTS` | `01-REQUIREMENTS` §Documents | `TEST-DOC-001`, `TEST-SEC-001` |
| `REQ-DOC-006` | `PHASE-07-DOCUMENTS` | `01-REQUIREMENTS` §Documents | `TEST-DOC-002` |
| `REQ-DOC-007` | `PHASE-07-DOCUMENTS` | `01-REQUIREMENTS` §Documents | `TEST-DOC-002`, `TEST-SEC-001` |
| `REQ-DOC-008` | `PHASE-07-DOCUMENTS` | `01-REQUIREMENTS` §Documents | `TEST-DOC-002` |
| `REQ-DOC-009` | `PHASE-07-DOCUMENTS` | `01-REQUIREMENTS` §Documents | `TEST-DOC-002`, `TEST-SEC-001` |
| `REQ-DOC-010` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Receipts | `TEST-INCOME-001`, `TEST-E2E-001` |
| `REQ-DOC-011` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Receipts | `TEST-INCOME-001` |
| `REQ-DOC-012` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Receipts | `TEST-INCOME-001`, `TEST-SEC-001` |
| `REQ-DOC-013` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Receipts | `TEST-INCOME-001`, `TEST-FIN-002` |
| `REQ-DOC-014` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Receipts | `TEST-INCOME-001` |
| `REQ-REPORT-001` | `PHASE-09-REPORTS` | `01-REQUIREMENTS` §Search, reports, and export | `TEST-REPORT-001`, `TEST-E2E-001` |
| `REQ-REPORT-002` | `PHASE-09-REPORTS` | `01-REQUIREMENTS` §Search, reports, and export | `TEST-REPORT-001`, `TEST-CONTRIB-001` |
| `REQ-REPORT-003` | `PHASE-09-REPORTS` | `01-REQUIREMENTS` §Search, reports, and export | `TEST-REPORT-001`, `TEST-RESP-002` |
| `REQ-REPORT-004` | `PHASE-09-REPORTS` | `01-REQUIREMENTS` §Search, reports, and export | `TEST-REPORT-001`, `TEST-RESP-001` |
| `REQ-SEARCH-001` | `PHASE-09-REPORTS` | `01-REQUIREMENTS` §Search, reports, and export | `TEST-SEARCH-001`, `TEST-E2E-001` |
| `REQ-SEARCH-002` | `PHASE-09-REPORTS` | `01-REQUIREMENTS` §Search, reports, and export | `TEST-SEARCH-001`, `TEST-SEC-001` |
| `REQ-AUDIT-001` | `PHASE-10-AUDIT-SETTINGS` | `01-REQUIREMENTS` §Audit history | `TEST-AUDIT-001`, `TEST-E2E-001` |
| `REQ-AUDIT-002` | `PHASE-10-AUDIT-SETTINGS` | `01-REQUIREMENTS` §Audit history | `TEST-AUDIT-001`, `TEST-SEC-001` |
| `REQ-SETTINGS-001` | `PHASE-10-AUDIT-SETTINGS` | `01-REQUIREMENTS` §Settings | `TEST-AUDIT-002`, `TEST-E2E-001` |
| `REQ-SETTINGS-002` | `PHASE-10-AUDIT-SETTINGS` | `01-REQUIREMENTS` §Settings | `TEST-AUDIT-002` |
| `REQ-SETTINGS-003` | `PHASE-10-AUDIT-SETTINGS` | `01-REQUIREMENTS` §Settings | `TEST-AUDIT-002` |
| `REQ-SETTINGS-004` | `PHASE-10-AUDIT-SETTINGS` | `01-REQUIREMENTS` §Settings | `TEST-AUDIT-002` |
| `REQ-SETTINGS-005` | `PHASE-10-AUDIT-SETTINGS` | `01-REQUIREMENTS` §Settings | `TEST-AUDIT-002` |
| `REQ-SETTINGS-006` | `PHASE-10-AUDIT-SETTINGS` | `01-REQUIREMENTS` §Settings | `TEST-AUDIT-002`, `TEST-SEC-001` |
| `REQ-SETTINGS-007` | `PHASE-10-AUDIT-SETTINGS` | `01-REQUIREMENTS` §Settings | `TEST-AUDIT-002` |
| `REQ-SETTINGS-008` | `PHASE-10-AUDIT-SETTINGS` | `01-REQUIREMENTS` §Settings | `TEST-AUDIT-002` |
| `REQ-SETTINGS-009` | `PHASE-10-AUDIT-SETTINGS` | `01-REQUIREMENTS` §Settings | `TEST-AUDIT-002` |
| `REQ-EXPORT-001` | `PHASE-09-REPORTS` | `01-REQUIREMENTS` §Search, reports, and export | `TEST-EXPORT-001`, `TEST-E2E-001` |
| `REQ-EXPORT-002` | `PHASE-09-REPORTS` | `01-REQUIREMENTS` §Search, reports, and export | `TEST-EXPORT-001` |
| `REQ-RESP-001` | `PHASE-11-UI-INTEGRATION` | `01-REQUIREMENTS` §Product and access | `TEST-RESP-001`, `TEST-RESP-002` |
| `REQ-RESP-002` | `PHASE-11-UI-INTEGRATION` | `01-REQUIREMENTS` §Interaction and responsiveness | `TEST-RESP-001`, `TEST-E2E-001` |
| `REQ-RESP-003` | `PHASE-11-UI-INTEGRATION` | `01-REQUIREMENTS` §Interaction and responsiveness | `TEST-RESP-001`, `TEST-RESP-002` |
| `REQ-RESP-004` | `PHASE-11-UI-INTEGRATION` | `01-REQUIREMENTS` §Interaction and responsiveness | `TEST-RESP-001`, `TEST-E2E-001` |
| `REQ-RESP-005` | `PHASE-11-UI-INTEGRATION` | `01-REQUIREMENTS` §Interaction and responsiveness | `TEST-RESP-001` |
| `REQ-RESP-006` | `PHASE-11-UI-INTEGRATION` | `01-REQUIREMENTS` §Interaction and responsiveness | `TEST-RESP-001` |
| `REQ-RESP-007` | `PHASE-11-UI-INTEGRATION` | `01-REQUIREMENTS` §Interaction and responsiveness | `TEST-RESP-001` |
| `REQ-RESP-008` | `PHASE-11-UI-INTEGRATION` | `01-REQUIREMENTS` §Interaction and responsiveness | `TEST-RESP-001`, `TEST-E2E-001` |
| `REQ-RESP-009` | `PHASE-11-UI-INTEGRATION` | `01-REQUIREMENTS` §Interaction and responsiveness | `TEST-RESP-001`, `TEST-E2E-001` |
| `REQ-RESP-010` | `PHASE-11-UI-INTEGRATION` | `01-REQUIREMENTS` §Interaction and responsiveness | `TEST-RESP-001`, `TEST-E2E-001` |
| `REQ-RESP-011` | `PHASE-11-UI-INTEGRATION` | `01-REQUIREMENTS` §Interaction and responsiveness | `TEST-RESP-001`, `TEST-E2E-001` |
| `REQ-RESP-012` | `PHASE-11-UI-INTEGRATION` | `01-REQUIREMENTS` §Interaction and responsiveness | `TEST-RESP-002` |
| `REQ-RESP-013` | `PHASE-11-UI-INTEGRATION` | `01-REQUIREMENTS` §Interaction and responsiveness | `TEST-RESP-002` |
| `REQ-FIN-001` | `PHASE-02-DATABASE` | `01-REQUIREMENTS` §Financial records | `TEST-FIN-001` |
| `REQ-FIN-002` | `PHASE-02-DATABASE` | `01-REQUIREMENTS` §Product and access | `TEST-FIN-001` |
| `REQ-FIN-003` | `PHASE-02-DATABASE` | `01-REQUIREMENTS` §Financial records | `TEST-FIN-001` |
| `REQ-FIN-004` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Financial records | `TEST-DASH-001`, `TEST-FIN-001` |
| `REQ-FIN-005` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Core calculations | `TEST-FIN-001`, `TEST-DASH-001` |
| `REQ-FIN-006` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Core calculations | `TEST-FIN-001`, `TEST-DASH-001` |
| `REQ-FIN-007` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Core calculations | `TEST-FIN-001`, `TEST-DASH-001` |
| `REQ-FIN-008` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Core calculations | `TEST-FIN-001`, `TEST-FIN-002` |
| `REQ-FIN-009` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Core calculations | `TEST-FIN-001`, `TEST-DASH-001` |
| `REQ-FIN-010` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Core calculations | `TEST-FIN-001`, `TEST-DASH-001` |
| `REQ-FIN-011` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Core calculations | `TEST-FIN-001` |
| `REQ-FIN-012` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Core calculations | `TEST-FIN-001`, `TEST-DASH-001` |
| `REQ-FIN-013` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Core calculations | `TEST-FIN-001`, `TEST-DASH-001` |
| `REQ-FIN-014` | `PHASE-08-DASHBOARD` | `01-REQUIREMENTS` §Core calculations | `TEST-FIN-001`, `TEST-DASH-001` |
| `REQ-FIN-015` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Transaction correction and void rules | `TEST-FIN-002` |
| `REQ-FIN-016` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Transaction correction and void rules | `TEST-FIN-002` |
| `REQ-FIN-017` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Transaction correction and void rules | `TEST-FIN-002` |
| `REQ-FIN-018` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Transaction correction and void rules | `TEST-FIN-002` |
| `REQ-FIN-019` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Transaction correction and void rules | `TEST-FIN-002` |
| `REQ-FIN-020` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Transaction correction and void rules | `TEST-FIN-002` |
| `REQ-FIN-021` | `PHASE-02-DATABASE` | `01-REQUIREMENTS` §Invalid and adversarial behavior | `TEST-FIN-003` |
| `REQ-FIN-022` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Invalid and adversarial behavior | `TEST-FIN-003`, `TEST-E2E-002` |
| `REQ-FIN-023` | `PHASE-02-DATABASE` | `01-REQUIREMENTS` §Invalid and adversarial behavior | `TEST-FIN-003` |
| `REQ-FIN-024` | `PHASE-05-INCOME` | `01-REQUIREMENTS` §Invalid and adversarial behavior | `TEST-FIN-003`, `TEST-SEC-001` |
| `REQ-FIN-025` | `PHASE-12-FINAL-QA` | `01-REQUIREMENTS` §Evidence requirement | `TEST-FIN-001`, `TEST-E2E-002` |
| `REQ-FIN-026` | `PHASE-01-FOUNDATION` | `01-REQUIREMENTS` §Technology and deployment direction | `TEST-FIN-001` |
| `REQ-FIN-027` | `PHASE-12-FINAL-QA` | `01-REQUIREMENTS` §Technology and deployment direction | `TEST-DEPLOY-001` |

## Integration and dependency notes

- Phase 02 owns shared idempotency persistence; every later create or mutation module consumes it and is verified by `TEST-FIN-003`.
- Phase 07 owns the reusable document storage and lifecycle. Phases 05 and 06 may expose only association integration points and must not create temporary upload systems.
- Phase 08 owns the canonical calculation/query layer. Phases 09, 10, and 11 consume its projections; they do not recalculate financial totals independently.
- Phase 09 provides the minimal canonical audit-read projection needed by the Audit Report; Phase 10 owns the full dedicated Audit History interface.
- Phase 06 owns the category data lifecycle; Phase 10 owns the Settings entry point that exposes it.
- A later phase may regression-test an earlier requirement, but the primary owner column remains the single acceptance owner.

## Audit result

Verified by identifier-set comparison between `docs/01-REQUIREMENTS.md`, `docs/10-TEST-PLAN.md`, the register below, and the primary owned requirement lists in `docs/phases/`.

- Requirement coverage: **119 of 119 mapped**, with contiguous, unique identifiers and no duplicates.
- Verification identifiers: **24**, each referenced by at least one requirement row.
- Orphan requirements: **0**.
- Unmapped required requirements: **0**.
- Multiple primary phase owners: **0**.
- Unresolved specification conflicts: **0**.
- Phase owned-requirement lists: **13 of 13 match the register**.
- Traceability matrix: **COMPLETE**.
- Documentation ownership audit: **PASS**.

### Corrections applied during the Prompt 01B audit

- `REQ-EXP-004` was mapped and covered by `TEST-EXP-001` but had no clause in `01-REQUIREMENTS.md`; the active-category requirement was added there so the mapped identifier is defined by its owning authority.
- `REQ-INCOME-002` and `REQ-EXP-003` shared one bullet; they were split so each identifier is defined and auditable on its own line.
- `TEST-AUTH-002` was defined in the test plan but not referenced by any requirement; it is now linked from `REQ-AUTH-003` and `REQ-AUTH-004`.
- Phase 08 owns 31 requirements, not 29; the ownership map, phase total, and `PHASE-08-DASHBOARD.md` primary list were corrected to include `REQ-CONTRIB-005` and `REQ-CONTRIB-006`.
- `10-TEST-PLAN.md` coverage cells were extended so test-plan coverage is a superset of every verification reference in this matrix.
