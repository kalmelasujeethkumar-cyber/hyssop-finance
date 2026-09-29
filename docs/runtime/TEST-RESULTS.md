# HYSSOP FINANCE — Test Results

## Document Responsibility

- Owns: executed commands, environment assumptions, results, failures, fixes, retests, and evidence locations.
- Does not own: test specifications, product requirements, technical decisions, or planned scenarios.
- Referenced by: `10-TEST-PLAN.md`, `11-DEFINITION-OF-DONE.md`, and phase completion gates.
- Change rule: record objective run evidence; never convert a planned test or self-assessment into a passing result.

## Current status

**The Phase 04 members quality gate passed on 2026-09-28 and its Git gate is closed: commit `b1477379dee465c1129bb7a32e22a4c713e4d4ea` is pushed to `origin/main` and the remote hash matches. `npm run verify` exited `0` and `npm run test:e2e` reported `16 passed`. Phase 03 remains closed with commit `ab7847037120b3deeb519d053c11d4d09afc3746`. No phase is marked `COMPLETE` until its Git gate evidence is recorded below.**

**The whole Phase 04 gate was independently re-executed on 2026-09-29 after an accidental editor close, and every command passed again against the same committed tree; see "Phase 04 re-verification after the accidental session close" below. Phase 05 has not started.**

Phase 04 implemented the Members domain: member create/read/update, `HY-MEM-0001` reference allocation, name/phone/notes validation, search, sorting, pagination, contribution periods with an expected amount, ledger-derived received/remaining/status projections, and the Members list and detail screens with browser journeys that prove the whole stack against a real API and a real PostgreSQL database.

## Phase 04 members gate

Phase 04 owns `REQ-MEM-001`–`REQ-MEM-006`, `REQ-CONTRIB-001`–`REQ-CONTRIB-004`, and the search/derived-status portions consumed by later phases. All evidence below is from the final run on 2026-09-28 after the defects in the Phase 04 defects table were fixed.

Environment assumptions: unchanged (Windows, Node `22.19.0`, npm `10.9.3`, PowerShell 5.1, project-local PostgreSQL `16` on loopback port `55432`, `hyssop_finance_dev` and `hyssop_finance_test`). The Playwright run provisions its own Admin with a random password generated in memory, applies migrations to the `_test` database, and never reads or prints a real credential. `hyssop_finance_test` is not reset between runs, so the browser suite uses unique member names and phone numbers each run.

| Command | Result | Evidence |
|---|---|---|
| `npm run lint` | Pass | `eslint .` reported no problems |
| `npm run format:check` | Pass | `All matched files use Prettier code style!` after one `npm run format` pass over the two phase files that had drifted |
| `npm run typecheck` | Pass | Contracts build, `apps/api` and `apps/web` `tsc --noEmit` all clean, including the Playwright specs under `apps/web/e2e` |
| `npm run typecheck:scripts` | Pass | `tsc -p tsconfig.scripts.json --noEmit` clean |
| `npm run test:api` | Pass | 23 suites, 241 tests (member repository, member search, members HTTP, phone, envelope, and the Phase 03/02 regression suites) |
| `npm run test:web` | Pass | 8 files, 134 tests (Members page, member detail/form, money utilities, and the Phase 03/02 regression suites) |
| `npm run db:validate` | Pass | `The schema at prisma\schema.prisma is valid` |
| `npm run db:status` | Pass | `4 migrations found` and `Database schema is up to date!`, so the contribution-period audit migration matches the applied history |
| `npm run db:drift` | Pass | `migration history vs prisma/schema.prisma: no difference detected` and `hyssop_finance_dev vs prisma/schema.prisma: no difference detected`, then the disposable shadow database was dropped |
| `npm run test:db` | Pass | 6 suites, 103 tests against real PostgreSQL, including the contribution-period and member suites and the unchanged Phase 02 financial suites |
| `npm run build` | Pass | Contracts declaration build, `nest build` for `apps/api`, and `vite build` for `apps/web` (`✓ built in 355ms`) |
| `npm run test:e2e` | Pass after three defect fixes | 16 Playwright tests (`16 passed (15.2s)`), covering the foundation journeys plus six `member management` journeys: screen controls live, create + open + set expected monthly amount, edit with optimistic lock, search by name/reference/phone, pagination, and sort/order |
| `npm run verify` | Pass | The full gate exited `0`: lint, typecheck, contracts build, script typecheck, 241 API tests, 134 web tests, both production builds, and format check |
| Browser journey evidence | Pass | Each journey signs in through the real login API, then: creates a member and reads its `HY-MEM-*` reference from the success banner; opens the detail page whose URL is the canonical UUID; sets an expected monthly amount for the current Asia/Kolkata month and sees the derived `Sep 2026 ₹500.00 ₹0.00 ₹500.00 Not paid` row in the same panel; edits the name through the edit form and sees the confirmation and updated heading; searches by the generated name, its `HY-MEM` reference, and the phone; pages through the list with `Per page` controls; and switches sort field/order without leaking a reference ID into the URL path |
| Optimistic-lock evidence | Pass | The API suite asserts a stale `If-Match`/revision returns `409` with code `CONFLICT` and does not overwrite persisted state; the browser suite edits once and verifies the confirmation text |
| Reference evidence | Pass | `member-search.spec.ts` and `members-http.e2e-spec.ts` verify allocation returns sequential `HY-MEM-` references and that the API path always uses the UUID, never the reference |
| Secret and staged-file review | Pass | A credential-pattern scan over all changed and added files matched no Argon2 hash, JWT, private key, token prefix, or literal password. `.env` is ignored and untracked, only `.env.example` is tracked with every value commented out, and no build output, dependency, Playwright report, or local database artifact is staged |
| Traceability review | Pass | No `REQ-*` or `TEST-*` identifier was added, removed, or renumbered, so `docs/14-TRACEABILITY-MATRIX.md` needed no edit. Re-verified mechanically after the implementation |
| Git gate | Pass | Intended files committed and pushed to `origin/main`; `git rev-parse HEAD` and `git rev-parse origin/main` both return the Phase 04 hash after a fresh `git fetch` |

## Phase 04 re-verification after the accidental session close

On 2026-09-29 the editing session was closed accidentally and reopened. No work was lost: the working tree was clean, `git status` reported nothing to commit, and `HEAD` already held the Phase 04 implementation commit `b1477379dee465c1129bb7a32e22a4c713e4d4ea` plus the evidence commit `25bac9fdcb1cc269e55d88a33773f170c3c8d060`, both equal to the locally known `origin/main`. Phase 04 was therefore neither restarted nor re-implemented.

Because the recorded evidence is only trustworthy if it is reproducible, every mandatory gate was re-executed against the committed tree rather than being assumed. All of them passed, and the test counts are identical to the 2026-09-28 run, which independently corroborates the committed evidence.

| Command | Result | Evidence |
|---|---|---|
| `npm run lint` | Pass | `eslint .` exited `0` with no reported problems |
| `npm run format:check` | Pass | `All matched files use Prettier code style!` |
| `npm run typecheck` | Pass | Contracts build plus `apps/api` and `apps/web` `tsc --noEmit`, all clean |
| `npm run typecheck:scripts` | Pass | `tsc -p tsconfig.scripts.json` exited `0` |
| `npm run test:api` | Pass | 23 suites, 241 tests, identical to the 2026-09-28 count |
| `npm run test:web` | Pass | 8 files, 134 tests, identical to the 2026-09-28 count |
| `npm run build` | Pass | Contracts build, `nest build`, and `vite build` (`✓ built in 344ms`) |
| `npm run verify` | Pass | The full gate exited `0` |
| `npm run db:validate` | Pass | `The schema at prisma\schema.prisma is valid` |
| `npm run db:status` | Pass | `4 migrations found` and `Database schema is up to date!` |
| `npm run db:seed` | Pass | `Members: 8`, `Contribution periods: 24`, `Transactions created this run: 48` on a freshly initialised cluster, matching the documented seed totals |
| `npm run db:drift` | Pass | `No difference detected.` for both the migration history and the live development database, then the disposable shadow database was dropped |
| `npm run test:db` | Pass | 6 suites, 103 tests against real PostgreSQL, identical to the 2026-09-28 count |
| `npm run test:e2e` | Pass | `16 passed (21.7s)`, including the six `member management` journeys |
| Phase boundary review | Pass | `apps/api` still exposes only `health`, `auth`, `members`, and `contribution-periods`; `apps/web` still routes only `/`, `/members`, `/members/:memberId`, `/login`, and the not-found screen. No income, offering, donation, expense, document, dashboard, or report route or screen exists, so Phase 05 and Phase 07 have not begun |
| Financial-arithmetic review | Pass | Money crosses the API as decimal INR strings (`expectedPaise`, `receivedPaise`, `remainingPaise`, `amountPaise`) and is held as `bigint` paise in the calculation layer; `receivedPaise` sums only transactions with `status: 'ACTIVE'`, so a voided transaction cannot reach a total |
| Secret and staged-file review | Pass | A credential-pattern scan over all 215 tracked files matched only the `$argon2id$` algorithm prefix asserted in the authentication tests and the `password.service.ts` pattern checks, never a hash value, token, key, or literal password. `.env` is ignored by `.gitignore:1`, is untracked, and the working tree is clean |

One environmental incident occurred during this re-verification and is recorded as `ISSUE-024`. It did not affect the committed tree, and every database-backed result above was produced after it was resolved.

## Phase 04 defects found and fixed

| Defect | How it was found | Fix | Regression evidence |
|---|---|---|---|
| The first `npm run test:e2e` run failed on TypeScript errors in the Playwright spec and on strict-mode violations: `getByText('HYSSOP FINANCE')` matched both the brand and a footer sentence, and `getByRole('link', { name: 'Members' })` also matched the Foundation page's "Go to members" link | Full `npm run test:e2e` run | The brand assertion uses `{ exact: true }`, the nav link uses `{ name: 'Members', exact: true }`, and the null `textContent()` result is handled with `?? ''` | `foundation.spec.ts` and `members.spec.ts` assert against unique targets; the final run reached `16 passed` |
| `getByLabel('Month')` matched both the period-month select and the `aria-label="Monthly contributions"` section, failing a strict-mode expectation | Second full `npm run test:e2e` run | The select is addressed with `{ exact: true }` on its own label; the panel is addressed by its section role only | Final `16 passed` run |
| The period-status test failed after the real HTTP suite showed a written February 2027 period confirming `Feb 2027 is set to ₹250.00` in the banner while the refetched member detail returned `contributionPeriods: []` | Probe spec proved it was not a caching artefact: the 304 was browser revalidation of a byte-identical body, and `periodViewsForYear` defaults to `currentBusinessYear()` (`members.service.ts`), so the current-year-only panel cannot display a future-year period | Recorded as `ISSUE-023` for the UI gap; the test now drives the current Asia/Kolkata business month and year through an IST helper, so the panel that saved the period also renders it. The row is asserted by the four `cell`-role columns (the month cell is a table header with the `rowheader` role and is asserted on the row) | The full period journey passed (`16 passed`); `ISSUE-023` records the current-year-only visibility limitation with the API already able to serve `?year=` for any year |

## Phase 03 authentication gate

Environment assumptions: unchanged from Phase 02 (Windows, Node `22.19.0`, npm `10.9.3`, PowerShell 5.1, project-local PostgreSQL `16` on loopback port `55432`, `hyssop_finance_dev` and `hyssop_finance_test`). The Playwright run provisions its own Admin with a random password generated in memory, applies migrations to the `_test` database, and never reads or prints a real credential. No secret is stored in the repository or passed on a command line.

| Command | Result | Evidence |
|---|---|---|
| `npm run db:validate` | Pass | `The schema at prisma\schema.prisma is valid` |
| `npm run db:status` | Pass | `3 migrations found` and `Database schema is up to date!`, so the authentication migration and the amended `revision` column match the applied history |
| `npm run db:drift` | Pass | `migration history vs prisma/schema.prisma: no difference detected` and `hyssop_finance_dev vs prisma/schema.prisma: no difference detected`, then the disposable shadow database was dropped |
| `npm run test:db` | Pass, twice | 6 suites, 103 tests against real PostgreSQL, including the `auth-http` and `auth-persistence` suites, the Admin bootstrap suite, and the unchanged Phase 02 financial suites |
| `npm run test:api` | Pass | 20 suites, 162 tests |
| `npm run test:web` | Pass, four times | 5 files, 37 tests; the sign-in route test was run repeatedly after the redirect race fix because it had been intermittent |
| `npm run test:e2e` | Pass after two defect fixes | 10 Playwright tests: 4 failed on the first run, 2 on the second, `10 passed (14.1s)` on the third. See the Phase 03 defects table below |
| `npm run lint` | Pass | `eslint .` reported no problems |
| `npm run format:check` | Pass | `All matched files use Prettier code style!` |
| `npm run typecheck` | Pass | Contracts build, `apps/api` and `apps/web` `tsc --noEmit` all clean |
| `npm run typecheck:scripts` | Pass | `tsc -p tsconfig.scripts.json --noEmit` clean, so `prisma/seed.ts` and `scripts/admin-bootstrap.mjs` are typechecked |
| `npm run build` | Pass | Contracts declaration build, `nest build` for `apps/api`, and `vite build` for `apps/web` (`✓ built in 243ms`) |
| `npm run verify` | Pass | The full gate exited `0`: lint, typecheck, contracts build, script typecheck, 162 API tests, 37 web tests, both production builds, and format check |
| CSRF negative-path evidence | Pass | The real HTTP suite proves `GET /api/v1/auth/csrf` sets a matching readable cookie, and `POST /auth/login` rejects a missing cookie, a mismatched pair, a matching pair that was never issued, an untrusted origin, and a replay, every time with `CSRF_FAILED` and no session cookie |
| Session and revocation evidence | Pass | Sign-in, `GET /auth/me`, server-side revocation through `POST /auth/logout`, and rejection of a replaced session cookie are all proven against the real database; a tampered cookie returns the Admin to the sign-in screen in the browser |
| Storage evidence | Pass | The browser test asserts `localStorage.length` and `sessionStorage.length` are both `0` after sign-in, that `hyssop_session` is `httpOnly`, and that `hyssop_csrf` is not |
| Rate-limit evidence | Pass | `auth-http.db-spec.ts` runs a dedicated instance with the documented `5` attempts and asserts the sixth attempt returns `RATE_LIMITED` with `Retry-After`; the shared database-suite environment uses `100` so unrelated suites are not self-blocked |
| Secret and staged-file review | Pass | A credential-pattern scan over all 79 changed and added files matched no Argon2 hash, JWT, private key, token prefix, or literal password. `.env` is ignored and untracked, only `.env.example` is tracked with every value commented out, and no build output, dependency, Playwright report, or local database artifact is staged |
| Traceability review | Pass | No `REQ-*` or `TEST-*` identifier was added, removed, or renumbered, so `docs/14-TRACEABILITY-MATRIX.md` needed no edit. Re-verified mechanically after the implementation: `docs/01-REQUIREMENTS.md` defines 119 unique `REQ-*` identifiers, the matrix maps all 119 with `0` unmapped, and the 22 `TEST-*` identifiers in the test-plan coverage table are referenced by the matrix with `0` missing in either direction. Phase 03 continues to own its existing authentication requirements |
| Git gate | Pass | 83 intended files committed as `ab7847037120b3deeb519d053c11d4d09afc3746` and pushed to `origin/main`; `git rev-parse HEAD` and `git rev-parse origin/main` both return that hash after a fresh `git fetch` |

## Phase 03 defects found and fixed

| Defect | How it was found | Fix | Regression evidence |
|---|---|---|---|
| The browser sign-in journey was intermittent: after a successful sign-in the Admin was sometimes stranded back on the sign-in screen, and the API log showed a `429` on `POST /auth/login` | `npm run test:web` failed on about half its runs. The queued anonymous-route redirect could commit after the session had already been established | `RequireSession` now performs a guarded redirect and renders nothing while anonymous, and `LoginPage` redirects away when the live state is already authenticated, so a late redirect cannot strand a signed-in Admin. The test harness now mirrors the production React Query defaults instead of forcing `gcTime: 0`, and the stub session state changes on sign-in and sign-out. No timeout was increased | The suite passed 37 of 37 on four consecutive runs |
| `POST /api/v1/auth/login` returned `204 No Content` for logout while the browser client unwraps a canonical `data` envelope, so signing out failed in the browser | Contract comparison during Phase 03 recovery | `LogoutResult` was added to the shared contract, the route returns `200` with the canonical envelope, and the web stub returns the real shape (`DEC-067`, `ISSUE-019`) | `auth-http.db-spec.ts` asserts `200` and a validated `revoked` value; `api-client.test.ts` proves a `200` envelope is unwrapped and a bodyless `204` is rejected |
| `GET /api/v1/auth/csrf` returned the pre-authentication token in the body only, and login validated the header alone, contradicting the cookie-and-token rule in `docs/07-SECURITY-RULES.md` | Contract comparison during Phase 03 recovery; the existing test asserted the wrong behavior, so it hid the mismatch | The route now sets a short-lived readable cookie whose value equals the response token, login requires the header and cookie to match, and the comparison is constant-time over hashed values (`DEC-065`, `ISSUE-020`) | The HTTP suite proves the pair is required, must match, must have been issued, is origin-bound, and is single-use |
| Four Playwright tests failed with a `429` because the suite signs in about nine times from one address while the documented default limit is 5 attempts per 15 minutes in a single API process | `npm run test:e2e` first run, read from the API access log rather than guessed at | The limiter is unchanged and still enforced; only the throwaway Playwright API process is started with `LOGIN_RATE_LIMIT_MAX_ATTEMPTS=100`, because a per-client limit cannot be shared across independent journeys in one process | The documented threshold and the generic rate-limit message remain verified against the real values in `auth-http.db-spec.ts`; the browser suite reached `10 passed` |
| One Playwright test failed on `expect(browserErrors).toEqual([])` because Chromium logs the documented `401` answer to the anonymous session probe as a console error | `npm run test:e2e` second run | The helper now grants exactly one allowance per real `401` response from `/api/v1/auth/me` and spends it only on that generic resource message. Any extra 401, any other console error, any uncaught exception, and any failed request still fails the test, so the filter cannot hide a real defect | `npm run test:e2e` reported `10 passed (14.1s)`, and the strict error checks are unchanged in every other test |

## Phase 02 database gate

Environment assumptions: Windows, Node `22.19.0`, npm `10.9.3`, PowerShell 5.1, PostgreSQL `16` from the project-local cluster in `scripts/local-postgres.mjs` on loopback port `55432`, root `.env` created from `.env.example`, `hyssop_finance_dev` for development and `hyssop_finance_test` for database tests, runtime role `hyssop_app`, migration role `hyssop_migrator`, `trust` authentication so no credential exists in the repository.

| Command | Result | Evidence |
|---|---|---|
| `npm run db:start` | Pass | Idempotent; cluster already running, roles and `hyssop_finance_dev` / `hyssop_finance_test` present, and it prints the four runtime and migration URLs without credentials |
| `npm run db:generate` | Pass | Prisma Client `6.19.3` generated into `node_modules/.prisma` |
| `npm run db:validate` | Pass | `prisma validate` reports `The schema at prisma\schema.prisma is valid` |
| `npx prisma migrate deploy` | Pass | 2 migrations applied; `All migrations have been successfully applied.` and `prisma migrate status` reports `Database schema is up to date!` |
| `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code` | Pass, procedure later corrected | `No difference detected.` with exit code `0`. See the Phase 03 preflight correction below: this invocation was given `--shadow-database-url` pointing at the live development database, which is destructive, and it has been replaced by `npm run db:drift` |
| `npm run db:seed` (first run on an empty database) | Pass | `Members: 8`, `Contribution periods: 24`, `Transactions created this run: 48`, `Transactions already present and skipped: 0` |
| `npm run db:seed` (second run) | Pass | `Transactions created this run: 0`, `Transactions already present and skipped: 48`, proving idempotency of the fictional fixtures |
| Runtime-role read of seeded data | Pass | As `hyssop_app`: `members=8`, `periods=24`, `transactions=48`, `active_income_paise=1314000` (exact `BIGINT` paise, no floating point) |
| Least-privilege grant verification | Pass | `has_table_privilege` for `hyssop_app` on `audit_event`: `select=true insert=true update=false delete=false`; on `financial_transaction`: `update=true`, which corrections require |
| `npm run test:db` | Pass | 3 suites, 48 tests against real PostgreSQL, including schema invariants, grants, triggers, reference concurrency, audit append-only, transaction rollback, and idempotent replay |
| `npm run lint` | Pass | `eslint .` reported no problems |
| `npm run format:check` | Pass | `prettier --check .` clean after one formatting pass |
| `npm run typecheck` | Pass | Contracts build, `apps/api` and `apps/web` `tsc --noEmit` all clean |
| `npm run typecheck:scripts` | Pass | `tsc -p tsconfig.scripts.json --noEmit` clean, so `prisma/seed*.ts` and the local PostgreSQL script are typechecked |
| `npm run test` | Pass | API 13 suites / 103 tests and web 4 files / 19 tests |
| `npm run build` | Pass | Contracts declaration build, `nest build` for `apps/api`, `vite build` for `apps/web` |
| `npm run test:e2e` | Pass | 2 Playwright tests; the API access log shows the browser's `GET /api/v1/health` answered `200` through the Vite proxy |
| API and frontend connectivity (documented local ports) | Pass | `http://127.0.0.1:3000/api/v1/health` returned `hyssop-finance-api`; the same request through the web origin `http://127.0.0.1:5173/api/v1/health` returned `hyssop-finance-api`; `http://127.0.0.1:5173/` returned `200` and served the application markup |
| Index evidence for `05-DATABASE-SPEC.md` | Pass with a recorded deviation | `pg_indexes` shows 21 indexes matching the documented names, columns, and sort directions, including unique indexes on every `reference_id`; with `enable_seqscan` disabled the planner resolves 11 of the 12 documented predicates to their dedicated index. The two `IS NOT NULL` member and category predicates chose the broader `financial_transaction_status_business_date_idx` with a filter, because 48 seeded rows make a full index cheaper; the deviation in `DEC-060` and `ISSUE-013` is about partial, not usable |
| `npm audit` | Advisory, not a pass | 3 high-severity findings, all `deepmerge-ts` through the Prisma CLI; reachability evidence and the rejected breaking fix are recorded in `ISSUE-014` |
| Phase boundary review | Pass | No REST route, session, credential, or UI feature was added; `apps/api` still exposes only `GET /api/v1/health`, which stays process-only and never queries the database |
| Traceability review | Pass | Re-verified mechanically: `docs/01-REQUIREMENTS.md` defines 119 unique `REQ-*` identifiers, `docs/14-TRACEABILITY-MATRIX.md` maps 119 unique rows, and unmapped `0`, orphan `0`, multiple primary owners `0`. Phase 02 still owns exactly `REQ-FIN-001`, `REQ-FIN-002`, `REQ-FIN-003`, `REQ-FIN-021`, and `REQ-FIN-023`, and the 22 `TEST-*` identifiers in the test-plan coverage table are referenced by the matrix with none missing in either direction. No identifier was added, removed, or renumbered, so the matrix needed no edit |
| Secret and staged-file review | Pass | A high-confidence credential-pattern scan over all 63 committable files matched only `docker/postgres/init/001-app-role.sh`, where `: 'APP_ROLE_PASSWORD'` is a psql variable reference supplied by the container environment and not a stored value. `.env` is ignored and untracked, and no build output, dependency, or local database artifact is staged |
| Git gate | Pass | 63 intended files committed as `84b5687189d58755438b13f0ea97cd82172958cf` and pushed to `origin/main`; local and remote hashes match |

## Phase 02 defects found and fixed

| Defect | How it was found | Fix | Regression evidence |
|---|---|---|---|
| The development database had no runtime privileges: `has_schema_privilege('hyssop_app','public','USAGE')` was `false` and `SELECT count(*) FROM public.financial_transaction` returned `permission denied for schema public`, so a real API process could not read its own data | Manual `psql` inspection while collecting index evidence, after health and browser tests had already passed | Object-level grants moved out of `scripts/local-postgres.mjs` into the reviewed migration `20260926140000_runtime_role_grants`, including default privileges for later migrations; the script now owns only roles, databases, `CONNECT`, and schema `USAGE` (`DEC-055`) | `has_table_privilege` now reports the documented least-privilege result, the runtime role reads the 48 seeded transactions, and `npm run test:db` still passes 48 tests |
| `prisma/migrations` had no `migration_lock.toml`, so `prisma migrate diff --from-migrations` failed with `Could not determine the connector from the migrations directory` | Migration drift check | Added the standard `provider = "postgresql"` lock file | Drift check reports `No difference detected.` with exit code `0` |
| `hyssop_finance_dev` had no `_prisma_migrations` history, so `prisma migrate deploy` refused to run with `P3005: The database schema is not empty` | `migrate deploy` after the new migration was added | Baselined the already-applied migration with `prisma migrate resolve --applied 20260926120000_init`, which records history without executing SQL | `migrate deploy` applies only the new migration and `migrate status` reports the schema is up to date |
| The idempotency design wrote a claim row with `responseStatus = 0`, which the new `response_status` check constraint correctly rejected, so the first real command failed | First real-database test run against `audited-commands.db-spec.ts` | Replaced begin/complete/abandon with one `runOnce` transaction that writes the business row and the stored response together, validates a real HTTP status, and replays the stored response on a unique conflict (`DEC-056`) | `npm run test:db` passes, including the duplicate-request, concurrent-request, and failed-command rollback cases |
| Reconciliation period filtering missed the first day of a range because a bare timestamp parameter was compared against a `date` column in the session time zone | Real-database test asserting the seeded September totals | Bound every date parameter as `formatBusinessDate(value)::date` (`DEC-057`) | `reference-and-reconciliation.db-spec.ts` passes on the seeded data, and the aggregates match the seed totals |
| The seed re-inserted its correction example on a second run because it matched the transaction to correct by its original amount, which the correction itself had changed | Second `npm run db:seed` run created rows instead of skipping them | The correction example is matched by reference identity, not by the pre-correction amount | First run creates 48 and skips 0; second run creates 0 and skips 48 |
| `npm run test:db` could not run from the repository root without manually exporting test URLs | Attempting the phase acceptance gate from a clean shell | The test global setup derives the test URLs from the development URLs when explicit test values are absent, and refuses any database name that does not end in `_test` (`DEC-059`) | `npm run test:db` passes from the repository root with no manual environment setup |
| The API process aborts with a clear message and non-zero exit code when it cannot bind its port, and writes the reason to server-side stderr | A second API start during connectivity verification produced `listen EADDRINUSE` in `api.err.log` while the already-running instance kept serving | No code change; the Phase 01 startup error contract behaved as documented | Health kept answering `200` and the failure stayed diagnosable without exposing internals to the client |

## Phase 02 non-blocking advisories

| Advisory | Assessment |
|---|---|
| `npm install` warns that `@angular-devkit/*` (Nest CLI tooling) declares Node `^22.22.0 \|\| ^24.15.0 \|\| >=26.0.0` while the approved runtime is `22.19.0` | Build, typecheck, and tests all pass on the approved runtime; `nest generate` may be restricted on a newer Node. Tracked as `ISSUE-011`, not a phase failure |
| NestJS logs a `LegacyRouteConverter` message for its internal catch-all route | Upstream Express 5 `path-to-regexp` advisory; the route is internal 404 handling, not an application route. Tracked as `ISSUE-012` |
| `vite build` reports a chunk-size advisory for the single shell bundle | Expected for a shell with no route-level code splitting; recorded rather than suppressed |
| Prisma warns that `package.json#prisma` is removed in Prisma 7 | Reproduced on every Prisma command and accepted for this phase per `DEC-061`; tracked as `ISSUE-015` |
| `npm audit` reports 3 high-severity `deepmerge-ts` findings through the Prisma CLI | Not reachable from the shipped API bundle or `@prisma/client`; the only offered fix is a breaking Prisma downgrade. Tracked as `ISSUE-014` |
| The Docker/Compose provisioning path was never executed | Docker is not installed on the developer machine; the project-local PostgreSQL 16 workflow produced all Phase 02 evidence. Tracked as `ISSUE-016` |
| The default development port `3000` was already owned by an unrelated process on the developer machine | The acceptance run uses dedicated loopback ports; no process outside the workspace was inspected beyond identifying the port owner, and nothing outside the workspace was modified |

## Phase 01 foundation gate

Environment assumptions: Windows, Node `22.19.0`, npm `10.9.3`, PowerShell 5.1, root `.env` created from `.env.example`, npm workspaces, Chromium installed through `npx playwright install chromium`.

| Command | Result | Evidence |
|---|---|---|
| `npm install` | Pass | `package-lock.json` created; no `--legacy-peer-deps`; no peer-dependency override |
| `npm run lint` | Pass | `eslint .` reported no problems for `apps/`, `packages/`, and root configuration |
| `npm run typecheck` | Pass | Contracts build, `apps/api` `tsc --noEmit`, and `apps/web` `tsc --noEmit` all clean |
| `npm run test --workspace @hyssop/api` | Pass | 6 suites, 49 tests, including the `api-foundation.e2e-spec.ts` integration suite |
| `npm run test --workspace @hyssop/web` | Pass | 4 files, 19 tests, including routes, error boundary, client, and configuration tests |
| `npm run build` | Pass | `@hyssop/contracts` declaration build, `nest build` for `apps/api`, and `vite build` for `apps/web` |
| `npm run format:check` | Pass | `prettier --check .` clean after a single formatting pass |
| `npm run test:e2e` | Pass | 2 Playwright tests against the built bundle with a real API process; API access log shows `200` for the browser health request |
| Phase boundary review | Pass | No member, contribution, income, expense, document, dashboard, report, or session code exists; no navigation target is rendered that does not work |
| Secret and staged-file review | Pass | Credential-pattern scan over all 104 committable files matched only the deliberate redaction test fixtures; `.env` is ignored and untracked |
| Git gate | Pass | 75 intended files committed as `1a11d34af7d4ef3f8352cdaabf533b9056b21b7f` and pushed to `origin/main`; local and remote hashes match |

## Phase 01 defects found and fixed

| Defect | How it was found | Fix | Regression evidence |
|---|---|---|---|
| `StructuredLogger` factory received no `ConfigService`, so the real API process aborted on startup with `Cannot read properties of undefined (reading 'getOrThrow')` | Browser acceptance run; unit tests had overridden the provider and therefore missed it | Added the explicit `inject: [ConfigService]` dependency to the provider factory in `apps/api/src/app.module.ts` | `npm run test:e2e` boots the real composition and answers `200` |
| Startup failures reported only `The API failed to start.`, hiding the root cause | Diagnosis of the same failure | `apps/api/src/main.ts` now adds the reason and stack to server-side stderr while still returning a generic client message | Startup failure in the smoke run was then diagnosable as `EADDRINUSE` |
| The production build shipped a bundle whose API base URL came from `.env` instead of the smoke-mode value, so the browser called the wrong origin | Browser acceptance run failed with `data-state="unavailable"` while the API log showed no browser request | `smoke` mode now injects the value through Vite `define`, and a production build fails fast when `VITE_API_BASE_URL` is absent | `npm run build` and `npm run test:e2e` pass; the API log shows the browser request |
| `vite preview` resolved `dist` relative to the invocation directory, so a repository-root invocation failed with `The directory "dist" does not exist` | Manual preview diagnostic | `apps/web/vite.config.ts` sets an explicit `root`, and the proxy target now honors the process environment | `npm run test:e2e` serves the built bundle successfully |
| Section titles used weight 600, below the documented 650–700 range in `04-DESIGN-TOKENS.md` | Specification comparison during self-review | Section headings now use `font-bold` (700) | Visual rule now matches the token document |
| `eslint` reported 3 remaining strictness violations after the first pass | `npm run lint` | Removed the redundant assertions, typed the rejection helper parameter as `Error` | `npm run lint` passes with no rule disabled |

## Phase 01 non-blocking advisories

| Advisory | Assessment |
|---|---|
| `npm install` warns that `@angular-devkit/*` (Nest CLI tooling) declares Node `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0` while the approved runtime is `22.19.0` | Build, typecheck, and tests all pass on the approved runtime; `nest generate` may be restricted on a newer Node. Tracked as an open issue, not a phase failure |
| NestJS logs a `LegacyRouteConverter` message for its internal catch-all route | Upstream Express 5 `path-to-regexp` advisory; the route is internal 404 handling, not an application route |
| `vite build` reports a chunk-size advisory for the single shell bundle | Expected for a shell with no route-level code splitting; recorded rather than suppressed |
| The default development port `3000` was already owned by an unrelated process on the developer machine | The acceptance run uses dedicated loopback ports; no process outside the workspace was inspected beyond identifying the port owner, and nothing outside the workspace was modified |

## Phase 03 preflight correction to Phase 02 evidence

Phase 03 preflight found that the Phase 02 drift check was destructive and that the development database had been silently destroyed by it. The Phase 02 `migrate deploy`, `migrate status`, grant, and seed rows above remain accurate for the moment they were executed, but the drift **procedure** was wrong and is corrected here rather than quietly replaced.

| Finding | Evidence | Correction |
|---|---|---|
| The Phase 02 drift check passed `--shadow-database-url` set to the development database. `prisma migrate diff` resets its shadow database before use, so the check deleted the development schema, its `_prisma_migrations` history, its least-privilege grants, and all 48 seeded transactions | At Phase 03 preflight `prisma migrate status` reported both migrations unapplied while the tables still existed, and every table returned `0` rows. No npm script or document had ever referenced `--shadow`, so the repository was never affected | `npm run db:drift` (`scripts/migration-drift.mjs`, `DEC-062`) creates a disposable `hyssop_finance_shadow` database owned by the migration role, guards the name to end with `_shadow`, refuses the development database by name, drops the shadow database in a `finally` block, and adds a read-only `--from-url` comparison of the live development database |
| The development database had to be restored before Phase 03 could trust it | `node scripts/local-postgres.mjs reset` -> `npm run db:migrate` -> `npm run db:seed` | `migrate status` reports `Database schema is up to date!` with 2 recorded migrations, the seed created 8 members, 24 contribution periods and 48 transactions, and the runtime role reads them with `schema_usage=true`, `audit_update=false`, `audit_delete=false` |
| The corrected check must not be able to destroy data again | `npm run db:drift` run twice, plus a forced-misconfiguration run | Exit code `0` with `No difference detected.` for both the history and the live-database comparison; the guard prints `Refusing to use "hyssop_finance_dev" as a shadow database` and exits `1`; after a successful run the development database still holds 48 transactions and 2 recorded migrations |
| The first Phase 03 preflight `npm run test:db` run failed 1 of 48 tests: `reference-and-reconciliation.db-spec.ts` -> "never produces a duplicate under concurrent allocation" reported `Transaction API error: Unable to start a transaction in the given time` | `npm run test:db` after the test database had been recreated by `local-postgres.mjs reset`; the test fires 12 concurrent interactive transactions that are serialized by the `id_sequence` row lock, and `node_modules/@prisma/client/runtime/library.d.ts` documents the Prisma defaults `maxWait ?= 2000` and `timeout ?= 5000`. The error is a client-side connection-acquisition wait, not a duplicate or lock failure | Configured explicit transaction waits on the shared Prisma client, `maxWait` 15 s and `timeout` 30 s (`DEC-063`, `ISSUE-018`). The test's concurrency and its uniqueness assertion were not changed, and no timeout was used to hide a uniqueness problem: the guarantee is enforced by the row lock and the unique constraint | `npm run test:db` passed 48 of 48 on two consecutive runs, and `npm run verify` passed end to end (lint, typecheck, `typecheck:scripts`, API 13 suites / 103 tests, web 4 files / 19 tests, contracts + `nest build` + `vite build`, `format:check`) |

## Prior stage: Prompt 01B documentation gate

Application tests remain unstarted. The following rows record documentation checks executed against the completed Prompt 01B worktree.

| Check | Status | Evidence |
|---|---|---|
| Complete specification/phase/runtime reread | Complete | All `docs/00`–`docs/14`, `docs/phases/PHASE-00`–`PHASE-12`, and runtime files reread during Prompt 01B |
| Document responsibility coverage | Complete | `Document Responsibility` present in `AGENTS.md` and all 34 files under `docs/` (15 specifications, 6 runtime records, 13 phase contracts) |
| Stable identifier register | Complete | `docs/01-REQUIREMENTS.md` defines 119 unique contiguous `REQ-*` identifiers with no duplicates; `docs/10-TEST-PLAN.md` defines 24 `TEST-*` identifiers |
| Traceability coverage | Complete | 119 of 119 requirements mapped exactly once in `docs/14-TRACEABILITY-MATRIX.md`; 24 of 24 test identifiers referenced; two-way verification consistency confirmed against `docs/10-TEST-PLAN.md` |
| Phase ownership consistency | Complete | All 13 phase `Primary owned requirements` lists match the matrix register; Phase 08 owns 31 requirements including `REQ-CONTRIB-005` and `REQ-CONTRIB-006`; multiple primary owners `0` |
| Contradiction and ownership audit | Complete | Phase 05/06/07 document dependency, Phase 09/10 audit ordering, and Phase 06/10 category ownership recorded in `DECISIONS.md` and `ISSUES.md`; `ISSUE-010` records the final traceability corrections |
| Whitespace and Git diff checks | Complete | `git diff --check` reported no whitespace errors before staging |
| Secret and staged-file review | Complete | High-confidence pattern scan over the worktree found no credential material; staged file list contains documentation only |
| Checkpoint commit | Complete | `ee3bae4627dd0f06ae40ec8c5f1b0c8e627657e3` — 36 intended documentation files, 1040 insertions, 185 deletions |
| Push verification | Complete | `main` pushed to `origin/main`; local and remote hashes match |
| Application lint, typecheck, unit, integration, database, E2E, and build | Not run | No application code, toolchain, schema, or deployment exists |

## Evidence for this stage

| Check | Result | Evidence |
|---|---|---|
| Required file inventory | Complete | 4 root project files, 14 specifications, 13 phase specifications, and 6 runtime files |
| Specification consistency review | Complete | Every bootstrap document reread; missing receipt/search requirements, response envelope, period boundaries, CSRF, document-removal, idempotency, optional member fields, category/settings persistence, and phase-ordering issues corrected |
| Authorized remote | Complete | `origin` matches `https://github.com/kalmelasujeethkumar-cyber/hyssop-finance.git` for fetch and push |
| Ignore-rule review | Complete | `.env`, dependencies, build output, tests, logs, local uploads, local database artifacts, and secret file types are ignored; `.env.example` remains visible |
| Secret and placeholder review | Complete | No high-confidence credential patterns found; `.env.example` contains placeholders only and no personal data is present |
| Git whitespace check | Complete | `git diff --check` reported no errors before staging |
| Staged file and diff review | Complete | Exactly 37 intended documentation/config files staged; no generated or unrelated files |
| Checkpoint commit | Complete | `64245b74a78eb86ff12bb602d7c025ac9e7f1389` |
| Push verification | Complete | `main` pushed to `origin/main`; local and remote hashes match |
| Lint | Not run | No application code |
| Typecheck | Not run | No application code |
| Unit tests | Not run | No application code |
| Integration tests | Not run | No application code |
| Database tests | Not run | No database or migrations |
| E2E tests | Not run | No application |
| Production build | Not run | No application |

## Future recording format

For each approved phase, record the command, environment assumptions, result, failures, fixes, regression checks, and evidence location. A phase cannot be marked `COMPLETE` without the applicable entries.
