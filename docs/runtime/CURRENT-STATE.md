# HYSSOP FINANCE — Current State

## Document Responsibility

- Owns: current stage, progress, next action, blockers, and authorization reminder only.
- Does not own: decision history, issue details, test evidence, or final readiness.
- Referenced by: `AGENTS.md`, the current phase document, and external review.
- Change rule: keep this record short and current; move historical reasoning to `DECISIONS.md`, `ISSUES.md`, or `PHASE-HISTORY.md`.

## Project

- Project: **HYSSOP FINANCE**
- Repository: `HYSSOP-FINANCE`
- Authorized remote: `https://github.com/kalmelasujeethkumar-cyber/hyssop-finance.git` (`origin`)

## Current stage

- Current stage: **PHASE 05 — INCOME (QUALITY GATE PASSED), PHASE 06 — EXPENSES (NOT STARTED)**
- Current phase: `PHASE-06-EXPENSES`
- Status: **PHASE 05 QUALITY GATE PASSED ON 2026-09-29; GIT GATE PENDING**
- Next gate: the Phase 05 Git gate, then `PHASE-06-EXPENSES`
- Phase 06: **NOT STARTED** apart from the `packages/contracts/src/expenses.ts` contract scaffold
- Phase 07: **NOT STARTED**; document upload, download, and the storage adapter remain out of scope for every phase completed so far
- Application implementation: **PHASE 01, PHASE 02, PHASE 03, PHASE 04, AND PHASE 05 COMPLETE** (foundation, persistence, authentication, members, and income)
- Documentation: Prompt 01 baseline and Prompt 01B hardening pushed; Phase 01, Phase 02, Phase 03, and Phase 04 gates closed with recorded evidence; Phase 05 gate recorded
- Database migrations: **5 REVIEWED MIGRATIONS APPLIED** to `hyssop_finance_dev` and `hyssop_finance_test`
- External services: **NOT CONFIGURED**

## Progress

Prompt 01 established the project constitution, specifications, phase plan, runtime tracking, Git safety, and verification framework. Its checkpoint commit `64245b74a78eb86ff12bb602d7c025ac9e7f1389` and evidence commit `2c0e56586f286cd074c8fb581e6721c6555d148c` were pushed to `origin/main`.

Prompt 01B reread the full specification, phase, and runtime set; added the document ownership map and per-document responsibility boundaries; introduced 119 stable `REQ-*` and 24 stable `TEST-*` identifiers; created and audited `docs/14-TRACEABILITY-MATRIX.md`; defined the canonical financial calculation layer; and resolved phase dependency overlaps.

Phase 01 is complete. It owns `REQ-AUTH-001`, `REQ-AUTH-006`, and `REQ-FIN-026` and implemented the technical foundation: npm workspace, pinned toolchain, `apps/api` with structured logging, security headers, explicit CORS, the global error envelope, request IDs, and `GET /api/v1/health`; `apps/web` with design tokens, routing, an honest error boundary, and a real connectivity check; `packages/contracts`; and the lint, typecheck, test, build, and browser-smoke harnesses.

Phase 02 is complete. It owns `REQ-FIN-001`, `REQ-FIN-002`, `REQ-FIN-003`, `REQ-FIN-021`, and `REQ-FIN-023` and implemented the canonical Prisma schema with two reviewed migrations, exact `BIGINT` paise money, database-enforced transaction, void, period, reference, and append-only audit invariants, transactional idempotency, reconciliation queries, a fictional idempotent seed, a disposable local PostgreSQL 16 workflow, and 48 real-database tests.

Phase 03 is implemented and has passed its quality gate. It owns the authentication requirements and implemented the single-Admin account with an Argon2id password hash, a one-time `npm run admin:bootstrap` that revokes the previous Admin's sessions, opaque server-side sessions stored as SHA-256 hashes with real revocation, an HTTP-only session cookie and a script-readable CSRF cookie, origin-bound single-use pre-authentication CSRF enforced with a constant-time comparison, login rate limiting, a sign-in screen, a session-guarded product area, and 10 Playwright journeys that run against a real API and a real database. `npm run verify` exited `0`, `npm run test:e2e` reported `10 passed`, `npm run test:db` passed 103 tests, and the API suite passed 162 tests. No financial screen exists yet; the product area is the foundation shell only.

Phase 04 is implemented and has passed its quality gate. It owns `REQ-MEM-001`–`REQ-MEM-006`, `REQ-CONTRIB-001`–`REQ-CONTRIB-004`, and implemented member create/read/update, immutable `HY-MEM-0001` references allocated from a per-scope sequence with the UUID kept as the route identity, phone normalization and validation, free-text search, sort, and pagination, contribution periods with an expected amount whose received, remaining, and PAID / PARTIALLY PAID / NOT PAID status are derived from active member-contribution transactions, and the Members list and detail screens with a six-journey browser suite. `npm run test:e2e` reported `16 passed`, `npm run test:api` passed 241 tests, `npm run test:web` passed 134 tests, `npm run test:db` passed 103 tests, and `npm run verify` exited `0`. Two contract/document details were corrected (`DEC-068`, `DEC-073`) and one UI limitation was recorded rather than silently accepted: the contribution-period panel renders only the current business year with no year selector (`ISSUE-023`), while the API already supports `?year=` for any year.

Phase 05 is implemented and has passed its quality gate. It owns `REQ-INCOME-001`–`REQ-INCOME-006`, `REQ-DOC-010`–`REQ-DOC-014`, `REQ-FIN-015`–`REQ-FIN-020`, `REQ-FIN-022`, and `REQ-FIN-024`, and implemented the income create path with the four documented income types, member contribution periods derived from the business date, `HY-INC-*` reference allocation, a reason-required void workflow, audited corrections with `If-Match` optimistic locking, transactional idempotency, a read-only receipt projection that scopes anonymous identity, and the Income list and detail screens. `npm run test:e2e` reported `25 passed`, `npm run test:api` passed 334 tests across 24 suites, `npm run test:web` passed 235 tests, and `npm run test:db` passed 117 tests. Five defects were found and fixed, three of them production defects: a silently discarded member correction (`ISSUE-026`), a member contribution the form could not submit at all (`ISSUE-027`), and a member detail whose derived contribution status was never invalidated after a contribution, correction, or void (`ISSUE-029`). The other two were a test-harness defect that left the test database without its required settings (`ISSUE-028`) and a test locator that matched two tables (`ISSUE-030`).

## Next planned step

Close the Phase 05 Git gate: inspect the status, the diff, and the recent history, review the staged file list and secret safety, commit only the intended Phase 05 files, push to `origin/main` after the gate passes, verify the push, and record the verified hash in `PHASE-HISTORY.md`.

Then begin `PHASE-06-EXPENSES` by rereading the phase contract, `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `05-DATABASE-SPEC.md`, and `06-API-SPEC.md`, and planning the expense category, expense create, correction, and void work on top of the shared transaction layer Phase 05 established. `packages/contracts/src/expenses.ts` already exists as a contract scaffold and must be reviewed against the specification rather than assumed correct. Phase 07 remains out of scope.

## Blockers

No current blockers are known. Twelve advisories are recorded in `docs/runtime/ISSUES.md` (`ISSUE-011` through `ISSUE-016`, `ISSUE-021`, `ISSUE-022`, `ISSUE-023`, and the resolved `ISSUE-024`); none of them blocks the phase, and each records the condition that would require user approval. `ISSUE-021` (a new sign-in currently leaves an earlier session live), `ISSUE-022` (the login rate limit is per API process), and `ISSUE-023` (the contribution-period panel shows only the current business year) are recorded rather than silently decided, because no locked requirement owns any of those behaviors. `ISSUE-025` through `ISSUE-031` are resolved: the lost HTTP suite and its two follow-on findings, the test-database settings defect, the member-detail cache defect, the ambiguous journey locator, and the `npx playwright` rebuild trap. If a locked-requirement conflict, authorization need, secret requirement, or unsafe operation arises, record it in `docs/runtime/ISSUES.md` and stop.

## Authorization reminder

Work only inside the opened `HYSSOP-FINANCE` workspace. Do not access outside files, bypass security, or change unrelated system or Git configuration.
