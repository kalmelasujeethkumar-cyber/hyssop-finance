# HYSSOP FINANCE

HYSSOP FINANCE is a financial-management demo for one church. The repository contains the project constitution, locked specifications, phase plan, traceability matrix, and runtime documentation, plus the implemented application: a NestJS API, a React + Vite web app, shared contracts, the canonical Prisma data layer, authentication, members, income, expenses, documents, dashboard, reports, audit history, settings, and the responsive application shell.

Every figure is computed and persisted through the backend and database. Nothing in the interface is presented as complete before its real path exists.

## Current status

- Stage: Phase 12 — Final QA (local quality gate passed; deployment `BLOCKED — DEPLOYMENT NOT AUTHORIZED`)
- Application implementation: **complete** (API, web app, contracts, data layer, authentication, members, income, expenses, documents, dashboard, reports, audit history, settings, responsive shell)
- Database, Prisma, and migrations: **implemented**; 7 reviewed migrations applied to a disposable local PostgreSQL 16 instance
- Authentication, sessions, and CSRF: **implemented** (single Admin, Argon2id, server-side sessions, cookie CSRF, login and request rate limits)
- Members, contributions, income, expenses, documents, dashboard, and reports: **implemented** and verified
- Deployment: **BLOCKED** — no hosting target is authorized (`ISSUE-051`); a local-only run is not a deployment
- Next step: a user decision on a future demo deployment path; see `docs/runtime/FINAL-REPORT.md`

## Workspace layout

- `apps/api` — NestJS API shell: validated configuration, structured JSON logging with redaction, request IDs, global error envelope, Helmet, explicit CORS, and `GET /api/v1/health`; persistence repositories, idempotency, and reconciliation
- `apps/web` — React + Vite + Tailwind shell: design tokens, router, layout, route error boundary, typed API client, and a real connectivity check
- `packages/contracts` — shared API envelope, error codes, request-ID header, and health types
- `prisma/` — canonical schema, reviewed migrations, and the fictional idempotent seed
- `scripts/` — project tooling, including the disposable local PostgreSQL workflow
- `docs/` — specifications, phase contracts, and runtime records; `AGENTS.md` is the constitution

## Local development

Requirements: Node `>=22.12.0`, npm `>=10.9.0`, and PostgreSQL `16` binaries on the machine. Use Windows PowerShell commands as written; every script is cross-platform.

```powershell
npm install
Copy-Item .env.example .env
npm run db:start     # disposable local PostgreSQL 16 cluster on 127.0.0.1:55432
npm run db:migrate   # apply reviewed migrations
npm run db:seed      # fictional demo fixtures (idempotent)
npm run dev
```

`npm run dev` starts the contracts watcher, the API, and the web dev server. Open `http://127.0.0.1:5173`. The API listens on `PORT` (default `3000`) and answers `http://127.0.0.1:3000/api/v1/health`. Health is a process check and never queries the database.

Database URLs: `DATABASE_URL` is the least-privilege runtime role (`hyssop_app`), and `DIRECT_DATABASE_URL` is the schema-owner role (`hyssop_migrator`) used only for migrations. `npm run db:start` prints both URLs for the development and test databases; the local cluster uses loopback-only `trust` authentication, so no password is stored in the repository. `docker-compose.yml` is the container alternative and is not verified on the current machine.

`npm run db:drift` verifies that the migrations and `prisma/schema.prisma` agree and that the development database still matches the schema. It creates and drops its own `hyssop_finance_shadow` database, because `prisma migrate diff` destroys whatever database it is given as a shadow. Never pass a database that holds data as `--shadow-database-url`.

Configuration lives in one root `.env`; `.env.example` is the only template and contains no secrets. Only `VITE_`-prefixed values reach the browser. The web dev and preview servers are bound to `127.0.0.1` and proxy `/api` to `API_PROXY_TARGET`, so the browser calls one origin. If `3000` is already in use on your machine, change `PORT` and `API_PROXY_TARGET` together and add the matching origin to `CORS_ALLOWED_ORIGINS`.

## Quality gate

```powershell
npm run lint           # ESLint 10 flat config, type-aware rules, no rule disabled
npm run typecheck      # contracts build + strict tsc for the API and the web app
npm run typecheck:scripts # strict tsc for prisma/seed*.ts and scripts/
npm run test           # 42 API suites / 865 tests + 21 web files / 557 tests
npm run test:db        # 13 suites / 267 tests against real disposable PostgreSQL
npm run db:drift       # migration history and live dev database vs prisma/schema.prisma
npm run build          # contracts, nest build, vite build
npm run format:check   # Prettier
npm run test:e2e       # 71 Playwright journeys; builds the smoke bundle and starts both services
```

`npm run verify` runs lint, typecheck, tests, builds, and the formatting check in order. `npm run test:db` requires a running local PostgreSQL 16 cluster, refuses any database name that does not end in `_test`, and derives its test URLs from the development URLs unless `TEST_DATABASE_URL` and `TEST_DIRECT_DATABASE_URL` are set. `npm run test:e2e` builds the web app in `smoke` mode first; install the browser once with `npx playwright install chromium`.

A production web build fails fast when `VITE_API_BASE_URL` is missing, because a bundle is only correct when its API origin is known at build time.

Executed evidence for this stage is recorded in `docs/runtime/TEST-RESULTS.md`.

## Documentation map

- `AGENTS.md` — highest-priority project constitution
- `docs/00-PROJECT-BRIEF.md` — purpose and scope
- `docs/01-REQUIREMENTS.md` — locked requirements
- `docs/02-ARCHITECTURE.md` — modular-monolith architecture
- `docs/03-UI-UX-RULES.md` — UI and interaction rules
- `docs/04-DESIGN-TOKENS.md` — light-theme design tokens
- `docs/05-DATABASE-SPEC.md` — data model and financial invariants
- `docs/06-API-SPEC.md` — REST contracts
- `docs/07-SECURITY-RULES.md` — security requirements
- `docs/08-PERMISSIONS.md` — workspace and agent permissions
- `docs/09-GIT-RULES.md` — Git safety and phase gate
- `docs/10-TEST-PLAN.md` — verification strategy
- `docs/11-DEFINITION-OF-DONE.md` — completion criteria
- `docs/12-DEPLOYMENT-PLAN.md` — free-tier deployment direction
- `docs/13-DEMO-DATA-SPEC.md` — fictional data requirements
- `docs/14-TRACEABILITY-MATRIX.md` — requirement-to-phase-to-test mapping and audit counts
- `docs/phases/` — phase specifications 00 through 12
- `docs/runtime/` — current state, decisions, issues, evidence, and history

Never place credentials in this file, in a committed environment file, or in any documentation.
