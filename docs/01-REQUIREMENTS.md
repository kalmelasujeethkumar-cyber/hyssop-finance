# HYSSOP FINANCE — Requirements

## Document Responsibility

- Owns: locked business requirements, business formulas, product behavior, and stable `REQ-*` identifiers.
- Does not own: architecture, database schema, transport design, visual values, or test procedures.
- Referenced by: `AGENTS.md`, all other specifications, all phase documents, and the traceability matrix.
- Change rule: a requirement change must preserve the locked behavior, use an existing identifier where possible, and be mapped before implementation.

## Requirement status and interpretation

The requirements in this document are locked for the demo unless the user explicitly changes them. Proposed technical details in other specifications must be checked against this document. A conflict is a stop-and-ask condition.

Requirement identifiers are stable. Existing identifiers are never renumbered. A new identifier is created only for genuinely new behavior, and the change is recorded in the traceability matrix and, when it has a technical reason, in `docs/runtime/DECISIONS.md`.

## Product and access

- **REQ-AUTH-001** — The product name is **HYSSOP FINANCE**.
- **REQ-AUTH-002** — The demo serves one church and has one authenticated application role, **Admin**.
- **REQ-AUTH-003** — Authentication is real backend authentication with secure password hashing. No frontend-only or hard-coded login is acceptable.
- **REQ-AUTH-004** — Protected operations require an authenticated session.
- **REQ-AUTH-005** — Logout invalidates the session.
- **REQ-AUTH-006** — The architecture should permit later production expansion without implementing unused demo complexity.
- **REQ-FIN-002** — Business timezone is `Asia/Kolkata`; currency is INR.
- **REQ-RESP-001** — The application is light-only and uses the white/blue/orange direction in `04-DESIGN-TOKENS.md`.

## Financial records

The system must support the following financial record behavior:

- **REQ-INCOME-001** — Income types are Member Contribution, Offering, Donation, and Anonymous Donation.
- **REQ-EXP-001** — Expenses support these initial categories: Electricity, Water, Church Maintenance, Repairs, Church Programs, Food, Decoration, Equipment, Cleaning, Transport, Charity / Help, and Other.
- **REQ-EXP-002** — Admin-created custom expense categories are supported.
- **REQ-EXP-004** — An expense requires exactly one existing active expense category. A missing, unknown, or inactive category is rejected instead of being saved without a category.
- **REQ-INCOME-002** — Payment methods are Cash, UPI, and Bank Transfer.
- **REQ-EXP-003** — The same three payment methods apply to expense entries.
- **REQ-FIN-001** — Financial records carry transaction date, business date, description, amount, and relevant associations.
- **REQ-FIN-003** — Financial calculation and display use exact money arithmetic rather than unsafe floating-point arithmetic.
- **REQ-FIN-004** — Financial results are not represented by hard-coded dashboard values or a single permanent member amount field.

Member Contribution requires a member. Offering and Donation may optionally identify a member when appropriate. Anonymous Donation must not require or expose a contributor identity, including through a description, note, receipt, search result, report, or CSV cell.

- **REQ-INCOME-003** — Member Contribution requires a member.
- **REQ-INCOME-004** — Offering and Donation may optionally identify a member.
- **REQ-INCOME-005** — Anonymous Donation must not require or expose contributor identity through description, notes, receipt, search, report, or CSV.
- **REQ-INCOME-006** — Anonymous Donation rejects identity-bearing free text and uses a server-owned neutral description.

For this demo, the only named-contributor association is the optional member association above; the application does not invent a separate contributor identity model.

## Core calculations

For any selected period:

```text
TOTAL INCOME = active member contributions
             + active offerings
             + active donations
             + active anonymous donations

TOTAL EXPENSES = all active valid expenses in the period

AVAILABLE BALANCE = TOTAL INCOME - TOTAL EXPENSES
```

- **REQ-FIN-005** — Total income equals active member contributions, offerings, donations, and anonymous donations in the selected period.
- **REQ-FIN-006** — Total expenses equal all active, valid expenses in the selected period. A valid record is persisted as `ACTIVE` and satisfies the database type and association constraints.
- **REQ-FIN-007** — Selected-period available balance equals selected-period income minus selected-period expenses.
- **REQ-FIN-008** — Only active, non-voided records participate in financial totals.
- **REQ-FIN-009** — Selected-period income and expense cards represent period movements.

Payment-method cards are ending balances through the selected period end, calculated from all active records from the beginning of the ledger through that end date:

```text
METHOD BALANCE AS OF PERIOD END = active income received by method through period end
                                - active expenses paid by method through period end
```

- **REQ-FIN-010** — Each method balance is active income through period end minus active expenses through period end.
- **REQ-FIN-011** — The demo has no opening-balance record, setting, transfer, or hidden seed. Every balance starts at zero and is derived from actual transaction history.
- **REQ-FIN-012** — A method balance may be negative when recorded expenses exceed recorded income for that method, and the UI must not conceal that condition.
- **REQ-FIN-013** — Total available balance is the sum of the three ending method balances and reconciles to the active ledger through period end.
- **REQ-FIN-014** — Any displayed period movement is labeled separately from an ending balance and cannot be confused with one.

Month-wise contribution tracking is based on the member's expected amount for a month/year and active member-contribution transactions assigned to that member and period:

```text
PAID = received >= expected
PARTIALLY PAID = received > 0 and received < expected
NOT PAID = received = 0
```

- **REQ-CONTRIB-001** — Contribution tracking uses the member's expected amount for a month/year period.
- **REQ-CONTRIB-002** — Status is `PAID` when received is at least expected, `PARTIALLY PAID` when received is above zero and below expected, and `NOT PAID` when received is zero.
- **REQ-CONTRIB-003** — The period record stores the expected amount; received and remaining amounts are derived from the active ledger.
- **REQ-CONTRIB-004** — A period is not marked paid merely because a dashboard value appears correct, and a permanent member amount field cannot replace transaction history.

For a selected range spanning multiple months, the contribution-status visualization counts each configured member-period bucket in the range rather than counting a member only once.

- **REQ-CONTRIB-005** — A multi-month contribution-status visualization counts each configured member-period bucket rather than counting each member once.
- **REQ-CONTRIB-006** — A member-period with no expected-period record is shown as a separate **Not configured** state and is not silently classified as `PAID`, `PARTIALLY PAID`, or `NOT PAID`. The bucket population is members created on or before the end of that month.

## Members and history

- **REQ-MEM-001** — Each member has a human-readable member ID and a name.
- **REQ-MEM-002** — Phone number and notes are optional member fields.
- **REQ-MEM-003** — A member has contribution history and may have many transactions.
- **REQ-MEM-004** — The member page eventually shows month/year, expected, received, remaining, status, applicable payment method, and relevant receipts/documents.
- **REQ-MEM-005** — When a phone number is present, it must contain 7 to 15 digits after removing spaces, hyphens, parentheses, and an optional `+91` prefix. The same rule applies in the UI, API, and database validation.
- **REQ-MEM-006** — Member deletion and deactivation are not provided in the demo. Current member views treat all persisted members as active; the dashboard applies its separate period-end creation rule.

## Transaction correction and void rules

- **REQ-FIN-015** — Editing a financial transaction saves the corrected value and creates an audit event containing the relevant previous and new values, timestamp, actor, and action.
- **REQ-FIN-016** — Application users must not normally permanently delete a financial transaction.
- **REQ-FIN-017** — A transaction may be voided only through a workflow that requires a non-empty reason after validation.
- **REQ-FIN-018** — A voided transaction remains available to audit/history views but is excluded from active income, expenses, balances, contribution received totals, and applicable reports.
- **REQ-FIN-019** — A void operation records its reason, actor, timestamp, and action.
- **REQ-FIN-020** — Database/API implementation must prevent silent deletion and preserve history.

The correction allow-list, immutable identity fields, and revision conflict behavior are technical contracts owned by `05-DATABASE-SPEC.md` and `06-API-SPEC.md`; they implement these requirements rather than create new product behavior.

## Documents

- **REQ-DOC-001** — A transaction may have multiple documents.
- **REQ-DOC-002** — Supported demo formats are JPG, JPEG, PNG, WEBP, and PDF.
- **REQ-DOC-003** — Expenses may omit a receipt, but the interface must clearly show **Receipt Missing**.
- **REQ-DOC-004** — The demo must support validated upload and transaction association.
- **REQ-DOC-005** — The demo must support authenticated view/preview where supported, open, and download.
- **REQ-DOC-006** — Controlled document removal is permitted where the authenticated Admin supplies a non-empty reason and the action is audited.
- **REQ-DOC-007** — Raw files must not be stored directly in PostgreSQL.
- **REQ-DOC-008** — Local project-controlled storage is used behind an abstraction so production storage can be substituted later.
- **REQ-DOC-009** — Access to storage paths must not bypass authentication or authorization.

## Receipts

Every income type is eligible for a generated receipt, including Offering, Donation, and Anonymous Donation. An active income transaction must be able to display and print a receipt containing:

- **REQ-DOC-010** — HYSSOP FINANCE, transaction reference, amount, income type, payment method, and business date.
- **REQ-DOC-011** — Received from, when a member or named contributor legitimately applies.
- **REQ-DOC-012** — An Anonymous Donation receipt must not reveal a contributor identity.
- **REQ-DOC-013** — A voided income transaction may retain an authorized historical receipt marked **VOIDED**; the demo retains the historical receipt when it is available and keeps it excluded from active totals.
- **REQ-DOC-014** — Receipt generation uses persisted transaction data and is not a static image or manually maintained duplicate record.

## Dashboard and date filters

The dashboard must support the required metrics and visualizations:

- **REQ-DASH-001** — Total Income.
- **REQ-DASH-002** — Total Expenses / Total Used.
- **REQ-DASH-003** — Available Balance for the selected period.
- **REQ-DASH-004** — Member count.
- **REQ-DASH-005** — Cash balance.
- **REQ-DASH-006** — UPI balance.
- **REQ-DASH-007** — Bank balance.
- **REQ-DASH-008** — Total available balance as the ending ledger balance through the selected period end.
- **REQ-DASH-009** — Income versus expense visualization.
- **REQ-DASH-010** — Income breakdown and expense breakdown visualizations.
- **REQ-DASH-011** — Contribution status visualization.
- **REQ-DASH-012** — Monthly financial trend.
- **REQ-DASH-013** — Recent transactions.
- **REQ-DASH-014** — Working quick actions.

The dashboard must support the following period filters and state the active period using Asia/Kolkata boundaries:

- **REQ-DASH-015** — Today, This Month, Last Month, Last 3 Months, Last 6 Months, This Year, Last Year, and Custom Date Range.
- **REQ-DASH-016** — The active period is visible and Asia/Kolkata boundaries are used consistently.
- **REQ-DASH-017** — Period presets and custom ranges use the exact inclusive definitions below.
- **REQ-DASH-018** — Dashboard member count is the number of members whose creation business date is on or before the end of the selected period.

Period boundaries are defined in Asia/Kolkata and are inclusive of both the start and end date:

- **Today**: the current business date only.
- **This Month**: the first through the last day of the current calendar month.
- **Last Month**: the previous calendar month in full.
- **Last 3 Months**: the current calendar month plus the two preceding calendar months.
- **Last 6 Months**: the current calendar month plus the five preceding calendar months.
- **This Year**: 1 January through 31 December of the current calendar year.
- **Last Year**: the previous calendar year in full.
- **Custom Date Range**: an explicit `from` and `to` where both are required and `from` must not be after `to`.

Canonical labels are **Period movement** for the selected-period income and expense movement, and **Available balance as of period end** for the ledger-derived total. This prevents duplicate-looking totals from being displayed as the same value.

## Search, reports, and export

- **REQ-SEARCH-001** — Global search covers member name, member ID, transaction reference, category, transaction type, dates, and amounts where appropriate.
- **REQ-SEARCH-002** — Search is implemented against authorized server data with intentional validation, bounded results, and safe query behavior. Free text is limited to names, IDs, references, categories, and types; dates and exact amounts use validated filters.
- **REQ-REPORT-001** — The application provides Financial Summary, Income, Expense, Member Contribution, Offering, Donation, Payment Method, Expense Category, Receipt / Document, Audit, and Complete Transaction reports.
- **REQ-REPORT-002** — Member contribution reports show expected, received, remaining, and contribution status.
- **REQ-REPORT-003** — Print output is intentional, readable, and accessible.
- **REQ-REPORT-004** — User-facing dates use familiar Indian formats such as `25 Sep 2026` or `25/09/2026`, and times use 12-hour format such as `02:45 PM`, always in `Asia/Kolkata`.
- **REQ-EXPORT-001** — CSV exports contain useful financial fields and a useful document reference or link where applicable.
- **REQ-EXPORT-002** — Local document links are identified as valid only while the local application is accessible.

Active financial reports exclude voided records. The Complete Transaction and Audit reports retain history, and the Receipt / Document report distinguishes available, removed, and voided history according to the database and API contracts. All tabular reports support CSV; receipts support view and print.

## Audit history

- **REQ-AUDIT-001** — A dedicated Audit History interface covers transaction creation, transaction edit, transaction void, document upload, permitted document removal, important settings changes, and relevant authentication/security events.
- **REQ-AUDIT-002** — Each event exposes enough detail to understand what changed, who acted, when it happened, and any required reason, without secrets or unnecessary personal data.

The minimum event set includes login success, login failure, logout, session rejection, transaction create/edit/void, document upload/removal, member/category changes, and settings changes. The exact action-code list and before/after redaction rules are technical contracts owned by `05-DATABASE-SPEC.md` and `07-SECURITY-RULES.md`.

## Settings

Demo settings are limited to useful configuration:

- **REQ-SETTINGS-001** — Default monthly contribution.
- **REQ-SETTINGS-002** — Expense category management entry point.
- **REQ-SETTINGS-003** — Enabled payment-method management.
- **REQ-SETTINGS-004** — INR currency is fixed and shown read-only.
- **REQ-SETTINGS-005** — `Asia/Kolkata` timezone is fixed and shown read-only.
- **REQ-SETTINGS-006** — At least one payment method must remain enabled.
- **REQ-SETTINGS-007** — Disabling a method affects new transaction entry only and never changes historical method values, balances, edits, or void workflows.
- **REQ-SETTINGS-008** — Church identity/profile customization is deferred.
- **REQ-SETTINGS-009** — No reset-demo-database feature is allowed.

## Interaction and responsiveness

The eventual UI must include the following behavior:

- **REQ-RESP-002** — Desktop sidebar navigation.
- **REQ-RESP-003** — An appropriate collapsible sidebar and mobile drawer.
- **REQ-RESP-004** — Clear tables and working search, filters, sorting, and pagination where appropriate.
- **REQ-RESP-005** — Status badges and properly formatted INR amounts.
- **REQ-RESP-006** — Intentional loading, empty, success, error, disabled, hover, and focus states.
- **REQ-RESP-007** — Form-validation feedback.
- **REQ-RESP-008** — Confirmation for transaction void, important financial edits, document removal, and navigation/logout when unsaved work could be lost.
- **REQ-RESP-009** — Navigation or logout warns the user when unsaved work could be lost.
- **REQ-RESP-010** — Every required visible control must work.
- **REQ-RESP-011** — Required functionality is not presented as a dead control, fake filter, fake chart, misleading placeholder, or `Coming Soon` item.
- **REQ-RESP-012** — The interface works on desktop, laptop, tablet, Android-sized screens, and iPhone-sized screens.
- **REQ-RESP-013** — Supported viewports have no unintended page-level horizontal overflow, overlapping controls, inaccessible controls, broken dialogs, or unreadable financial tables.

## Technology and deployment direction

- **REQ-FIN-026** — Unless a genuine incompatibility is found and approved, use React, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query where appropriate, Recharts, Node.js, NestJS, REST, PostgreSQL, Prisma, Vitest, React Testing Library, Jest where appropriate for NestJS, Supertest, and Playwright. Use a modular monolith, Git, GitHub, and Docker/Compose where useful.
- **REQ-FIN-027** — Demo deployment follows free-tier infrastructure where practical, prefers Netlify for the frontend, does not purchase services or silently enable paid plans, does not distort backend/database architecture to fit one hosting platform, and verifies platform capabilities at deployment time.

## Invalid and adversarial behavior

- **REQ-FIN-021** — Negative, zero, non-numeric, exponent-based, ambiguous, and otherwise prohibited money input is rejected safely.
- **REQ-FIN-022** — Missing names, invalid phone input, missing expense categories, malformed requests, unsupported or oversized uploads, unauthenticated requests, duplicate submissions, invalid IDs, invalid date ranges, and other relevant boundary cases are rejected safely.
- **REQ-FIN-023** — Duplicate submissions are rejected or safely deduplicated.
- **REQ-FIN-024** — Validation errors are clear and do not leak secrets or internal details.
- **REQ-FIN-025** — Important workflows must prove downstream effects across API result, database state, transaction visibility, member history, dashboard totals, payment-method balances, reports, and audit behavior rather than relying on render or click assertions alone.

## Evidence requirement

Passing means verified behavior, not a rendered page or a clicked button. Every required workflow must reconcile across the database, API, UI, reports, balances, documents, and audit history. Passing a render assertion or click assertion alone is not sufficient.
