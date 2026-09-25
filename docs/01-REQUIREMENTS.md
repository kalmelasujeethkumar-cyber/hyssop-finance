# HYSSOP FINANCE — Requirements

## Requirement status and interpretation

The requirements in this document are locked for the demo unless the user explicitly changes them. Proposed technical details in other specifications must be checked against this document. A conflict is a stop-and-ask condition.

## Product and access

- The product name is **HYSSOP FINANCE**.
- The demo serves one church and has one authenticated application role, **Admin**.
- Authentication is real backend authentication with secure password hashing. No frontend-only or hard-coded login is acceptable.
- Protected operations require an authenticated session. Logout invalidates the session.
- The architecture should permit later production expansion without implementing unused demo complexity.
- Business timezone is `Asia/Kolkata`; currency is INR.
- The application is light-only and uses the white/blue/orange direction in `04-DESIGN-TOKENS.md`.

## Financial records

The system must support:

- Income types: Member Contribution, Offering, Donation, and Anonymous Donation.
- Expenses with initial categories: Electricity, Water, Church Maintenance, Repairs, Church Programs, Food, Decoration, Equipment, Cleaning, Transport, Charity / Help, and Other.
- Admin-created custom expense categories.
- Payment methods: Cash, UPI, and Bank Transfer.
- Transaction date, business date, description, amount, and relevant associations.
- Exact money calculation and Indian Rupee display.

Member Contribution requires a member. Offering and Donation may optionally identify a member when appropriate. Anonymous Donation must not require or expose a contributor identity. Financial records must not be represented by a hard-coded dashboard value or a single permanent member amount field.

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

Only active, non-voided records participate. Payment-method balances use the same active ledger:

```text
METHOD BALANCE = active income received by method - active expenses paid by method
```

The demo has no hidden opening-balance feature. Cash, UPI, and bank balances are derived from the recorded transaction ledger and may be negative when recorded expenses exceed recorded income for a method; the UI must not conceal that condition. The total available balance is the sum of the three method balances and must reconcile to total available balance.

Month-wise contribution tracking is based on the member's expected amount for a month/year and active member-contribution transactions assigned to that member and period:

```text
PAID = received >= expected
PARTIALLY PAID = received > 0 and received < expected
NOT PAID = received = 0
```

The period record stores the expected amount; received and remaining amounts are derived from the ledger so totals cannot drift. A period must not be marked paid merely because a dashboard value appears correct.

## Members and history

Each member must have a human-readable member ID and name. Phone number and notes are optional, and each member has contribution history. A member may have many transactions. The member page must eventually show month/year, expected, received, remaining, status, payment method where applicable, and relevant receipts/documents.

Phone number is optional. When present, it must contain 7 to 15 digits after removing spaces, hyphens, parentheses, and an optional `+91` prefix. The same rule applies in the UI, API, and database validation. For the demo, all persisted members are counted as active because member deletion and deactivation are not provided; a future member-status feature requires separate approval.

## Transaction correction and void rules

- Editing a financial transaction must save the corrected value and create an audit event containing the relevant previous and new values, timestamp, actor, and action.
- Application users must not normally permanently delete a financial transaction.
- A transaction may be voided only through a workflow that requires a reason.
- A voided transaction remains available to audit/history views but is excluded from active income, expenses, balances, contribution received totals, and applicable reports.
- A void operation records its reason, actor, timestamp, and action.
- Database/API implementation must prevent silent deletion and preserve history.

## Documents

A transaction may have multiple documents. Supported demo formats are JPG, JPEG, PNG, WEBP, and PDF. Expenses may omit a receipt, but the interface must clearly show **Receipt Missing**.

The demo must support upload, validation, transaction association, authenticated view/preview where supported, open, download, and controlled removal where permitted. Raw files must not be stored directly in PostgreSQL. Local project-controlled storage is used behind an abstraction so production storage can be substituted later. Access to storage paths must not bypass authentication or authorization.

## Receipts

An eligible income transaction must be able to display and print a receipt containing:

- HYSSOP FINANCE
- transaction reference
- received from, when a member or named contributor legitimately applies
- amount
- income type
- payment method
- business date

A receipt for an Anonymous Donation must not reveal a contributor identity. Receipt generation must use persisted transaction data and must not be a static image or manually maintained duplicate record.

## Dashboard and date filters

The dashboard must support the required metrics and visualizations:

- Total Income
- Total Expenses / Total Used
- Available Balance
- Member count
- Cash balance
- UPI balance
- Bank balance
- Total available balance
- Income versus expense visualization
- Income breakdown
- Expense breakdown
- Contribution status visualization
- Monthly financial trend
- Recent transactions
- Quick actions

Dashboard calculations must respond to Today, This Month, Last Month, Last 3 Months, Last 6 Months, This Year, Last Year, and Custom Date Range. The UI must state the active period and use Asia/Kolkata boundaries consistently.

Period boundaries are defined in Asia/Kolkata and are inclusive of both the start and end date:

- **Today**: the current business date only.
- **This Month**: the first through the last day of the current calendar month.
- **Last Month**: the previous calendar month in full.
- **Last 3 Months**: the current calendar month plus the two preceding calendar months.
- **Last 6 Months**: the current calendar month plus the five preceding calendar months.
- **This Year**: 1 January through 31 December of the current calendar year.
- **Last Year**: the previous calendar year in full.
- **Custom Date Range**: an explicit `from` and `to` where both are required and `from` must not be after `to`.

Dashboard Member count means the number of active members as of the end of the selected period. Contribution status visualization counts members whose period status is PAID, PARTIALLY PAID, or NOT PAID for the selected period.

## Search, reports, and export

The application must provide useful global/search functionality across member name, member ID, transaction reference, category, transaction type, dates, and amounts where appropriate. Search must be implemented against authorized server data with intentional validation and safe query behavior.

Required reports are:

- Financial Summary
- Income Report
- Expense Report
- Member Contribution Report
- Offering Report
- Donation Report
- Payment Method Report
- Expense Category Report
- Receipt / Document Report
- Audit Report
- Complete Transaction Report

Member contribution reports must show expected, received, remaining, and contribution status. CSV exports must contain useful financial fields and a useful document reference or link where applicable. Local links may work only while the local app is accessible. Print must use intentional, accessible browser print output. User-facing dates must use familiar Indian formats such as `25 Sep 2026` or `25/09/2026`, and times must use 12-hour format such as `02:45 PM`, always in `Asia/Kolkata`.

## Audit history

A dedicated Audit History interface must cover transaction creation, transaction edit, transaction void, document upload, permitted document removal, important settings changes, and relevant authentication/security events. Each event must expose enough detail to understand what changed, who acted, when it happened, and any required reason.

## Settings

Demo settings are limited to useful configuration: default monthly contribution, expense category management, enabled payment methods, INR currency, and Asia/Kolkata timezone. Currency and timezone are fixed product values shown in Settings rather than editable controls in this demo. Church identity/profile customization is deferred. No reset-demo-database feature is allowed.

## Interaction and responsiveness

The eventual UI must include desktop sidebar navigation, an appropriate collapsible/mobile drawer, quick actions, clear tables, search, filters, sorting, pagination where appropriate, status badges, formatted amounts, loading, empty, success, error, disabled, hover, and focus states, and form validation feedback.

Sensitive operations require confirmation: void transaction, important financial edits, document removal, and navigation/logout when unsaved work could be lost. Required controls must work. No dead buttons, fake filters, fake charts, placeholder pages presented as complete, or `Coming Soon` labels for required demo functionality are allowed.

The interface must work on desktop, laptop, tablet, Android-sized screens, and iPhone-sized screens without unintended page-level horizontal overflow, overlapping controls, inaccessible controls, broken dialogs, or unreadable financial tables.

## Technology and deployment direction

Unless a genuine incompatibility is found and approved, use React, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query where appropriate, Recharts, Node.js, NestJS, REST, PostgreSQL, Prisma, Vitest, React Testing Library, Jest where appropriate for NestJS, Supertest, and Playwright. Use a modular monolith, Git, GitHub, and Docker/Compose where useful.

The demo deployment direction is free-tier infrastructure where practical, with Netlify preferred for the frontend. Do not purchase services, provide payment information, silently enable paid plans, or distort the backend/database architecture to fit one hosting platform. Verify platform capabilities at deployment time.

## Invalid and adversarial behavior

The future system must safely reject negative or zero amounts where prohibited, non-numeric amounts, missing names, invalid phone input, missing expense categories, malformed requests, unsupported or oversized uploads, unauthenticated requests, duplicate submissions, invalid IDs, invalid date ranges, and other relevant boundary cases. Errors must be clear without leaking secrets or internal details.

## Evidence requirement

Important workflows must prove downstream effects: API result, database state, transaction visibility, member history, dashboard totals, payment-method balances, reports, and audit behavior must agree. Passing a render assertion or click assertion alone is not sufficient.
