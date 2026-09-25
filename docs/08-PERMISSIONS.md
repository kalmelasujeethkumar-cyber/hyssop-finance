# HYSSOP FINANCE — Permissions and Boundaries

## OpenCode workspace boundary

The authorized project boundary is the currently opened `HYSSOP-FINANCE` workspace. Agents may create, read, edit, rename, move, organize, and, only when genuinely necessary, delete project files inside this workspace.

Agents must not search, inspect, read, modify, move, rename, copy, upload, index, summarize, or delete anything outside this workspace, including:

- Documents, Pictures, Photos, Videos, Music, or personal Downloads.
- Unrelated Desktop or OneDrive files.
- Other coding projects, repositories, databases, or Docker resources.
- Browser history, cookies, profiles, saved passwords, or password managers.
- Personal SSH keys, unrelated `.env` files, unrelated cloud credentials, Windows credential stores, or personal financial information.
- System files unrelated to HYSSOP FINANCE.

Do not perform broad machine searches or unrelated machine administration. If a required resource appears to be outside the boundary, stop and ask the user.

## Permitted project operations

Inside the workspace, the following are authorized when the environment supports them and the current phase permits them:

- Create project files and directories.
- Edit, refactor, rename, and organize project files.
- Run project-local development commands.
- Install legitimate required dependencies in an approved phase.
- Initialize and inspect this Git repository.
- Run tests, linters, type checks, and builds.
- Use Prisma, Docker, and Compose when appropriate to this project.
- Run development servers and browser E2E tests against HYSSOP FINANCE.
- Create fictional demo and test data.
- Create and maintain project documentation.

These permissions never authorize bypassing a security control or accessing another project.

## GitHub and external services

The only authorized remote is `https://github.com/kalmelasujeethkumar-cyber/hyssop-finance.git`, named `origin`. Push only to that remote. If authentication requires interaction, stop and ask the user. Netlify, GitHub, a database host, or another service may be used only with the user's existing authorization and after the deployment and security rules are satisfied.

## Secrets

Never request, display, log, or commit passwords, tokens, API keys, private keys, recovery codes, or production secrets. Use environment variables and the existing authorized authentication environment. If a secret is not already securely configured, stop and ask the user for the exact action needed.

## Application authorization

The demo has one role, Admin. Protected financial operations require a valid server session. The frontend may hide or disable controls for usability, but the server is the enforcement point. Do not add multi-user RBAC to the demo unless a later approved requirement makes it necessary.

## Stop and ask conditions

Stop and record a `BLOCKED` issue when:

- Locked requirements genuinely conflict.
- Access outside this workspace is required.
- A secret or interactive authorization is required and is not configured.
- A destructive operation outside the project is required.
- GitHub or a deployment service requires authorization.
- Payment or a paid plan would be required.
- A security protection would need to be bypassed.
- A database action could destroy non-demo or user data.
- A critical defect remains unresolved after several evidence-based repair attempts.
- A major architecture change contradicting the specifications appears necessary.
- A client requirement cannot be determined safely.
- An OS or OpenCode permission dialog requires approval.

Record the problem, evidence, attempts, why continuing is unsafe, and the exact user action required in `docs/runtime/ISSUES.md`, then stop.

## Current prompt limit

Prompt 01 authorizes documentation bootstrap, Git initialization, remote verification, and a checkpoint commit. It does not authorize application feature code, dependency installation, database migrations, external service setup, or autonomous progression into Phase 01.
