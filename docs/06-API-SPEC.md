# HYSSOP FINANCE — API Specification

## Document Responsibility

- Owns: versioned REST routes, request/response envelopes, validation errors, filters, pagination, and transport semantics.
- Does not own: business formulas, persistence schema, visual design, or implementation evidence.
- Referenced by: `02-ARCHITECTURE.md`, `05-DATABASE-SPEC.md`, `07-SECURITY-RULES.md`, phase documents, and the test plan.
- Change rule: contract changes must be documented, backward impacts recorded, and covered by the applicable API tests.

## Status and conventions

This document specifies the proposed REST surface. No API code is created during Prompt 01. The base path is `/api/v1`, JSON is used except for document upload and download, and all monetary values are decimal INR strings such as `"1500.00"`.

Every response includes a request ID in headers and error bodies. Successful single resources and list responses both use a `data` property; list responses also include `pagination`. Timestamps are ISO 8601 instants. Financial `businessDate` is `YYYY-MM-DD` interpreted in `Asia/Kolkata`.

## API responsibility and references

This document owns the transport implementation of the requirements listed in `01-REQUIREMENTS.md`. It references `REQ-AUTH-*`, `REQ-MEM-*`, `REQ-CONTRIB-*`, `REQ-INCOME-*`, `REQ-EXP-*`, `REQ-DOC-*`, `REQ-DASH-*`, `REQ-REPORT-*`, `REQ-SEARCH-*`, `REQ-AUDIT-*`, `REQ-SETTINGS-*`, `REQ-EXPORT-*`, `REQ-RESP-*`, and `REQ-FIN-*` but does not redefine them. Database invariants remain owned by `05-DATABASE-SPEC.md`, and server-side aggregate semantics remain owned by `02-ARCHITECTURE.md`.

All financial aggregate responses are projections of the canonical calculation layer. The API must not accept client-supplied totals, received amounts, remaining amounts, or status values in place of ledger-derived values. Search free text is bounded to names, IDs, references, categories, and types; dates and exact amounts use validated filters.

## Common error format

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request could not be validated.",
    "fields": { "amount": ["Amount must be greater than zero."] },
    "requestId": "6f2f0b2e-6b5b-4a03-9b3e-2c6f0b6f7c11"
  }
}
```

Use stable machine codes and safe human messages. Do not return stack traces, SQL details, secrets, session tokens, or local filesystem paths.

## Health and connectivity

- `GET /api/v1/health` — unauthenticated connectivity check for the running API process. It performs no financial calculation and reads no business data.

```json
{
  "data": {
    "status": "ok",
    "service": "hyssop-finance-api",
    "version": "0.1.0",
    "uptimeSeconds": 42,
    "timestamp": "2026-09-26T09:15:00.000Z"
  }
}
```

The response includes an `x-request-id` response header like every other endpoint. It never returns configuration values, environment variables, dependency versions, filesystem paths, or credentials. A later readiness check may verify its database dependency; until that dependency exists, `status` reflects only the API process itself.

## Authentication endpoints

- `POST /api/v1/auth/login` — requires a pre-authentication CSRF token, accepts `identifier` and `password`, verifies Argon2id, sets the secure session cookie, and returns the Admin profile plus a rotated CSRF token. Failed attempts return a generic message.
- `POST /api/v1/auth/logout` — invalidates the current session and clears the cookie.
- `GET /api/v1/auth/me` — returns the authenticated Admin and current session context.
- `GET /api/v1/auth/csrf` — issues or returns a short-lived pre-authentication CSRF cookie and matching token bound to the trusted origin. The endpoint does not require an authenticated session; the token is required by login and rotated after authentication.

Mutating requests, including login, require the CSRF header or token defined by the security specification. Session cookies are HTTP-only and never readable by application JavaScript. Cross-origin deployment must use explicit trusted origins and secure cookie policy.

## Members

- `GET /api/v1/members` — search, sort, and paginated list.
- `POST /api/v1/members` — create a member and return its `HY-MEM-0001` reference.
- `GET /api/v1/members/:id` — member detail with current period summaries.
- `PATCH /api/v1/members/:id` — update allowed fields with optimistic revision checking using the member `revision` value and an `If-Match` or equivalent request contract. A stale revision returns a conflict.
- `GET /api/v1/members/:id/contributions?year=` — month-wise expected, received, remaining, and status.
- `GET /api/v1/members/:id/transactions` — member transaction history.
- `GET /api/v1/members/:id/documents` — documents associated with the member's transactions where needed.

## Contribution periods

- `GET /api/v1/contribution-periods?memberId=&year=&month=&status=`
- `PUT /api/v1/contribution-periods/:memberId/:year/:month` — set the expected amount for a period.
- `GET /api/v1/contribution-periods/summary` — counts and totals by PAID, PARTIALLY PAID, and NOT PAID for a period.

PUT is idempotent for the same expected amount. Received and remaining values are derived, never accepted from the client.

## Transactions

- `GET /api/v1/transactions` — list with type, status, date, method, member, category, income type, reference, and exact `minAmount`/`maxAmount` filters where applicable.
- `GET /api/v1/transactions/:id` — complete transaction detail.
- `POST /api/v1/income` — create Member Contribution, Offering, Donation, or Anonymous Donation.
- `PATCH /api/v1/transactions/:id` — edit only amount, payment method, business date, description, notes, and type-specific associations permitted by the transaction type; identity, reference, transaction type, creator, creation timestamp, status, and void fields are immutable. The request includes the current transaction `revision` through `If-Match` or an equivalent contract. A stale revision returns a conflict. The change writes an audit event and increments revision.
- `POST /api/v1/transactions/:id/void` — requires `reason`; preserves the row and excludes it from active totals.
- `GET /api/v1/transactions/:id/audit` — transaction audit trail.
- `GET /api/v1/transactions/:id/receipt` — returns the stable receipt JSON projection for every income type, containing HYSSOP FINANCE, the reference, received from when applicable, amount, income type, payment method, and business date. The browser print route renders that same projection. An Anonymous Donation must not reveal a contributor identity, including through description or notes. A voided receipt is historical and visibly marked `VOIDED`.
- `GET /api/v1/transactions/summary` — authoritative period totals used by the dashboard and reports.

All create and mutation endpoints require an idempotency key for safe retries. Repeating a request with the same key and hash returns the original result rather than creating a duplicate financial record. A repeated key with a different payload is rejected. Records are retained for 30 days; an expired key is rejected as expired rather than silently reused. Concurrent identical requests are serialized by the database unique constraint.

## Expenses and categories

- `POST /api/v1/expenses` — create an expense with category, amount, method, and business date.
- `GET /api/v1/expenses` — paginated expense list with filters.
- `GET /api/v1/expenses/categories` — active categories.
- `POST /api/v1/expenses/categories` — create a custom category.
- `PATCH /api/v1/expenses/categories/:id` — rename or deactivate a category; never silently delete history.

## Documents

- `POST /api/v1/transactions/:id/documents` — multipart upload, one file per request or an explicitly documented batch shape.
- `GET /api/v1/transactions/:id/documents` — document metadata list.
- `GET /api/v1/documents/:id` — authenticated metadata and download or preview stream.
- `GET /api/v1/documents/:id/preview` — inline preview only for supported formats.
- `DELETE /api/v1/documents/:id` — controlled removal requiring a non-empty `reason`; preserve metadata and audit. The API commits the `REMOVED` state first, denies content with `410 Gone`, and retries physical storage deletion without exposing the object.

Allowed types are JPG, JPEG, PNG, WEBP, and PDF. The server validates declared type, detected type, size, and safe storage key. The response includes a reference, original filename, byte size, detected type, and authenticated relative link.

## Dashboard and reports

- `GET /api/v1/dashboard?period=thisMonth&from=&to=`
- `GET /api/v1/reports/financial-summary?period=`
- `GET /api/v1/reports/income?period=`
- `GET /api/v1/reports/expenses?period=`
- `GET /api/v1/reports/member-contributions?period=`
- `GET /api/v1/reports/offerings?period=`
- `GET /api/v1/reports/donations?period=`
- `GET /api/v1/reports/payment-methods?period=`
- `GET /api/v1/reports/expense-categories?period=`
- `GET /api/v1/reports/documents?period=`
- `GET /api/v1/reports/audit?from=&to=&action=`
- `GET /api/v1/reports/transactions?period=&type=&status=`
- `GET /api/v1/reports/:reportId/export.csv?period=` — CSV export with documented columns and escaping.

Period values are `today`, `thisMonth`, `lastMonth`, `last3Months`, `last6Months`, `thisYear`, `lastYear`, or an explicit `from` and `to` in `YYYY-MM-DD`. Boundaries are inclusive and are defined exactly in `01-REQUIREMENTS.md`. Custom ranges require both dates and reject `from` after `to`.

Report visibility is deterministic: active financial reports exclude `VOIDED` records; Complete Transaction and Audit retain history; Receipt / Document projections distinguish `AVAILABLE`, `REMOVED`, and authorized historical `VOIDED` records. The same projections are consumed by CSV export and print.

## Search

- `GET /api/v1/search?q=&type=` — global search across member name, member ID, transaction reference, category, transaction type, dates, and amounts where appropriate. Results are paginated, ordered deterministically, and limited to authorized data. `type` may be `all`, `member`, or `transaction`.

## Audit and settings

- `GET /api/v1/audit-events` — paginated, filterable audit history.
- `GET /api/v1/settings` — safe demo settings.
- `PATCH /api/v1/settings` — update the default monthly contribution or enabled payment methods with audit events; at least one payment method remains enabled, and disabling a method affects new entries only. Fixed INR and `Asia/Kolkata` values are returned but not mutable in the demo.
- `POST /api/v1/settings/contribution-default` — set the default monthly expectation used when creating a new period.

## Example income contract

Request:

```json
{
  "incomeType": "MEMBER_CONTRIBUTION",
  "amount": "1000.00",
  "paymentMethod": "CASH",
  "businessDate": "2026-09-25",
  "memberId": "0d6d2a4c-2a6f-4a7e-8c2d-6d1f9c2b7a11",
  "contributionPeriod": { "year": 2026, "month": 9 },
  "description": "September monthly contribution"
}
```

Response:

```json
{
  "data": {
    "id": "3b0b8b8c-2b9a-4a3e-9a2b-3c1a0a5a9f10",
    "referenceId": "HY-INC-000001",
    "type": "INCOME",
    "incomeType": "MEMBER_CONTRIBUTION",
    "amount": "1000.00",
    "currency": "INR",
    "paymentMethod": "CASH",
    "status": "ACTIVE",
    "businessDate": "2026-09-25",
    "member": { "id": "0d6d2a4c-2a6f-4a7e-8c2d-6d1f9c2b7a11", "referenceId": "HY-MEM-0001", "name": "Anitha Kumar" },
    "contributionStatus": "PAID"
  }
}
```

The response must not expose internal paise arithmetic unless a contract explicitly requires it.

## Contract rules

- Every list has deterministic ordering and pagination.
- Static paths such as `/transactions/summary` take precedence over parameterized paths such as `/transactions/:id` during routing.
- Filters are validated and cannot inject arbitrary query structure.
- Mutating endpoints validate the same rules as the UI and return field-level errors.
- Monetary totals in responses must reconcile with database-derived aggregates and each other.
- Authorization is enforced on the server for every protected endpoint.
- API contract changes require a decision record and updated tests.
