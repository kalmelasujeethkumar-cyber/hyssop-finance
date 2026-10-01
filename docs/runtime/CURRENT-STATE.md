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

- Current stage: **PHASE 05 — INCOME (COMPLETE), PHASE 06 — EXPENSES (QUALITY GATE PASSED, GIT GATE PENDING)**
- Current phase: `PHASE-06-EXPENSES`
- Status: **PHASE 06 QUALITY GATE PASSED ON 2026-10-01; GIT GATE PENDING**
- Next gate: the Phase 06 Git gate, then `PHASE-07-DOCUMENTS`
- Phase 06: **IMPLEMENTED AND VERIFIED**; expense create, read, correction, void, category lifecycle, and the **Receipt Missing** state are implemented and covered by API, web, real-database, and browser tests
- Phase 07: **NOT STARTED**; document upload, download, and the storage adapter remain out of scope for every phase completed so far
- Application implementation: **PHASE 01, PHASE 02, PHASE 03, PHASE 04, AND PHASE 05 COMPLETE** (foundation, persistence, authentication, members, and income); Phase 06 is implemented and quality-gated
- Documentation: Prompt 01 baseline and Prompt 01B hardening pushed; Phase 01, Phase 02, Phase 03, Phase 04, and Phase 05 gates closed with recorded evidence; Phase 06 gate recorded, Git gate pending
- Database migrations: **5 REVIEWED MIGRATIONS APPLIED** to `hyssop_finance_dev` and `hyssop_finance_test`; Phase 06 added none, because `expense_category` and the expense columns were created and reviewed in Phase 02
- External services: **NOT CONFIGURED**

## Progress

Prompt 01 established the project constitution, specifications, phase plan, runtime tracking, Git safety, and verification framework. Its checkpoint commit `64245b74a78eb86ff12bb602d7c025ac9e7f1389` and evidence commit `2c0e56586f286cd074c8fb581e6721c6555d148c` were pushed to `origin/main`.

Prompt 01B reread the full specification, phase, and runtime set; added the document ownership map and per-document responsibility boundaries; introduced 119 stable `REQ-*` and 24 stable `TEST-*` identifiers; created and audited `docs/14-TRACEABILITY-MATRIX.md`; defined the canonical financial calculation layer; and resolved phase dependency overlaps.

Phase 01 is complete. It owns `REQ-AUTH-001`, `REQ-AUTH-006`, and `REQ-FIN-026` and implemented the technical foundation: npm workspace, pinned toolchain, `apps/api` with structured logging, security headers, explicit CORS, the global error envelope, request IDs, and `GET /api/v1/health`; `apps/web` with design tokens, routing, an honest error boundary, and a real connectivity check; `packages/contracts`; and the lint, typecheck, test, build, and browser-smoke harnesses.

Phase 02 is complete. It owns `REQ-FIN-001`, `REQ-FIN-002`, `REQ-FIN-003`, `REQ-FIN-021`, and `REQ-FIN-023` and implemented the canonical Prisma schema with two reviewed migrations, exact `BIGINT` paise money, database-enforced transaction, void, period, reference, and append-only audit invariants, transactional idempotency, reconciliation queries, a fictional idempotent seed, a disposable local PostgreSQL 16 workflow, and 48 real-database tests.

Phase 03 is implemented and has passed its quality gate. It owns the authentication requirements and implemented the single-Admin account with an Argon2id password hash, a one-time `npm run admin:bootstrap` that revokes the previous Admin's sessions, opaque server-side sessions stored as SHA-256 hashes with real revocation, an HTTP-only session cookie and a script-readable CSRF cookie, origin-bound single-use pre-authentication CSRF enforced with a constant-time comparison, login rate limiting, a sign-in screen, a session-guarded product area, and 10 Playwright journeys that run against a real API and a real database. `npm run verify` exited `0`, `npm run test:e2e` reported `10 passed`, `npm run test:db` passed 103 tests, and the API suite passed 162 tests. No financial screen exists yet; the product area is the foundation shell only.

Phase 04 is implemented and has passed its quality gate. It owns `REQ-MEM-001`–`REQ-MEM-006`, `REQ-CONTRIB-001`–`REQ-CONTRIB-004`, and implemented member create/read/update, immutable `HY-MEM-0001` references allocated from a per-scope sequence with the UUID kept as the route identity, phone normalization and validation, free-text search, sort, and pagination, contribution periods with an expected amount whose received, remaining, and PAID / PARTIALLY PAID / NOT PAID status are derived from active member-contribution transactions, and the Members list and detail screens with a six-journey browser suite. `npm run test:e2e` reported `16 passed`, `npm run test:api` passed 241 tests, `npm run test:web` passed 134 tests, `npm run test:db` passed 103 tests, and `npm run verify` exited `0`. Two contract/document details were corrected (`DEC-068`, `DEC-073`) and one UI limitation was recorded rather than silently accepted: the contribution-period panel renders only the current business year with no year selector (`ISSUE-023`), while the API already supports `?year=` for any year.

Phase 05 is implemented and has passed its quality gate. It owns `REQ-INCOME-001`–`REQ-INCOME-006`, `REQ-DOC-010`–`REQ-DOC-014`, `REQ-FIN-015`–`REQ-FIN-020`, `REQ-FIN-022`, and `REQ-FIN-024`, and implemented the income create path with the four documented income types, member contribution periods derived from the business date, `HY-INC-*` reference allocation, a reason-required void workflow, audited corrections with `If-Match` optimistic locking, transactional idempotency, a read-only receipt projection that scopes anonymous identity, and the Income list and detail screens. `npm run test:e2e` reported `25 passed`, `npm run test:api` passed 334 tests across 24 suites, `npm run test:web` passed 235 tests, and `npm run test:db` passed 117 tests. Five defects were found and fixed, three of them production defects: a silently discarded member correction (`ISSUE-026`), a member contribution the form could not submit at all (`ISSUE-027`), and a member detail whose derived contribution status was never invalidated after a contribution, correction, or void (`ISSUE-029`). The other two were a test-harness defect that left the test database without its required settings (`ISSUE-028`) and a test locator that matched two tables (`ISSUE-030`).

Phase 06 is implemented and has passed its quality gate. It owns `REQ-EXP-001`–`REQ-EXP-004` and `REQ-DOC-003`, and implemented the expense create path with exact paise amounts, the three shared payment methods, Asia/Kolkata business dates, `HY-EXP-*` reference allocation, an active-category rule enforced by the database as well as the API, a reason-required void, audited corrections behind `If-Match` optimistic locking, transactional idempotency, the custom-category lifecycle with rename and deactivation and no delete route, the derived **Receipt Missing** state, and the Expenses list and detail screens. `npm run verify` exited `0` (418 API tests across 25 suites, 325 web tests, both builds, lint, typecheck, format), `npm run typecheck:scripts` was clean, `npm run test:db` passed 136 tests across 8 suites, `npm run db:validate`, `db:status`, and `db:drift` all passed with no drift, and `npm run test:e2e` reported `35 passed`, which includes the 10 new expense journeys and all 25 pre-existing journeys. Phase 06 added no migration, because `expense_category` and the expense transaction columns were created and reviewed in Phase 02. Four findings were recorded and fixed: a shared transaction projection that dropped an expense's category and receipt state (`ISSUE-032`, a production defect), an invalid nested-form markup defect in the inline category panel (`ISSUE-033`, a production defect), a browser harness with no categories after a database-test run (`ISSUE-034`), and four test defects in the new journeys, one of which asserted the stub client's wording rather than the API's (`ISSUE-035`). `DEC-079` through `DEC-083` record the transaction projection, inline-form markup, harness provisioning, receipt state, and duplicate-category decisions.

## Next planned step

Close the Phase 06 Git gate: inspect the status, the diff, and the recent history, review the staged file list and secret safety, commit only the intended Phase 06 files, push to `origin/main` after the gate passes, verify the push, and record the verified hash in `PHASE-HISTORY.md`.

The Phase 05 Git gate is closed: 45 files were committed as `c639fa89504ee5be09e17d8bb2206b89139d9ccf` and pushed to `origin/main`, and the local and remote hashes match.

Then begin `PHASE-07-DOCUMENTS` by rereading the phase contract, `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `05-DATABASE-SPEC.md`, `06-API-SPEC.md`, and `07-SECURITY-RULES.md`, and implementing the reusable storage subsystem and document lifecycle that Phase 06 deliberately left out. Phase 06 exposed only the association integration points that Phase 07 consumes, and the expense screens state **Receipt Missing** in words because no attach control may exist yet; that state is what Phase 07 replaces. Do not treat Phase 07 as started until its own plan is recorded.

## Blockers

No current blockers are known. Twelve advisories are recorded in `docs/runtime/ISSUES.md` (`ISSUE-011` through `ISSUE-016`, `ISSUE-021`, `ISSUE-022`, `ISSUE-023`, and the resolved `ISSUE-024`); none of them blocks the phase, and each records the condition that would require user approval. `ISSUE-021` (a new sign-in currently leaves an earlier session live), `ISSUE-022` (the login rate limit is per API process), and `ISSUE-023` (the contribution-period panel shows only the current business year) are recorded rather than silently decided, because no locked requirement owns any of those behaviors. `ISSUE-025` through `ISSUE-035` are resolved: the lost HTTP suite and its two follow-on findings, the test-database settings defect, the member-detail cache defect, the ambiguous journey locator, the `npx playwright` rebuild trap, and the four Phase 06 findings. If a locked-requirement conflict, authorization need, secret requirement, or unsafe operation arises, record it in `docs/runtime/ISSUES.md` and stop.

## Authorization reminder

Work only inside the opened `HYSSOP-FINANCE` workspace. Do not access outside files, bypass security, or change unrelated system or Git configuration.
