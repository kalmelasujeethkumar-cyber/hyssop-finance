# PHASE 02 — Database

## Objective

Implement the PostgreSQL and Prisma data layer exactly as specified, including exact money, references, constraints, contribution periods, documents metadata, and append-only audit events.

## Scope

- Translate `05-DATABASE-SPEC.md` into the Prisma schema and reviewed migrations.
- Create the disposable development database workflow.
- Implement reference allocation, transaction invariants, void metadata, audit-event persistence, and idempotency records.
- Add idempotent fictional seed data from `13-DEMO-DATA-SPEC.md`.
- Add database-level reconciliation queries and tests.

## Prerequisites

- Phase 01 complete.
- `05-DATABASE-SPEC.md` and `07-SECURITY-RULES.md` reread.
- Docker/Compose or an approved disposable PostgreSQL instance is available.
- No real or user data may be used.

## Expected files and modules

- `prisma/schema.prisma`, migrations, seed, and database test helpers.
- Persistence adapters and repository functions for members, periods, transactions, categories, documents metadata, audit, and settings.
- Reconciliation and reference-allocation services.

## Implementation requirements

- Store money as integer paise; keep API conversion exact.
- Enforce type-specific transaction checks and positive amounts.
- Keep void rows and audit rows; never hard-delete financial transactions.
- Derive contribution received and remaining values from active transactions.
- Use parameterized queries, safe constraints, and append-only audit permissions.
- Use unique references and concurrency-safe sequence allocation.
- Enforce same-key idempotency with request hashes so retries never duplicate a financial write.

## Prohibited shortcuts

- No floating-point money columns or JavaScript number arithmetic for authoritative totals.
- No cached dashboard totals as the source of truth.
- No destructive migration against a database that could contain non-demo data.
- No fake seed data presented as production data.

## Acceptance criteria

- Migrations apply cleanly to an empty disposable database and roll back only where safe.
- Constraints reject invalid amounts, invalid type/category combinations, duplicate references, and invalid period links.
- Seed data is fictional, idempotent, and covers the specified states.
- Database-derived totals reconcile with the documented financial scenario.
- Audit events cannot be updated or deleted by the application role.

## Tests required

- Migration and constraint tests against real PostgreSQL.
- Reference allocation concurrency tests.
- Exact money, void, period, and audit persistence tests.
- Seed idempotency and reconciliation tests.
- Database performance checks for the documented indexes.

## Documentation updates required

Record schema decisions, migration commands, environment requirements, and reconciliation evidence.

## Git completion gate

Run database tests, full unit/integration gates, and build; inspect diff and secrets; commit; push; verify; record the hash.

## Rollback and recovery

Use forward corrective migrations for schema fixes. Never drop a database or volume that may contain non-demo data. If a migration is unsafe, stop and ask the user before applying it to any shared environment.

## Completion checklist

- [ ] Schema and migrations reviewed.
- [ ] Money and void invariants enforced.
- [ ] Contribution and audit persistence implemented.
- [ ] Seed data verified as fictional and idempotent.
- [ ] Database tests pass.
- [ ] Documentation and Git gate complete.
