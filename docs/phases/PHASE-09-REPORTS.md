# PHASE 09 — REPORTS

## Objective

Implement every required report with consistent period filters, database-derived values, safe CSV export, print presentation, and search/filter support.

## Scope

- Financial Summary, Income Report, Expense Report, Member Contribution Report, Offering Report, Donation Report, Payment Method Report, Expense Category Report, Receipt / Document Report, Audit Report, and Complete Transaction Report.
- Today through custom date range filters.
- CSV export with documented columns, escaping, and document references.
- Print views for receipts and appropriate reports.

## Prerequisites

- Phases 01 through 08 complete.
- `01-REQUIREMENTS.md`, `06-API-SPEC.md`, `10-TEST-PLAN.md`, and `03-UI-UX-RULES.md` reread.
- Report queries must reuse canonical aggregate and audit services.

## Expected files and modules

- Report query services and API endpoints.
- Report pages, filter controls, tables, CSV generation, and print styles.
- Report, CSV, and browser tests.

## Implementation requirements

- Use the same canonical period and money rules as the dashboard.
- Exclude voided records from active financial reports while keeping them identifiable in audit or complete history views as specified.
- Show expected, received, remaining, and status in member contribution reports.
- Escape CSV cells, define column order, and include useful document references.
- Make local document references honest about local-only availability.
- Keep print output readable and free of hidden interactive-only content.

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
- Print output is readable and intentional.

## Tests required

- Report query and period boundary unit tests.
- API integration and database reconciliation tests for each report.
- CSV structure, escaping, and reconciliation tests.
- Browser tests for filters, report navigation, CSV download, and print preview.

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
