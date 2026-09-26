# PHASE 00 — Documentation Bootstrap

## Document Responsibility

- Owns: the documentation bootstrap checkpoint, constitution, ownership model, traceability matrix, and runtime tracking initialization.
- Does not own: any `REQ-*` product requirement or application acceptance result; phases reference requirements rather than redefining them.
- Primary owned requirements: none; this phase establishes the documents that own them.
- Consumed requirements: all `REQ-*` identifiers, recorded as the baseline for later phases.
- Authority references: `AGENTS.md`, `docs/00`–`docs/14`, `docs/runtime/`, and `09-GIT-RULES.md`.
- Deliverables: owned specifications, consistent phase contracts, traceability audit, and a verified documentation checkpoint.
- Out of scope: React, NestJS, Prisma, dependencies, migrations, credentials, deployment, and Phase 01 implementation.
- Handoff: user review and approval of the documentation checkpoint before Phase 01.
- Acceptance evidence: documentation coverage, duplication, contradiction, whitespace, and secret-safety checks; application test evidence remains explicitly not run.

## Phase Metadata

- Status: `COMPLETE` for Prompt 01; Prompt 01B documentation hardening is in progress.
- Preconditions: opened workspace, authorized `origin`, no application code required.
- Handoff rule: the next phase starts only after the documentation gate and user approval.

## Objective

Establish the permanent operating system for HYSSOP FINANCE: project constitution, complete specifications, phase plan, runtime tracking, Git safety, and verification framework. This phase is documentation-only.

## Scope

- Create `AGENTS.md` and the root safe files.
- Create `docs/00` through `docs/13`.
- Create `docs/phases/PHASE-00` through `PHASE-12`.
- Create `docs/runtime/` tracking files.
- Initialize Git, verify the authorized `origin`, and create a documentation checkpoint.
- Perform a consistency review of all documents.

## Prerequisites

- The workspace is the opened `HYSSOP-FINANCE` directory.
- The user has authorized Prompt 01.
- No application code or infrastructure is required.

## Expected files and modules

- `AGENTS.md`, `README.md`, `.gitignore`, and a placeholder-only `.env.example`.
- Fourteen specification documents and thirteen phase documents.
- Six runtime documents: current state, decisions, issues, test results, phase history, and final report.

## Implementation requirements

- Derive the specifications from the approved prompt without weakening locked rules.
- Define exact money, void, audit, document-storage, security, permission, and deployment boundaries.
- Record runtime status honestly as implementation not started.
- Verify that only workspace content is included in Git.

## Prohibited shortcuts

- No React, NestJS, Prisma, Docker, or dependency installation.
- No database migrations or seeds.
- No placeholder-only specification documents containing only headings.
- No invented credentials, tokens, deployment URLs, or test results.
- No autonomous start of Phase 01 or later.

## Acceptance criteria

- `AGENTS.md` and all specification, phase, and runtime files exist with meaningful content.
- Document priority, reread protocol, drift rule, stop conditions, and phase gate are explicit.
- Financial calculation, exact money, void, audit, and storage rules are unambiguous.
- Git status, diff, and staged files are inspected; no secrets or unrelated files are present.
- A meaningful documentation checkpoint commit is created and pushed only if authentication is already available.
- The user is given a review opportunity before implementation begins.

## Tests required

- Documentation consistency review by rereading every document.
- Reference check for phase numbering and required file names.
- Secret and personal-data scan of tracked content.
- Git status, diff, and remote verification.
- No application tests, because no application exists yet.

## Documentation updates required

Record the checkpoint in `docs/runtime/CURRENT-STATE.md` and `docs/runtime/PHASE-HISTORY.md`. Record only real issues in `docs/runtime/ISSUES.md`.

## Git completion gate

Inspect status, files, and diff; verify no secrets; commit with `chore: establish HYSSOP FINANCE project constitution and specifications` or an equally clear message; push to the authorized `origin` only after the gate passes; record the hash.

## Rollback and recovery

If the checkpoint must be abandoned before publication, do not rewrite published history. Remove or correct only uncommitted workspace files, explain the change, and commit a focused correction. If a secret is ever staged, stop and ask the user before any history action.

## Completion checklist

- [x] Constitution created and reviewed.
- [x] Specifications `00` through `13` created and reviewed.
- [x] Phases `00` through `12` created and reviewed.
- [x] Runtime files initialized and reviewed.
- [x] `.gitignore`, `.env.example`, and `README.md` reviewed.
- [x] Consistency review complete.
- [x] Git remote verified.
- [x] Checkpoint commit created.
- [x] Push verified or blocked status recorded.
- [x] User review requested before Phase 01.
