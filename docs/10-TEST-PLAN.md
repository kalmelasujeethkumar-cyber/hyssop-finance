# HYSSOP FINANCE — Test Plan

## Testing philosophy

Passing means verified behavior, not a rendered page or a clicked button. Important workflows must prove downstream state across API, database, UI, reports, balances, and audit history. Tests must be deterministic, isolated, and safe to run repeatedly.

## Test layers

- **Unit tests**: exact money parsing and formatting, paise arithmetic, contribution status, period boundaries, validation, reference formatting, and storage-path safety.
- **Integration tests**: NestJS modules against a real disposable PostgreSQL database, including transaction rollback, audit writes, void behavior, document metadata, and authorization.
- **Component tests**: React components and forms with accessible states, validation, error feedback, and no dead controls.
- **API tests**: Supertest coverage of authentication, authorization, contracts, idempotency, pagination, filters, uploads, and error codes.
- **Database tests**: Prisma migrations, constraints, indexes, seed idempotency, and reconciliation of database-derived totals.
- **Browser E2E tests**: Playwright exercising the Admin workflows listed below against the real stack.
- **Responsive and accessibility checks**: representative desktop, laptop, tablet, Android-sized, and iPhone-sized viewports, keyboard focus, dialogs, tables, and charts.

The exact test commands must be established during the foundation phase and recorded before they are treated as evidence.

## Financial integrity scenario

Use a deterministic dataset:

| Transaction | Method | Amount |
|---|---|---:|
| Member Contribution | Cash | ₹1,000 |
| Member Contribution | UPI | ₹500 |
| Offering | Cash | ₹5,000 |
| Donation | Bank | ₹10,000 |

Expected active income is ₹16,500. Add Electricity on Bank for ₹2,000 and Food on Cash for ₹1,000. Expected active expenses are ₹3,000 and expected available balance is ₹13,500. Method balances must be Cash ₹4,000, UPI ₹500, and Bank ₹8,000, and they must sum to ₹13,500.

The same expected values must agree across dashboard aggregates, database-derived calculations, reports, monthly summaries, payment-method balances, transaction views, contribution status, and CSV where applicable. Any unexplained mismatch is a failure.

Add a voided transaction to prove that it remains auditable but is excluded from every active total. Add a corrected transaction to prove the audit record shows the previous and new values.

## Contribution testing

Cover full, partial, and unpaid months. Test that received and remaining amounts derive from active transactions, that a void removes the amount from the derived total, that the period is not overwritten by a client-supplied paid amount, and that member history matches the report.

## Invalid input testing

Intentionally test negative amounts, zero amounts, non-numeric amounts, ambiguous decimal input, missing names, invalid phone input, missing expense categories, invalid type/category combinations, malformed requests, unsupported uploads, oversized uploads, unauthenticated protected requests, invalid IDs, invalid or reversed date ranges, duplicate submissions, expired sessions, CSRF failures, and unauthorized document access. Verify safe, stable error responses and no partial financial writes.

## Document testing

Cover JPG, JPEG, PNG, WEBP, PDF, multiple documents per transaction, transaction association, preview, open, download, missing-receipt indication, controlled removal, persistence after application restart, invalid content rejection, path traversal rejection, and unauthorized access. Raw files must never be written to PostgreSQL.

## Search, filter, report, and export testing

Verify case-insensitive member search, reference search, type/category/status/method/date filters, sorting, pagination, active-period boundaries, all required reports, CSV escaping, and document references. Local document links may be documented as local-only.

## Browser E2E workflow

As the Admin, cover login, dashboard, member creation, member search, member editing, full contribution, partial contribution, offering, donation, anonymous donation, document upload, expense, multiple documents, financial totals, payment-method balances, financial edit, audit history, void transaction, search, filters, reports, CSV, receipt or document access, print behavior where automatable, settings, and logout. Assertions must check expected behavior and persisted downstream effects.

## Responsive and usability testing

Check navigation, forms, tables, charts, dialogs, buttons, filters, text, overflow, spacing, and touch usability at representative viewports. Financial tables must remain readable without accidental page-level horizontal scrolling or overlapping controls.

## Security testing

Test unauthenticated access, session expiry and logout, CSRF, CORS restrictions, role enforcement, ID guessing, upload content validation, path traversal, secret redaction, error leakage, rate limits where implemented, and audit immutability expectations.

## Complete-retest rule

After final QA finds and fixes a defect, do not rerun only the previously failing test. Restart the complete required test process from the beginning. If a regression is found, fix it and restart the complete run again. Only a complete run with no blocking failures supports demo-ready status.

## Evidence recording

Record commands, environment assumptions, test counts, failures, fixes, and retest results in `docs/runtime/TEST-RESULTS.md`. Application tests have not started because implementation has not started.
