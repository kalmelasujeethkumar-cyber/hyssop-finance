# HYSSOP FINANCE — Test Plan

## Document Responsibility

- Owns: test layers, stable `TEST-*` identifiers, deterministic scenarios, verification obligations, and evidence requirements.
- Does not own: product requirements, architecture, database schema, or runtime test results.
- Referenced by: `11-DEFINITION-OF-DONE.md`, phase documents, and `docs/runtime/TEST-RESULTS.md`.
- Change rule: test identifiers are stable; new concerns receive new identifiers and a requirement mapping, and existing scenarios are never weakened to obtain green results.

## Testing philosophy

Passing means verified behavior, not a rendered page or a clicked button. Important workflows must prove downstream state across API, database, UI, reports, balances, and audit history. Tests must be deterministic, isolated, and safe to run repeatedly.

## Test identifier register

Test identifiers are stable verification handles. They do not create product requirements; each row names the requirement coverage that must be mapped in `docs/14-TRACEABILITY-MATRIX.md`.

| Test ID | Verification concern | Primary requirement coverage |
|---|---|---|
| `TEST-AUTH-001` | Password hashing, session lifecycle, login, logout, expiry, revocation, and protected routes | `REQ-AUTH-002`–`REQ-AUTH-005` |
| `TEST-AUTH-002` | Pre-authentication and post-authentication CSRF, trusted origins, and CORS policy | `REQ-AUTH-003`, `REQ-AUTH-004`, `REQ-FIN-024` |
| `TEST-FIN-001` | Exact money, ledger aggregates, period boundaries, reconciliation, and technology-direction adherence | `REQ-FIN-001`–`REQ-FIN-014`, `REQ-FIN-025`, `REQ-AUTH-006` |
| `TEST-FIN-002` | Transaction correction, void, audit, voided-receipt retention, and immutability | `REQ-FIN-015`–`REQ-FIN-020`, `REQ-DOC-013` |
| `TEST-FIN-003` | Validation, category and association rules, duplicate submission, idempotency, and revision conflicts | `REQ-FIN-021`–`REQ-FIN-024`, `REQ-EXP-004` |
| `TEST-MEM-001` | Member identity, references, contact validation, search, history, and creation-date boundary | `REQ-MEM-001`–`REQ-MEM-006`, `REQ-DASH-018` |
| `TEST-CONTRIB-001` | Expected, received, remaining, and contribution statuses | `REQ-CONTRIB-001`–`REQ-CONTRIB-006` |
| `TEST-INCOME-001` | Every income type, method, member association, and anonymous privacy | `REQ-INCOME-001`–`REQ-INCOME-006`, `REQ-DOC-010`–`REQ-DOC-014` |
| `TEST-EXP-001` | Initial and custom expense categories and expense behavior | `REQ-EXP-001`–`REQ-EXP-004` |
| `TEST-DOC-001` | Allowed formats, multiple documents, association, preview, open, download, and missing receipt | `REQ-DOC-001`–`REQ-DOC-005` |
| `TEST-DOC-002` | Removal, `410 Gone`, cleanup retry, path safety, and unauthorized access | `REQ-DOC-006`–`REQ-DOC-009` |
| `TEST-DASH-001` | Required metrics, charts, trends, contribution buckets, formula reconciliation, recent transactions, and quick actions | `REQ-DASH-001`–`REQ-DASH-014`, `REQ-CONTRIB-005`, `REQ-CONTRIB-006`, `REQ-FIN-004`–`REQ-FIN-014` |
| `TEST-DASH-002` | Period presets, custom ranges, active-period labeling, and member-count derivation | `REQ-DASH-015`–`REQ-DASH-018`, `REQ-MEM-006` |
| `TEST-REPORT-001` | All required reports, period filters, contribution report fields, and print behavior | `REQ-REPORT-001`–`REQ-REPORT-004` |
| `TEST-SEARCH-001` | Authorized global search, deterministic ordering, bounded filters, and privacy | `REQ-SEARCH-001`, `REQ-SEARCH-002` |
| `TEST-AUDIT-001` | Audit coverage, filtering, detail safety, and immutability | `REQ-AUDIT-001`, `REQ-AUDIT-002` |
| `TEST-AUDIT-002` | Settings scope, defaults, payment-method invariants, and settings audit | `REQ-SETTINGS-001`–`REQ-SETTINGS-009` |
| `TEST-EXPORT-001` | CSV columns, escaping, reconciliation, and document references | `REQ-EXPORT-001`, `REQ-EXPORT-002` |
| `TEST-RESP-001` | Required controls, confirmation, feedback, accessibility, state honesty, product identity, and INR/date formatting | `REQ-RESP-001`–`REQ-RESP-011`, `REQ-AUTH-001`, `REQ-REPORT-004` |
| `TEST-RESP-002` | Desktop, laptop, tablet, Android-sized, iPhone-sized, and print-output behavior | `REQ-RESP-012`, `REQ-RESP-013`, `REQ-REPORT-003` |
| `TEST-SEC-001` | Sessions, CSRF, CORS, uploads, traversal, redaction, identity-disclosure prevention, settings invariants, rate limits, and authorization | `REQ-AUTH-002`–`REQ-AUTH-005`, `REQ-DOC-004`–`REQ-DOC-009`, `REQ-FIN-022`–`REQ-FIN-024`, `REQ-INCOME-005`, `REQ-INCOME-006`, `REQ-SETTINGS-006`, `REQ-SEARCH-002` |
| `TEST-E2E-001` | Complete Admin browser workflow from login through logout | All user-visible `REQ-*` identifiers |
| `TEST-E2E-002` | Invalid, adversarial, duplicate, expired-session, unauthorized flows, and cross-layer evidence for those flows | `REQ-FIN-021`–`REQ-FIN-025`, `REQ-AUTH-*`, `REQ-DOC-*`, `REQ-SEARCH-002` |
| `TEST-DEPLOY-001` | Free-tier capability verification, durable storage, HTTPS, CORS/CSRF, migrations, and hosted smoke test | `REQ-FIN-027` |

## Authentication verification (`TEST-AUTH-001`, `TEST-AUTH-002`)

Verify password hashing and verification, session creation and invalidation, expiry and revocation, generic login failures, pre-authentication CSRF for login, post-authentication CSRF rotation, trusted-origin and CORS policy, protected-route enforcement, and absence of secrets in responses or logs.

## Test layers

- **Unit tests**: exact money parsing and formatting, paise arithmetic, contribution status, period boundaries, validation, reference formatting, and storage-path safety.
- **Integration tests**: NestJS modules against a real disposable PostgreSQL database, including transaction rollback, audit writes, void behavior, document metadata, and authorization.
- **Component tests**: React components and forms with accessible states, validation, error feedback, and no dead controls.
- **API tests**: Supertest coverage of authentication, authorization, contracts, idempotency, pagination, filters, uploads, and error codes.
- **Database tests**: Prisma migrations, constraints, indexes, seed idempotency, and reconciliation of database-derived totals.
- **Browser E2E tests**: Playwright exercising the Admin workflows listed below against the real stack.
- **Responsive and accessibility checks**: representative desktop, laptop, tablet, Android-sized, and iPhone-sized viewports, keyboard focus, dialogs, tables, and charts.

The exact test commands must be established during the foundation phase and recorded before they are treated as evidence.

## Financial integrity scenario (`TEST-FIN-001`)

Use a deterministic dataset:

| Transaction | Method | Amount |
|---|---|---:|
| Member Contribution | Cash | ₹1,000 |
| Member Contribution | UPI | ₹500 |
| Offering | Cash | ₹5,000 |
| Donation | Bank | ₹10,000 |

Expected active income is ₹16,500. Add Electricity on Bank for ₹2,000 and Food on Cash for ₹1,000. Expected active expenses are ₹3,000 and expected available balance is ₹13,500. Method balances through the period end must be Cash ₹4,000, UPI ₹500, and Bank ₹8,000, and they must sum to ₹13,500. Add a second reconciliation fixture with ₹20,000 UPI income and a ₹5,000 UPI expense, expecting an ending UPI balance of ₹15,000. Add a fixture where expenses exceed income for a method and verify the visible negative balance rather than a hidden reset or opening-balance value.

The same expected values must agree across dashboard aggregates, database-derived calculations, reports, monthly summaries, payment-method balances, transaction views, contribution status, and CSV where applicable. Any unexplained mismatch is a failure.

Add a voided transaction to prove that it remains auditable but is excluded from every active total. Add a corrected transaction to prove the audit record shows the previous and new values. Verify that selected-period income and expense cards show period movement while method and total available balances are ending balances through period end.

## Contribution testing (`TEST-CONTRIB-001`)

Cover full, partial, and unpaid months. Test that received and remaining amounts derive from active transactions, that a void removes the amount from the derived total, that the period is not overwritten by a client-supplied paid amount, and that member history matches the report. Test the member-count rule at a period boundary, multi-month bucket counts, and an absent expected period displayed as **Not configured** rather than silently classified as a payment status.

## Invalid input testing (`TEST-FIN-003`, `TEST-E2E-002`)

Intentionally test negative amounts, zero amounts, non-numeric amounts, ambiguous decimal input, missing names, invalid phone input, missing expense categories, invalid type/category combinations, malformed requests, unsupported uploads, oversized uploads, unauthenticated protected requests, invalid IDs, invalid or reversed date ranges, duplicate submissions, expired sessions, CSRF failures, and unauthorized document access. Verify safe, stable error responses and no partial financial writes. Test concurrent identical idempotency requests, expired-key rejection, same-key/different-payload rejection, stale member and transaction revision conflicts, and rejection of forbidden transaction identity, type, reference, status, and void fields.

## Document testing (`TEST-DOC-001`, `TEST-DOC-002`)

Cover JPG, JPEG, PNG, WEBP, PDF, multiple documents per transaction, transaction association, preview, open, download, missing-receipt indication, controlled removal, persistence after application restart, invalid content rejection, path traversal rejection, and unauthorized access. After removal, verify metadata remains, content returns `410 Gone`, and a failed storage deletion remains inaccessible with a controlled cleanup retry. Raw files must never be written to PostgreSQL.

## Search, filter, report, and export testing (`TEST-SEARCH-001`, `TEST-REPORT-001`, `TEST-EXPORT-001`)

Verify case-insensitive member search, reference search, type/category/status/method/date filters, sorting, pagination, active-period boundaries, all required reports, CSV escaping, and document references. Local document links may be documented as local-only. Test global search API ownership, deterministic ordering, safe query limits, and that anonymous donation free text cannot reveal identity.

## Browser E2E workflow (`TEST-E2E-001`)

As the Admin, cover login, dashboard, member creation, member search, member editing, full contribution, partial contribution, offering, donation, anonymous donation, document upload, expense, multiple documents, financial totals, payment-method balances, financial edit, audit history, void transaction, search, filters, reports, CSV, receipt or document access, print behavior where automatable, settings, and logout. Assertions must check expected behavior and persisted downstream effects, including a receipt for every income type, a marked historical receipt for a voided income record, and no anonymous identity disclosure.

## Responsive and usability testing (`TEST-RESP-001`, `TEST-RESP-002`)

Check navigation, forms, tables, charts, dialogs, buttons, filters, text, overflow, spacing, and touch usability at representative viewports. Financial tables must remain readable without accidental page-level horizontal scrolling or overlapping controls.

## Security testing (`TEST-SEC-001`)

Test unauthenticated access, session expiry and logout, CSRF for both pre-auth login and authenticated mutations, CORS restrictions, role enforcement, ID guessing, upload content validation, path traversal, secret redaction, error leakage, required login/upload/search/export/mutation rate limits, and audit immutability expectations.

## Complete-retest rule (`TEST-E2E-002`)

After final QA finds and fixes a defect, do not rerun only the previously failing test. Restart the complete required test process from the beginning. If a regression is found, fix it and restart the complete run again. Only a complete run with no blocking failures supports demo-ready status.

## Evidence recording

Record commands, environment assumptions, test counts, failures, fixes, and retest results in `docs/runtime/TEST-RESULTS.md`. Application tests have not started because implementation has not started.
