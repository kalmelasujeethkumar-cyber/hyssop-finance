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

- Status: `COMPLETE`; the quality gate passed on 2026-10-02 and the Git gate is recorded in `docs/runtime/PHASE-HISTORY.md`.
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

## Implementation record

This section records where the delivered behavior is defined. It deliberately does not restate the contract: the owning files are cited so there is one authority per behavior, and each of them is generated from or validated against PostgreSQL.

- Report definitions — the eleven closed report ids, their titles, the voided-visibility rule per report (`REPORT_EXCLUDES_VOIDED`), and the exact CSV column order per report (`REPORT_CSV_COLUMNS`) are declared once in `packages/contracts/src/reports.ts`. The screen states the voided-visibility sentence from that constant, so a report cannot claim a rule the contract does not give it (`DEC-097`).
- Report and search projections — `apps/api/src/reports/reports.service.ts` and `apps/api/src/database/*`. Every figure comes from the same canonical calculation layer the dashboard uses, so a report cannot disagree with the dashboard, and money crosses the wire as exact decimal strings (`DEC-096`).
- CSV — `apps/api/src/reports/csv.ts` escapes every cell, neutralizes a leading spreadsheet formula character, and `apps/api/src/reports/report-csv.ts` renders the contract's column list for each report from the same projection the JSON route returns.
- Print — `apps/web/src/styles/theme.css` owns `.print-hidden`, `.print-only`, and `.print-block`; the page prints its own scope, period, and generation timestamp and carries no control.
- Deliberate local-link limitation — the document columns are named `Document Link (local application only)`, and the receipt panel states that a local link is valid only while this local application is accessible (`REQ-EXPORT-002`). No report claims a hosted document URL.

## Completion checklist

- [x] All required reports exist and work.
- [x] All period filters work.
- [x] CSV and print behavior verified.
- [x] Values reconcile with the ledger.
- [x] Documentation, tests, and Git gate complete.
