# HYSSOP FINANCE — Test Results

## Document Responsibility

- Owns: executed commands, environment assumptions, results, failures, fixes, retests, and evidence locations.
- Does not own: test specifications, product requirements, technical decisions, or planned scenarios.
- Referenced by: `10-TEST-PLAN.md`, `11-DEFINITION-OF-DONE.md`, and phase completion gates.
- Change rule: record objective run evidence; never convert a planned test or self-assessment into a passing result.

## Current status

**The Phase 10 audit and settings quality gate passed on 2026-10-03: every mandatory command passed, `npm run verify` exited `0`, and `npm run test:e2e` reported `63 passed`, including the 6 new audit and settings journeys and all 57 pre-existing journeys. The Phase 10 Git gate is closed: 38 implementation and evidence files were committed as `6a5b1785ffa890d50d284c8920897718a98eee31` and pushed to `origin/main`, and after a fresh `git fetch` both `git rev-parse HEAD` and `git rev-parse origin/main` return that hash. Phase 09 remains closed with implementation commit `416080493a86fb827c597013518d7026b78c0198` and evidence commit `e1afed8af69994ca4eb7953ef12ea985fa2716cc`.**

**The Phase 09 reports quality gate passed on 2026-10-02: every mandatory command passed and `npm run test:e2e` reported `57 passed`, including the 10 new report and search journeys and all 47 pre-existing journeys. The Phase 09 Git gate is recorded in `PHASE-HISTORY.md`. Phase 08 remains closed with commit `525493c63a99f43430558307401bf41ed4bca477`. No phase is marked `COMPLETE` until its Git gate evidence is recorded.**

**The Phase 07 documents quality gate passed on 2026-10-01: every mandatory command passed, `npm run verify` exited `0`, and `npm run test:e2e` reported `38 passed`, including the four new document journeys and all 34 pre-existing journeys. The Phase 07 Git gate is recorded in `PHASE-HISTORY.md`. Phase 06 remains closed with commit `6a2ad41bcf40f6bfffd11b9a98ea1520db0cc479`. No phase is marked `COMPLETE` until its Git gate evidence is recorded.**

**The Phase 06 expense quality gate passed on 2026-10-01: every mandatory command passed and `npm run test:e2e` reported `35 passed`, including all 10 Phase 06 expense journeys and all 25 pre-existing journeys. The Phase 06 Git gate is recorded in `PHASE-HISTORY.md`. Phase 05 remains closed with commit `c639fa89504ee5be09e17d8bb2206b89139d9ccf`, Phase 04 with `b1477379dee465c1129bb7a32e22a4c713e4d4ea`, and Phase 03 with `ab7847037120b3deeb519d053c11d4d09afc3746`. No phase is marked `COMPLETE` until its Git gate evidence is recorded.**

**The Phase 05 income quality gate passed on 2026-09-29: every mandatory command passed and `npm run test:e2e` reported `25 passed`. Phase 04 remains closed with commit `b1477379dee465c1129bb7a32e22a4c713e4d4ea`, and Phase 03 with `ab7847037120b3deeb519d053c11d4d09afc3746`. No phase is marked `COMPLETE` until its Git gate evidence is recorded.**

**The Phase 04 gate was independently re-executed on 2026-09-29 after an accidental editor close, and every command passed again against the same committed tree; see "Phase 04 re-verification after the accidental session close" below.**

Phase 04 implemented the Members domain: member create/read/update, `HY-MEM-0001` reference allocation, name/phone/notes validation, search, sorting, pagination, contribution periods with an expected amount, ledger-derived received/remaining/status projections, and the Members list and detail screens with browser journeys that prove the whole stack against a real API and a real PostgreSQL database.

## Phase 10 audit and settings gate

Phase 10 owns `REQ-AUDIT-001`, `REQ-AUDIT-002`, and `REQ-SETTINGS-001`–`REQ-SETTINGS-009`, with the acceptance identifiers `TEST-AUDIT-001`, `TEST-AUDIT-002`, `TEST-SEC-001`, and `TEST-E2E-001`. All evidence below is from the final run on 2026-10-03, after the four Phase 10 findings in the table beneath this gate were fixed. This checkpoint is a resumption: the implementation was already present in the working tree when the session recovered, so the whole applicable gate was re-executed against the delivered tree rather than accepting an earlier run's claim.

Environment assumptions: unchanged (Windows, Node `22.19.0`, npm `10.9.3`, PowerShell 5.1, project-local PostgreSQL `16` on loopback port `55432`, `hyssop_finance_dev` and `hyssop_finance_test`). The `ISSUE-040`/`ISSUE-045` cluster condition did **not** recur: the project-local cluster was already accepting connections on `127.0.0.1:55432` when the gate began. The Playwright run provisions its own Admin with a random password generated in memory, applies migrations to the `_test` database, and never reads or prints a real credential. `hyssop_finance_test` is not reset between runs, so the audit and settings journeys assert against records they create in the same run with unique tags rather than against seeded values.

| Command | Result | Evidence |
|---|---|---|
| `npm run db:validate` | Pass | `The schema at prisma\schema.prisma is valid` |
| `npm run db:status` | Pass | `6 migrations found in prisma/migrations` and `Database schema is up to date!`; Phase 10 added `20261003120000_audit_entity_reference_width` |
| `npm run db:drift` | Pass | `No difference detected` for both `migration history vs prisma/schema.prisma` and `hyssop_finance_dev vs prisma/schema.prisma`, then the disposable shadow database was dropped |
| `npm run lint` | Pass | `eslint .` reported no problems |
| `npm run format:check` | Pass | `All matched files use Prettier code style!` after one `npx prettier --write` pass over the two files that had drifted |
| `npm run typecheck` | Pass | Contracts build plus `apps/api` and `apps/web` `tsc --noEmit`, clean |
| `npm run typecheck:scripts` | Pass | `tsc -p tsconfig.scripts.json` clean |
| `npm run test:api` | Pass | 36 suites, 760 tests, including the 60-test `audit-settings-http.e2e-spec.ts` contract suite and the unchanged Phase 02–09 regression suites |
| `npm run test:web` | Pass | 19 files, 492 tests, including the 22 tests across `features/audit/audit-settings.test.tsx` |
| `npm run test:db` | Pass | 12 suites, 246 tests against real PostgreSQL, including the new 16-test `settings-audit-persistence.db-spec.ts` and the unchanged Phase 02–09 financial and invariant suites |
| `npm run build` | Pass | Contracts declaration build, `nest build`, and `vite build` |
| `npm run verify` | Pass | `lint`, `typecheck`, `typecheck:scripts`, `test`, `build`, and `format:check` all passed in one run and the script exited `0` after the format pass |
| `npm run test:e2e` | Pass after four defect fixes | 63 Playwright tests (`63 passed`) against the rebuilt bundle served by `vite preview`, with a real API process and a real PostgreSQL database; this is the 6 new audit and settings journeys plus all 57 pre-existing journeys, and therefore the combined Phase 03–10 regression in one run |
| Audit reachability and immutability evidence | Pass | The journey opens Audit History, asserts it is reachable from the primary navigation, and asserts the screen offers no edit, delete, remove, or void control, so the append-only rule is proven from the interface the Admin sees |
| Audit filter evidence | Pass | A filter narrows the history and its selection is written into the URL so a shared link reproduces the same query, and the Clear control resets the selection rather than leaving a stale filter |
| Void-history evidence | Pass | The journey records an income, voids it with a reason, filters `action=TRANSACTION_VOIDED`, expands the detail, and asserts the reason is shown, so a void event retains the required reason in history |
| Settings honesty evidence | Pass | The journey asserts the fixed values (INR currency, Asia/Kolkata timezone, at least one enabled payment method) are shown as read-only and state that they cannot be changed here, so no control is offered that does nothing |
| Settings persistence and audit evidence | Pass | The journey changes the default monthly contribution and asserts the confirmation banner names the new amount **and** that the newest audit entry records the change with `entityType=app_setting`, the `DEFAULT_MONTHLY_CONTRIBUTION_PAISE` key, and the new paise value |
| Settings validation evidence | Pass | The journey enters a malformed amount and asserts the API's own `MONEY_FORMAT_MESSAGE` is reported rather than a silent or invented message |
| Real-PostgreSQL settings evidence | Pass | `settings-audit-persistence.db-spec.ts` asserts exact paise persistence, a written audit event, method ordering and de-duplication, a no-op change writing no event, multi-setting atomicity, identical-replay tolerance, rejection cases, contribution-default paise and replay, no retroactive change, audit ordering/labels/attribution, filtering with unknown-value rejection, business-day inclusivity, redaction, recorded-empty versus absent values, and pagination |
| Security and redaction evidence | Pass | `TEST-SEC-001` is covered by the contract suite asserting unauthorized and CSRF-less writes are refused, and by the database spec asserting no secret, token, or raw document content appears in audit detail |
| Traceability review | Pass | No `REQ-*` or `TEST-*` identifier was added, removed, or renumbered, so `docs/14-TRACEABILITY-MATRIX.md` needed no edit |
| Git gate | Pass | 38 intended implementation and evidence files committed as `6a5b1785ffa890d50d284c8920897718a98eee31` and pushed to `origin/main`; after a fresh `git fetch` both `git rev-parse HEAD` and `git rev-parse origin/main` return that hash. `apps/api/.jest-audit-verbose.txt` is a machine-local diagnostic and was intentionally left untracked |

## Phase 10 defects found and fixed

| Defect | How it was found | Fix | Regression evidence |
|---|---|---|---|
| `audit_event.entity_reference` was `VARCHAR(32)`, two characters shorter than the 34-character `DEFAULT_MONTHLY_CONTRIBUTION_PAISE` key, so an audited settings change could not be written (`ISSUE-046`, `DEC-099`) | Writing `settings-audit-persistence.db-spec.ts`: persisting a settings change failed at the audit insert while the settings row itself was writable, and the schema showed the reference column narrower than the key | Added migration `20261003120000_audit_entity_reference_width` widening the column to `VARCHAR(64)`, updated `prisma/schema.prisma` and `docs/05-DATABASE-SPEC.md` | `db:status` reports 6 migrations up to date, `db:drift` reports no difference, and the 16-test settings and audit persistence suite passes against real PostgreSQL |
| The browser audit and settings clients prefixed an already-versioned base URL, so every request 404'd (`ISSUE-047`, `DEC-100`) | The audit and settings journeys failed at the first request; the request log showed `/api/v1/api/v1/audit-events` while the API client's base URL already ends in `/api/v1` and the income client correctly uses a relative path | Changed the audit client to `/audit-events` and the settings client to `/settings` and `/settings/contribution-default`, and updated the matching stub paths in the web test file | The 22 web audit and settings unit tests pass, and both browser journeys pass against the real API |
| Settings write mutations omitted the CSRF token, so every settings save was rejected `403 CSRF_FAILED` (`ISSUE-048`, `DEC-101`) | The settings journey reached the API but the save was refused with the CSRF error code while other state-changing writes in the app obtained a token | Wrapped the settings `PATCH` and `POST` mutations in `withCsrf`, matching every other state-changing write in the app | The settings persistence and audit journey passes, and the contract suite continues to refuse a write with no CSRF token |
| An invalid audit `entityType` or `action` filter value was reported as a date error (`ISSUE-049`, `DEC-102`) | Reading `toHistoryFilter`: the vocabulary guards and the date-boundary parser shared one thrown message, so a bad vocabulary value claimed the date format was wrong | Split the parsing so vocabulary guards keep their `Choose one of` message and a new boundary parser names the offending `from`/`to` field | The HTTP contract suite asserts the correct message for a bad vocabulary value and for a malformed date, and the audit filter journey exercises the valid path |

## Phase 10 non-blocking advisories

| Advisory | Assessment |
|---|---|
| The NestJS internal legacy-route advisory about `/api/*` (`ISSUE-012`) | Framework-owned and unchanged by Phase 10. It is emitted during API start-up and does not affect any audit or settings route |
| The contribution-period panel has no year selector (`ISSUE-023`) | Carried from Phase 04 and unchanged by Phase 10. No settings or audit work touches the contribution-period projection |
| The project's Vite build reports a chunk larger than 500 kB | Pre-existing and non-blocking: the bundle is served by `vite preview` for acceptance, the figure is a size advisory rather than an error, and it is not a Phase 10 regression |
| The `ISSUE-040` OneDrive cluster condition did not recur for Phase 10 | The cluster was already up on the documented port when the gate began, so the documented start path needed no workaround and no detached helper was used |

## Phase 05 income gate

Phase 05 owns `REQ-INCOME-001`-`REQ-INCOME-006`, `REQ-DOC-010`-`REQ-DOC-014`, `REQ-FIN-015`-`REQ-FIN-020`, `REQ-FIN-022`, and `REQ-FIN-024`, and the acceptance identifiers `TEST-INCOME-001`, `TEST-FIN-002`, `TEST-FIN-003`, `TEST-DOC-001`, and `TEST-E2E-001`. All evidence below is from the final run on 2026-09-29 after the five Phase 05 defects in the table beneath this gate were fixed.

Environment assumptions: unchanged (Windows, Node `22.19.0`, npm `10.9.3`, PowerShell 5.1, project-local PostgreSQL `16` on loopback port `55432`, `hyssop_finance_dev` and `hyssop_finance_test`). The project-local cluster had to be started detached from the interactive shell to stay up (`ISSUE-024`). The Playwright run provisions its own Admin with a random password generated in memory, applies migrations to the `_test` database, and never reads or prints a real credential. `hyssop_finance_test` is not reset between runs, so the browser suite uses unique descriptions and member names each run.

| Command | Result | Evidence |
|---|---|---|
| `npm run db:migrate` | Pass | Five recorded migrations applied to both databases, including the new `20260929210000_app_setting_initial_keys` forward migration that seeds the four required `app_setting` rows, followed by `npm run db:grant` |
| `npm run lint` | Pass | `eslint .` reported no problems |
| `npm run format:check` | Pass | `All matched files use Prettier code style!` after one `npx prettier --write` pass over the single file that had drifted |
| `npm run typecheck` | Pass | Contracts build, `apps/api` and `apps/web` `tsc --noEmit` all clean, including the Playwright specs under `apps/web/e2e` |
| `npm run typecheck:scripts` | Pass | `tsc -p tsconfig.scripts.json` clean |
| `npm run test:api` | Pass | 24 suites, 334 tests, including the 93-test `income-http.e2e-spec.ts` contract suite and the unchanged Phase 02-04 regression suites |
| `npm run test:web` | Pass | 10 files, 235 tests, including the income form, income request body, transaction helpers, and the new cache-invalidation guard |
| `npm run test:db` | Pass | 7 suites, 117 tests against real PostgreSQL, including the new `schema-invariants.db-spec.ts` guard and the unchanged Phase 02-04 financial suites |
| `npm run build` | Pass | Contracts declaration build, `nest build` for `apps/api`, and `vite build` for `apps/web` (`✓ built in 346ms`) |
| `npm run test:e2e` | Pass after three defect fixes | 25 Playwright tests (`25 passed (25.0s)`) against the built bundle served by `vite preview`, with a real API process and a real PostgreSQL database |
| Member-contribution browser evidence | Pass | The journey records a real member contribution through the form, reads the API-allocated `HY-INC-*` reference and the derived `Contribution month`, follows `Open member`, and asserts the month row inside the `Monthly contributions` region as expected `500.00`, received `500.00`, remaining `0.00`, status `^Paid$`, plus the matching `Contribution history` row for the same reference |
| Cache-coherence evidence | Pass | The request log of the passing run shows `GET /api/v1/members/:id` immediately after `POST /api/v1/income`, which is the refetch that `ISSUE-029` was missing. Three unit tests over a real `QueryClient` assert the invalidated keys, and the member-detail test was confirmed to fail when the invalidation line is removed |
| Idempotency, concurrency, and audit evidence | Pass | The 93-test contract suite asserts replay of a repeated `Idempotency-Key`, a `409` on a reused key with a different body, `If-Match` revision conflicts, and a complete `TRANSACTION_CREATED` / `TRANSACTION_UPDATED` / `TRANSACTION_VOIDED` audit trail with stored `before` and `after` values |
| Anonymous-privacy evidence | Pass | An anonymous donation is stored with no member, description, or notes anywhere, the member control is absent rather than disabled, and the receipt reports `Not recorded (anonymous)` |
| Secret and staged-file review | Pass | A credential-pattern scan over all changed and added files matched no Argon2 hash, JWT, private key, token prefix, or literal password. `.env` is ignored and untracked, only `.env.example` is tracked, and no build output, dependency, Playwright report, trace, or local database artifact is staged |
| Traceability review | Pass | No `REQ-*` or `TEST-*` identifier was added, removed, or renumbered, so `docs/14-TRACEABILITY-MATRIX.md` needed no edit |
| Git gate | Pass | 45 intended files committed and pushed to `origin/main` as `c639fa89504ee5be09e17d8bb2206b89139d9ccf`; after a fresh `git fetch`, `git rev-parse HEAD` and `git rev-parse origin/main` both return that hash |

## Phase 05 defects found and fixed

| Defect | How it was found | Fix | Regression evidence |
|---|---|---|---|
| `memberId` was missing from the transaction correction allow-list, so a computed member change was silently discarded (`ISSUE-026`, `DEC-074`) | The re-authored `income-http.e2e-spec.ts` "detaches a member from a named offering" test kept the member attached | Added `memberId` to `CorrectableTransactionFields`, to `CORRECTABLE_FIELDS`, and to the nullable-passthrough branch of `toCorrectableData` | Two HTTP tests assert the stored row and the audit `before`/`after` member pair, not only the response body; `npm run test:api` 334/334 |
| The income form never sent the `contributionPeriod` the API requires, so a Member Contribution could not be recorded at all (`ISSUE-027`, `DEC-076`) | The Phase 05 browser journey; the API refused the write with `400 A member contribution requires a contribution month` | Derived the month from the validated business date and sent it for a member contribution only, leaving it off the three types the API forbids one for | `income-api.test.ts` asserts the corrected body, the per-type omission, and the month derivation, and the browser journey records a real member contribution end to end |
| The disposable test database's `reset()` truncated the migration-seeded `app_setting` rows, so a browser run after a database-test run failed with `App setting was not found.` (`ISSUE-028`, `DEC-077`) | A full-suite Playwright run that followed a passing `npm run test:db` | Added `INITIAL_APP_SETTING_VALUES` and made `reset()` restore the set with `createMany({ skipDuplicates: true })` | `schema-invariants.db-spec.ts` asserts the keys exist after a reset and are readable through the repository; `npm run test:db` 117/117 and `npm run test:e2e` 25/25 in sequence |
| A member contribution was stored correctly but the member detail's derived status was never invalidated, so the month the Admin had just paid in full kept reading `Not paid` (`ISSUE-029`, `DEC-078`) | The same browser journey, after PostgreSQL proved the stored row, period link, and `50000` paise were all correct | Added one `invalidateTransactionDependents` helper in the shared transaction layer and called it from income create, correction, and void | Three unit tests over a real `QueryClient`, the member-detail one confirmed to fail without the line; the browser journey now passes and the request log shows the member refetch |
| The member-contribution journey's row locator matched two tables and its expected status string did not exist (`ISSUE-030`) | A Playwright strict-mode violation once the product defect above was fixed | Scoped the row to the `Monthly contributions` region and asserted the four cells individually, including the exact `^Paid$` status | `npm run test:e2e` 25/25; no assertion was weakened and the interface was not changed to satisfy the test |

## Phase 05 non-blocking advisories

| Advisory | Assessment |
|---|---|
| The local PostgreSQL cluster still requires a detached launch to stay up on this machine (`ISSUE-024`) | Environmental, not a project defect, and it reproduced identically inside and outside the OneDrive-synced tree. Recorded as a run instruction rather than worked around in project code |
| A bare `npx playwright test` skips the `pretest:e2e` rebuild and serves the previous `dist/` (`ISSUE-031`) | A diagnostic-invocation trap, not a product fault. The gate is already self-protecting, so no project change was made; acceptance evidence is taken only from `npm run test:e2e`, which runs its own build |

## Phase 08 dashboard gate

Phase 08 owns `REQ-DASH-001`–`REQ-DASH-018`, `REQ-CONTRIB-005`, `REQ-CONTRIB-006`, and `REQ-FIN-004`–`REQ-FIN-014`, with the acceptance identifiers `TEST-DASH-001`, `TEST-DASH-002`, `TEST-FIN-001`, `TEST-RESP-001`, and `TEST-E2E-001`. All evidence below is from the final run on 2026-10-02, after the two Phase 08 findings in the table beneath this gate were fixed.

Environment assumptions: unchanged (Windows, Node `22.19.0`, npm `10.9.3`, PowerShell 5.1, project-local PostgreSQL `16` on loopback port `55432`, `hyssop_finance_dev` and `hyssop_finance_test`). The project-local cluster's `ISSUE-040` condition recurred during this phase: the cluster would not stay up under the documented start path, and it had to be started from a detached helper inside the authorized workspace. No path outside the workspace was used, no data directory was relocated, and no project file records the helper, so no migration or configuration changed. `hyssop_finance_test` is deliberately not reset between runs, so the dashboard browser journeys assert against values they recorded themselves in the same run rather than against any seeded figure.

| Command | Result | Evidence |
|---|---|---|
| `npm run db:status` | Pass | 5 migrations found, `Database schema is up to date!`; Phase 08 added no migration, because the dashboard reads the `financial_transaction`, `member`, and `contribution_period` rows created and reviewed in Phase 02 |
| `npm run db:drift` | Pass | `No difference detected` for both `migration history vs prisma/schema.prisma` and `hyssop_finance_dev vs prisma/schema.prisma`, then the disposable shadow database was dropped |
| `npm run lint` | Pass | `eslint .` reported no problems |
| `npm run typecheck` | Pass | Contracts build plus `apps/api` and `apps/web` `tsc --noEmit`, clean |
| `npm run format:check` | Pass | `All matched files use Prettier code style!` |
| `npm run test:api` | Pass | 31 suites, 579 tests, including the new period-resolver, dashboard projection, and `dashboard-http.e2e-spec.ts` contract suites |
| `npm run test:web` | Pass | 15 files, 399 tests, including the new `features/dashboard/dashboard.test.tsx` and `dashboard-api.test.ts` |
| `npm run test:db` | Pass | 10 suites, 195 tests against real PostgreSQL, including the new `dashboard-projection.db-spec.ts` suite |
| `npm run build` | Pass | Contracts declaration build, `nest build`, and `vite build` (`✓ built in 309ms`; the 523.04 kB chunk advisory is pre-existing and is not an error) |
| `npm run test:e2e` | Pass after one test-defect fix | 47 Playwright tests (`47 passed (55.4s)`) against the rebuilt bundle served by `vite preview`, with a real API process and a real PostgreSQL database; this is the 8 new dashboard journeys plus all 39 pre-existing journeys, and therefore the combined Phase 03–08 regression as well |
| Server-authoritative figure evidence | Pass | The browser journeys compare the rendered card against the value the API returned in the same period, so a hard-coded or client-recalculated total cannot pass. The trend table and both breakdown lists are asserted against the same response, and the trend SVG carries the accessible name `Income and expenses for each month in the selected period` with the matching table `Income, expenses, and movement for each month`, so a drawn-only chart cannot pass either |
| Period boundary evidence | Pass | Every preset is exercised through the real period control and asserted against the Asia/Kolkata boundaries in `REQ-DASH-017`; a cold load of **Last Year** is observed sending `from=2025-01-01&to=2025-12-31`, the custom range sends its own inclusive pair, and switching a cached period is asserted without a redundant request while a cold period does send one |
| Reconciliation evidence | Pass | `dashboard-projection.db-spec.ts` reconciles the projection against the ledger it writes: prior-period history, a UPI ₹20,000 minus ₹5,000 ending negative method balance, the voided-row exclusion from every figure while the row is retained in the ledger, the member-count boundary at period end, and multi-month contribution buckets including an absent expected period shown as **Not configured** |
| Honesty evidence | Pass | A period with no transactions asserts zero movement, no income or expense breakdown entry, no alert banner, and a recent list that is not the empty-state message, so a genuinely empty period cannot pass as a failed request |

## Phase 08 defects found and fixed

| Defect | How it was found | Fix | Regression evidence |
|---|---|---|---|
| Recent transactions were ordered by a column that cannot order them, so the newest entry was frequently absent from the list (`ISSUE-043`, `DEC-094`) | The full `npm run test:e2e` run: the post-write journey recorded a ₹2,500.00 offering, reloaded the dashboard, and could not find it in the recent list while older same-day entries were present. Reading `recentTransactions` showed the cause in the `ORDER BY`. `occurred_at` is not a recorded instant in this schema: `income.service.ts:89` and `expenses.service.ts:90` both derive it with `startOfBusinessDay(businessDate)`, so it is byte-identical for every row sharing a business date, and the third tiebreak was `id DESC` on `gen_random_uuid()`. Every same-day row was therefore ordered by a random UUID. `created_at` is the genuine recorded instant, is immutable under the `HY_FIN_IMMUTABLE_TRANSACTION_FIELDS` trigger, and is the column the schema already reserves for it. The Admin-visible effect was that the entry they had just written could be missing from a list that claims to show the ten most recent, which is the state-honesty rule failing in the direction of a wrong answer | The projection orders by `business_date DESC, created_at DESC, id DESC`. `business_date` stays first, because that is what "recent" means to a bookkeeper entering a back-dated receipt, and `id` remains only as an exact-`created_at` collision tiebreak. The comment was corrected to state why `occurred_at` cannot be used instead of leaving the misleading claim in place | Two new real-database tests: three entries sharing one business date now assert the last-recorded entry is returned first, and fourteen entries sharing one date assert the newest is inside the bound of ten and the oldest is not. `npm run test:db` passes 10 suites/195 tests and `npm run test:e2e` passes 47/47 |
| A sign-in journey still asserted the Phase 01 landing screen (`ISSUE-044`) | The full `npm run test:e2e` run: `authentication.spec.ts` waited for `health-status` with `Expected: "connected"`, and reported `element(s) not found`. That was a stale test, not a product fault. `health-status` belongs to the Status screen, and `signIn` landed on Dashboard once Phase 08 made it the signed-in root, so the element the test waited for was on a page the journey no longer visited. The same assertion had been moved rather than removed in an earlier recovery, which is why it survived a green `foundation.spec.ts` run | The journey now asserts what it is actually testing: the signed-in Admin identity is shown and the Dashboard heading is visible. The connectivity assertion was left where it belongs, in `foundation.spec.ts`, which navigates to the Status screen explicitly and still asserts `data-state="connected"` | `apps/web/e2e/authentication.spec.ts` and `foundation.spec.ts` pass 11/11 together, and `npm run test:e2e` passes 47/47 |

## Phase 08 non-blocking advisories

| Advisory | Assessment |
|---|---|
| The NestJS internal legacy-route advisory about `/api/*` (`ISSUE-012`) | Framework-owned and unchanged by Phase 08. It is emitted during API start-up and does not affect the dashboard route; the documented 404 envelope is verified by the existing contract suite |
| The contribution-period panel has no year selector, so a period configured for a future year is invisible (`ISSUE-023`) | Carried from Phase 04 and unchanged by Phase 08. The dashboard's own contribution-status visualization covers configured buckets for the selected period, and no locked requirement owns a year selector |
| The project's Vite build reports a chunk larger than 500 kB after `✓ built in 309ms` | Pre-existing and non-blocking: the bundle is served by `vite preview` for acceptance, the figure is a size advisory rather than an error, and it is not a Phase 08 regression |
| The project-local PostgreSQL cluster inside the OneDrive-synchronised workspace would not stay up under the documented start path (`ISSUE-040`) | Environmental and unchanged in kind from the Phase 07 recurrence. The cluster was started from a detached helper inside the authorized workspace, which changed no project file, relocated no data, and needed no requirement change. The recurrence is recorded here and in `ISSUES.md` rather than silently absorbed |

## Phase 09 reports gate

Phase 09 owns `REQ-REPORT-001`–`REQ-REPORT-004`, `REQ-SEARCH-001`, `REQ-SEARCH-002`, `REQ-EXPORT-001`, and `REQ-EXPORT-002`, with the acceptance identifiers `TEST-REPORT-001`, `TEST-SEARCH-001`, `TEST-EXPORT-001`, `TEST-FIN-001`, and `TEST-E2E-001`. All evidence below is from the final run on 2026-10-02, which re-executed the whole applicable gate against the delivered Phase 09 tree rather than accepting an earlier interrupted run's claim.

Environment assumptions: unchanged (Windows, Node `22.19.0`, npm `10.9.3`, PowerShell 5.1, project-local PostgreSQL `16` on loopback port `55432`, `hyssop_finance_dev` and `hyssop_finance_test`). The `ISSUE-040`/`ISSUE-045` cluster condition did **not** recur for this phase: the project-local cluster was already accepting connections on `127.0.0.1:55432` when the gate began, so no detached helper was needed and no project file was touched to bring it up. The Playwright run provisions its own Admin with a random password generated in memory, applies migrations to the `_test` database, and never reads or prints a real credential. `hyssop_finance_test` is not reset between runs, so the report journeys assert against the figures the API returned in the same request rather than against any seeded number.

| Command | Result | Evidence |
|---|---|---|
| `npm run db:validate` | Pass | `The schema at prisma\schema.prisma is valid` |
| `npm run db:status` | Pass | `5 migrations found in prisma/migrations` and `Database schema is up to date!`; Phase 09 added no migration, because every report is a read projection over the `financial_transaction`, `member`, `contribution_period`, `expense_category`, `transaction_document`, and `audit_event` rows created and reviewed in Phase 02, and the audit read projection reuses the existing append-only `audit_event` table |
| `npm run db:drift` | Pass | `No difference detected` for both `migration history vs prisma/schema.prisma` and `hyssop_finance_dev vs prisma/schema.prisma`, then `Dropped the disposable shadow database hyssop_finance_shadow.` |
| `npm run lint` | Pass | `eslint .` reported no problems |
| `npm run format:check` | Pass | `All matched files use Prettier code style!` |
| `npm run typecheck` | Pass | Contracts build, `apps/api` and `apps/web` `tsc --noEmit`, clean |
| `npm run typecheck:scripts` | Pass | `tsc -p tsconfig.scripts.json` clean |
| `npm run test:api` | Pass | 34 suites, 671 tests, including the 92 tests across `reports-http.e2e-spec.ts`, `src/reports/reports.service.spec.ts`, and `src/reports/csv.spec.ts`, and the unchanged Phase 02–08 regression suites |
| `npm run test:web` | Pass | 18 files, 470 tests, including the 71 tests across `features/reports/reports.test.tsx`, `reports-api.test.ts`, and `search.test.tsx` |
| `npm run test:db` | Pass | 11 suites, 230 tests against real PostgreSQL, including the new 35-test `reports-projection.db-spec.ts` and the unchanged Phase 02–08 financial and invariant suites |
| `npm run build` | Pass | Contracts declaration build, `nest build`, and `vite build` (`✓ built in 330ms`; the 558.53 kB chunk advisory is a pre-existing size advisory, not an error, and grew only because the reports and search features joined the bundle) |
| `npm run test:e2e` | Pass | 57 Playwright tests (`57 passed (1.1m)`) against the rebuilt bundle served by `vite preview`, with a real API process and a real PostgreSQL database; this is the 10 new report and search journeys plus all 47 pre-existing journeys, and therefore the combined Phase 03–09 regression in one run |
| Route-fidelity evidence | Pass | The API exposes exactly the eleven report routes, the one `:reportId/export.csv` route, and the one `/search` route that `docs/06-API-SPEC.md` defines. No route was invented and no documented route is missing |
| Server-authoritative figure evidence | Pass | The browser journeys read the same response the server returned for the selected period and assert the rendered figures against it, so a hard-coded total or a client recomputation cannot pass. A code review of `features/reports` and both report pages found no floating-point money arithmetic at all: the only `Number()` conversions are the integer `page`/`pageSize` URL parameters and a kilobyte label for a file size, and every money value stays an exact decimal string from PostgreSQL to the DOM |
| Period-boundary evidence | Pass | The period presets are exercised through the real period control, the selection is read back from the URL so a shared link reproduces the same request pair, and the audit window is observed sending whole Asia/Kolkata day instants (`DEC-098`) while the whole-history option sends no window at all |
| Voided-visibility evidence | Pass | One journey opens every documented report and asserts each states its own voided visibility, and a second asserts a history report keeps voided rows while an arithmetic report excludes them, so a screen cannot claim a rule its projection does not implement (`DEC-097`) |
| CSV evidence | Pass | The export journey clicks the real control, captures the request, and asserts the downloaded file carries the server-decided filename and the header row the API produced, so a client-built CSV cannot pass. `csv.spec.ts` and the contract suite assert every cell is escaped, a leading spreadsheet formula character is neutralized, and an unknown report id is refused rather than used to build a filename |
| Print evidence | Pass | The printed page is asserted to state its own scope and carry no controls, and the shared print classes live in `theme.css` rather than in inline styles, so the print stylesheet is reviewable in one place |
| Search evidence | Pass | Search requests only after a term is submitted, reports the API's own total, and a term that matches nothing is shown as an explicit empty state rather than a blank page |
| Dead-control audit | Pass | The journey that opens every report also asserts each leaves no dead control, and the web tests assert that a failed search and a failed export are both reported to the Admin and can be dismissed or retried, rather than failing silently as the Phase 07 download control did (`ISSUE-042`) |

## Phase 09 findings

No defect was found and fixed in Phase 09. Every applicable gate command passed on the first execution in this session against the delivered tree, so no `ISSUE-046` or later entry exists. That is recorded as an observation rather than presented as an absence of risk: the audit above re-read the new code for the three shortcuts `docs/phases/PHASE-09-REPORTS.md` prohibits — hard-coded report rows, a client-only filter, and a browser-side authoritative calculation — and found none.

The three technical decisions Phase 09 introduced are recorded as `DEC-096` (one row cap shared by the screen and the export), `DEC-097` (one voided-visibility constant), and `DEC-098` (audit dates widened to whole Asia/Kolkata days at the transport boundary). None of them conflicts with a locked requirement, so none required a change to `01-REQUIREMENTS.md` or any other specification.

## Phase 09 non-blocking advisories

| Advisory | Assessment |
|---|---|
| The NestJS internal legacy-route advisory about `/api/*` (`ISSUE-012`) | Framework-owned and unchanged by Phase 09. It is emitted during API start-up and does not affect any report or search route |
| The contribution-period panel has no year selector (`ISSUE-023`) | Carried from Phase 04 and unchanged by Phase 09. The Member Contribution report accepts any year through the API and the period control, so the report is not subject to the panel's limitation |
| The Vite build now reports a 558.53 kB chunk after `built in 330ms` | A size advisory rather than an error, pre-existing in kind from the 523.04 kB figure recorded for Phase 08. Recorded so it is not mistaken for a failed build |
| The `ISSUE-040` OneDrive cluster condition did not recur for Phase 09 | The cluster was already up on the documented port when the gate began, so the documented start path needed no workaround and no detached helper was used |

## Phase 07 documents gate

Phase 07 owns `REQ-DOC-001`–`REQ-DOC-009` and the storage-abstraction requirement of `docs/02-ARCHITECTURE.md`, with the acceptance identifiers `TEST-DOC-001`, `TEST-DOC-002`, `TEST-DOC-003`, `TEST-FIN-002`, and `TEST-E2E-001`. All evidence below is from the final run on 2026-10-01, after the seven Phase 07 findings in the table beneath this gate were fixed.

Environment assumptions: unchanged (Windows, Node `22.19.0`, npm `10.9.3`, PowerShell 5.1, project-local PostgreSQL `16` on loopback port `55432`, `hyssop_finance_dev` and `hyssop_finance_test`). The project-local cluster is stored inside the OneDrive-synchronised workspace and previously failed to start or to accept connections while OneDrive held `tmp/pgdata/server.log` (`ISSUE-040`). It was brought up inside the authorized workspace only; no path outside the workspace was used, and Docker remains unavailable, so the documented `HYSSOP_PG_DATA_DIR` override was verified by inspection rather than by relocation. The Playwright run provisions its own Admin with a random password generated in memory, applies migrations to the `_test` database, never reads or prints a real credential, and restores the initial expense category set idempotently (`ISSUE-034`). `hyssop_finance_test` is not reset between runs, so the browser suite uses unique descriptions, amounts, and category names each run and narrows a list by search before asserting a filter removed a specific row (`ISSUE-039`).

| Command | Result | Evidence |
|---|---|---|
| `npm run db:validate` | Pass | `The schema at prisma\schema.prisma is valid` |
| `npm run db:status` | Pass | `Database schema is up to date!`; Phase 07 added no migration, because `transaction_document` and its indexes were created and reviewed in Phase 02 |
| `npm run db:drift` | Pass | `No difference detected` for both `migration history vs prisma/schema.prisma` and `hyssop_finance_dev vs prisma/schema.prisma`, then the disposable shadow database was dropped |
| `npm run lint` | Pass | `eslint .` reported no problems |
| `npm run format:check` | Pass | `All matched files use Prettier code style!` after one `npx prettier --write` pass over the 22 Phase 07 files that had drifted, and a second over `apps/web/e2e/expenses.spec.ts` after its last edit |
| `npm run typecheck` | Pass | Contracts build plus `apps/api` and `apps/web` `tsc --noEmit`, clean |
| `npm run typecheck:scripts` | Pass | `tsc -p tsconfig.scripts.json` clean |
| `npm run test:api` | Pass | 29 suites, 504 tests, including the new 40-test `documents-http.e2e-spec.ts` contract suite and the 16-test `local-document-storage.spec.ts` |
| `npm run test:web` | Pass | 13 files, 351 tests, including the 22-test `features/documents/documents.test.tsx` and the 16-test `lib/api-client.test.ts` document-transport group |
| `npm run test:db` | Pass | 9 suites, 158 tests against real PostgreSQL, including the new 22-test `document-persistence.db-spec.ts` |
| `npm run build` | Pass | Contracts declaration build, `nest build`, and `vite build` (`built in 301ms`; the 500 kB chunk advisory is pre-existing and is not an error) |
| `npm run verify` | Pass | `lint`, `typecheck`, `typecheck:scripts`, `test`, `build`, and `format:check` all passed in one run and the script exited `0` |
| `npm run test:e2e` | Pass after two test-defect fixes | 38 Playwright tests (`38 passed (41.5s)`) against the rebuilt bundle served by `vite preview`, with a real API process and a real PostgreSQL database |
| Document critical-path browser evidence | Pass | The journey records a real expense, asserts **Receipt Missing** in the receipt panel and in the recorded details, uploads a real one-pixel PNG through the real multipart route, and asserts the row carries the server-allocated `HY-DOC-\d{6}` reference and the Admin's own filename, that the recorded detail flips to `Attached`, and that download and preview controls appear |
| Removal browser evidence | Pass | A removal with an empty reason is refused and the receipt stays in place with the detail still `Attached`; a removal with the reason `wrong expense` succeeds and the panel then states `This receipt was removed.`, shows `Reason: wrong expense`, returns the recorded detail to `Receipt Missing`, and offers no download control |
| Content-delivery browser evidence | Pass | Two journeys cover what a visible button alone cannot prove. The download journey clicks **Download receipt** and **Preview receipt**, captures both outgoing requests to prove the panel used the server-supplied path and carried the session, then reads the bytes back: both routes answer `200`, both return `image/png`, both return the exact 70-byte PNG that was uploaded, and the download offers `receipt-bytes.png` as the filename. The post-removal journey reads the stored UUID from the API's own projection and asserts the content route then answers `410`, so the retained row and the unreadable bytes are both proven rather than inferred |
| Multipart security evidence | Pass | The 40-test contract suite asserts a missing session and a missing CSRF token are refused on the upload route, that a declared image type with non-image bytes is refused, that an oversized body is refused with `413`, that a crafted filename carrying `../` is refused rather than sanitised into a valid path, and that a header-bearing filename cannot inject response headers |
| Storage-key containment evidence | Pass | `local-document-storage.spec.ts` asserts an invalid key is rejected on `open`, `delete`, and `exists` rather than reported as an absent file, and that a traversal key cannot escape the configured root |
| Real-PostgreSQL document evidence | Pass | `document-persistence.db-spec.ts` asserts the declared and detected types are both constrained to the allowed set, that the storage key is required and non-empty, that no raw bytes or filesystem path column exists, that removal requires and retains a reason, and that a removed document's receipt projection flows through `toExpenseSummary` |
| Retention evidence | Pass | The browser journey asserts a removed receipt keeps its reference, reason, and removal date on screen and is not deleted, and the contract suite asserts a removed document's content route answers `410 Gone` rather than `404` |

## Phase 07 defects found and fixed

| Defect | How it was found | Fix | Regression evidence |
|---|---|---|---|
| A failed authorization on the document upload route was reported to the browser as `400 VALIDATION_FAILED` instead of `401`/`403` (`ISSUE-036`, `DEC-084`) | Writing `apps/api/test/documents-http.e2e-spec.ts`: the "refuses an upload without a session" test came back `400` with the multipart validation envelope. The route-scoped `@Catch()` filter mounted on the upload handler was the cause, because a route-scoped exception filter in NestJS intercepts *every* exception raised while that route is served, so an authentication or authorization failure thrown upstream was caught by the multipart branch and rewritten. The filter also matched on the presence of any `code` string rather than on known Multer codes, which widened the set of errors it swallowed. The same run then proved the browser could not have sent a traversal filename as a test, because Multer had already basenamed it before the validator ran | Moved multipart error mapping into the global `ApiExceptionFilter`, ordered after the `DomainError` and `HttpException` branches and before the unhandled branch, so a `401` or `403` keeps its own status. Added `common/errors/multipart-error.ts`, which maps only the documented Multer codes and returns `null` for anything else, and deleted `apps/api/src/documents/multipart-error.filter.ts`. Set `preservePath: true` on `FileInterceptor` so the filename validator sees what the client actually sent (`DEC-085`) | The 40-test contract suite asserts `401` without a session and `403` with a stale CSRF token on the upload route, an unfamiliar error code stays `500`, and a crafted `../` filename is refused rather than basenamed |
| `LocalDocumentStorage` reported a malformed storage key as "file absent" rather than as an invalid request (`ISSUE-037`, `DEC-086`) | Writing `apps/api/test/local-document-storage.spec.ts`: `open`, `delete`, and `exists` only guarded against the traversal case, so a key that was not 64 lowercase hexadecimal characters and contained no traversal segment fell through to the filesystem lookup, produced `ENOENT`, and was mapped by the service to `notFound`. The API was therefore claiming a document did not exist when it had been asked about an identifier this system never issued, which is the state-honesty rule failing in the direction of a wrong answer | Every key is validated against the documented format before any filesystem access, and an invalid key is rejected as an invariant violation. A key that validates and genuinely does not exist still reports `notFound`, which remains the honest answer for a real absence | `local-document-storage.spec.ts` covers all three operations with an invalid key, the traversal key cannot escape the configured root, and the contract suite still returns the documented `NOT_FOUND` for a real removal |
| An upload of unrecognisable bytes could be recorded with the type the client declared (`ISSUE-038`) | Writing `apps/api/test/document-content.spec.ts`: content detection returns `null` for bytes matching no supported signature, and the validator consulted the declared type whenever detection returned `null`, so a request whose content was neither an image nor a PDF was accepted whenever the client claimed it was one. The HTTP suite's declared-image/non-image-body case was the visible symptom | A `null` detection is now rejected before the declared type is consulted, so only bytes that genuinely are a supported image or PDF can be stored. The declared type remains authoritative for a re-typed file only when detection agrees the bytes are a supported format | `document-content.spec.ts` asserts unknown bytes are refused whatever the client declares, and the HTTP suite proves a declared-image/non-image-body upload is refused |
| The income search-and-filter journey failed against a reused test database, and some of its assertions could have passed without proving anything (`ISSUE-039`, `DEC-090`) | The full `npm run test:e2e` run after the document journeys were added. `hyssop_finance_test` is deliberately not reset between runs, so income rows accumulate: the journey asserted that a record reappeared after clearing a filter, but the record could be on a later page, and a "count 0" assertion would equally have passed for a record that was merely off the first page | The journey now waits for the reset to finish clearing criteria, then searches for the run's unique text to narrow the list to exactly the record under test before asserting the filter sequence. No assertion was weakened and no product code changed | `npm run test:e2e` passes 38/38, and because the list is narrowed first, the later amount-range assertions are meaningful too |
| The project-local PostgreSQL cluster intermittently refused to start or dropped connections while the workspace was synchronised by OneDrive (`ISSUE-040`) | The Phase 07 gate runs. The cluster's data directory is inside the OneDrive-synchronised workspace, and OneDrive holding `tmp/pgdata/server.log` open produced a `sharing violation` plus an occasional client-side startup failure. This is the same class of environment as `ISSUE-024`, which was previously attributed to DLL initialisation and not to OneDrive; both are recorded rather than merged, because `ISSUE-024`'s reproduction outside the synchronised tree did not reproduce | Started the cluster detached from the interactive shell, as `ISSUE-024` already required, and kept it inside the authorized workspace. No project change: `HYSSOP_PG_DATA_DIR` already overrides the data directory, and Docker is not installed here, so `docker-compose.yml` remains the unverified path (`ISSUE-016`) | `npm run test:db` passed 9 suites/158 tests, `db:validate`, `db:status`, and `db:drift` all reported no drift and dropped the shadow database, and the browser run passed 38 tests against the same cluster |
| Two Phase 06 browser journeys and two web unit tests asserted the Phase 06 receipt placeholder rather than the Phase 07 behaviour (`ISSUE-041`, `DEC-091`) | Expected: those assertions were correct when Phase 06 prohibited an upload control because Phase 07 owned the storage subsystem, and they are wrong once Phase 07 ships the panel. The failures were the tests being outdated, not the product regressing | The tests were rewritten to assert the delivered behaviour rather than deleted: the expense journey uploads a real image and removes it again with a reason, the receipt-without-reason journey proves the refusal, and the web tests assert the real panel. The create form still has no file input, which is now recorded as a consequence of attaching by transaction id rather than as a missing feature | `npm run test:e2e` passes 38/38 and `npm run test:web` passes 13 files/351 tests, and the assertions now describe the shipped behaviour |
| A download control that did nothing on failure, and one removal idempotency key shared by every row | Final Phase 07 code audit, reading `TransactionDocumentsPanel.tsx` rather than trusting the green suite. The content fetch caught its error and returned nothing, leaving a visibly enabled control that silently did nothing, which is the dead control `docs/phases/PHASE-07-DOCUMENTS.md` prohibits. Separately, `useRemoveDocument` was handed `createIdempotencyKey()` called during render, so every re-render minted a fresh key and a retry after a failure could not be recognised as the same intent. Both defects were invisible to the suite because no test had two receipts on one transaction and no test failed a content fetch | The failed fetch now sets a reported banner instead of returning silently. Removal state moved from one shared reason box, error, and render-time key to a `removals` record keyed by document id: the reason, the error, and the idempotency key are all per-document, the key is minted on the first keystroke of an intent and reused on retry, and it is cleared only once the removal succeeds | Four new web tests cover the fixes directly: one receipt's reason never appears in another's box and removing the wrong row is refused without sending anything, two removals use two distinct keys, a retry of the same removal reuses its key, and a failed download is reported. Four `api-client.test.ts` tests cover the transport: `FormData` passed through with no `Content-Type`, the JSON reason in the `DELETE` body, a `400` field issue preserved as a `field`/`message` pair, and a `410` raised as a typed error rather than a transport fault. `npm run test:web` passes 351/351 |

## Phase 07 non-blocking advisories

| Advisory | Assessment |
|---|---|
| The NestJS internal legacy-route advisory about `/api/*` (`ISSUE-012`) | Framework-owned and unchanged by Phase 07. It is emitted during API start-up and does not affect any document route; the documented 404 envelope is verified by integration test |
| The contribution-period panel has no year selector, so a period configured for a future year is invisible (`ISSUE-023`) | Carried from Phase 04 and unchanged by Phase 07. No locked requirement owns a year selector, and the document work does not touch the contribution-period projection |
| The project's Vite build reports a chunk larger than 500 kB after `built in 301ms` | Pre-existing and non-blocking: the bundle is served by `vite preview` for acceptance, the figure is a size advisory rather than an error, and it is not a Phase 07 regression. Recorded so it is not mistaken for a failed build |
| A browser-side 10 MB pre-check on uploads duplicates a server-owned limit (`DEC-088`) | Deliberate and honest: the interface states it as a pre-check so a non-technical pastor does not wait for a doomed upload, while `UPLOAD_MAX_BYTES` on the API remains the only enforcement point and the HTTP suite proves an oversized body is refused with `413` |

## Phase 06 expense gate

Phase 06 owns `REQ-EXP-001`–`REQ-EXP-004` and `REQ-DOC-003`, with the acceptance identifiers `TEST-EXP-001`, `TEST-FIN-002`, `TEST-FIN-003`, `TEST-DOC-001`, and `TEST-E2E-001`. All evidence below is from the final run on 2026-10-01, after the five Phase 06 findings in the table beneath this gate were fixed.

Environment assumptions: unchanged (Windows, Node `22.19.0`, npm `10.9.3`, PowerShell 5.1, project-local PostgreSQL `16` on loopback port `55432`, `hyssop_finance_dev` and `hyssop_finance_test`). The project-local cluster had to be started detached from the interactive shell to stay up (`ISSUE-024`). The Playwright run provisions its own Admin with a random password generated in memory, applies migrations to the `_test` database, never reads or prints a real credential, and now also restores the initial expense category set idempotently before the journeys start (`ISSUE-034`). `hyssop_finance_test` is not reset between runs, so the browser suite uses unique descriptions, amounts, and category names each run.

| Command | Result | Evidence |
|---|---|---|
| `npm run db:validate` | Pass | `The schema at prisma\schema.prisma is valid` |
| `npm run db:status` | Pass | `5 migrations found in prisma/migrations` and `Database schema is up to date!`; Phase 06 added no migration, because `expense_category` and the expense transaction columns were created and reviewed in Phase 02 |
| `npm run db:drift` | Pass | `=== hyssop_finance_dev vs prisma/schema.prisma: no difference detected ===` against a disposable shadow database that was dropped afterwards |
| `npm run lint` | Pass | `eslint .` reported no problems |
| `npm run format:check` | Pass | `All matched files use Prettier code style!` after one `npm run format` pass over the 17 Phase 06 files that had drifted |
| `npm run typecheck` | Pass | Contracts build, `apps/api` and `apps/web` `tsc --noEmit` all clean, including the Playwright specs under `apps/web/e2e` |
| `npm run typecheck:scripts` | Pass | `tsc -p tsconfig.scripts.json` clean |
| `npm run test:api` | Pass | 25 suites, 418 tests, including the new 84-test `expense-http.e2e-spec.ts` contract suite and the unchanged Phase 02–05 regression suites |
| Shared test doubles | Pass | `income-http.e2e-spec.ts` shows 761 deletions and 34 insertions in this diff, which is **not** a loss of tests: its private in-memory repository doubles were extracted into `apps/api/test/support/fake-ledger.ts` so the income and expense contract suites cannot drift apart about the rules a double stands in for. The suite still declares its 93 tests and passes all of them, and the file's own header comment now records why one shared double is required instead of a private copy per suite |
| `npm run test:web` | Pass | 12 files, 325 tests, including the new 90 expense tests across `expenses.test.tsx` and `expense-api.test.ts` |
| `npm run test:db` | Pass | 8 suites, 136 tests against real PostgreSQL, including the new 19-test `expense-persistence.db-spec.ts` |
| `npm run build` | Pass | Contracts declaration build, `nest build` for `apps/api`, and `vite build` for `apps/web` (`built in 248ms`) |
| `npm run verify` | Pass | `npm run verify` exited `0` over lint, typecheck, script typecheck, 418 API tests, 325 web tests, both builds, and the format check, in that order, after the format pass |
| `npm run test:e2e` | Pass after four journey fixes | 35 Playwright tests (`35 passed (47.8s)`) against the built bundle served by `vite preview`, with a real API process and a real PostgreSQL database; 10 of the 35 are the new Phase 06 expense journeys |
| Combined Phase 05 + Phase 06 regression | Pass | The same `npm run test:e2e` run executes the 10 Phase 05 income journeys and the 10 Phase 06 expense journeys in one suite against one API and one database: the 25 pre-existing journeys (10 auth, 2 foundation, 10 income, 3 members) all still pass alongside the 10 expense journeys |
| `REQ-EXP-001` initial categories | Pass | `expense-persistence.db-spec.ts` asserts the 12 documented categories exist, `restoreInitialExpenseCategories()` provisions them from the same canonical constant the seed uses, and the expense journey records a real `Water` expense |
| `REQ-EXP-002` custom categories | Pass | 21 HTTP tests cover create, trim, case-insensitive duplicate rejection, length and emptiness validation, refusing a forged `isSystem`, idempotent replay, and refusal of a different payload on the same key; the journey adds a category inline and immediately records an expense with it |
| `REQ-EXP-003` payment methods | Pass | An unknown payment method is refused, and the list filters by Cash, UPI, and Bank Transfer |
| `REQ-EXP-004` exactly one active category | Pass | A missing category, an unknown id, a non-UUID id, and a deactivated category are each refused, the deactivated case naming the field; clearing the category on a correction and moving to a deactivated category are refused; `expense-persistence.db-spec.ts` proves the database itself refuses an expense without an active category |
| `REQ-DOC-003` Receipt Missing | Pass | `hasReceipt` is derived, never stored: three HTTP tests report no receipt for an expense with nothing attached and a receipt for one with an attached document; the journey asserts `Receipt Missing` in the receipt panel, in the recorded details, and the absence of any attach control |
| Negative and security testing | Pass | Unauthenticated reads and writes are refused, a write without a CSRF token is refused, an untrusted origin is refused with a valid session, and `Idempotency-Key` is required rather than generated; replay returns the original record and a reused key with a different body returns `409` |
| Void and audit evidence | Pass | A void requires a reason, keeps the record readable with the reason recorded, and freezes the record against later edits; the journey asserts the audit history contains `TRANSACTION_VOIDED` and that the record's void state says in words that it is not counted in totals |
| Category lifecycle evidence | Pass | A category is renamed and deactivated rather than deleted, a historical expense keeps its label under a later-deactivated category, a new expense on it is refused, reactivation works, and there is no delete route |
| Secret and staged-file review | Pass | A credential-pattern scan over all 36 changed and added files matched no Argon2 hash, JWT, private key, token prefix, literal password, or connection string. `.env` is ignored and untracked, only `.env.example` is tracked, and no build output, dependency, Playwright report, trace, or local database artifact is staged. `git diff --check` reported no whitespace errors |
| Traceability review | Pass | No `REQ-*` or `TEST-*` identifier was added, removed, or renumbered, so `docs/14-TRACEABILITY-MATRIX.md` needed no edit |
| Git gate | Pass | 38 intended files committed and pushed to `origin/main` as `6a2ad41bcf40f6bfffd11b9a98ea1520db0cc479`; after a fresh `git fetch`, `git rev-parse HEAD` and `git rev-parse origin/main` both return that hash |

## Phase 06 defects found and fixed

| Defect | How it was found | Fix | Regression evidence |
|---|---|---|---|
| The shared transaction detail, correction, and void responses projected expenses through `toTransactionSummary`, so an expense read through those routes lost its category and its receipt state (`ISSUE-032`, `DEC-079`) | Writing `expense-http.e2e-spec.ts`: the "reads the detail with its category" and "carries the expense guarantees on the shared transaction detail route" tests failed against a correct database row | Added `toTransactionView()` in `transaction-mapper.ts`, which dispatches to the expense or income projection by stored type, and used it in the three `TransactionsService` responses that return a single transaction | Two HTTP tests assert the category and receipt state on the detail, correction, and void responses; the expense journey asserts the recorded category and `Receipt Missing` on the detail screen, which is only reachable through that projection |
| The inline "Add a category" panel inside the record form was a `<form>` nested inside the record form's own `<form>`, which HTML does not permit (`ISSUE-033`, `DEC-080`) | The expense journey "a custom category is added inline and is immediately usable for a new expense", which failed while the panel was a nested form | Replaced the nested form with a `<fieldset>` that carries no form owner, a `type="button"` add action, an Enter-key handler scoped to the panel, and `disabled` plus `aria-busy` while the request is in flight | The journey records a category inline and then records the expense in the same still-open session; the web unit tests cover the fieldset's disabled and busy states and the Enter path. The invalid nesting itself was verified in Chromium, where the HTML parser discards a `<form>` inside another `<form>` entirely; the exact pre-fix runtime symptom was not retained, so no claim about it is recorded |
| The browser suite had no expense categories to work with after `npm run test:db`, because the disposable test database's `reset()` deliberately leaves `expense_category` empty to keep the repository isolation tests independent (`ISSUE-034`, `DEC-081`) | A full `npm run test:e2e` run immediately after a passing `npm run test:db`; the API answered an honest empty category list, so every expense journey failed at the first control | Added `restoreInitialExpenseCategories()` in `apps/api/test/database/support/baseline-configuration.ts`, which creates the missing initial categories with `isSystem: true` and `skipDuplicates`, reactivates any that were deactivated, and verifies the normalized-name count; `global-setup.ts` calls it after migrations and Admin provisioning | Seeding categories in `reset()` was tried first and reverted because it made the repository suites share state, which is the failure mode those tests exist to catch. `npm run test:db` and `npm run test:e2e` now both pass in either order: 136/136 and 35/35 in sequence |
| The duplicate-category journey asserted the stub client's wording instead of the API's, the void journey expected a hyphen where the interface renders an em dash, the receipt journey's locator matched two legitimate elements, and the deliberate `409` was counted as a browser error (`ISSUE-035`) | Writing the journeys, one failure at a time, against the real API rather than the stub | Asserted the API's own message, the interface's own punctuation, scoped the receipt assertion to the `Receipt` region, and added an opt-in `allowOneConflict` allowance to `collectBrowserErrors` that only absorbs a `409` on the category route and only when a journey asks for it | `npm run test:e2e` 35/35. No assertion was weakened and no interface copy was changed to satisfy a test; the journey now proves the API's message reaches the Admin against the field it belongs to |
| Duplicate-category feedback was not reaching the Admin, because the API reports the offending field as `details.field` and the browser read `fieldIssuesByName(error).name` | The duplicate-category journey passing its message assertion while the Admin saw nothing | No API change was needed: `ApiExceptionFilter` already turns `details.field` into the documented `fields` issue, so the browser's existing lookup was correct and only the test's expectation was wrong | `fieldIssuesByName` resolves `{ field: 'name' }` to the `name` field issue, the unit tests assert the message is placed on the name input, and the journey now sees the API's own wording |

## Phase 06 non-blocking advisories

| Advisory | Assessment |
|---|---|
| The local PostgreSQL cluster still requires a detached launch to stay up on this machine (`ISSUE-024`) | Environmental, not a project defect, and unchanged from Phase 05; recorded as a run instruction rather than worked around in project code |
| A bare `npx playwright test` skips the `pretest:e2e` rebuild and serves the previous `dist/` (`ISSUE-031`) | A diagnostic-invocation trap, not a product fault. It mattered more in Phase 06 because `ISSUE-032` was a server-side fix that only reaches the browser through a rebuild; the gate is still self-protecting, so no project change was made and acceptance evidence is taken only from `npm run test:e2e` |

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
