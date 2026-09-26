# HYSSOP FINANCE — Decisions

## Document Responsibility

- Owns: accepted technical decisions, `DEC-*` identifiers, reasons, alternatives, and impacts.
- Does not own: current status, open issues, test results, or locked product requirements.
- Referenced by: affected specifications, phase documents, and the traceability matrix.
- Change rule: record a decision only after the owning specification is updated or confirmed; a decision that weakens a locked requirement is a stop-and-ask condition.

Decisions are recorded so that future phases do not rely on conversational memory. A decision that conflicts with a locked requirement must stop and ask the user instead of being recorded as settled.

| ID | Decision | Status | Reason and impact |
|---|---|---|---|
| DEC-001 | Use a modular monolith with React/Vite frontend, NestJS REST backend, PostgreSQL, and Prisma. | Accepted from prompt | Keeps one church demo maintainable and avoids unnecessary distributed infrastructure. |
| DEC-002 | Use one authenticated Admin role for the demo. | Accepted from prompt | Avoids unused RBAC complexity while keeping the boundary for future expansion. |
| DEC-003 | Represent money as integer paise in PostgreSQL and decimal INR strings at the API boundary. | Accepted from prompt | Prevents unsafe floating-point arithmetic and makes totals reproducible. |
| DEC-004 | Use a canonical financial transaction record for income and expense behavior. | Accepted | Keeps document, audit, void, and reference rules consistent. |
| DEC-005 | Derive member contribution received and remaining values from active transactions. | Accepted from prompt | Prevents a stored paid amount from drifting away from transaction history. |
| DEC-006 | Use reason-required void instead of normal financial deletion. | Accepted from prompt | Preserves auditability while excluding voided records from active totals. |
| DEC-007 | Store document bytes behind a storage abstraction, with project-controlled local storage for the demo. | Accepted from prompt | Keeps PostgreSQL free of raw files and allows production storage substitution. |
| DEC-008 | Use human-readable references in addition to internal UUIDs. | Accepted from prompt | Provides readable business references such as `HY-INC-000001`. |
| DEC-009 | Use Argon2id and revocable server-side opaque sessions with secure cookies and CSRF protection. | Accepted | Provides real backend authentication without browser token storage; Phase 03 implements and verifies it. |
| DEC-010 | Use light-only white/blue/orange tokens with orange as an accent. | Accepted from prompt | Supports a professional, readable interface for a non-technical user. |
| DEC-011 | Use Asia/Kolkata business dates and INR formatting. | Accepted from prompt | Matches the business context and avoids ambiguous reporting boundaries. |
| DEC-012 | Do not provide a user-facing demo database reset. | Accepted from prompt | Keeps the demo focused; developer seeding is separate and must be safe. |
| DEC-013 | Prefer Netlify for the frontend demo, with backend and database deployed separately after capability verification. | Proposed | Preserves sound architecture while targeting free-tier hosting; verify at deployment time. |
| DEC-014 | Require documentation-first changes and a full quality gate for every phase. | Accepted from prompt | Makes implementation auditable and prevents silent specification drift. |
| DEC-015 | Persist idempotency records keyed by Admin, endpoint, and key with a request hash. | Accepted | Makes financial retries safe and rejects reuse of a key with a different payload. |
| DEC-016 | Require a reason and audit event for document removal. | Accepted | Preserves document history and makes destructive metadata changes explainable. |
| DEC-017 | Define all dashboard and report periods as inclusive Asia/Kolkata calendar boundaries. | Accepted | Removes rolling-versus-calendar ambiguity and makes ledger reconciliation deterministic. |
| DEC-018 | Treat member phone and notes as optional; count all persisted demo members as active. | Accepted | Matches the explicit optional-field rule and avoids adding an unapproved member-status workflow. |
| DEC-019 | Model expense categories with active/inactive status and preserve history; keep fixed INR and timezone settings immutable. | Accepted | Gives category management and settings deterministic persistence without hard deletes or hidden configuration changes. |
| DEC-020 | Treat selected-period income and expenses as period movements, and payment-method balances as ending ledger balances through the selected period end, starting from zero with no opening-balance feature. | Accepted | Makes the ₹20,000 UPI minus ₹5,000 example explicit while preserving a distinct period activity view. |
| DEC-021 | Require a pre-authentication CSRF cookie and matching token for login, then rotate it after session creation. | Accepted | Protects login as well as authenticated mutations without relying on an already-authenticated session. |
| DEC-022 | Use optimistic `revision` values for member and transaction corrections and reject stale updates. | Accepted | Prevents concurrent edits from silently overwriting financial or identity data and requires an auditable conflict path. |
| DEC-023 | Reject identity-bearing free text for Anonymous Donations and use a server-owned neutral description. | Accepted | Prevents donor identity leakage through descriptions, receipts, search, reports, CSV, and audit surfaces. |
| DEC-024 | Mark a document `REMOVED` and audited before physical storage deletion; deny content with `410 Gone` and retry failed deletion without restoring access. | Accepted | Preserves history and prevents a storage/database failure from exposing a removed object. |
| DEC-025 | Retain idempotency records for 30 days and reject expired keys rather than silently reusing them. | Accepted | Prevents late retries from creating duplicate financial writes while keeping the demo database bounded. |
| DEC-026 | Require at least one enabled payment method; disabling a method affects new entries only. | Accepted | Prevents an invalid empty method configuration without rewriting historical ledger records. |
| DEC-027 | Assign hosted deployment and durable storage verification to Phase 12; local-only behavior is not a completed deployment. | Accepted | Ensures the stated deployment goal has an implementation and acceptance owner. |
| DEC-028 | Count contribution status per configured member-period bucket and show absent expected periods as **Not configured**. | Accepted | Avoids falsely classifying an unconfigured member as unpaid while preserving the three required payment statuses. |

| DEC-029 | Use one server-side canonical financial calculation/query layer for period movement, ending method balances, contribution projections, reports, and CSV. | Accepted in Prompt 01B | Prevents divergent totals and makes the documented financial scenario verifiable across every surface. |
| DEC-030 | Assign each required behavior exactly one primary phase owner; later phases consume and regression-test but do not silently re-own it. | Accepted in Prompt 01B | Makes phase overlap visible and keeps `docs/14-TRACEABILITY-MATRIX.md` auditable. |
| DEC-031 | Use stable `REQ-*` and `TEST-*` identifiers and retain existing numeric suffixes; the matrix is a mapping artifact only. | Accepted in Prompt 01B | Prevents renumbering and keeps requirements, tests, and phase ownership traceable across future changes. |
| DEC-032 | Retain an authorized historical receipt for a voided income transaction when available and mark it `VOIDED`; active totals still exclude it. | Accepted in Prompt 01B | Resolves the optional wording in the requirement while preserving the lower-level receipt and audit evidence contract. |
| DEC-033 | Treat the optional member association as the only named-contributor association for Offering and Donation; do not invent a separate contributor identity model. | Accepted in Prompt 01B | Preserves the current product scope and keeps anonymous-donation privacy enforceable. |
| DEC-034 | Enumerate configured contribution buckets from members created on or before the end of each month; absent expected periods are **Not configured**. | Accepted in Prompt 01B | Removes ambiguity in multi-month status visualization without changing the three payment statuses. |
| DEC-035 | Limit search free text to names, IDs, references, categories, and types; use validated filters for dates and exact amounts. | Accepted in Prompt 01B | Prevents ambiguous numeric/date search behavior and unsafe query construction. |
| DEC-036 | Define the audit-read projection used by reports before the dedicated Audit History interface is delivered; Phase 09 provides the minimal projection and Phase 10 owns the full interface. | Accepted in Prompt 01B | Removes the phase-ordering conflict without duplicating audit-event creation. |
| DEC-037 | Allow any `AVAILABLE` document to be removed by the authenticated Admin with a non-empty reason; `REMOVED` metadata is immutable and content is denied with `410 Gone`. | Accepted in Prompt 01B | Gives document removal a safe, testable state transition and preserves history. |
| DEC-038 | Use `occurred_at` for the recorded instant and `business_date` for Asia/Kolkata accounting and filtering; treat `ACTIVE` plus database-valid associations as the only valid aggregation state. | Accepted in Prompt 01B | Removes date and validity ambiguity across database, API, and reports. |
| DEC-039 | Canonicalize stored phone numbers to national digits after optional `+91` normalization; format for presentation only at API/UI boundaries. | Accepted in Prompt 01B | Makes the existing phone rule consistent across UI, API, and database. |
| DEC-040 | Assign durable hosted document storage and deployment verification to Phase 12 behind the same storage abstraction; local storage remains the demo adapter. | Accepted in Prompt 01B | Preserves the local demo rule while preventing a local-only run from being reported as a hosted deployment. |

## Decision protocol

Before changing a decision, update the relevant specification, record the reason and impact here, and confirm that no locked requirement is weakened. Record rejected alternatives when they clarify future work.
