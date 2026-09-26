# HYSSOP FINANCE — Demo Data Specification

## Document Responsibility

- Owns: fictional demo-data characteristics, coverage, naming rules, seed integrity, and privacy review.
- Does not own: locked product requirements, database schema authority, or deployment status.
- Referenced by: the database, security, deployment, and test documents.
- Change rule: demo data must remain fictional, deterministic where required, and must not introduce real personal or church data.

## Purpose

The demo uses realistic fictional data to make financial behavior understandable to a church administrator and to prove the application under meaningful variation. It must never use real personal, church, donor, or financial information.

## Coverage

Seed data should span several months relative to an injected demo clock. The seed command must accept a documented `DEMO_AS_OF_DATE` or clock value so deterministic tests can use a fixed date while a running demo can produce meaningful Today and This Month records. Include:

- Multiple members with varied names, optional phone values, and short fictional notes.
- Member Contributions that produce PAID, PARTIALLY PAID, and NOT PAID months.
- Offerings, Donations, and Anonymous Donations.
- Cash, UPI, and Bank Transfer income and expenses.
- All initial expense categories at least once, plus custom categories.
- Expenses with and without receipts; missing evidence must display **Receipt Missing**.
- Multiple documents on at least one transaction using allowed formats.
- A corrected transaction with an audit event showing previous and new values.
- A voided transaction with a reason, excluded from active totals but visible in audit and history.
- Recent transactions spanning enough dates to exercise every dashboard period filter.

## Fictional naming rules

Names, phone numbers, notes, and descriptions must be invented for demonstration. Phone numbers should be obviously fictional or use a documented demo range, and must not be copied from a real person. No real addresses, bank account numbers, payment handles, or identification documents are required.

## Data integrity

Seed records must use the exact money representation, valid references, valid business dates in `Asia/Kolkata`, and allowed enums. Amounts must reconcile across the dashboard, method balances, reports, and CSV. Seeding must be idempotent for development and must not create duplicates when rerun safely.

The demo does not provide a user-facing reset-database control. A developer-only reseed command may be considered only in an approved phase and must not be presented as a production feature.

## Reference examples

Illustrative formats are `HY-MEM-0001`, `HY-INC-000001`, `HY-EXP-000001`, and `HY-DOC-000001`. Seeds must not assume a particular starting number beyond the documented allocator; the database remains authoritative.

## Privacy and review

Before any demo environment is shared, review seeded content for accidental real data, remove unnecessary personal fields, and confirm that local uploads and logs are excluded from Git.
