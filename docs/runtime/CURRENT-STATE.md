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

- Current stage: **PHASE 03 — AUTH**
- Current phase: `PHASE-03-AUTH`
- Status: **PHASE 03 QUALITY GATE PASSED; GIT GATE IN PROGRESS**
- Next gate: commit the Phase 03 implementation, push it to `origin/main`, verify the remote hash, and record that evidence
- Phase 04: **NOT STARTED**; it must not begin before the Phase 03 Git gate closes
- Application implementation: **PHASE 01, PHASE 02, AND PHASE 03 IMPLEMENTED** (foundation, persistence, and authentication)
- Documentation: Prompt 01 baseline and Prompt 01B hardening pushed; Phase 01 and Phase 02 gates closed with recorded evidence; Phase 03 evidence is written and awaits the Git gate
- Database migrations: **3 REVIEWED MIGRATIONS APPLIED** to `hyssop_finance_dev` and `hyssop_finance_test`, with `npm run db:drift` reporting no difference
- External services: **NOT CONFIGURED**

## Progress

Prompt 01 established the project constitution, specifications, phase plan, runtime tracking, Git safety, and verification framework. Its checkpoint commit `64245b74a78eb86ff12bb602d7c025ac9e7f1389` and evidence commit `2c0e56586f286cd074c8fb581e6721c6555d148c` were pushed to `origin/main`.

Prompt 01B reread the full specification, phase, and runtime set; added the document ownership map and per-document responsibility boundaries; introduced 119 stable `REQ-*` and 24 stable `TEST-*` identifiers; created and audited `docs/14-TRACEABILITY-MATRIX.md`; defined the canonical financial calculation layer; and resolved phase dependency overlaps.

Phase 01 is complete. It owns `REQ-AUTH-001`, `REQ-AUTH-006`, and `REQ-FIN-026` and implemented the technical foundation: npm workspace, pinned toolchain, `apps/api` with structured logging, security headers, explicit CORS, the global error envelope, request IDs, and `GET /api/v1/health`; `apps/web` with design tokens, routing, an honest error boundary, and a real connectivity check; `packages/contracts`; and the lint, typecheck, test, build, and browser-smoke harnesses.

Phase 02 is complete. It owns `REQ-FIN-001`, `REQ-FIN-002`, `REQ-FIN-003`, `REQ-FIN-021`, and `REQ-FIN-023` and implemented the canonical Prisma schema with two reviewed migrations, exact `BIGINT` paise money, database-enforced transaction, void, period, reference, and append-only audit invariants, transactional idempotency, reconciliation queries, a fictional idempotent seed, a disposable local PostgreSQL 16 workflow, and 48 real-database tests.

Phase 03 is implemented and has passed its quality gate. It owns the authentication requirements and implemented the single-Admin account with an Argon2id password hash, a one-time `npm run admin:bootstrap` that revokes the previous Admin's sessions, opaque server-side sessions stored as SHA-256 hashes with real revocation, an HTTP-only session cookie and a script-readable CSRF cookie, origin-bound single-use pre-authentication CSRF enforced with a constant-time comparison, login rate limiting, a sign-in screen, a session-guarded product area, and 10 Playwright journeys that run against a real API and a real database. `npm run verify` exited `0`, `npm run test:e2e` reported `10 passed`, `npm run test:db` passed 103 tests, and the API suite passed 162 tests. No financial screen exists yet; the product area is the foundation shell only.

## Next planned step

Close the Phase 03 Git gate: commit the intended files, push to `origin/main`, verify that the remote hash matches, and record the verified hash in `docs/runtime/PHASE-HISTORY.md` and `docs/runtime/TEST-RESULTS.md` as an evidence-only commit. Then stop for review; `PHASE-04-FINANCIAL` requires explicit approval before any work starts.

## Blockers

No current blockers are known. Eight advisories are recorded in `docs/runtime/ISSUES.md` (`ISSUE-011` through `ISSUE-016`, plus `ISSUE-021` and `ISSUE-022`); none of them blocks the phase, and each records the condition that would require user approval. `ISSUE-021` (a new sign-in currently leaves an earlier session live) and `ISSUE-022` (the login rate limit is per API process) are recorded rather than silently decided, because no locked requirement owns either behavior. If a locked-requirement conflict, authorization need, secret requirement, or unsafe operation arises, record it in `docs/runtime/ISSUES.md` and stop.

## Authorization reminder

Work only inside the opened `HYSSOP-FINANCE` workspace. Do not access outside files, bypass security, or change unrelated system or Git configuration.
