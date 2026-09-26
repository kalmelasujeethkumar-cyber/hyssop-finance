# HYSSOP FINANCE — Test Results

## Document Responsibility

- Owns: executed commands, environment assumptions, results, failures, fixes, retests, and evidence locations.
- Does not own: test specifications, product requirements, technical decisions, or planned scenarios.
- Referenced by: `10-TEST-PLAN.md`, `11-DEFINITION-OF-DONE.md`, and phase completion gates.
- Change rule: record objective run evidence; never convert a planned test or self-assessment into a passing result.

## Current status

**Phase 01 foundation quality gate passed on 2026-09-26. No phase is marked `COMPLETE` until its Git gate evidence is recorded below.**

Phase 01 introduced the first executable application code in the repository: the API shell, the web shell, shared contracts, and the quality-gate tooling. The financial and business layers remain unimplemented by design.

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

## Defects found and fixed during the phase

| Defect | How it was found | Fix | Regression evidence |
|---|---|---|---|
| `StructuredLogger` factory received no `ConfigService`, so the real API process aborted on startup with `Cannot read properties of undefined (reading 'getOrThrow')` | Browser acceptance run; unit tests had overridden the provider and therefore missed it | Added the explicit `inject: [ConfigService]` dependency to the provider factory in `apps/api/src/app.module.ts` | `npm run test:e2e` boots the real composition and answers `200` |
| Startup failures reported only `The API failed to start.`, hiding the root cause | Diagnosis of the same failure | `apps/api/src/main.ts` now adds the reason and stack to server-side stderr while still returning a generic client message | Startup failure in the smoke run was then diagnosable as `EADDRINUSE` |
| The production build shipped a bundle whose API base URL came from `.env` instead of the smoke-mode value, so the browser called the wrong origin | Browser acceptance run failed with `data-state="unavailable"` while the API log showed no browser request | `smoke` mode now injects the value through Vite `define`, and a production build fails fast when `VITE_API_BASE_URL` is absent | `npm run build` and `npm run test:e2e` pass; the API log shows the browser request |
| `vite preview` resolved `dist` relative to the invocation directory, so a repository-root invocation failed with `The directory "dist" does not exist` | Manual preview diagnostic | `apps/web/vite.config.ts` sets an explicit `root`, and the proxy target now honors the process environment | `npm run test:e2e` serves the built bundle successfully |
| Section titles used weight 600, below the documented 650–700 range in `04-DESIGN-TOKENS.md` | Specification comparison during self-review | Section headings now use `font-bold` (700) | Visual rule now matches the token document |
| `eslint` reported 3 remaining strictness violations after the first pass | `npm run lint` | Removed the redundant assertions, typed the rejection helper parameter as `Error` | `npm run lint` passes with no rule disabled |

## Non-blocking advisories

| Advisory | Assessment |
|---|---|
| `npm install` warns that `@angular-devkit/*` (Nest CLI tooling) declares Node `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0` while the approved runtime is `22.19.0` | Build, typecheck, and tests all pass on the approved runtime; `nest generate` may be restricted on a newer Node. Tracked as an open issue, not a phase failure |
| NestJS logs a `LegacyRouteConverter` message for its internal catch-all route | Upstream Express 5 `path-to-regexp` advisory; the route is internal 404 handling, not an application route |
| `vite build` reports a chunk-size advisory for the single shell bundle | Expected for a shell with no route-level code splitting; recorded rather than suppressed |
| The default development port `3000` was already owned by an unrelated process on the developer machine | The acceptance run uses dedicated loopback ports; no process outside the workspace was inspected beyond identifying the port owner, and nothing outside the workspace was modified |

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
