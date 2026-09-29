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

- Current stage: **PHASE 04 — MEMBERS**
- Current phase: `PHASE-04-MEMBERS`
- Status: **PHASE 04 QUALITY GATE PASSED; GIT GATE CLOSED AWAITING EXTERNAL REVIEW**
- Next gate: external review of the Phase 04 checkpoint
- Phase 05: **NOT STARTED**; it must not begin before the Phase 04 checkpoint is approved
- Application implementation: **PHASE 01, PHASE 02, PHASE 03, AND PHASE 04 COMPLETE** (foundation, persistence, authentication, and members)
- Documentation: Prompt 01 baseline and Prompt 01B hardening pushed; Phase 01, Phase 02, Phase 03, and Phase 04 gates closed with recorded evidence
- Database migrations: **4 REVIEWED MIGRATIONS APPLIED** to `hyssop_finance_dev` and `hyssop_finance_test`, with `npm run db:drift` reporting no difference
- External services: **NOT CONFIGURED**

## Progress

Prompt 01 established the project constitution, specifications, phase plan, runtime tracking, Git safety, and verification framework. Its checkpoint commit `64245b74a78eb86ff12bb602d7c025ac9e7f1389` and evidence commit `2c0e56586f286cd074c8fb581e6721c6555d148c` were pushed to `origin/main`.

Prompt 01B reread the full specification, phase, and runtime set; added the document ownership map and per-document responsibility boundaries; introduced 119 stable `REQ-*` and 24 stable `TEST-*` identifiers; created and audited `docs/14-TRACEABILITY-MATRIX.md`; defined the canonical financial calculation layer; and resolved phase dependency overlaps.

Phase 01 is complete. It owns `REQ-AUTH-001`, `REQ-AUTH-006`, and `REQ-FIN-026` and implemented the technical foundation: npm workspace, pinned toolchain, `apps/api` with structured logging, security headers, explicit CORS, the global error envelope, request IDs, and `GET /api/v1/health`; `apps/web` with design tokens, routing, an honest error boundary, and a real connectivity check; `packages/contracts`; and the lint, typecheck, test, build, and browser-smoke harnesses.

Phase 02 is complete. It owns `REQ-FIN-001`, `REQ-FIN-002`, `REQ-FIN-003`, `REQ-FIN-021`, and `REQ-FIN-023` and implemented the canonical Prisma schema with two reviewed migrations, exact `BIGINT` paise money, database-enforced transaction, void, period, reference, and append-only audit invariants, transactional idempotency, reconciliation queries, a fictional idempotent seed, a disposable local PostgreSQL 16 workflow, and 48 real-database tests.

Phase 03 is implemented and has passed its quality gate. It owns the authentication requirements and implemented the single-Admin account with an Argon2id password hash, a one-time `npm run admin:bootstrap` that revokes the previous Admin's sessions, opaque server-side sessions stored as SHA-256 hashes with real revocation, an HTTP-only session cookie and a script-readable CSRF cookie, origin-bound single-use pre-authentication CSRF enforced with a constant-time comparison, login rate limiting, a sign-in screen, a session-guarded product area, and 10 Playwright journeys that run against a real API and a real database. `npm run verify` exited `0`, `npm run test:e2e` reported `10 passed`, `npm run test:db` passed 103 tests, and the API suite passed 162 tests. No financial screen exists yet; the product area is the foundation shell only.

Phase 04 is implemented and has passed its quality gate. It owns `REQ-MEM-001`–`REQ-MEM-006`, `REQ-CONTRIB-001`–`REQ-CONTRIB-004`, and implemented member create/read/update, immutable `HY-MEM-0001` references allocated from a per-scope sequence with the UUID kept as the route identity, phone normalization and validation, free-text search, sort, and pagination, contribution periods with an expected amount whose received, remaining, and PAID / PARTIALLY PAID / NOT PAID status are derived from active member-contribution transactions, and the Members list and detail screens with a six-journey browser suite. `npm run test:e2e` reported `16 passed`, `npm run test:api` passed 241 tests, `npm run test:web` passed 134 tests, `npm run test:db` passed 103 tests, and `npm run verify` exited `0`. Two contract/document details were corrected (`DEC-068`, `DEC-073`) and one UI limitation was recorded rather than silently accepted: the contribution-period panel renders only the current business year with no year selector (`ISSUE-023`), while the API already supports `?year=` for any year.

## Next planned step

The Phase 04 Git gate is closed: the Phase 04 commit was pushed to `origin/main` and the remote hash matches. Phase 04 is stopped here for review; `PHASE-05-INCOME` requires explicit approval before any work starts.

On 2026-09-29, after the editing session was closed accidentally, the whole Phase 04 gate was re-executed against the committed tree rather than assumed. Every command passed again with identical test counts — 241 API tests, 134 web tests, 103 real-PostgreSQL tests, and `16 passed` Playwright journeys — and `npm run verify` exited `0`. No work was lost and nothing was re-implemented; the evidence is recorded in `TEST-RESULTS.md`.

## Blockers

No current blockers are known. Ten advisories are recorded in `docs/runtime/ISSUES.md` (`ISSUE-011` through `ISSUE-016`, `ISSUE-021`, `ISSUE-022`, `ISSUE-023`, and the resolved `ISSUE-024`); none of them blocks the phase, and each records the condition that would require user approval. `ISSUE-021` (a new sign-in currently leaves an earlier session live), `ISSUE-022` (the login rate limit is per API process), and `ISSUE-023` (the contribution-period panel shows only the current business year) are recorded rather than silently decided, because no locked requirement owns any of those behaviors. If a locked-requirement conflict, authorization need, secret requirement, or unsafe operation arises, record it in `docs/runtime/ISSUES.md` and stop.

## Authorization reminder

Work only inside the opened `HYSSOP-FINANCE` workspace. Do not access outside files, bypass security, or change unrelated system or Git configuration.
