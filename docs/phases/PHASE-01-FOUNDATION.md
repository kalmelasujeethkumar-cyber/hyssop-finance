# PHASE 01 — Foundation

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

- Use React, TypeScript, Vite, Tailwind, React Router, TanStack Query, Recharts, Node.js, NestJS, REST, and the locked testing tools.
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

- [ ] Layout and scripts established.
- [ ] Configuration validation implemented.
- [ ] Frontend and backend shells run.
- [ ] Lint, typecheck, unit tests, and build pass.
- [ ] Documentation and decisions updated.
- [ ] Git gate passed and hash recorded.
