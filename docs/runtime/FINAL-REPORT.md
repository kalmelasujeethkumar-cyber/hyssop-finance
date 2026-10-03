# HYSSOP FINANCE — Final Report

## Document Responsibility

- Owns: final readiness status, consolidated evidence, limitations, defect status, and Git/deployment evidence.
- Does not own: current working state, decision history, issue details, or test specifications.
- Referenced by: external review and the final completion gate.
- Change rule: report only observed evidence; keep the status `NOT READY` until the implementation and QA requirements are actually satisfied.

**STATUS: NOT READY — DEPLOYMENT CONFIGURED, HOSTED VERIFICATION PENDING**

The complete local implementation and quality gate is green (Phases 01–11 implemented and pushed; Phase 12 adversarial QA passed with one mandated control gap found and fixed). The final status is not `READY` because Phase 12's required demo deployment (`TEST-DEPLOY-001`) has not been performed or smoke-tested. Netlify is authorized as the frontend target (`DEC-013`) and the `TS2307 Cannot find module '@hyssop/contracts'` build failure is fixed by a repository-root `netlify.toml` that compiles the contracts package before the web app (`DEC-107`), verified locally; but no hosted deployment exists yet, `VITE_API_BASE_URL` is not set on a host, the separate backend, PostgreSQL, and durable document-storage targets are not associated, and no live URL has been smoke-tested. That is recorded `OPEN` as `ISSUE-051`. A local-only run is not a deployment, so this report does not claim one.

## Report identity

- Project: HYSSOP FINANCE
- Version or commit: Phase 12 verified commit `c1314b69a0d73c289136346caa6741472fb5b897` (`origin/main`); the preceding Phase 11 verified state was `b9d14f0de6001736e139310e52b91a451b0aa00c`
- Report date: 2026-10-03
- Prepared by: OpenCode, Phase 12 final QA
- Deployment environment: **Netlify authorized frontend target, not accessed from this workspace** — a repository-root `netlify.toml` fixes the `TS2307` workspace-resolution build failure (`DEC-107`), and the hosted deployment is unverified (`ISSUE-051`)
- Local run instructions: repository-root npm scripts (`npm run db:start`, `npm run db:migrate`, `npm run admin:bootstrap`, `npm run dev`), with configuration read from a repository-root `.env` (only `.env.example` is tracked)
- Demo login guidance: one Admin is provisioned through the approved `npm run admin:bootstrap` path; no credential is published in this report or in the repository

## Architecture status

- Modular-monolith status: implemented — one repository with `apps/api` (NestJS REST), `apps/web` (React/Vite), and `packages/contracts`, per `DEC-001`
- Frontend status: implemented — light-only white/blue/orange tokens, responsive accessible shell, every visible control calls a real authorized path
- Backend status: implemented — versioned REST, global error envelope, request IDs, validated configuration, structured redacting logs
- Database and Prisma status: implemented — PostgreSQL 16 with 6 reviewed forward migrations; money is exact `BIGINT` paise; database-enforced transaction, void, period, reference, and append-only audit invariants
- Authentication status: implemented — single Admin, Argon2id password hashing, opaque revocable server-side sessions, HTTP-only session cookie and CSRF cookie, origin-bound single-use pre-auth CSRF, login rate limiting
- Storage adapter status: implemented — reusable `DocumentStorage` abstraction with a project-controlled local adapter; bytes never stored in PostgreSQL
- Deployment status: **NOT READY** — build config added and locally verified, hosted deployment pending (`ISSUE-051`)

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
| 12 Final QA | LOCAL QUALITY GATE PASSED, GIT GATE PASSED, DEPLOYMENT BUILD CONFIG ADDED | `c1314b69a0d73c289136346caa6741472fb5b897` | Adversarial QA, rate-limit fix, complete regression, Netlify build config added and locally verified, hosted deployment pending (`ISSUE-051`) |

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
- Deployment and smoke-test result: **not performed from this workspace** — Netlify is the authorized frontend target and a repository-root `netlify.toml` fixes the `TS2307` workspace-resolution build failure (`DEC-107`), locally verified; the hosted redeploy and `TEST-DEPLOY-001` smoke test remain pending (`ISSUE-051`)

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
| `ISSUE-051` | Phase 12 | Acceptance item | Netlify frontend build failed with `TS2307 Cannot find module '@hyssop/contracts'` because the workspace-linked contracts package's generated `dist/` was not built before the web typecheck, and no hosted deployment exists | Added a repository-root `netlify.toml` that builds contracts before the web app (`DEC-107`); no external service touched | Local `build:contracts` clean, `build:web` has no TypeScript error, and `npm run verify` exits `0`; hosted smoke test still pending | OPEN |

Earlier phase defects (`ISSUE-011` through `ISSUE-049`) are individually recorded with root cause and regression evidence in `docs/runtime/ISSUES.md` and the per-phase tables in `docs/runtime/TEST-RESULTS.md`; all are resolved except the non-blocking advisories listed under known limitations.

## Known limitations

- Hosted deployment and hosted document storage are unverified: Netlify is authorized as the frontend target and its build configuration is fixed and locally verified (`DEC-107`), but no hosted deployment exists and no backend, PostgreSQL, or document-storage target is associated (`ISSUE-051`). This is the one open item.
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
- External service authorization status: Netlify is authorized as the frontend target (`DEC-013`) but was not accessed from this workspace; the repository-root `netlify.toml` is a local configuration change (`DEC-107`), and no external service was contacted or configured

## Git evidence

- Authorized remote: `https://github.com/kalmelasujeethkumar-cyber/hyssop-finance.git` (`origin`)
- Branch: `main`
- Final commit: `c1314b69a0d73c289136346caa6741472fb5b897` (`origin/main`)
- Push verification: `main` pushed to `origin/main` (`b9d14f0..c1314b6`); after a fresh `git fetch`, both `git rev-parse HEAD` and `git rev-parse origin/main` return `c1314b69a0d73c289136346caa6741472fb5b897`
- Recent history: Phases 01–11 are closed and pushed; the Phase 12 rate-limit fix and QA evidence are committed as `c1314b69a0d73c289136346caa6741472fb5b897`
- Deployment build configuration: `e68cc9199c96c07130e6b6b342e811d5a7b62873` (`origin/main`), the repository-root `netlify.toml` (`DEC-107`) that builds `@hyssop/contracts` before the web app; pushed and verified after a fresh `git fetch`
