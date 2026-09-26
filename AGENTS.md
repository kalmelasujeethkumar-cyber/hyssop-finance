# HYSSOP FINANCE — Project Constitution

## Status and purpose

HYSSOP FINANCE is a working financial-management demo for one church. The demo must use a real, maintainable architecture so it can later be evolved into a production application with explicit validation and approval. It is not a disposable UI prototype, and the current bootstrap is documentation-only.

The persistent source of truth for future OpenCode work is this repository. When instructions conflict, apply the priority order below rather than relying on conversational memory.

## Non-negotiable instruction priority

1. `AGENTS.md`
2. `docs/07-SECURITY-RULES.md`
3. `docs/08-PERMISSIONS.md`
4. `docs/01-REQUIREMENTS.md`
5. `docs/02-ARCHITECTURE.md`
6. `docs/05-DATABASE-SPEC.md`
7. `docs/06-API-SPEC.md`
8. `docs/03-UI-UX-RULES.md`
9. `docs/04-DESIGN-TOKENS.md`
10. `docs/10-TEST-PLAN.md`
11. `docs/11-DEFINITION-OF-DONE.md`
12. `docs/14-TRACEABILITY-MATRIX.md` (mapping and audit only; it does not create requirements)
13. The current phase document
14. Agent judgment

A lower-priority source must never silently override a higher-priority source. If two locked requirements genuinely conflict, stop and ask the user; do not choose silently.

`docs/00-PROJECT-BRIEF.md`, `docs/09-GIT-RULES.md`, `docs/12-DEPLOYMENT-PLAN.md`, and `docs/13-DEMO-DATA-SPEC.md` are not ranked above `docs/11-DEFINITION-OF-DONE.md`; they apply fully and are read whenever they are relevant to the work.

## Document Responsibility

The ownership map below is the canonical assignment of document authority. A document may reference another document, but it must not silently restate or override that document's authority.

| Document | Sole responsibility | Must not independently own |
|---|---|---|
| `AGENTS.md` | Constitution, precedence, workspace boundary, change control, execution protocol, and stop conditions | Product requirements, API details, database schema, or feature acceptance |
| `docs/00-PROJECT-BRIEF.md` | Product identity, purpose, scope, and non-goals | Detailed behavior, implementation, or verification procedure |
| `docs/01-REQUIREMENTS.md` | Locked business requirements, business formulas, and stable `REQ-*` identifiers | Architecture, schema, transport details, or test procedures |
| `docs/02-ARCHITECTURE.md` | System structure, module boundaries, canonical calculation layer, storage abstraction, and technology direction | New product behavior, database constraints, or test evidence |
| `docs/03-UI-UX-RULES.md` | User interaction, accessibility, responsive behavior, feedback, and state honesty | Business formulas, persistence, or server authorization |
| `docs/04-DESIGN-TOKENS.md` | Exact light-theme visual tokens and visual quality rules | Interaction behavior, business behavior, or component implementation |
| `docs/05-DATABASE-SPEC.md` | PostgreSQL/Prisma entities, constraints, invariants, indexes, and persistence rules | API routes, UI behavior, or product expansion |
| `docs/06-API-SPEC.md` | Versioned REST contracts, validation envelopes, filters, and response semantics | Business formulas, persistence schema, or visual design |
| `docs/07-SECURITY-RULES.md` | Application security controls and security verification obligations | Product scope, UI tokens, or deployment execution |
| `docs/08-PERMISSIONS.md` | OpenCode workspace permissions, agent boundaries, and stop permissions | Application security policy or feature requirements |
| `docs/09-GIT-RULES.md` | Git/GitHub safety, staged-file review, commit, push, and history rules | Product acceptance or runtime status |
| `docs/10-TEST-PLAN.md` | Test layers, stable `TEST-*` identifiers, scenarios, and evidence requirements | New product behavior or implementation decisions |
| `docs/11-DEFINITION-OF-DONE.md` | Phase and final completion gates and status vocabulary | Product requirements or test scenarios |
| `docs/12-DEPLOYMENT-PLAN.md` | Deployment direction, platform verification, and deployment limitations | Application feature behavior or local storage implementation details |
| `docs/13-DEMO-DATA-SPEC.md` | Fictional demo-data characteristics and data-integrity expectations | Product requirements, schema authority, or deployment status |
| `docs/14-TRACEABILITY-MATRIX.md` | Requirement-to-phase-to-test mapping and audit counts | Requirements, implementation, or independent policy |
| `docs/phases/PHASE-00`–`PHASE-12` | Phase objective, scope, dependencies, deliverable boundaries, and acceptance execution | Locked product requirements; phases reference `REQ-*` identifiers instead of redefining them |
| `docs/runtime/CURRENT-STATE.md` | Current phase, progress, next action, and blockers only | Decisions, issue history, test evidence, or final readiness |
| `docs/runtime/DECISIONS.md` | Accepted technical decisions with reasons and impacts | Current status, test results, or requirement definitions |
| `docs/runtime/ISSUES.md` | Open, blocked, and resolved issue records | Decisions, phase progress, or generic test results |
| `docs/runtime/TEST-RESULTS.md` | Commands, environment assumptions, results, failures, fixes, and evidence | Test specifications or product requirements |
| `docs/runtime/PHASE-HISTORY.md` | Chronological phase/prompt checkpoints and verified commit hashes | Current blockers or detailed test procedures |
| `docs/runtime/FINAL-REPORT.md` | Final readiness report and consolidated evidence | Current working state or decision log |

The map is normative for document responsibility. If two documents appear to own the same behavior, the document named in the relevant requirement or architecture contract is authoritative; the other document must link to it. The traceability matrix records this relationship without becoming a second source of truth.

## Workspace boundary

The authorized project boundary is the currently opened `HYSSOP-FINANCE` workspace. Work only inside that directory.

Never search, inspect, read, modify, move, rename, copy, upload, index, summarize, or delete files outside this workspace, including personal files, browser data, credentials, unrelated repositories, unrelated databases, unrelated Docker resources, system files, or other OneDrive content. If an apparently necessary resource is outside the boundary, stop and ask the user instead of accessing it.

Do not perform broad machine searches or unrelated machine administration. Do not change global Git, Windows, browser, security, account, or service configuration.

## Security and authorization

Respect OpenCode, operating-system, GitHub, Netlify, database, browser, account, and project security controls. Never bypass, disable, weaken, suppress, or work around a permission prompt, authentication challenge, security protection, or approval requirement.

Never expose, request, log, commit, or place in documentation passwords, access tokens, API keys, private keys, recovery codes, production secrets, or unrelated credentials. Use secure environment variables or the user's existing authorized authentication environment. If a secret or interactive authorization is required and is not already securely configured, stop and ask the user.

## Product constraints

The application name is locked as **HYSSOP FINANCE**. The demo has one authenticated user role: **Admin**. Do not add multi-user RBAC complexity unless a later approved requirement makes it necessary.

The eventual interface is light-only, professional, clear, and optimized for a non-technical pastor. It must use a white/blue/orange visual system, intentional responsive behavior, exact INR formatting, and Asia/Kolkata business dates.

The eventual application must genuinely calculate and persist financial data through the backend and database. It must not use hard-coded dashboard totals, fake charts, dead controls, or placeholder functionality presented as complete. Every required visible control must work or be absent from the completed experience.

## Required financial behavior

Use an exact money representation, not unsafe floating-point arithmetic. The database specification selects integer paise and API money strings. Financial totals include only active, valid transactions. Voided transactions remain auditable but are excluded from active totals, balances, and applicable calculations.

Financial transaction edits preserve audit history. Normal application deletion uses a required-reason VOID workflow. Member contribution tracking is period-based, supports full, partial, and unpaid states, and does not replace transaction history with one permanent amount field.

Transaction documents are associated through a storage abstraction. Demo storage is local and project-controlled; files are not stored as raw bytes in PostgreSQL. Production storage may replace the adapter without changing financial transaction rules.

## Documentation-first workflow

Before every future implementation phase, read or reread:

- `AGENTS.md`
- `docs/00-PROJECT-BRIEF.md`
- `docs/01-REQUIREMENTS.md`
- `docs/02-ARCHITECTURE.md`
- `docs/03-UI-UX-RULES.md`
- `docs/04-DESIGN-TOKENS.md`
- `docs/05-DATABASE-SPEC.md`
- `docs/06-API-SPEC.md`
- `docs/07-SECURITY-RULES.md`
- `docs/08-PERMISSIONS.md`
- `docs/09-GIT-RULES.md`
- `docs/10-TEST-PLAN.md`
- `docs/11-DEFINITION-OF-DONE.md`
- `docs/12-DEPLOYMENT-PLAN.md`
- `docs/13-DEMO-DATA-SPEC.md`
- `docs/14-TRACEABILITY-MATRIX.md`
- `docs/runtime/CURRENT-STATE.md`
- `docs/runtime/DECISIONS.md`
- `docs/runtime/ISSUES.md`
- `docs/runtime/TEST-RESULTS.md` when evidence is available
- The current phase document

Before declaring a phase complete, reread all specifications relevant to that phase and compare the implementation to them explicitly.

## Documentation drift rule

If a legitimate technical decision changes the documented design:

1. Check whether it conflicts with a locked requirement.
2. Stop and ask the user if it does.
3. Otherwise update the appropriate specification before implementation.
4. Record the decision, reason, and impact in `docs/runtime/DECISIONS.md`.
5. Implement only after the documentation is consistent.
6. Test the implementation and record evidence.

Never weaken a requirement just to make implementation easier.

## Change control procedure

For every specification or phase change, follow this procedure:

1. Classify the change as a product requirement, technical decision, verification update, runtime status update, or traceability-only update.
2. Identify the document that owns the changed behavior and update that document first.
3. If a stable identifier already exists, retain it; create a new identifier only for a genuinely new requirement or test concern and never renumber existing identifiers.
4. Update the technical decision, issue, or runtime record when the change has a technical reason, blocker, or status impact.
5. Add or update the requirement-to-phase-to-test mapping in `docs/14-TRACEABILITY-MATRIX.md` and verify that each required requirement has exactly one primary phase owner.
6. Reread every affected authority document and its current phase, then run coverage, duplication, contradiction, whitespace, and secret-safety checks.
7. Inspect the intended diff and staged file list, commit only intended files, push after the gate passes, verify the push, and record the verified hash in the appropriate runtime record.

A traceability-only correction may change mapping and audit metadata but must not silently create, weaken, or reinterpret a locked requirement.

## Phase execution state machine

Every future phase follows this order:

`READ MASTER RULES → READ CURRENT STATE → READ CURRENT PHASE → PLAN → IMPLEMENT → SELF-REVIEW → REREAD RELEVANT SPECIFICATIONS → COMPARE CODE AGAINST SPECIFICATIONS → LINT → TYPECHECK → UNIT TESTS → INTEGRATION TESTS WHERE APPLICABLE → DATABASE TESTS WHERE APPLICABLE → E2E TESTS WHERE APPLICABLE → PRODUCTION BUILD → PHASE-SPECIFIC ACCEPTANCE TESTS`

If a check fails, read the actual failure, determine the root cause, make the smallest safe fix, retest the affected area, and run required regression checks. Do not rewrite working code blindly or weaken tests to obtain green results. Mark a phase complete only after its quality gate passes.

## Git and repository safety

The only authorized remote is:

`https://github.com/kalmelasujeethkumar-cyber/hyssop-finance.git`

It is named `origin`. Never force-push, rewrite published history, delete the remote repository, delete remote branches without explicit user instruction, change repository visibility, modify GitHub account settings, or push to another remote. Never commit secrets or generated/local files that `.gitignore` protects.

For an implementation phase gate, inspect status, changed files, diff, recent history, and secret safety; run required tests and builds; commit only intended files with a meaningful message; push only after the gate passes; verify the push; and record the implementation/test commit hash in runtime documentation. A later evidence-only commit may record that verified hash and the push result; it must not change the implementation verdict. Do not commit merely to hide failures.

## Stop conditions

Stop and ask the user when any of the following occurs:

- Locked requirements genuinely conflict.
- Access outside this workspace is required.
- A secret, token, private key, or password is required and is not already securely configured.
- A destructive operation outside the project is required.
- GitHub authentication requires interaction.
- Netlify or another service requires authorization.
- Payment or a paid service would be required.
- A security protection would need to be bypassed.
- A database action could destroy non-demo or user data.
- A critical problem remains unresolved after several evidence-based repair attempts.
- A major architecture change contradicting these specifications appears necessary.
- A client requirement cannot be determined safely.
- An OpenCode or operating-system permission dialog requires approval.
- An external service cannot be configured safely without the user.

When blocked, update `docs/runtime/ISSUES.md` with status `BLOCKED`, current phase, problem, evidence, attempts, why continuing is unsafe, and the exact user action or information required. Then stop.

## Current prompt boundary

Prompt 01B is documentation-only. It hardens document responsibility, stable requirement and test identifiers, traceability, phase ownership, and the canonical financial calculation contract. It must not create React/NestJS feature code, install the full stack, run database migrations, authenticate, deploy, or begin Phase 01. After the documentation checkpoint and quality gate, stop for user review.
