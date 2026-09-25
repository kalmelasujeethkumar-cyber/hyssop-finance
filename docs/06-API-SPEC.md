# HYSSOP FINANCE — API Specification

## Status and conventions

This document specifies the proposed REST surface. No API code is created during Prompt 01. The base path is `/api/v1`, JSON is used except for document upload and download, and all monetary values are decimal INR strings such as `"1500.00"`.

Every response includes a request ID in headers and error bodies. Successful single resources and list responses both use a `data` property; list responses also include `pagination`. Timestamps are ISO 8601 instants. Financial `businessDate` is `YYYY-MM-DD` interpreted in `Asia/Kolkata`.

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

## Authentication endpoints

- `POST /api/v1/auth/login` — accepts `identifier` and `password`, verifies Argon2id, sets the secure session cookie, returns the Admin profile and CSRF token. Failed attempts return a generic message.
- `POST /api/v1/auth/logout` — invalidates the current session and clears the cookie.
- `GET /api/v1/auth/me` — returns the authenticated Admin and current session context.
- `GET /api/v1/auth/csrf` — returns a CSRF token for the current session if the deployment requires CSRF protection.

Mutating requests require the CSRF header or token defined by the security specification. Session cookies are HTTP-only and never readable by application JavaScript. Cross-origin deployment must use explicit trusted origins and secure cookie policy.

## Members

- `GET /api/v1/members` — search, sort, and paginated list.
- `POST /api/v1/members` — create a member and return its `HY-MEM-0001` reference.
- `GET /api/v1/members/:id` — member detail with current period summaries.
- `PATCH /api/v1/members/:id` — update allowed fields with optimistic revision checking.
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
- `PATCH /api/v1/transactions/:id` — edit allowed fields; writes an audit event and increments revision.
- `POST /api/v1/transactions/:id/void` — requires `reason`; preserves the row and excludes it from active totals.
- `GET /api/v1/transactions/:id/audit` — transaction audit trail.
- `GET /api/v1/transactions/:id/receipt` — returns receipt data or a print-ready document for eligible income records, containing HYSSOP FINANCE, the reference, received from when applicable, amount, income type, payment method, and business date. An Anonymous Donation must not reveal a contributor identity.
- `GET /api/v1/transactions/summary` — authoritative period totals used by the dashboard and reports.

All create and mutation endpoints require an idempotency key for safe retries. Repeating a request with the same key returns the original result rather than creating a duplicate financial record. A repeated key with a different payload is rejected.

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
- `DELETE /api/v1/documents/:id` — controlled removal requiring a non-empty `reason`; preserve metadata and audit.

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

## Search

- `GET /api/v1/search?q=&type=` — global search across member name, member ID, transaction reference, category, transaction type, dates, and amounts where appropriate. Results are paginated, ordered deterministically, and limited to authorized data. `type` may be `all`, `member`, or `transaction`.

## Audit and settings

- `GET /api/v1/audit-events` — paginated, filterable audit history.
- `GET /api/v1/settings` — safe demo settings.
- `PATCH /api/v1/settings` — update the default monthly contribution or enabled payment methods with audit events; fixed INR and `Asia/Kolkata` values are returned but not mutable in the demo.
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
