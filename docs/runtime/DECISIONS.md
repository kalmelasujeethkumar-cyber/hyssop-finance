# HYSSOP FINANCE — Decisions

Decisions are recorded so that future phases do not rely on conversational memory. A decision that conflicts with a locked requirement must stop and ask the user instead of being recorded as settled.

| ID | Decision | Status | Reason and impact |
|---|---|---|---|
| D-001 | Use a modular monolith with React/Vite frontend, NestJS REST backend, PostgreSQL, and Prisma. | Accepted from prompt | Keeps one church demo maintainable and avoids unnecessary distributed infrastructure. |
| D-002 | Use one authenticated Admin role for the demo. | Accepted from prompt | Avoids unused RBAC complexity while keeping the boundary for future expansion. |
| D-003 | Represent money as integer paise in PostgreSQL and decimal INR strings at the API boundary. | Accepted from prompt | Prevents unsafe floating-point arithmetic and makes totals reproducible. |
| D-004 | Use a canonical financial transaction record for income and expense behavior. | Accepted | Keeps document, audit, void, and reference rules consistent. |
| D-005 | Derive member contribution received and remaining values from active transactions. | Accepted from prompt | Prevents a stored paid amount from drifting away from transaction history. |
| D-006 | Use reason-required void instead of normal financial deletion. | Accepted from prompt | Preserves auditability while excluding voided records from active totals. |
| D-007 | Store document bytes behind a storage abstraction, with project-controlled local storage for the demo. | Accepted from prompt | Keeps PostgreSQL free of raw files and allows production storage substitution. |
| D-008 | Use human-readable references in addition to internal UUIDs. | Accepted from prompt | Provides readable business references such as `HY-INC-000001`. |
| D-009 | Use Argon2id and revocable server-side opaque sessions with secure cookies and CSRF protection. | Accepted | Provides real backend authentication without browser token storage; Phase 03 implements and verifies it. |
| D-010 | Use light-only white/blue/orange tokens with orange as an accent. | Accepted from prompt | Supports a professional, readable interface for a non-technical user. |
| D-011 | Use Asia/Kolkata business dates and INR formatting. | Accepted from prompt | Matches the business context and avoids ambiguous reporting boundaries. |
| D-012 | Do not provide a user-facing demo database reset. | Accepted from prompt | Keeps the demo focused; developer seeding is separate and must be safe. |
| D-013 | Prefer Netlify for the frontend demo, with backend and database deployed separately after capability verification. | Proposed | Preserves sound architecture while targeting free-tier hosting; verify at deployment time. |
| D-014 | Require documentation-first changes and a full quality gate for every phase. | Accepted from prompt | Makes implementation auditable and prevents silent specification drift. |
| D-015 | Persist idempotency records keyed by Admin, endpoint, and key with a request hash. | Accepted | Makes financial retries safe and rejects reuse of a key with a different payload. |
| D-016 | Require a reason and audit event for document removal. | Accepted | Preserves document history and makes destructive metadata changes explainable. |
| D-017 | Define all dashboard and report periods as inclusive Asia/Kolkata calendar boundaries. | Accepted | Removes rolling-versus-calendar ambiguity and makes ledger reconciliation deterministic. |
| D-018 | Treat member phone and notes as optional; count all persisted demo members as active. | Accepted | Matches the explicit optional-field rule and avoids adding an unapproved member-status workflow. |
| D-019 | Model expense categories with active/inactive status and preserve history; keep fixed INR and timezone settings immutable. | Accepted | Gives category management and settings deterministic persistence without hard deletes or hidden configuration changes. |

## Decision protocol

Before changing a decision, update the relevant specification, record the reason and impact here, and confirm that no locked requirement is weakened. Record rejected alternatives when they clarify future work.
