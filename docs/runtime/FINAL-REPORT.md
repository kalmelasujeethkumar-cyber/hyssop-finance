# HYSSOP FINANCE — Final Report

## Document Responsibility

- Owns: final readiness status, consolidated evidence, limitations, defect status, and Git/deployment evidence.
- Does not own: current working state, decision history, issue details, or test specifications.
- Referenced by: external review and the final completion gate.
- Change rule: report only observed evidence; keep the status `NOT READY` until the implementation and QA requirements are actually satisfied.

**STATUS: BLOCKED — DEPLOYMENT NOT AUTHORIZED**

The complete local implementation and quality gate is green (Phases 01–11 implemented and pushed; Phase 12 adversarial QA passed with one mandated control gap found and fixed). The final status is not `READY` because Phase 12's required demo deployment (`TEST-DEPLOY-001`) has no authorized target: no hosting account has been accessed, no environment or database association exists, and no durable document-storage adapter has been selected. That is recorded `BLOCKED` as `ISSUE-051`. A local-only run is not a deployment, so this report does not claim one.

## Report identity

- Project: HYSSOP FINANCE
- Version or commit: Phase 11 verified commit `b9d14f0de6001736e139310e52b91a451b0aa00c` (`origin/main`); the Phase 12 rate-limit fix and documentation are local and their commit hash is recorded only after the Phase 12 Git gate and push verification succeed
- Report date: 2026-10-03
- Prepared by: OpenCode, Phase 12 final QA
- Deployment environment: **none** — no deployment target is authorized (`ISSUE-051`)
- Local run instructions: repository-root npm scripts (`npm run db:start`, `npm run db:migrate`, `npm run admin:bootstrap`, `npm run dev`), with configuration read from a repository-root `.env` (only `.env.example` is tracked)
- Demo login guidance: one Admin is provisioned through the approved `npm run admin:bootstrap` path; no credential is published in this report or in the repository

## Architecture status

- Modular-monolith status: implemented — one repository with `apps/api` (NestJS REST), `apps/web` (React/Vite), and `packages/contracts`, per `DEC-001`
- Frontend status: implemented — light-only white/blue/orange tokens, responsive accessible shell, every visible control calls a real authorized path
- Backend status: implemented — versioned REST, global error envelope, request IDs, validated configuration, structured redacting logs
- Database and Prisma status: implemented — PostgreSQL 16 with 6 reviewed forward migrations; money is exact `BIGINT` paise; database-enforced transaction, void, period, reference, and append-only audit invariants
- Authentication status: implemented — single Admin, Argon2id password hashing, opaque revocable server-side sessions, HTTP-only session cookie and CSRF cookie, origin-bound single-use pre-auth CSRF, login rate limiting
- Storage adapter status: implemented — reusable `DocumentStorage` abstraction with a project-controlled local adapter; bytes never stored in PostgreSQL
- Deployment status: **BLOCKED** — no authorized target (`ISSUE-051`)

## Phase status

| Phase | Status | Commit | Evidence |
|---|---|---|---|
| 00 Documentation Bootstrap | COMPLETE | `64245b74a78eb86ff12bb602d7c025ac9e7f1389` | Constitution, specifications, phase plan, runtime files |
| 01 Foundation | COMPLETE | `1a11d34af7d4ef3f8352cdaabf533b9056b21b7f` | Workspace, toolchain, API/web shells, full harness |
| 02 Database | COMPLETE | `84b5687189d58755438b13f0ea97cd82172958cf` | Schema, 2 reviewed migrations, invariants, seed, real-PostgreSQL tests |
| 03 Authentication | COMPLETE | `ab7847037120b3deeb519d053c11d4d09afc3746` | Admin bootstrap, sessions, CSRF, login rate limit, browser journeys |
| 04 Members | COMPLETE | `b1477379dee465c1129bb7a32e22a4c713e4d4ea` | Member CRUD, references, periods, ledger-derived status, screens |
| 05 Income | COMPLETE | `c639fa89504ee5be09e17d8bb2206b89139d9ccf` | Four income types, contributions, void, corrections, receipt |
| 06 Expenses | COMPLETE | `6a2ad41bcf40f6bfffd11b9a98ea1520db0cc479` | Expenses, custom categories, receipt-missing state |
| 07 Documents | COMPLETE | `2e1d778287da8d7c67c90cac2d25a63a80ba0e82` | Storage abstraction, upload, reason-required removal, `410` |
| 08 Dashboard | COMPLETE | `525493c63a99f43430558307401bf41ed4bca477` | Canonical calculation layer, presets, ledger balances, charts |
| 09 Reports | COMPLETE | `416080493a86fb827c597013518d7026b78c0198` | Eleven reports, search, CSV, print |
| 10 Audit and Settings | COMPLETE | `6a5b1785ffa890d50d284c8920897718a98eee31` | Audit history, limited settings, audited changes |
| 11 UI Integration | COMPLETE | `c94f1aa23ec58682080c36543ddb553cd3d5e6bf` | Responsive accessible shell, unsaved-work guard |
| 12 Final QA | LOCAL QUALITY GATE PASSED, DEPLOYMENT BLOCKED | pending Git gate | Adversarial QA, rate-limit fix, complete regression, deployment `BLOCKED` |

## Verification evidence

- Lint result: `eslint .` clean (`npm run verify`)
- Typecheck result: contracts + `apps/api` + `apps/web` `tsc --noEmit` clean, plus `typecheck:scripts` clean
- Unit test result: included in `npm run verify`; 21 web files / 501 tests
- Integration test result: covered by the API contract suites and the real-PostgreSQL suites below
- API test result: 38 suites / 770 tests
- Database test result: 13 suites / 250 real-PostgreSQL tests
- E2E result: `66 passed` Playwright journeys against the rebuilt bundle, a real API process, and a real PostgreSQL database; no rate-limit rejection appeared in the request log
- Financial calculation result: reconciled across dashboard, database, reports, method balances, transaction views, contribution status, and CSV by `reference-and-reconciliation.db-spec.ts` and `dashboard-projection.db-spec.ts`, re-run in this gate
- Document test result: upload, traversal, and stored-byte tests re-run in the DB and API suites; content routes return the exact uploaded bytes and `410 Gone` after removal
- Responsive and accessibility result: responsive shell journeys (desktop sidebar, mobile drawer, no overflow at 360–1440 px) pass; charts carry readable equivalents
- Security checks: no `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function`; opt-out-only global session guard; mandated upload/search/export/mutation rate limits implemented and tested (`TEST-SEC-001`); CSRF and authorization suites re-run
- Production build result: contracts declaration build, `nest build`, and `vite build` all pass
- Deployment and smoke-test result: **not performed** — no authorized deployment target (`ISSUE-051`)

## Financial integrity evidence

The documented financial scenario is verified by deterministic real-PostgreSQL tests rather than by rendered figures. `reference-and-reconciliation.db-spec.ts` and `dashboard-projection.db-spec.ts` reconcile the canonical projection against the ledger they write: prior-period history, an example method balance (a ₹20,000 receipt minus a ₹5,000 payment leaving the method negative), exclusion of voided rows from every active figure while retaining the row in the ledger, the member-count boundary at period end, and multi-month contribution buckets including an absent expected period shown as **Not configured**. Money is exact integer paise computed in PostgreSQL and transported as decimal strings; no authoritative browser-side calculation exists.

## Feature verification

| Feature | Status | Evidence |
|---|---|---|
| Authentication and logout | Pass | Contract and persistence suites assert Argon2id login, session revocation, CSRF cookie/token pair, `401`/`403` boundaries |
| Members and history | Pass | Member HTTP and persistence suites; browser journeys |
| Contribution periods and status | Pass | Ledger-derived received/remaining/status with void exclusion; real-PostgreSQL projection tests |
| All income types | Pass | Contract suite covers the four types, corrections, void, receipt, anonymous privacy |
| Expenses and custom categories | Pass | Contract suite; custom-category lifecycle with no delete |
| Payment-method balances | Pass | Dashboard projection reconciliation against the ledger |
| Documents and missing receipts | Pass | Upload, byte round-trip, reason-required removal, `410 Gone` |
| Dashboard and period filters | Pass | Presets, inclusive custom range, ending ledger balances, accessible charts |
| Reports, CSV, and print | Pass | Eleven reports, shared row cap, escaped CSV, print presentation |
| Audit history and settings | Pass | Read-only append-only log; limited settings with audited changes |
| Responsive and accessible controls | Pass | Desktop sidebar, mobile drawer, focus/scroll behavior, no horizontal overflow |

## Defects

| ID | Found in | Severity | Root cause | Fix | Regression evidence | Status |
|---|---|---|---|---|---|---|
| `ISSUE-050` | Phase 12 | Security control gap | `docs/07-SECURITY-RULES.md` required safe login/upload/search/export/mutation limits, but only the login limiter existed | General in-process `RequestRateLimiter`, global `RateLimitGuard` after `SessionGuard`, `@RateLimit` decorator, validated configuration (`DEC-106`) | `request-rate-limiter.service.spec.ts`, `rate-limit.guard.spec.ts`, and the real-HTTP `rate-limit-http.db-spec.ts` (`TEST-SEC-001`) for every category | RESOLVED |
| `ISSUE-051` | Phase 12 | Acceptance blocker | No authorized deployment target exists | None — recorded honestly, no external service touched | Local-only run explicitly is not a deployment | BLOCKED |

Earlier phase defects (`ISSUE-011` through `ISSUE-049`) are individually recorded with root cause and regression evidence in `docs/runtime/ISSUES.md` and the per-phase tables in `docs/runtime/TEST-RESULTS.md`; all are resolved except the non-blocking advisories listed under known limitations.

## Known limitations

- Hosted deployment and hosted document storage are unverified because no deployment target is authorized (`ISSUE-051`). This is the one open `BLOCKED` item.
- The upload/search/export/mutation rate limit is enforced per API process (`ISSUE-022`, `DEC-106`), so a future multi-instance deployment would need a shared store.
- A successful sign-in does not replace an earlier live session (`ISSUE-021`); no locked requirement specifies single-session enforcement.
- The contribution-period panel shows only the current business year with no year selector (`ISSUE-023`); the API accepts any year.
- `ISSUE-011`–`ISSUE-016` remain recorded toolchain and infrastructure advisories (Nest CLI Node engine warning, NestJS legacy-route advisory, partial-index deviation, a Prisma-CLI-only dependency advisory, the Prisma 7 configuration deprecation, and the unverified Docker/Compose path). None affects required demo behavior.

## Deferred to production

- Hosted object storage and the durable deployment (behind the existing `DocumentStorage` abstraction).
- A shared rate-limit store for multi-instance deployments.
- Monitoring, backups, and expanded church configuration.
- Richer roles beyond the single demo Admin.

## Security and secret review

- Tracked secret scan: changed and added files were scanned for credentials; no Argon2 hash, JWT, private key, token prefix, or literal password was found
- `.env` protection: `.env` is ignored and untracked; only `.env.example` is tracked
- Upload and document access review: byte-content detection, invalid-key and traversal rejection, session and CSRF enforcement, `410 Gone` after removal
- Authentication and authorization review: single Admin, server-side revocable sessions, origin-bound single-use pre-auth CSRF, opt-out-only global session guard
- External service authorization status: **none** — no service was authorized or accessed

## Git evidence

- Authorized remote: `https://github.com/kalmelasujeethkumar-cyber/hyssop-finance.git` (`origin`)
- Branch: `main`
- Final commit: pending the Phase 12 Git gate; the recorded pre-Phase-12 state is `b9d14f0de6001736e139310e52b91a451b0aa00c` (`origin/main`)
- Push verification: to be recorded in `docs/runtime/PHASE-HISTORY.md` only after the push is verified
- Recent history: Phases 01–11 are closed and pushed; the Phase 12 rate-limit fix and these documentation updates are the pending change set
