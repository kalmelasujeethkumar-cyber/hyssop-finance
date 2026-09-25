# PHASE 12 — FINAL QA

## Objective

Enter an adversarial QA mindset, find and repair defects, run the complete required test process from the beginning, verify deployment assumptions, and produce an evidence-based final report.

## Scope

- Review frontend, backend, database, authentication, financial calculations, documents, reports, CSV, audit history, dates, search, filters, responsive design, states, duplicate submissions, security boundaries, code quality, configuration, and deployment behavior.
- Run full unit, integration, database, API, E2E, responsive, security, and build checks.
- Fix each defect with a root cause, regression test, and retest.
- Repeat the complete test process until it passes without blocking failures.
- Update `docs/runtime/FINAL-REPORT.md` and related evidence.

## Prerequisites

- Phases 01 through 11 complete.
- All specifications and `docs/runtime/CURRENT-STATE.md` reread.
- Test commands, deployment assumptions, and demo credentials guidance are documented without committing secrets.

## Expected files and modules

- Defect fixes and regression tests wherever required.
- Updated runtime evidence, final report, and any corrected specification.
- Verified build and deployment or a clearly documented deployment limitation.

## Implementation requirements

- Assume defects exist and try to break the application safely.
- Verify downstream effects, not just surface rendering.
- Reconcile the documented financial scenario across every surface.
- Verify unauthorized access, upload attacks, invalid input, retry safety, and audit behavior.
- Verify representative desktop, laptop, tablet, and mobile workflows.
- Do not weaken tests or hide failures.

## Prohibited shortcuts

- No claiming READY without a complete passing run.
- No skipping the complete-retest restart after a fix.
- No hard-coded values, fake evidence, invented deployment results, or fabricated scores used as proof.
- No unresolved serious defect left undocumented.

## Acceptance criteria

- Every defect found is documented, root-caused, fixed, retested, and regression tested.
- The complete required test process passes from the beginning after the final fix.
- Financial, document, report, audit, security, and responsive evidence is recorded.
- Final status is accurate: READY only with complete evidence, otherwise BLOCKED or NOT READY with reasons.
- The final report includes the required evidence and known limitations.

## Tests required

- Complete lint, typecheck, unit, integration, database, API, E2E, responsive, security, and production build runs.
- Full Admin browser workflow from the test plan.
- Financial integrity scenario and reconciliation.
- Invalid input, duplicate submission, session expiry, upload, and unauthorized access scenarios.
- Deployment smoke checks if a deployment exists, or a documented verification of why it does not.

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
