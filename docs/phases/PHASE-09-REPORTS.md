# PHASE 09 — REPORTS

## Document Responsibility

- Owns: all required report projections, global search service, CSV generation, print behavior, and report-specific presentation.
- Does not own: business formula statements, canonical aggregate design, audit-event creation, UI tokens, or requirement definitions.
- Primary owned requirements: `REQ-REPORT-001`–`REQ-REPORT-004`, `REQ-SEARCH-001`, `REQ-SEARCH-002`, `REQ-EXPORT-001`, `REQ-EXPORT-002`.
- Consumed requirements: `REQ-DASH-*`, `REQ-MEM-*`, `REQ-CONTRIB-*`, `REQ-INCOME-*`, `REQ-EXP-*`, `REQ-DOC-*`, `REQ-AUDIT-001`, `REQ-AUDIT-002`, and `REQ-FIN-*` projections.
- Authority references: `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `05-DATABASE-SPEC.md`, `06-API-SPEC.md`, `07-SECURITY-RULES.md`, `10-TEST-PLAN.md`, and `14-TRACEABILITY-MATRIX.md`.
- Deliverables: report API/pages, minimal canonical audit-read projection for the Audit Report, search, CSV, print, and reconciliation evidence.
- Out of scope: duplicating dashboard calculations, creating audit events, or reimplementing document access.
- Handoff: Phase 10 consumes the report audit projection and owns the full dedicated Audit History interface; Phase 11 integrates final navigation.
- Acceptance evidence: `TEST-REPORT-001`, `TEST-SEARCH-001`, `TEST-EXPORT-001`, `TEST-FIN-001`, and `TEST-E2E-001`.

## Phase Metadata

- Status: `NOT STARTED`; requires the canonical calculation layer and earlier financial phases.
- Preconditions: Phases 01–08 complete; audit read projection is defined before report acceptance.
- Handoff rule: all report totals and CSV values are projections of the canonical ledger, not parallel calculations.

## Objective

Implement every required report with consistent period filters, database-derived values, safe CSV export, print presentation, and search/filter support.

## Scope

- Financial Summary, Income Report, Expense Report, Member Contribution Report, Offering Report, Donation Report, Payment Method Report, Expense Category Report, Receipt / Document Report, Audit Report, and Complete Transaction Report.
- Today through custom date range filters.
- CSV export with documented columns, escaping, and document references.
- Print views for receipts and appropriate reports.
- Global search API service and endpoint across members and transactions, using the authorized search contract.

## Prerequisites

- Phases 01 through 08 complete.
- `01-REQUIREMENTS.md`, `06-API-SPEC.md`, `10-TEST-PLAN.md`, and `03-UI-UX-RULES.md` reread.
- Report queries must reuse canonical aggregate and audit services.

## Expected files and modules

- Report query services, global search query service, and API endpoints.
- Report pages, filter controls, tables, CSV generation, and print styles.
- Report, CSV, and browser tests.

## Implementation requirements

- Use the same canonical period and money rules as the dashboard.
- Exclude voided records from active financial reports while keeping them identifiable in audit or complete history views as specified.
- Show expected, received, remaining, and status in member contribution reports.
- Escape CSV cells, define column order, and include useful document references.
- Make local document references honest about local-only availability.
- Keep print output readable and free of hidden interactive-only content.
- Implement global search across member names, Member IDs, transaction references, categories, transaction types, dates, and amounts with bounded, deterministic results.

## Prohibited shortcuts

- No hard-coded report rows, client-only filters, or fake export.
- No report total that disagrees with the dashboard or database.
- No CSV that silently misrepresents money or omits required financial fields.
- No broken print or export control.

## Acceptance criteria

- All eleven reports are available and accurate for every period filter.
- Member contribution status is correct.
- CSV exports are well-formed, escaped, and reconcile with the report.
- Document and receipt references behave as documented.
- Global search returns bounded, deterministic authorized results.
- Print output is readable and intentional.

## Tests required

- Report query and period boundary unit tests.
- API integration and database reconciliation tests for each report.
- CSV structure, escaping, and reconciliation tests.
- Browser tests for filters, report navigation, global search, CSV download, and print preview.

## Documentation updates required

Record report definitions, CSV columns, print behavior, and any deliberate local-link limitation.

## Git completion gate

Pass the complete applicable quality gate; inspect diff and secrets; commit; push; verify; record the hash.

## Rollback and recovery

Correct a report through a focused service change and regression tests. Do not patch a displayed number to match another bug.

## Completion checklist

- [ ] All required reports exist and work.
- [ ] All period filters work.
- [ ] CSV and print behavior verified.
- [ ] Values reconcile with the ledger.
- [ ] Documentation, tests, and Git gate complete.
