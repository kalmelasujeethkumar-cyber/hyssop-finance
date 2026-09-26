# HYSSOP FINANCE — Git Rules

## Document Responsibility

- Owns: repository identity, authorized remote, Git safety, staged-file review, commit, push, history, and the phase Git gate.
- Does not own: product acceptance, runtime status, or test specifications.
- Referenced by: `AGENTS.md`, `11-DEFINITION-OF-DONE.md`, and `docs/runtime/PHASE-HISTORY.md`.
- Change rule: a Git or remote change requires explicit user instruction; published history is never rewritten.

## Repository

- Local repository root: the opened `HYSSOP-FINANCE` workspace.
- Authorized remote: `https://github.com/kalmelasujeethkumar-cyber/hyssop-finance.git`.
- Remote name: `origin`.
- Default working branch: `main`.

Never add a second remote or push to an unlisted host. Never change global Git configuration.

## Prohibited Git behavior

Never force-push, rewrite published history, delete the remote repository, delete remote branches without explicit user instruction, change repository visibility, modify GitHub account settings, commit secrets, commit `.env` files, commit private keys, or intentionally expose credentials in logs or documentation.

Do not bypass a GitHub authentication challenge. If push requires user interaction, stop and ask.

## Secret and file safety

- `.gitignore` protects environment files, dependencies, build output, coverage, logs, local uploads, local database artifacts, and editor or OS noise.
- `.env.example` is the only environment template and contains placeholders only.
- Before every commit, inspect staged file names and the diff for credentials, private keys, real personal data, local uploads, and unrelated files.
- Never use `git add -f` to force-add an ignored secret or generated file.

## Phase completion gate

A phase may be committed as complete only after:

1. `git status` is inspected.
2. Intended files and the diff are inspected.
3. Recent history is reviewed.
4. No secret-sensitive file is staged.
5. Required tests and build pass.
6. Documentation is updated to match the implementation.
7. A meaningful commit message describes the completed phase.
8. Push to `origin` is attempted only after the gate passes.
9. The push is verified.
10. The implementation/test commit hash is recorded in `docs/runtime/PHASE-HISTORY.md`. A later evidence-only commit may record the verified hash and push result without changing the implementation verdict.

Do not hide a known failure merely to obtain a clean status. A failing gate is a stop-and-fix condition.

## Commit style

Use concise, descriptive conventional messages when appropriate, for example `feat(transactions): add reason-required void workflow` or `docs: record architecture decision`. Keep commits scoped to one phase or one coherent change. Do not create empty commits or amend a failed commit to hide its history.

## Verification commands

Use the commands established by the approved foundation phase for status, diff, lint, typecheck, tests, and build. Bootstrap documentation review uses read-only Git inspection and the documented evidence files.

## Recovery

If a bad commit exists locally, stop and explain it before rewriting anything. Never rewrite published history. If a secret is exposed, stop and ask the user how to handle rotation and remote history rather than attempting a destructive repair autonomously.
