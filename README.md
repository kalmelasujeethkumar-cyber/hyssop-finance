# HYSSOP FINANCE

HYSSOP FINANCE is a planned financial-management demo for one church. This repository currently contains the project constitution, specifications, phase plan, traceability matrix, and runtime documentation created during Prompt 01 and hardened during Prompt 01B.

## Current status

- Stage: Documentation Hardening
- Prompt: Prompt 01B
- Application implementation: **Not started**
- Database migrations: **Not started**
- React/NestJS application code: **Not started**
- Next step: user review and approval of the documentation checkpoint before Phase 01

The demo will eventually use React, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query where appropriate, Recharts, Node.js, NestJS, REST, PostgreSQL, Prisma, and real backend authentication. It will use a modular monolith and may later become production-ready only through explicit validation.

## Documentation map

- `AGENTS.md` — highest-priority project constitution
- `docs/00-PROJECT-BRIEF.md` — purpose and scope
- `docs/01-REQUIREMENTS.md` — locked requirements
- `docs/02-ARCHITECTURE.md` — proposed modular-monolith architecture
- `docs/03-UI-UX-RULES.md` — UI and interaction rules
- `docs/04-DESIGN-TOKENS.md` — light-theme design tokens
- `docs/05-DATABASE-SPEC.md` — data model and financial invariants
- `docs/06-API-SPEC.md` — proposed REST contracts
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

## Local documentation review

No application command is available at this stage. Prompt 01 reread the complete specification set, resolved cross-document ambiguities, verified the authorized remote and ignore rules, and checked tracked content for credentials. Application tests have not started.

## Future local development

The exact install, lint, typecheck, test, database, build, and E2E commands will be established during the approved foundation phase. They must be recorded in project documentation before use. Never place credentials in this file or in committed environment files.
