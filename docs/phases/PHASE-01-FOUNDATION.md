# PHASE 01 — Foundation

## Document Responsibility

- Owns: workspace layout, toolchain, configuration validation, application shells, and reproducible build/test commands.
- Does not own: financial feature behavior, business formulas, or requirement definitions.
- Primary owned requirements: `REQ-AUTH-001`, `REQ-AUTH-006`, `REQ-FIN-026`.
- Consumed requirements: `REQ-RESP-001`, `REQ-RESP-012`, `REQ-RESP-013`, and the security constraints referenced by `07-SECURITY-RULES.md`.
- Authority references: `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `03-UI-UX-RULES.md`, `04-DESIGN-TOKENS.md`, `07-SECURITY-RULES.md`, `08-PERMISSIONS.md`, `10-TEST-PLAN.md`, and `14-TRACEABILITY-MATRIX.md`.
- Deliverables: `apps/web`, `apps/api`, shared configuration, health endpoint, and documented commands.
- Out of scope: members, contributions, income, expenses, documents, dashboard, reports, and financial calculations.
- Handoff: Phase 02 receives a clean shell, validated configuration, and reproducible commands.
- Acceptance evidence: `TEST-FIN-001` for money/period primitives, `TEST-RESP-001`, `TEST-RESP-002`, and `TEST-SEC-001` for shell security boundaries.

## Phase Metadata

- Status: `IMPLEMENTED`; quality gate passed and Git gate passed on 2026-09-26 with commit `1a11d34af7d4ef3f8352cdaabf533b9056b21b7f`. Phase completion still requires external review.
- Preconditions: Phase 00 complete and user approval recorded.
- Handoff rule: no required control may be presented as working until its real path is implemented and tested.

## Objective

Create the maintainable project foundation after the user approves the bootstrap: workspace layout, toolchain, linting, type checking, test harnesses, build pipeline, and a minimal running frontend and backend shell. No financial feature is completed in this phase.

## Scope

- Establish the modular-monolith repository layout from `02-ARCHITECTURE.md`.
- Configure TypeScript, Vite, Tailwind, NestJS, lint, format, typecheck, unit, integration, and build commands.
- Establish frontend routing, layout, error boundary, and query client shells.
- Establish backend bootstrap, configuration validation, health endpoint, and module skeleton.
- Document local commands and environment requirements.

## Prerequisites

- Phase 00 complete and user approval recorded.
- Specifications reread, especially `01`, `02`, `04`, `07`, `08`, `09`, and `10`.
- Authorized workspace and origin.

## Expected files and modules

- `apps/web`, `apps/api`, and shared configuration or contracts packages as justified.
- Root workspace scripts, TypeScript and lint configuration, and test configuration.
- Frontend route shell and backend health module.
- Environment validation using `.env.example` placeholders only.

## Implementation requirements

- Use React, TypeScript, Vite, Tailwind, React Router, TanStack Query, Node.js, NestJS, REST, and the locked testing tools.
- A library with no Phase 01 consumer, `recharts` in particular, is introduced by the phase that renders the first real chart; the technology direction stays as recorded in `02-ARCHITECTURE.md` and `DEC-042`.
- Keep financial logic out of the shell.
- Fail fast on missing or unsafe configuration.
- Provide reproducible install, lint, typecheck, test, and production build commands.

## Prohibited shortcuts

- No hard-coded dashboard totals, fake charts, dead controls, or placeholder pages presented as complete.
- No disabling of strict TypeScript, lint rules, or tests to obtain a green build.
- No unrelated global tool or system configuration changes.
- No financial feature implementation before the relevant phase.

## Acceptance criteria

- Clean install and documented commands work on a developer machine.
- Lint, typecheck, unit tests, and production builds pass.
- The frontend and backend start and expose a health check.
- No required control is presented as working when it is not.
- The shell matches the light theme and navigation rules.

## Tests required

- Configuration and environment validation unit tests.
- Health endpoint integration test.
- Frontend route and error-boundary component tests.
- Lint, typecheck, unit test, and build gates.

## Documentation updates required

Record commands, environment variables, layout decisions, and any deviations in the runtime documents and the affected specifications.

## Git completion gate

Pass the full applicable quality gate, inspect the diff for secrets and generated files, commit the phase coherently, push to `origin`, verify the push, and record the hash.

## Rollback and recovery

Revert only the phase's own uncommitted changes or create a corrective commit. Do not rewrite published history. If a foundation choice is incompatible with a locked requirement, stop and ask the user before proceeding.

## Completion checklist

- [x] Layout and scripts established — `package.json` workspaces, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `apps/api`, `apps/web`, `packages/contracts`.
- [x] Configuration validation implemented — `apps/api/src/config/environment.ts` fails fast; `apps/web/src/lib/env.ts` fails the production build when the API base URL is missing.
- [x] Frontend and backend shells run — `npm run dev` starts both; `GET /api/v1/health` answers 200 through a real process.
- [x] Lint, typecheck, unit tests, and build pass — see the Phase 01 gate table in `docs/runtime/TEST-RESULTS.md`.
- [x] Documentation and decisions updated — `docs/06-API-SPEC.md` health contract, `DEC-041`–`DEC-052`, `ISSUES.md`, `TEST-RESULTS.md`, `README.md`.
- [x] Git gate passed and hash recorded — `1a11d34af7d4ef3f8352cdaabf533b9056b21b7f` pushed to `origin/main` with a matching remote hash.
