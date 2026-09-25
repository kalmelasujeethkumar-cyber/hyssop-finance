# HYSSOP FINANCE — Architecture

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

## Authentication proposal

Use Argon2id password hashing where practical. The recommended baseline is an opaque, revocable server-side session stored as a hash in PostgreSQL and sent through a secure, HTTP-only cookie. Do not store access or refresh tokens in browser local storage. Mutations require CSRF protection and a configured trusted origin. A short-lived alternative may be evaluated during Phase 03, but any change must be recorded before implementation.

Cross-site frontend/backend hosting requires deliberate CORS and cookie settings. Production must use HTTPS and the appropriate `Secure` and `SameSite` policy. Authentication, authorization, and security-event tests are mandatory.

## Storage boundary

Define a `DocumentStorage` interface with operations such as put, open stream, delete, and metadata retrieval. The local adapter uses a project-controlled directory, generated opaque storage keys, safe path construction, and authenticated API access. PostgreSQL stores metadata and references, not raw file bytes. The adapter must be replaceable with object storage later.

The local adapter is for the demo only. A deployed demo must not assume that a local disk is durable or shared across replicas. Deployment planning must address that limitation explicitly.

## Date and money handling

Persist timestamps as timezone-aware instants and retain an explicit business date for financial filtering. Interpret business-date boundaries in `Asia/Kolkata`. Persist amounts as integer paise in PostgreSQL and expose decimal INR strings at API boundaries. Never use JavaScript floating-point values for authoritative money arithmetic.

## API and observability

Use a versioned REST contract under `/api/v1`. Return stable error codes, request IDs, pagination metadata, and validation details without exposing stack traces or secrets. Structured logs must redact credentials, session tokens, uploaded file contents, and sensitive personal data.

## Deployment evolution

A frontend static host such as Netlify may serve the web build, while the backend and PostgreSQL remain deployable services selected after current capability verification. Do not force a sound architecture into a single static host. Storage, sessions, CORS, HTTPS, backups, and observability are deployment requirements, not afterthoughts.
