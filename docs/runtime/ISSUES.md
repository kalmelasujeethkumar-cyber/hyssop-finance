# HYSSOP FINANCE — Issues

## Document Responsibility

- Owns: open, blocked, and resolved issue records with evidence, attempts, and required user action.
- Does not own: technical decisions, phase progress, generic test results, or final readiness.
- Referenced by: `AGENTS.md`, `08-PERMISSIONS.md`, and the affected phase documents.
- Change rule: record only real issues, use stable `ISSUE-*` identifiers, and stop when a `BLOCKED` condition applies.

## Status

**No current blockers are known.**

Phase 01 completed its quality gate with two open advisories that do not block the phase: the Nest CLI's Node engine warning (`ISSUE-011`) and the NestJS internal legacy-route advisory (`ISSUE-012`). Both are recorded below with the condition that would escalate them. No locked-requirement conflict, unsafe operation, required secret, or authorization need has occurred.

## Issue log

| ID | Status | Phase | Problem | Evidence | Attempts | User action required |
|---|---|---|---|---|---|---|
| `ISSUE-011` | OPEN (advisory) | `PHASE-01-FOUNDATION` | `npm install` warns that `@angular-devkit/schematics` and `@angular-devkit/core` (transitive Nest CLI dependencies) declare Node `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0`, while the approved runtime is Node `22.19.0`. | Install output; `nest build`, typecheck, and Jest all pass on `22.19.0`; `jsdom` was downgraded to `26.1.0` for the same reason and installs cleanly | Selected NestJS `11.2.6` so the CLI remains on a line compatible with CommonJS output; verified the build, test, and generation-free workflows | None now. If a later phase needs `nest generate` on a runtime that rejects the CLI, ask before changing the Node version |
| `ISSUE-012` | OPEN (advisory) | `PHASE-01-FOUNDATION` | NestJS logs `LegacyRouteConverter: Unsupported route path "/api/*"` for its internal versioned catch-all route, an Express 5 `path-to-regexp` advisory. | API startup log during `npm run test:e2e`; all 49 API tests and 2 browser tests pass, and the 404 envelope is verified by integration test | None; the route belongs to NestJS version-prefixed 404 handling and is auto-converted upstream | None. Revisit only if a NestJS upgrade removes the advisory |

The log is intentionally small. Do not fabricate problems to make this document look active.

## Stop-condition reminder

Record a `BLOCKED` entry, then stop, when any condition in `AGENTS.md` or `08-PERMISSIONS.md` occurs. Include the current phase, problem, evidence, attempts, why continuing is unsafe, and the exact information or action required from the user.

## Known unverified areas

These are not current blockers; they are simply unverified because the owning phase has not run.

- Prisma and PostgreSQL versions, migrations, and the local database container.
- Session, CSRF, and authentication behavior (Phase 03).
- Document upload, traversal, and object-storage behavior (Phase 06 and Phase 12).
- Chart rendering and dashboard density (Phase 08).
- Exact hosted platform capabilities for the frontend and backend (Phase 12).

They become issues only if they conflict with a locked requirement, require unsafe action, or cannot be safely resolved within an approved phase.

## Resolved Prompt 01 review findings

| ID | Status | Resolution |
|---|---|---|
| `ISSUE-001` | RESOLVED | Defined period movement versus ending payment-method balances, including negative balances and the UPI example. |
| `ISSUE-002` | RESOLVED | Defined a pre-authentication CSRF flow for login and rotated post-login tokens. |
| `ISSUE-003` | RESOLVED | Added member and transaction optimistic revisions and explicit correction allow-lists. |
| `ISSUE-004` | RESOLVED | Assigned hosted deployment and durable storage verification to Phase 12. |
| `ISSUE-005` | RESOLVED | Defined receipt eligibility, anonymous privacy, document-removal failure behavior, idempotency retention, and contribution-period aggregation. |
| `ISSUE-006` | RESOLVED | Added stable `REQ-*` and `TEST-*` identifiers, document responsibility sections, and the traceability matrix. |
| `ISSUE-007` | RESOLVED | Resolved the Phase 05/06/07 document dependency: Phase 07 owns the reusable storage subsystem; earlier phases expose only association integration points. |
| `ISSUE-008` | RESOLVED | Resolved the Phase 09/10 audit ordering and Phase 06/10 category ownership overlaps. |
| `ISSUE-009` | RESOLVED | Resolved ambiguities for voided receipts, anonymous free text, named contributors, search grammar, phone normalization, business dates, and report visibility. |
| `ISSUE-010` | RESOLVED | The final traceability audit found `REQ-EXP-004` mapped but undefined, `REQ-INCOME-002`/`REQ-EXP-003` sharing one clause line, `TEST-AUTH-002` referenced by no requirement, and a Phase 08 ownership count of 29 instead of 31. All four were corrected in their owning documents and re-verified. |

These were documentation consistency findings, not application defects. They were corrected before the corrective documentation checkpoint.
