# PHASE 03 — Authentication

## Document Responsibility

- Owns: real Admin authentication, password hashing, sessions, CSRF, protected-route guards, and security events.
- Does not own: business calculations, member or transaction behavior, or requirement definitions.
- Primary owned requirements: `REQ-AUTH-002`, `REQ-AUTH-003`, `REQ-AUTH-004`, `REQ-AUTH-005`.
- Consumed requirements: `REQ-RESP-006`, `REQ-RESP-008`, `REQ-RESP-010`, and the audit/security obligations in `REQ-AUDIT-001` and `REQ-AUDIT-002`.
- Authority references: `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `05-DATABASE-SPEC.md`, `06-API-SPEC.md`, `07-SECURITY-RULES.md`, `10-TEST-PLAN.md`, and `14-TRACEABILITY-MATRIX.md`.
- Deliverables: Admin bootstrap, session/CSRF services, guards, login/logout UI, and security events.
- Out of scope: multi-user RBAC, business features, credential storage in Git, and secret creation by the agent.
- Handoff: authenticated API boundary for Phases 04–12 and safe activation of the actor-bearing demo seed.
- Acceptance evidence: `TEST-AUTH-001`, `TEST-SEC-001`, and `TEST-E2E-001`.

## Phase Metadata

- Status: `NOT STARTED`; requires approved secure environment values supplied by the user.
- Preconditions: Phase 02 complete and the Admin bootstrap path is authorized.
- Handoff rule: no client-side-only authorization or token-in-browser-storage shortcut is permitted.

## Objective

Implement real backend authentication for the single Admin role with secure password hashing, revocable sessions, CSRF protection, safe errors, and security audit events.

## Scope

- Admin bootstrap without embedding credentials in source.
- Argon2id password hashing and upgrade strategy.
- Opaque server-side session storage and secure cookie handling.
- Login, logout, current-session, and pre-authentication and post-authentication CSRF endpoints.
- Protected-route and API guard behavior.
- Authentication and security audit events.
- Activate the final actor-bearing fictional demo seed after the Admin bootstrap is verified.

## Prerequisites

- Phase 02 complete.
- `07-SECURITY-RULES.md`, `06-API-SPEC.md`, and `02-ARCHITECTURE.md` reread.
- Secure local environment values are available through the existing authorized environment; never request or commit them.

## Expected files and modules

- NestJS `auth` module, guards, session repository, password service, and audit integration.
- Login form, protected route handling, session bootstrap, and logout UI.
- Auth integration and browser tests.

## Implementation requirements

- Use Argon2id where practical and document parameters.
- Keep tokens out of browser storage and rotate or expire them safely.
- Enforce CSRF and trusted-origin rules for mutations.
- Rate-limit or delay repeated login attempts.
- Admin bootstrap uses a secure environment-provided password and is completed before the final actor-bearing demo seed is activated.
- Return generic authentication errors and redact sensitive logs.
- Invalidate the session on logout and expiry.

## Prohibited shortcuts

- No frontend-only login, hard-coded password, default credential in the repository, or client-side role check.
- No token in local storage.
- No disabling of CSRF, CORS, or security protections for convenience.
- No multi-user RBAC expansion in the demo.

## Acceptance criteria

- A configured Admin can log in, access protected API routes, and log out.
- Unauthenticated, expired, revoked, and tampered sessions are rejected.
- CSRF, CORS, and error behavior match the security specification.
- Security events are written to the audit trail without secrets.
- No credential or session token appears in source, logs, or Git.

## Tests required

- Password hashing and verification unit tests.
- Session lifecycle, expiry, logout, and guard integration tests.
- CSRF, CORS, rate-limit, and error-redaction tests.
- Browser login, protected navigation, expiry, and logout tests.

## Documentation updates required

Record the final auth design, environment variables, test evidence, and any decision changes.

## Git completion gate

Pass lint, typecheck, unit, integration, E2E, and build gates; inspect secrets; commit; push; verify; record the hash.

## Rollback and recovery

Do not commit a partially configured credential. If a secret is exposed, stop and ask the user about rotation. Revert only this phase's own changes with a corrective commit.

## Completion checklist

- [ ] Password and session design implemented.
- [ ] Auth endpoints and guards verified.
- [ ] CSRF and CORS policy verified.
- [ ] Security audit events verified.
- [ ] Documentation and Git gate complete.
