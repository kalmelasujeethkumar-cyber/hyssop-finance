# PHASE 12 — FINAL QA

## Document Responsibility

- Owns: adversarial QA, defect repair, the complete retest process, deployment verification, and final readiness evidence.
- Does not own: product requirements, feature implementation contracts, or status claims without evidence.
- Primary owned requirements: `REQ-FIN-025`, `REQ-FIN-027`.
- Consumed requirements: every `REQ-*` identifier and every `TEST-*` identifier.
- Authority references: `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `07-SECURITY-RULES.md`, `10-TEST-PLAN.md`, `11-DEFINITION-OF-DONE.md`, `12-DEPLOYMENT-PLAN.md`, `14-TRACEABILITY-MATRIX.md`, and all runtime evidence records.
- Deliverables: defect records, regression evidence, complete test run, verified deployment or `BLOCKED` record, and final report.
- Out of scope: weakening tests, hiding failures, inventing deployment results, or claiming READY from a local-only run.
- Handoff: external review of the final report; unresolved serious issues remain `NOT READY` or `BLOCKED`.
- Acceptance evidence: `TEST-DEPLOY-001`, `TEST-E2E-002`, and the complete applicable set of all `TEST-*` identifiers.

## Phase Metadata

- Status: `NOT STARTED`; requires Phases 01–11 complete.
- Preconditions: all feature contracts implemented, test commands documented, and deployment authorization available or a `BLOCKED` record permitted.
- Handoff rule: the complete required test process restarts from the beginning after any final-QA fix.

## Objective

Enter an adversarial QA mindset, find and repair defects, run the complete required test process from the beginning, implement and verify the approved demo deployment, and produce an evidence-based final report.

## Scope

- Review frontend, backend, database, authentication, financial calculations, documents, reports, CSV, audit history, dates, search, filters, responsive design, states, duplicate submissions, security boundaries, code quality, configuration, and deployment behavior.
- Run full unit, integration, database, API, E2E, responsive, security, and build checks.
- Fix each defect with a root cause, regression test, and retest.
- Repeat the complete test process until it passes without blocking failures.
- Implement and verify the Phase 12 deployment on a safe free-tier-compatible path, including selecting and configuring a durable replaceable document-storage adapter, environment variables, HTTPS, CORS/CSRF, database migrations, and hosted smoke tests.

## Prerequisites

- Phases 01 through 11 complete.
- All specifications and `docs/runtime/CURRENT-STATE.md` reread.
- Test commands, deployment assumptions, and demo credentials guidance are documented without committing secrets.

## Expected files and modules

- Defect fixes and regression tests wherever required.
- Updated runtime evidence, final report, and any corrected specification.
- Verified build, deployment configuration, and deployment smoke-test evidence. If authorization, payment, or a safe architecture is unavailable, record `BLOCKED`; do not silently substitute local-only behavior.

## Implementation requirements

- Assume defects exist and try to break the application safely.
- Verify downstream effects, not just surface rendering.
- Reconcile the documented financial scenario across every surface.
- Verify unauthorized access, upload attacks, invalid input, retry safety, and audit behavior.
- Verify representative desktop, laptop, tablet, and mobile workflows.
- Do not weaken tests or hide failures.
- Do not mark a deployment complete when only a local server or unverifiable URL exists.

## Prohibited shortcuts

- No claiming READY without a complete passing run.
- No skipping the complete-retest restart after a fix.
- No hard-coded values, fake evidence, invented deployment results, or fabricated scores used as proof.
- No unresolved serious defect left undocumented.

## Acceptance criteria

- Every defect found is documented, root-caused, fixed, retested, and regression tested.
- The complete required test process passes from the beginning after the final fix.
- Financial, document, report, audit, security, and responsive evidence is recorded.
- Final status is accurate: READY only with complete evidence and a verified safe deployment, otherwise BLOCKED or NOT READY with reasons.
- The final report includes the required evidence and known limitations.

## Tests required

- Complete lint, typecheck, unit, integration, database, API, E2E, responsive, security, and production build runs.
- Full Admin browser workflow from the test plan.
- Financial integrity scenario and reconciliation.
- Invalid input, duplicate submission, session expiry, upload, and unauthorized access scenarios.
- Deployment smoke checks against the deployed frontend, API, database, session flow, and document storage.

## Documentation updates required

Update `docs/runtime/TEST-RESULTS.md`, `docs/runtime/PHASE-HISTORY.md`, `docs/runtime/ISSUES.md` if needed, and `docs/runtime/FINAL-REPORT.md` with objective evidence.

## Git completion gate

Inspect status, diff, history, and secrets; run and record the complete test process; commit final verified changes; push to `origin`; verify the push; record the final commit hash. Do not hide failures to obtain a clean status.

## Rollback and recovery

If a critical defect cannot be repaired safely after several evidence-based attempts, mark the final status `BLOCKED`, record the exact user action required, and stop rather than weakening the system.

## Completion checklist

- [ ] Adversarial review performed.
- [ ] All defects fixed and regression tested.
- [ ] Complete retest process passes from the beginning.
- [ ] Financial, security, document, report, and responsive evidence recorded.
- [ ] Deployment status recorded honestly.
- [ ] Final report and Git gate complete.
