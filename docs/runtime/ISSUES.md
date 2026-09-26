# HYSSOP FINANCE — Issues

## Document Responsibility

- Owns: open, blocked, and resolved issue records with evidence, attempts, and required user action.
- Does not own: technical decisions, phase progress, generic test results, or final readiness.
- Referenced by: `AGENTS.md`, `08-PERMISSIONS.md`, and the affected phase documents.
- Change rule: record only real issues, use stable `ISSUE-*` identifiers, and stop when a `BLOCKED` condition applies.

## Status

**No current blockers are known.**

Prompt 01 and the Prompt 01B documentation review have not encountered an unresolved locked-requirement conflict, an unsafe operation, a required secret, or an authorization need. This statement is limited to documentation work; it is not a claim that future implementation will be free of defects.

## Issue log

| ID | Status | Phase | Problem | Evidence | Attempts | User action required |
|---|---|---|---|---|---|---|

The log is intentionally empty. Do not fabricate problems to make this document look active.

## Stop-condition reminder

Record a `BLOCKED` entry, then stop, when any condition in `AGENTS.md` or `08-PERMISSIONS.md` occurs. Include the current phase, problem, evidence, attempts, why continuing is unsafe, and the exact information or action required from the user.

## Known unverified areas

These are not current blockers; they are simply unverified because implementation has not started.

- Exact NestJS, Vite, Tailwind, Prisma, and test tool versions.
- Docker/Compose local database behavior.
- Current Netlify and backend free-tier capabilities.
- Production object storage and malware scanning.

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
