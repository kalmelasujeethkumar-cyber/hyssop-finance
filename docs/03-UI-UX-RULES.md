# HYSSOP FINANCE — UI/UX Rules

## Document Responsibility

- Owns: interaction behavior, accessibility, responsive behavior, feedback, dialogs, and state honesty.
- Does not own: business formulas, persistence rules, server authorization, or exact token values.
- Referenced by: `04-DESIGN-TOKENS.md`, phase documents, and the test plan.
- Change rule: interaction changes must remain consistent with the locked requirements and verified through the applicable tests.

## Product experience

The interface is a calm, professional financial workspace for a non-technical church administrator. It must make the current period, record type, amount, status, and next safe action obvious. It is light-only and must not look like a gaming product, an experimental dashboard, or a dense developer tool.

## Layout and navigation

- Use a desktop sidebar with the primary navigation: Dashboard, Members, Income, Expenses, Documents, Reports, Audit History, and Settings.
- Collapse the desktop sidebar where appropriate without hiding access to required sections.
- Provide a clear mobile navigation drawer or equivalent accessible navigation.
- Keep page titles, active period, primary action, and important status visible without relying on color alone.
- Use consistent page width, spacing, card hierarchy, and table containers.
- Avoid page-level horizontal overflow at supported viewport sizes.
- Keep the primary financial action obvious without cluttering the page with decorative controls.

## Visual direction

Use the exact tokens in `04-DESIGN-TOKENS.md`: white backgrounds, professional blue structure, and restrained orange accents. Orange is for emphasis, selected states, small highlights, or calls to action; it is not a dominant background. Avoid excessive gradients, glassmorphism, ornamental animation, and decorative imagery.

## Forms and feedback

Use a deliberate mix of modal, drawer, and full-page forms according to task complexity. A financial edit or void should have enough context to be reviewed safely. Every form must include:

- clear labels and required/optional indication;
- server-backed validation and accessible inline errors;
- correct input type and sensible keyboard order;
- disabled/loading state during submission;
- duplicate-submission protection;
- success and failure feedback;
- a clear cancel or back path.

Sensitive operations require a confirmation dialog. Void requires a non-empty reason. Important financial edits should show the changed values before confirmation. Navigation or logout with unsaved work must warn the user when data could be lost.

## Tables and financial data

Tables must show useful references, dates, payment methods, status, and formatted INR values. Use intentional responsive behavior:

- desktop/laptop: aligned columns and horizontal scrolling only inside a bounded table container when necessary;
- tablet: reduce secondary columns or use a deliberate detail view;
- mobile: prioritize labels and values in cards or stacked rows without squeezing controls.

Amounts use Indian grouping and the rupee symbol, for example `₹12,50,000`. Raw paise or unformatted numbers must not be shown as financial values. Status badges include text, not color alone. Loading, empty, error, and success states must be intentional.

## Dates and times

Show business dates in familiar Indian formats such as `25 Sep 2026` or `25/09/2026`, always in `Asia/Kolkata`. Show times in 12-hour format such as `02:45 PM`. Use one consistent format per surface, label ambiguous values, and never display a raw ISO timestamp or UTC offset as a user-facing business date.

## Charts and dashboard

Charts must use real API-derived data. Each chart must have a text alternative or accessible summary, an understandable label, and a clear period context. Do not display a chart when there is no meaningful data without explaining the empty state. Tooltips and legends must be usable on touch and keyboard where applicable.

## Documents

Document actions must show upload progress, validation feedback, file type and size constraints, multiple-file support, and clear association with the transaction. Preview is offered only for supported formats; other valid files open or download safely. Missing expense evidence is labeled **Receipt Missing**. Removal requires confirmation, a reason, and must be reflected in audit history.

## Receipts

An eligible income transaction must be able to show a receipt containing HYSSOP FINANCE, the transaction reference, the amount, income type, payment method, business date, and the member or contributor name when one legitimately applies. The receipt must be viewable on screen and printable, must not expose an anonymous donor identity, and must not offer controls that do nothing.

## Search and filters

Search, date filters, category filters, type filters, status filters, sorting, and pagination must operate against the real data source. The active filters and result count must be visible. Resetting filters must work. Loading and empty search results must be distinguishable.

## Accessibility

Target WCAG 2.2 AA practices where practical: semantic landmarks, keyboard navigation, visible focus, sufficient contrast, labelled controls, dialog focus management, status announcements for important changes, and touch targets suitable for mobile. Do not rely on color, hover, or pointer-only interaction.

## State honesty

Every visible required button, link, menu, dropdown, form control, filter, table action, pagination control, and important interactive component must work. If functionality is not implemented or verified, it must not be presented as a completed required feature. There are no dead controls, fake charts, or `Coming Soon` placeholders for required demo behavior.

## Feedback and errors

Errors must identify the problem and a safe next step without exposing internals. Network failures, authorization expiry, validation failures, duplicate submissions, and unexpected server errors need distinct, understandable UI treatment. A retry must not silently create a second financial record.
