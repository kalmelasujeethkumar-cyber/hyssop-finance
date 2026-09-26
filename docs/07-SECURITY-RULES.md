# HYSSOP FINANCE — Security Rules

## Document Responsibility

- Owns: application authentication, sessions, CSRF, CORS, input and upload safety, data protection, and security verification obligations.
- Does not own: agent filesystem permissions, Git procedure, product scope, or deployment implementation.
- Referenced by: the API, architecture, database, deployment, and test documents.
- Change rule: a security control may be weakened only through explicit user approval; verification failures block the phase gate.

## Security posture

Security requirements are mandatory and outrank convenience. The demo must use real authentication, safe defaults, least privilege, and evidence-based verification. No security prompt, permission control, OS protection, GitHub authentication mechanism, browser control, or database protection may be bypassed to make progress.

## Security responsibility and references

This document implements the security obligations for `REQ-AUTH-*`, `REQ-DOC-*`, `REQ-FIN-015` through `REQ-FIN-020`, `REQ-FIN-022` through `REQ-FIN-024`, `REQ-SEARCH-002`, `REQ-AUDIT-002`, `REQ-SETTINGS-006` and `REQ-SETTINGS-007`, and `REQ-RESP-010` through `REQ-RESP-013`. The product behavior remains in `01-REQUIREMENTS.md`. API enforcement points are defined in `06-API-SPEC.md`; persistence protections are defined in `05-DATABASE-SPEC.md`.

## Trust boundaries

- The browser is untrusted. It may present data but may not be trusted with authoritative calculations, authorization decisions, or storage paths.
- The REST API is the policy enforcement point for authentication, validation, idempotency, void reasons, and document access.
- PostgreSQL is the financial source of truth. Application roles must not exceed their documented needs.
- The local storage directory is project-controlled but is not a public static folder. Documents are served only through an authenticated endpoint.
- The database, storage adapter, and logs must not expose secrets or unnecessary personal data.

## Authentication and sessions

- The demo has one Admin account. Passwords are never stored in plaintext, in source control, in logs, or in documentation.
- Use Argon2id for password hashing where practical, with a documented cost and an upgrade path.
- Use revocable server-side sessions stored as hashes in PostgreSQL, or an explicitly reviewed equivalent. Never place access or refresh tokens in browser local storage.
- Cookies must be HTTP-only, `Secure` in HTTPS deployments, and use an explicitly verified `SameSite` and CORS policy for the chosen frontend/backend origins.
- Logout invalidates the session server-side. Expired and revoked sessions are rejected.
- Login failures use a generic message. Rate-limit or delay repeated attempts to reduce guessing.
- Passwords, session cookies, CSRF tokens, and reset material are never logged.

## CSRF, CORS, and headers

- The demo uses cookie-based sessions, so every state-changing request requires CSRF protection, including the unauthenticated login request. Before login, the API issues a short-lived CSRF cookie and matching token bound to the trusted origin; login presents the token and the server rotates it after session creation. Removing this protection is a stop-and-ask decision, not an implementation detail.
- CORS must allow only the configured frontend origin and required methods and headers. Never use `*` with credentials.
- Set a restrictive Content Security Policy, HSTS on HTTPS deployments, `X-Content-Type-Options: nosniff`, a restrictive referrer policy, and an appropriate frame policy.
- Do not expose internal error stacks, SQL, environment values, or local paths in responses.

## Validation and input safety

- Validate types, ranges, lengths, enums, date ranges, and referential relationships on the server.
- Amounts must be positive exact INR values; reject negative, zero, non-numeric, exponent-based, or ambiguous money input.
- Reject malformed UUIDs and business dates instead of coercing them.
- Use parameterized queries or the ORM's safe parameterization. Never build SQL by concatenating user input.
- Sanitize or escape free text in exports, previews, and any HTML-rendered receipt. Prefer plain text or a well-defined escaping policy.
- Restrict pagination and export sizes so a request cannot exhaust the demo server.

## Financial integrity

- Only the database and server-side domain code may compute authoritative totals.
- Voided transactions are excluded from active totals but retained for audit.
- Edits record before and after values, actor, action, and timestamp in the same transaction as the change.
- Use idempotency keys for financial creates and safe retries. A network retry must not create a second record.
- Reject attempts to change identity, transaction type, creator, reference, status, or void fields through unvalidated patch payloads. Allowed edits are explicitly allow-listed and use revision checks.

## Document security

- Accept only JPG, JPEG, PNG, WEBP, and PDF within the documented size limit.
- Validate the detected type from file content, not only the browser-declared MIME type or filename extension.
- Store files under generated opaque keys. Never use an uploaded filename to build a path.
- Reject path traversal, archive extraction, embedded scripts, and unexpected file signatures.
- Serve downloads and previews only after authentication and transaction authorization.
- Apply a safe download response policy; do not serve untrusted HTML or SVG.
- Controlled removal is permitted for any `AVAILABLE` document by the authenticated Admin and requires confirmation, a non-empty reason, and an audit event. Metadata remains for history. Once marked removed, content access is denied with `410 Gone`; storage deletion failure leaves the object inaccessible and enters a controlled cleanup retry rather than restoring public access. A `REMOVED` metadata row is immutable to the application.
- Production deployment must add malware scanning, storage-level access control, and lifecycle policy before untrusted uploads are accepted.

## Data protection

- Collect only information the demo needs. Demo names, phone numbers, and notes are fictional.
- Do not log document bytes, passwords, tokens, or full personal data.
- Use environment variables or an approved secret store for credentials. `.env` files are ignored and `.env.example` contains placeholders only.
- Limit database credentials and runtime permissions. Do not use a superuser account in the application.
- Backups, retention, and deletion policies must be defined before production. The demo may defer production retention policy but must not claim one exists.

## Rate limiting and abuse resistance

- Apply safe login, upload, search, export, and mutation limits appropriate to the demo. These controls are required, not optional, and final QA must test their threshold and generic-error behavior.
- Do not reveal whether a member, reference, or file exists to an unauthenticated caller.
- Log enough security events to investigate abnormal activity without logging secrets.

## Verification obligations

Each implementation phase must verify relevant security behavior with unit, integration, and E2E tests. Final QA must attempt unauthorized access, invalid tokens, CSRF failures, cross-origin requests, upload attacks, path traversal, duplicate submissions, ID guessing, and secret leakage. A failed security check blocks the phase gate.

## Prohibited practices

Never commit `.env`, credentials, private keys, or production secrets. Never weaken a security control to obtain a green test. Never disable a security prompt. Never use a frontend-only login, hard-coded role check, unprotected document directory, or client-side-only financial rule as a substitute for server enforcement.
