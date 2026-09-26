# HYSSOP FINANCE — Architecture

## Document Responsibility

- Owns: system structure, module boundaries, canonical financial calculation ownership, storage abstraction, and technology direction.
- Does not own: new product requirements, database constraints, API route details, or test evidence.
- Referenced by: the database, API, security, phase, and traceability documents.
- Change rule: architecture changes that alter a locked requirement require user approval; technical decisions are recorded in `docs/runtime/DECISIONS.md`.

## Architecture status

This is the proposed architecture for the demo and its later evolution. It is a specification, not an implementation record. Phase 01 may establish the repository structure and toolchain only after this document and the current phase are approved.

## Architectural style

Use a **modular monolith**:

- A React/TypeScript/Vite frontend.
- A Node.js/NestJS/TypeScript backend exposing a versioned REST API.
- PostgreSQL as the system of record.
- Prisma as the database access and migration layer.
- A storage abstraction whose demo adapter writes to project-controlled local storage.
- Git and GitHub for source control.
- Docker/Compose only where it materially helps local development or approved deployment.

Do not introduce microservices, Kubernetes, Kafka, Redis, or other distributed infrastructure without a demonstrated requirement and an approved architecture change.

## Repository shape

The foundation phase should establish a clear workspace, with boundaries similar to:

```text
apps/
  web/       React, TypeScript, Vite, Tailwind, routes, UI, query layer
  api/       NestJS, TypeScript, modules, adapters, configuration
packages/
  contracts/  Shared, non-secret API and validation contracts when useful
  config/     Shared lint, TypeScript, and test configuration when useful
prisma/
  schema.prisma
  migrations/
  seed.ts
storage/
  uploads/   Local demo adapter output; ignored by Git
docs/
```

The exact layout may be adjusted only when it improves maintainability and is recorded in `docs/runtime/DECISIONS.md`. Do not create a distributed system to support a single-church demo.

## Backend module boundaries

The API should keep domain rules in modules rather than controllers:

- **Auth**: Admin credentials, Argon2id password verification, session lifecycle, logout, and security events.
- **Members**: member identity, human-readable IDs, search, edit history, and member reads.
- **Contributions**: monthly expectations and derived paid/partial/unpaid status.
- **Income**: contribution, offering, donation, and anonymous donation commands and reads.
- **Expenses**: expense commands, categories, custom categories, and void behavior.
- **Transactions**: shared transaction invariants, correction commands, references, and recent activity.
- **Documents**: upload validation, storage adapter, association, controlled access, download, and removal audit.
- **Dashboard**: period-aware aggregates and visualizations data.
- **Reports**: period filters, report projections, CSV generation, and print data.
- **Audit**: append-only audit event reads and event creation.
- **Settings**: default contribution, payment methods, and category configuration.

Modules may share infrastructure, but financial rules must not be duplicated in the frontend. Controllers validate transport concerns and delegate to application/domain services. Database access is centralized enough to make invariants testable.

## Frontend boundaries

The frontend may contain:

- route-level page composition;
- accessible reusable UI primitives;
- API client and typed contracts;
- TanStack Query cache and invalidation rules where appropriate;
- presentation formatting for INR and business dates;
- client-side form validation that mirrors but never replaces server validation.

The frontend must not calculate authoritative financial totals, trust client-provided balances, or bypass API authorization. Every visible action must call a real API or intentionally be non-interactive presentation.

## Data and consistency

PostgreSQL is authoritative. Financial commands use transactions where multiple records or audit events must commit atomically. Reads use database-derived aggregates rather than duplicated dashboard values. The database specification defines exact money, status, relationships, indexes, and constraints.

Use a single canonical representation for a transaction across income and expense modules so document, audit, void, and reference behavior cannot diverge. Domain validation enforces the type-specific fields before persistence.

## Canonical financial calculation layer

All authoritative financial results come from one server-side calculation/query layer shared by every consumer. Its contract is owned here; the business formulas themselves remain in `01-REQUIREMENTS.md`.

The layer resolves an Asia/Kolkata business-period input once, reads active records from PostgreSQL using paise arithmetic, and returns typed, consistent projections for:

- period income and expense movement;
- ending Cash, UPI, Bank, and total available balances;
- contribution-period received, remaining, and status;
- dashboard breakdowns, trends, and recent activity;
- report rows, search projections, and CSV values.

Dashboard, reports, CSV, member history, charts, and receipts must consume this layer or its documented projections. The frontend may format and label values, but must not recompute totals, invent opening balances, or treat a cached projection as the source of truth. Any cached projection must be rebuildable from the active ledger and must be recorded in `docs/runtime/DECISIONS.md`.

The calculation layer must expose period-movement and ending-balance semantics separately. The deterministic ₹16,500 income, ₹3,000 expenses, ₹13,500 ending balance, and Cash ₹4,000/UPI ₹500/Bank ₹8,000 fixture is the conformance contract for this layer and is verified by the test plan.

## Authentication proposal

Use Argon2id password hashing where practical. The recommended baseline is an opaque, revocable server-side session stored as a hash in PostgreSQL and sent through a secure, HTTP-only cookie. Do not store access or refresh tokens in browser local storage. Mutations require CSRF protection and a configured trusted origin. A short-lived alternative may be evaluated during Phase 03, but any change must be recorded before implementation.

CSRF protection includes login. Before credentials are accepted, the API issues a short-lived pre-authentication CSRF cookie and matching token bound to the trusted origin. Login must present that token, and the server rotates the token after a successful session is created. An authenticated session receives a replacement token for subsequent mutations. The token is never accepted solely because it appears in a request body and is never logged.

Cross-site frontend/backend hosting requires deliberate CORS and cookie settings. Production must use HTTPS and the appropriate `Secure` and `SameSite` policy. Authentication, authorization, and security-event tests are mandatory.

## Storage boundary

Define a `DocumentStorage` interface with operations such as put, open stream, delete, and metadata retrieval. The local adapter uses a project-controlled directory, generated opaque storage keys, safe path construction, and authenticated API access. PostgreSQL stores metadata and references, not raw file bytes. The adapter must be replaceable with object storage later.

Controlled removal is a two-part state transition. The API first commits `AVAILABLE` to `REMOVED` metadata with a reason, actor, and audit event, then attempts storage deletion. Once marked `REMOVED`, content access is denied with `410 Gone`; metadata remains for history. A storage failure leaves the object inaccessible, records a cleanup-pending condition, and is retried by a controlled maintenance path without restoring content access. A successful deletion records `storage_deleted_at`.

The local adapter is for the demo only. A deployed demo must not assume that a local disk is durable or shared across replicas. Deployment planning must address that limitation explicitly.

## Cross-phase dependency boundaries

Document association is a reusable capability, not a per-phase upload system. Phase 02 establishes the shared transaction/document metadata and audit contract. Phases 05 and 06 may expose only the association interface and required integration points needed to complete income and expense behavior. Phase 07 owns the reusable `DocumentStorage` implementation, upload/preview/download/ removal flows, validation, and document UI. No earlier phase may create a temporary production-like upload path, bypass the storage abstraction, or duplicate document rules. Phase 09 consumes document metadata for report and export projections; Phase 12 selects a durable adapter before hosted deployment.

The same rule applies to shared financial behavior: Phase 02 owns shared idempotency persistence; each later create or mutation module consumes it rather than implementing a private retry mechanism.

## Date and money handling

Persist timestamps as timezone-aware instants and retain an explicit business date for financial filtering. Interpret business-date boundaries in `Asia/Kolkata`. Persist amounts as integer paise in PostgreSQL and expose decimal INR strings at API boundaries. Never use JavaScript floating-point values for authoritative money arithmetic.

The dashboard distinguishes period movement from ending balance. Income and expense cards summarize the selected period; Cash, UPI, Bank, and total available balance summarize active records from the beginning of the ledger through the selected period end. There are no hidden opening balances, transfers, or seed adjustments. A period movement may be shown separately and must be labeled as such.

## API and observability

Use a versioned REST contract under `/api/v1`. Return stable error codes, request IDs, pagination metadata, and validation details without exposing stack traces or secrets. Structured logs must redact credentials, session tokens, uploaded file contents, and sensitive personal data.

## Deployment evolution

A frontend static host such as Netlify may serve the web build, while the backend and PostgreSQL remain deployable services selected after current capability verification. Do not force a sound architecture into a single static host. Storage, sessions, CORS, HTTPS, backups, and observability are deployment requirements, not afterthoughts.
