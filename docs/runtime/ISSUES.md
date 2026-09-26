# HYSSOP FINANCE — Issues

## Document Responsibility

- Owns: open, blocked, and resolved issue records with evidence, attempts, and required user action.
- Does not own: technical decisions, phase progress, generic test results, or final readiness.
- Referenced by: `AGENTS.md`, `08-PERMISSIONS.md`, and the affected phase documents.
- Change rule: record only real issues, use stable `ISSUE-*` identifiers, and stop when a `BLOCKED` condition applies.

## Status

**No current blockers are known.**

Phase 01 completed its quality gate with two open advisories that do not block the phase: the Nest CLI's Node engine warning (`ISSUE-011`) and the NestJS internal legacy-route advisory (`ISSUE-012`). Phase 02 completed its quality gate with four more advisories: the partial-index deviation (`ISSUE-013`), a Prisma-CLI-only dependency advisory (`ISSUE-014`), the Prisma 7 configuration deprecation (`ISSUE-015`), and the unverified Docker provisioning path (`ISSUE-016`). No locked-requirement conflict, unsafe operation, required secret, or authorization need has occurred.

## Issue log

| ID | Status | Phase | Problem | Evidence | Attempts | User action required |
|---|---|---|---|---|---|---|
| `ISSUE-011` | OPEN (advisory) | `PHASE-01-FOUNDATION` | `npm install` warns that `@angular-devkit/schematics` and `@angular-devkit/core` (transitive Nest CLI dependencies) declare Node `^22.22.0 \|\| ^24.15.0 \|\| >=26.0.0`, while the approved runtime is Node `22.19.0`. | Install output; `nest build`, typecheck, and Jest all pass on `22.19.0`; `jsdom` was downgraded to `26.1.0` for the same reason and installs cleanly | Selected NestJS `11.2.6` so the CLI remains on a line compatible with CommonJS output; verified the build, test, and generation-free workflows | None now. If a later phase needs `nest generate` on a runtime that rejects the CLI, ask before changing the Node version |
| `ISSUE-012` | OPEN (advisory) | `PHASE-01-FOUNDATION` | NestJS logs `LegacyRouteConverter: Unsupported route path "/api/*"` for its internal versioned catch-all route, an Express 5 `path-to-regexp` advisory. | API startup log during `npm run test:e2e`; all 49 API tests and 2 browser tests pass, and the 404 envelope is verified by integration test | None; the route belongs to NestJS version-prefixed 404 handling and is auto-converted upstream | None. Revisit only if a NestJS upgrade removes the advisory |
| `ISSUE-013` | OPEN (advisory) | `PHASE-02-DATABASE` | `docs/05-DATABASE-SPEC.md` asks for `financial_transaction(member_id, business_date, status)` and `(category_id, business_date, status)` to be partial on active rows, but Prisma 6.19 cannot declare a partial index in the datamodel, and a migration-only `WHERE` clause makes `prisma migrate diff` report drift on every run. | Index inventory from `pg_indexes` and the zero-drift `prisma migrate diff` result recorded in `TEST-RESULTS.md`; the `DEC-060` impact statement | Kept the documented column order and name, implemented them as full indexes, and recorded the deviation rather than accepting permanent drift or an unreviewed hand-managed index | None now. Ask if strict partial indexes are required; the options are accepting permanent drift or owning those two indexes outside Prisma |
| `ISSUE-014` | OPEN (advisory) | `PHASE-02-DATABASE` | `npm audit` reports 3 high-severity findings, all one advisory (`GHSA-ggr8-5vv4-36mx`, stack exhaustion in `deepmerge-ts@7.1.5`) reached only through `@prisma/config`, which the Prisma CLI loads. | `npm ls deepmerge-ts` shows the single path `prisma → @prisma/config → deepmerge-ts`; a search for `deepmerge` in `apps/api/dist` and for `require('deepmerge` in `node_modules/@prisma/client` matches nothing, so no shipped runtime path loads it; the only automated fix npm offers is `npm audit fix --force`, which downgrades Prisma to `6.12.0` | Confirmed reachability is limited to developer-time CLI configuration merging of this repository's own static config; rejected the breaking downgrade because it would abandon the pinned `6.19.3` toolchain | None now. Ask before accepting a Prisma downgrade or any `npm audit fix --force` |
| `ISSUE-015` | OPEN (advisory) | `PHASE-02-DATABASE` | Every Prisma CLI command warns that `package.json#prisma` is deprecated and removed in Prisma 7, which requires a `prisma.config.ts` file. | Warning reproduced on `db:validate`, `migrate deploy`, `migrate status`, and `migrate diff`; all commands still succeed | Kept the working Prisma 6 configuration per `DEC-061` rather than mixing a configuration-format migration into the database phase | None now. Revisit when Prisma 7 is adopted |
| `ISSUE-016` | OPEN (advisory) | `PHASE-02-DATABASE` | `docker-compose.yml` and `docker/postgres/init/001-app-role.sh` are committed as the container provisioning path, but Docker is not installed on the developer machine, so that path has never been executed. | `db:start` reports a missing Docker CLI; the project-local PostgreSQL 16 path in `scripts/local-postgres.mjs` is the verified workflow and is what all Phase 02 evidence used | Implemented the equivalent role and privilege steps locally, including the least-privilege grants and the audit append-only revoke, and verified them with `has_table_privilege` | None now. Ask before treating a container run as verified, or before Phase 12 claims a hosted database is provisioned |

The log is intentionally small. Do not fabricate problems to make this document look active.

## Stop-condition reminder

Record a `BLOCKED` entry, then stop, when any condition in `AGENTS.md` or `08-PERMISSIONS.md` occurs. Include the current phase, problem, evidence, attempts, why continuing is unsafe, and the exact information or action required from the user.

## Known unverified areas

These are not current blockers; they are simply unverified because the owning phase has not run.

- The Docker/Compose provisioning path (`ISSUE-016`).
- Session, CSRF, and authentication behavior (Phase 03).
- Document upload, traversal, and object-storage behavior (Phase 06 and Phase 12). Phase 02 persists document metadata only.
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
