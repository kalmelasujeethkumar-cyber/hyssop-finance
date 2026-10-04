# HYSSOP FINANCE — Database Specification

## Document Responsibility

- Owns: PostgreSQL/Prisma entities, exact money storage, constraints, invariants, indexes, audit persistence, and migration rules.
- Does not own: product requirements, API routes, UI behavior, or deployment authorization.
- Referenced by: `02-ARCHITECTURE.md`, `06-API-SPEC.md`, `07-SECURITY-RULES.md`, phase documents, and the test plan.
- Change rule: schema changes must preserve the locked invariants and be recorded as a reviewed migration before application code depends on them.

## Status

This document specifies the proposed PostgreSQL and Prisma design. No schema, migration, seed, or database connection is created during Prompt 01. Phase 02 must implement and verify this specification after approval.

## Persistence responsibility and references

This document implements the persistence side of `REQ-FIN-001` through `REQ-FIN-003`, `REQ-FIN-005` through `REQ-FIN-020`, `REQ-MEM-001` through `REQ-MEM-006`, `REQ-CONTRIB-001` through `REQ-CONTRIB-003`, `REQ-DOC-007` through `REQ-DOC-009`, `REQ-DOC-013`, `REQ-EXP-001` through `REQ-EXP-004`, and `REQ-SETTINGS-001` through `REQ-SETTINGS-007`. The product statements remain in `01-REQUIREMENTS.md`; the API and UI consume these invariants rather than restating them.

`occurred_at` is the recorded instant; `business_date` is the Asia/Kolkata accounting and filter date used by financial periods. A record is valid for aggregation when it is persisted as `ACTIVE` and satisfies the database type and association constraints. The application must not introduce an undocumented third transaction status.

Phone numbers are normalized to national digits after removing spaces, hyphens, parentheses, and an optional `+91` prefix; the normalized digits are the canonical stored value, with presentation formatting applied only at API/UI boundaries.

## Exact money strategy

- Store every monetary amount as integer paise in a `BIGINT` column named `*_paise`.
- Never persist money as floating point or binary decimal.
- Never use JavaScript `number` for authoritative money arithmetic. Domain code uses `bigint` paise or an exact decimal library whose precision is verified.
- The API accepts and returns decimal INR strings such as `"1000.00"` and `"125000.00"`. The API boundary converts to and from paise with strict parsing; it never uses `parseFloat` for money.
- Aggregations are performed in PostgreSQL over paise and returned as strings.
- Currency is fixed to INR for the demo and stored on monetary records or settings as `INR` so a later currency change cannot reinterpret history.
- PostgreSQL `BIGINT` supports a far larger value range than the church demo requires. Maximum amount validation still applies.

## Entities

| Entity | Purpose | Key relationships |
|---|---|---|
| `admin_user` | The single authenticated Admin account | Has sessions and audit events |
| `admin_session` | Revocable opaque login session | Belongs to one Admin; token stored only as a hash |
| `auth_csrf_token` | Short-lived pre-authentication CSRF token | Belongs to one trusted origin; token stored only as a hash |
| `member` | Member identity and contact data | Has contribution periods, transactions, audit references |
| `contribution_period` | Expected monthly amount for a member | Unique per member, month, and year |
| `expense_category` | Initial and custom expense categories | Used by expense transactions; categories are deactivated rather than hard-deleted when no longer available for new entries |
| `financial_transaction` | Canonical income and expense record | Optional member, optional category, optional contribution period, many documents and audit events |
| `transaction_document` | Metadata and storage reference for an uploaded file | Belongs to one transaction; never stores raw bytes |
| `audit_event` | Append-only record of important actions | References actor and entity by UUID and reference ID |
| `app_setting` | Demo configuration values | Singleton or explicitly keyed settings |
| `id_sequence` | Allocation state for human-readable references | Internal, not a financial record |
| `idempotency_record` | Safe retry record for create and mutation commands | Unique per Admin, endpoint, and idempotency key |

## Enums

- `transaction_type`: `INCOME`, `EXPENSE`
- `income_type`: `MEMBER_CONTRIBUTION`, `OFFERING`, `DONATION`, `ANONYMOUS_DONATION`
- `payment_method`: `CASH`, `UPI`, `BANK_TRANSFER`
- `transaction_status`: `ACTIVE`, `VOIDED`
- `category_status`: `ACTIVE`, `INACTIVE`
- `document_status`: `AVAILABLE`, `REMOVED`
- `audit_action`: an extensible, versioned list of documented action codes including `TRANSACTION_CREATED`, `TRANSACTION_UPDATED`, `TRANSACTION_VOIDED`, `DOCUMENT_UPLOADED`, `DOCUMENT_REMOVED`, `MEMBER_CREATED`, `MEMBER_UPDATED`, `CATEGORY_CREATED`, `CATEGORY_UPDATED`, `SETTING_UPDATED`, `LOGIN_SUCCEEDED`, `LOGIN_FAILED`, and `LOGOUT`

## Financial transaction fields

Required columns:

- `id UUID PRIMARY KEY`
- `reference_id VARCHAR(32) NOT NULL UNIQUE`, for example `HY-INC-000001` or `HY-EXP-000001`
- `transaction_type transaction_type NOT NULL`
- `amount_paise BIGINT NOT NULL CHECK (amount_paise > 0)`
- `payment_method payment_method NOT NULL`
- `status transaction_status NOT NULL DEFAULT 'ACTIVE'`
- `business_date DATE NOT NULL`
- `occurred_at TIMESTAMPTZ NOT NULL`
- `description TEXT NULL`
- `member_id UUID NULL REFERENCES member(id) ON DELETE RESTRICT`
- `contribution_period_id UUID NULL REFERENCES contribution_period(id) ON DELETE RESTRICT`
- `income_type income_type NULL`
- `category_id UUID NULL REFERENCES expense_category(id) ON DELETE RESTRICT`
- `notes TEXT NULL`
- `voided_at TIMESTAMPTZ NULL`
- `voided_by_admin_id UUID NULL REFERENCES admin_user(id) ON DELETE RESTRICT`
- `void_reason TEXT NULL`
- `created_by_admin_id UUID NOT NULL REFERENCES admin_user(id) ON DELETE RESTRICT`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`
- `revision INTEGER NOT NULL DEFAULT 1`

Database checks must enforce the type-specific shape:

- `INCOME` requires `income_type` and forbids `category_id`.
- `EXPENSE` requires `category_id` and forbids `income_type` and `contribution_period_id`.
- `MEMBER_CONTRIBUTION` requires both `member_id` and a `contribution_period_id` whose member, month, and year match the transaction. This cross-table rule is enforced by application validation and a PostgreSQL constraint trigger, because a row-level CHECK constraint cannot reference another table.
- `ANONYMOUS_DONATION` forbids `member_id` and `contribution_period_id`, and its description must never be used to record a donor identity. Use a neutral server-owned value such as `Anonymous Donation`; identity-bearing free text is rejected at the API boundary.
- `OFFERING` and `DONATION` may have an optional `member_id` but never a contribution period.
- `status = 'ACTIVE'` requires void columns to be null; `status = 'VOIDED'` requires `voided_at`, `voided_by_admin_id`, and a non-empty `void_reason`.

Application validation and database constraints must both exist. The database is the final guard.

## Contribution periods

`contribution_period` contains `id`, `member_id`, `year SMALLINT`, `month SMALLINT`, `expected_paise BIGINT CHECK (expected_paise > 0)`, `created_at`, and `updated_at`, with a unique constraint on `(member_id, year, month)` and range checks for month 1–12 and a valid year.

Received and remaining values are derived from active `MEMBER_CONTRIBUTION` transactions:

```text
received_paise = SUM(active contribution transactions for the period)
remaining_paise = GREATEST(expected_paise - received_paise, 0)
```

Do not persist a mutable `paid_amount` as the source of truth. If a cached projection is introduced later, it must be rebuilt from the ledger and never replace the derivation.

## Expense categories

`expense_category` contains `id`, `name`, `normalized_name`, `status`, `is_system`, `created_at`, and `updated_at`. The initial category set is seeded with `is_system = true`; custom categories are Admin-created with `is_system = false`. Names are unique case-insensitively. A category may be renamed or set to `INACTIVE` without deleting its history; new expenses may reference only an `ACTIVE` category. The API exposes active categories for new entries and preserves inactive categories on historical transactions.

## Demo settings

`app_setting` stores validated, non-secret demo configuration. The initial key set is `DEFAULT_MONTHLY_CONTRIBUTION_PAISE`, `ENABLED_PAYMENT_METHODS`, `CURRENCY`, and `BUSINESS_TIMEZONE`. The default contribution is positive integer paise; enabled methods are a validated subset of `CASH`, `UPI`, and `BANK_TRANSFER` with at least one method enabled; `CURRENCY` is fixed to `INR` and `BUSINESS_TIMEZONE` is fixed to `Asia/Kolkata` in this demo. Disabling a method affects new transaction entry only and never changes historical records, balances, edits, or void operations. Settings writes are validated, audited, and do not alter historical financial records.

## Void and edit rules

- No application path performs a hard delete on `financial_transaction`.
- Void is an update of status and void metadata within the same database transaction that writes `audit_event`.
- Void reason is trimmed and must be non-empty after validation.
- Voiding is idempotent only for the same request key and target; a second void attempt with a different reason must be rejected clearly.
- Updates increment `revision` and write an audit event containing the changed field names, previous values, new values, actor, action, and timestamp.
- Transaction identity, reference, type, creator, and creation timestamp are immutable. Amount, payment method, business date, description, notes, and type-specific associations may be changed only through the validated correction command; each change increments `revision` and must preserve the before/after audit record. Status and void fields change only through the void command.
- Member `reference_id`, creation time, and financial-history links are immutable. Member edits use a `revision` optimistic-lock value and increment it atomically; a stale update is rejected.
- All financial aggregation queries filter `status = 'ACTIVE'`.

## Idempotency

`idempotency_record` contains `id`, `admin_user_id`, `endpoint`, `idempotency_key`, `request_hash`, `response_status`, `response_body JSONB`, `created_at`, and `expires_at`, with a unique constraint on `(admin_user_id, endpoint, idempotency_key)`. Demo records are retained for 30 days; after expiry the key is rejected as expired rather than silently creating a new financial operation. Concurrent requests with one key are serialized by the unique constraint.

- The first request creates the record in the same database transaction as the business change.
- A repeat with the same key and the same request hash returns the stored response.
- A repeat with the same key and a different request hash is rejected.
- Records are removed only by a safe retention job, never by user-facing application deletion.

## Documents

`transaction_document` contains `id`, `reference_id` such as `HY-DOC-000001`, `transaction_id`, `storage_key`, `original_filename`, `declared_mime_type`, `detected_mime_type`, `byte_size`, `checksum_sha256`, `status`, `storage_deleted_at`, `uploaded_by_admin_id`, `uploaded_at`, `removed_at`, `removed_by_admin_id`, and `removal_reason`. The database `status` is `AVAILABLE` or `REMOVED`; after removal, metadata is retained, content access is denied, and `storage_deleted_at` records successful physical deletion when it occurs. A failed storage deletion leaves the metadata `REMOVED` and a controlled cleanup retry, never publicly accessible content.

Constraints require a non-empty storage key, positive byte size, an allowed detected type, and a one-to-many relationship with the transaction. The database never stores file bytes. Removal requires a non-empty `removal_reason` when `status = 'REMOVED'`, preserves metadata, and writes an audit event rather than deleting the row.

The local storage key is an opaque generated value. The original filename is metadata only and must never be used to construct a filesystem path.

## Members

`member` contains `id`, `reference_id` such as `HY-MEM-0001`, `name`, `phone`, `notes`, `revision INTEGER NOT NULL DEFAULT 1`, `created_at`, and `updated_at`. Names are required and length-limited. Phone is optional; when present it must contain 7 to 15 digits after removing spaces, hyphens, parentheses, and an optional `+91` prefix. The same rule is enforced in the UI, API, and database. `reference_id` is unique and immutable. Member deletion is not provided in the demo; members may be deactivated only if a later approved requirement defines that behavior safely.

## Human-readable identifiers

Format and width are fixed:

- Members: `HY-MEM-` plus four digits.
- Income: `HY-INC-` plus six digits.
- Expenses: `HY-EXP-` plus six digits.
- Documents: `HY-DOC-` plus six digits.

`id_sequence` rows allocate the next value inside the same database transaction that creates the record. A failed transaction must not consume a committed business reference permanently for the caller, and concurrent allocation must never produce duplicates.

## Audit events

`audit_event` contains `id`, `actor_admin_id`, `action`, `entity_type`, `entity_id UUID NULL`, `entity_reference VARCHAR(64) NULL`, `before JSONB NULL`, `after JSONB NULL`, `reason TEXT NULL`, `request_id UUID NULL`, `ip_hash TEXT NULL`, and `occurred_at TIMESTAMPTZ NOT NULL`.

Audit rows are append-only. Application roles have no update or delete permission for audit events. Security events must avoid storing passwords, session tokens, raw documents, or unnecessary personal data.

## Admin accounts, sessions, and CSRF

`admin_user` contains `id`, `identifier VARCHAR(64) NOT NULL UNIQUE`, `display_name`, `password_hash TEXT NOT NULL`, `last_login_at TIMESTAMPTZ NULL`, `created_at`, and `updated_at`. The identifier is stored lower-cased and constrained to equal its own lower-case form, so `Admin` and `admin` can never become two accounts. There is exactly one Admin in the demo; the unique identifier is what makes an accidental second account impossible.

`password_hash` holds an Argon2id PHC string. A value beginning with `!` is the **unusable-credential sentinel**: it means the account exists as a financial actor but no password has been provisioned, so verification always fails. The sentinel exists so the fictional seed can create the actor row that transactions reference without ever embedding a credential. The Admin bootstrap replaces the sentinel with a real Argon2id hash and is the only supported way to provision the password in a project `_dev` or `_test` database, because it refuses every other database by name. When a production credential is lost rather than never created, `npm run admin:recover:production` is the only command that may replace the credential of an Admin that already exists: it accepts production databases only, refuses any `_dev` or `_test` database, requires an exact recovery confirmation token, and resolves exactly one Admin or changes nothing, refusing to choose between several. It renames nothing but the identifier it is given, and because that leaves the row's `id` untouched, audit events and financial records that reference the Admin are unaffected. The credential replacement and the revocation of that Admin's live sessions commit in one transaction, so no session created under the previous credential survives. Neither the identifier nor any password value is ever written to an audit event, log, or document.

`admin_session` contains `id`, `admin_user_id UUID NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE`, `token_hash CHAR(64) NOT NULL UNIQUE`, `csrf_token_hash CHAR(64) NOT NULL`, `ip_hash VARCHAR(128) NULL`, `created_at TIMESTAMPTZ NOT NULL`, `last_seen_at TIMESTAMPTZ NOT NULL`, `expires_at TIMESTAMPTZ NOT NULL`, `revoked_at TIMESTAMPTZ NULL`, and `revoked_reason VARCHAR(32) NULL` constrained to `LOGOUT`, `EXPIRED`, or `REPLACED`, with `CHECK (expires_at > created_at)`. The opaque session token is generated with a cryptographic random source, delivered only in an HTTP-only cookie, and stored only as a SHA-256 hash, so a database read cannot reconstruct a usable session. The post-authentication CSRF secret is likewise stored only as a hash and is rotated by updating the row. Session rows are not audit history: an expired or revoked session is rejected on read and may be deleted later by maintenance, while the `LOGIN_SUCCEEDED` and `LOGOUT` events remain permanently in `audit_event`.

`auth_csrf_token` contains `id`, `token_hash CHAR(64) NOT NULL UNIQUE`, `origin VARCHAR(255) NOT NULL`, `created_at`, `expires_at`, and `consumed_at TIMESTAMPTZ NULL`, with `CHECK (expires_at > created_at)`. It backs the unauthenticated pre-authentication CSRF token that login requires. The row binds the token to the exact trusted origin that requested it, expires quickly, and is marked consumed on use, so a login token cannot be replayed. The CSRF cookie is deliberately **not** HTTP-only, because the browser must echo the same value in a request header; the session cookie is always HTTP-only.

## Indexes and query performance

- `financial_transaction(status, business_date)`
- `financial_transaction(transaction_type, business_date, status)`
- `financial_transaction(payment_method, business_date, status)`
- `financial_transaction(member_id, business_date, status)` partial on active rows where applicable
- `financial_transaction(category_id, business_date, status)` partial on active rows
- `financial_transaction(income_type, business_date, status)`
- `contribution_period(member_id, year DESC, month DESC)`
- `transaction_document(transaction_id, status)`
- `audit_event(occurred_at DESC)`
- `audit_event(entity_type, entity_id, occurred_at DESC)`
- `member(lower(name))` for case-insensitive search
- `admin_session(admin_user_id)` and `admin_session(expires_at)` for session lookup and expired-row maintenance
- `auth_csrf_token(expires_at)` for expired pre-authentication token maintenance
- Unique indexes on every `reference_id`

Dashboard aggregates must use index-friendly filters and must not load full transaction history into frontend memory.

## Migration, seed, and recovery rules

- Prisma migrations are reviewed before application.
- Migrations must be additive or explicitly reversible, and destructive changes require a documented backup and recovery plan.
- Demo seeding is idempotent and uses only fictional data defined in `13-DEMO-DATA-SPEC.md`.
- Seeding never provisions a credential. The Admin bootstrap reads a password from the environment, hashes it with Argon2id, and is run before the actor-bearing demo seed is activated; the seed may create the actor row with the unusable-credential sentinel but never a usable password.
- A migration that makes a column unique must be applicable to a database that already holds more than one row of that table. The authentication migration therefore backfills the oldest `admin_user` row with the identifier `admin` and gives any further row a deterministic `admin-legacy-<id prefix>` identifier; every backfilled row receives the unusable-credential sentinel, so no extra row becomes a usable credential and the unique constraint can be created either way.
- A failed migration on a transactional PostgreSQL database leaves no partial schema. Recovery is `prisma migrate resolve --rolled-back <migration>` followed by a re-run, and it must be applied to the disposable `_test` database rather than by editing migration history.
- No user-facing reset-demo-database feature is allowed.
- Database tests must run against a real disposable PostgreSQL instance, not an in-memory substitute.
- Any action that could destroy non-demo or user data is a stop condition.
