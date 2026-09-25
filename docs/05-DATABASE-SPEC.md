# HYSSOP FINANCE — Database Specification

## Status

This document specifies the proposed PostgreSQL and Prisma design. No schema, migration, seed, or database connection is created during Prompt 01. Phase 02 must implement and verify this specification after approval.

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
- `audit_action`: an extensible, versioned list of documented action codes including `TRANSACTION_CREATED`, `TRANSACTION_UPDATED`, `TRANSACTION_VOIDED`, `DOCUMENT_UPLOADED`, `DOCUMENT_REMOVED`, `MEMBER_CREATED`, `MEMBER_UPDATED`, `CATEGORY_CREATED`, `CATEGORY_UPDATED`, `SETTING_UPDATED`, `LOGIN_SUCCEEDED`, and `LOGIN_FAILED`

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
- `ANONYMOUS_DONATION` forbids `member_id` and `contribution_period_id`, and its description must never be used to record a donor identity. Use a neutral default such as `Anonymous Donation` when no description is supplied.
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

`app_setting` stores validated, non-secret demo configuration. The initial key set is `DEFAULT_MONTHLY_CONTRIBUTION_PAISE`, `ENABLED_PAYMENT_METHODS`, `CURRENCY`, and `BUSINESS_TIMEZONE`. The default contribution is positive integer paise; enabled methods are a validated subset of `CASH`, `UPI`, and `BANK_TRANSFER`; `CURRENCY` is fixed to `INR` and `BUSINESS_TIMEZONE` is fixed to `Asia/Kolkata` in this demo. Settings writes are validated, audited, and do not alter historical financial records.

## Void and edit rules

- No application path performs a hard delete on `financial_transaction`.
- Void is an update of status and void metadata within the same database transaction that writes `audit_event`.
- Void reason is trimmed and must be non-empty after validation.
- Voiding is idempotent only for the same request key and target; a second void attempt with a different reason must be rejected clearly.
- Updates increment `revision` and write an audit event containing the changed field names, previous values, new values, actor, action, and timestamp.
- All financial aggregation queries filter `status = 'ACTIVE'`.

## Idempotency

`idempotency_record` contains `id`, `admin_user_id`, `endpoint`, `idempotency_key`, `request_hash`, `response_status`, `response_body JSONB`, `created_at`, and `expires_at`, with a unique constraint on `(admin_user_id, endpoint, idempotency_key)`.

- The first request creates the record in the same database transaction as the business change.
- A repeat with the same key and the same request hash returns the stored response.
- A repeat with the same key and a different request hash is rejected.
- Records are removed only by a safe retention job, never by user-facing application deletion.

## Documents

`transaction_document` contains `id`, `reference_id` such as `HY-DOC-000001`, `transaction_id`, `storage_key`, `original_filename`, `declared_mime_type`, `detected_mime_type`, `byte_size`, `checksum_sha256`, `status`, `uploaded_by_admin_id`, `uploaded_at`, `removed_at`, `removed_by_admin_id`, and `removal_reason`.

Constraints require a non-empty storage key, positive byte size, an allowed detected type, and a one-to-many relationship with the transaction. The database never stores file bytes. Removal requires a non-empty `removal_reason` when `status = 'REMOVED'`, preserves metadata, and writes an audit event rather than deleting the row.

The local storage key is an opaque generated value. The original filename is metadata only and must never be used to construct a filesystem path.

## Members

`member` contains `id`, `reference_id` such as `HY-MEM-0001`, `name`, `phone`, `notes`, `created_at`, and `updated_at`. Names are required and length-limited. Phone is optional; when present it must contain 7 to 15 digits after removing spaces, hyphens, parentheses, and an optional `+91` prefix. The same rule is enforced in the UI, API, and database. `reference_id` is unique and immutable. Member deletion is not provided in the demo; members may be deactivated only if a later approved requirement defines that behavior safely.

## Human-readable identifiers

Format and width are fixed:

- Members: `HY-MEM-` plus four digits.
- Income: `HY-INC-` plus six digits.
- Expenses: `HY-EXP-` plus six digits.
- Documents: `HY-DOC-` plus six digits.

`id_sequence` rows allocate the next value inside the same database transaction that creates the record. A failed transaction must not consume a committed business reference permanently for the caller, and concurrent allocation must never produce duplicates.

## Audit events

`audit_event` contains `id`, `actor_admin_id`, `action`, `entity_type`, `entity_id UUID NULL`, `entity_reference VARCHAR NULL`, `before JSONB NULL`, `after JSONB NULL`, `reason TEXT NULL`, `request_id UUID NULL`, `ip_hash TEXT NULL`, and `occurred_at TIMESTAMPTZ NOT NULL`.

Audit rows are append-only. Application roles have no update or delete permission for audit events. Security events must avoid storing passwords, session tokens, raw documents, or unnecessary personal data.

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
- Unique indexes on every `reference_id`

Dashboard aggregates must use index-friendly filters and must not load full transaction history into frontend memory.

## Migration, seed, and recovery rules

- Prisma migrations are reviewed before application.
- Migrations must be additive or explicitly reversible, and destructive changes require a documented backup and recovery plan.
- Demo seeding is idempotent and uses only fictional data defined in `13-DEMO-DATA-SPEC.md`.
- No user-facing reset-demo-database feature is allowed.
- Database tests must run against a real disposable PostgreSQL instance, not an in-memory substitute.
- Any action that could destroy non-demo or user data is a stop condition.
