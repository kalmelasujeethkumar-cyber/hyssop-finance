# PHASE 08 — Dashboard

## Document Responsibility

- Owns: the canonical financial calculation/query service, period-aware dashboard aggregates, required metrics, charts, trends, recent activity, and quick-action wiring.
- Does not own: business formula statements, report presentation, UI tokens, or requirement definitions.
- Primary owned requirements: `REQ-DASH-001`–`REQ-DASH-018`, `REQ-CONTRIB-005`, `REQ-CONTRIB-006`, `REQ-FIN-004`–`REQ-FIN-014`.
- Consumed requirements: `REQ-MEM-*`, `REQ-CONTRIB-001`–`REQ-CONTRIB-004`, `REQ-INCOME-*`, `REQ-EXP-*`, `REQ-DOC-003`, `REQ-RESP-001`, `REQ-RESP-005`, `REQ-RESP-006`, and `REQ-RESP-012`.
- Authority references: `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `05-DATABASE-SPEC.md`, `06-API-SPEC.md`, `03-UI-UX-RULES.md`, `04-DESIGN-TOKENS.md`, `10-TEST-PLAN.md`, and `14-TRACEABILITY-MATRIX.md`.
- Deliverables: period resolver, shared aggregate projections, dashboard API/UI, charts, and reconciliation evidence.
- Out of scope: hard-coded totals, opening balances, client-side authoritative calculations, or fake charts.
- Handoff: Phase 09 reuses the same projections for reports and CSV; Phase 11 wires the final page composition.
- Acceptance evidence: `TEST-FIN-001`, `TEST-DASH-001`, `TEST-DASH-002`, `TEST-RESP-001`, and `TEST-E2E-001`.

## Phase Metadata

- Status: `NOT STARTED`; requires the ledger, contribution, income, expense, and document contracts to be available.
- Preconditions: Phases 01–07 complete and the canonical calculation layer is reviewed.
- Handoff rule: period movement and ending balances are separate labeled projections.

## Objective

Deliver the real, period-aware dashboard with required financial metrics, balances, charts, contribution status, monthly trend, recent transactions, and working quick actions.

## Scope

- Total Income, Total Expenses, Available Balance, and member count.
- Cash, UPI, Bank, and total available balances.
- Income versus expense visualization and income/expense breakdowns.
- Contribution status visualization and monthly financial trend.
- Recent transactions and quick actions.
- Today, This Month, Last Month, Last 3 Months, Last 6 Months, This Year, Last Year, and custom range filters.

## Prerequisites

- Phases 01 through 07 complete.
- `01-REQUIREMENTS.md`, `03-UI-UX-RULES.md`, `04-DESIGN-TOKENS.md`, and `05-DATABASE-SPEC.md` reread.
- Dashboard aggregates are available from the API and derived from the database.

## Expected files and modules

- Dashboard aggregate service and API endpoint.
- Period filter component and query-state handling.
- Metric cards, charts, recent transaction list, and quick-action components.
- Dashboard integration, reconciliation, and browser tests.

## Implementation requirements

- Compute all values from active transactions only.
- Treat selected-period income and expenses as period movements, and compute Cash, UPI, Bank, and total available balance as ending ledger balances through the selected period end. Label any period movement separately and do not invent opening balances.
- Use Asia/Kolkata business-date boundaries.
- Reconcile dashboard values with reports, method balances, and database aggregates.
- Use real chart data with empty states and accessible summaries.
- Count members created on or before period end and count configured member-period buckets per month; show absent expected periods as **Not configured** rather than silently changing a payment status.
- Ensure quick actions navigate to or open working, authorized flows.
- Refresh data after mutations without showing stale totals as final.

## Prohibited shortcuts

- No hard-coded totals, fake charts, static data, or decorative controls.
- No client-side recalculation that disagrees with the server.
- No dead period filters, quick actions, or chart interactions.
- No pointer-only or color-only critical information.

## Acceptance criteria

- Every required metric and visualization is present and real.
- Every period filter returns the correct boundaries and values.
- Totals and method balances reconcile with the documented scenario.
- Empty, loading, and error states are intentional.
- Quick actions lead to working, authorized screens.

## Tests required

- Period boundary and aggregate unit tests.
- API integration and database reconciliation tests, including prior-period history, UPI ₹20,000 minus ₹5,000, negative method balances, member-count boundaries, and multi-month status buckets.
- Chart and empty-state component tests.
- Browser tests for each period filter, recent transactions, quick actions, and post-mutation refresh.

## Documentation updates required

Record the final period semantics, aggregate definitions, and reconciliation evidence.

## Git completion gate

Pass the complete applicable quality gate including E2E and build; inspect diff and secrets; commit; push; verify; record the hash.

## Rollback and recovery

Revert or correct the aggregate service with a focused commit and regression tests. Do not work around a mismatch with a hard-coded display value.

## Completion checklist

- [ ] All required metrics and charts work.
- [ ] All period filters work.
- [ ] Values reconcile across dashboard, API, and database.
- [ ] States and quick actions are real.
- [ ] Documentation, tests, and Git gate complete.
