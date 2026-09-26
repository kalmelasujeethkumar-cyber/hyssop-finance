# HYSSOP FINANCE — Definition of Done

## Document Responsibility

- Owns: phase completion gates, final readiness gates, status vocabulary, and the evidence standard.
- Does not own: product requirements, test scenarios, runtime results, or implementation decisions.
- Referenced by: every phase document and the runtime evidence records.
- Change rule: a gate may be tightened, but not weakened to allow an incomplete phase to pass.

## Principle

Code existing, a page loading, a build succeeding, most tests passing, or an implementation looking good does not mean finished. Completion requires evidence that the required behavior works and the required checks pass.

## Phase gate

A phase is complete only when all applicable items are evidenced:

- The phase objective and scope are implemented without prohibited shortcuts.
- Relevant specifications were reread and the implementation was compared against them explicitly.
- Lint passes.
- Typecheck passes.
- Unit tests pass.
- Integration tests pass where applicable.
- Database tests pass against a real disposable PostgreSQL instance where applicable.
- E2E tests pass where applicable.
- A production build succeeds.
- Phase-specific acceptance tests pass.
- Financial calculations reconcile across dashboard, database, reports, and method balances.
- Audit, void, authorization, validation, and document rules are verified.
- Responsive and accessible states are verified where UI is involved.
- Runtime documentation is updated with results, decisions, issues, and remaining risks.
- Requirement coverage, traceability, and phase ownership are checked against `docs/14-TRACEABILITY-MATRIX.md`.
- Git status, diff, and staged files are inspected; no secrets or unrelated files are included.
- A meaningful commit is created and its implementation/test hash is recorded; a later evidence-only commit may record the verified hash and push result.

A failing gate prevents `COMPLETE` status. Fix the root cause, retest, and run regression checks.

## Final demo readiness

The final demo is ready only when:

- The Admin can authenticate through the real backend and log out safely.
- Members, contributions, income types, expenses, categories, and payment methods work with real persistence.
- Dashboard metrics, charts, period filters, balances, and recent transactions use real data.
- Contributions show expected, received, remaining, and PAID/PARTIALLY PAID/NOT PAID correctly.
- Edits preserve audit history and voiding requires a reason and excludes the record from active totals.
- Documents upload, validate, associate, preview/open, download, and remove only through authorized paths; missing receipts are visible.
- All required reports, search, filters, pagination, CSV export, and print behavior work.
- Audit History and Settings are useful and accurate.
- Every visible required control works or is absent from the completed experience.
- No fake charts, fake totals, dead buttons, or `Coming Soon` required functionality remain.
- Desktop, laptop, tablet, and mobile workflows pass responsive and accessibility checks.
- Security boundaries, secrets handling, uploads, and unauthorized access have been tested.
- The complete required test process passes from the beginning after the final fix.
- The final report contains objective evidence and an accurate status.
- The demo deployment is implemented and smoke-tested on a safe free-tier-compatible path, including a durable replaceable document-storage choice for external access. If authorization, payment, or a sound architecture change is required, the final status is `BLOCKED` until the user resolves it; a local-only limitation is not silently treated as a completed deployment.

## Status vocabulary

- `NOT STARTED`: implementation has not begun.
- `IN PROGRESS`: work is underway and the gate is not passed.
- `BLOCKED`: a stop condition prevents safe progress and the issue is recorded.
- `COMPLETE`: the applicable phase gate passed with evidence.
- `READY`: final demo readiness is supported by a complete, passing, documented run.
- `NOT READY`: any required behavior or evidence is missing or failed.

## Evidence standard

A self-generated score is not evidence. Prefer command output, database reconciliation, API responses, browser results, screenshots or traces where appropriate, audit records, and reproducible scenario descriptions. A serious unresolved issue prevents READY status when it affects required demo behavior.
