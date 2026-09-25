# PHASE 08 — Dashboard

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
- Use Asia/Kolkata business-date boundaries.
- Reconcile dashboard values with reports, method balances, and database aggregates.
- Use real chart data with empty states and accessible summaries.
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
- API integration and database reconciliation tests.
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
