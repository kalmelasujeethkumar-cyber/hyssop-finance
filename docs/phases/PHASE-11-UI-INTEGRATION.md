# PHASE 11 — UI INTEGRATION

## Document Responsibility

- Owns: final route and page composition, navigation, interaction states, accessibility, responsive behavior, and integration of already-owned feature contracts.
- Does not own: new business behavior, authoritative calculations, API contracts, database rules, or requirement definitions.
- Primary owned requirements: `REQ-RESP-001`–`REQ-RESP-013`.
- Consumed requirements: all implemented `REQ-AUTH-*`, `REQ-MEM-*`, `REQ-CONTRIB-*`, `REQ-INCOME-*`, `REQ-EXP-*`, `REQ-DOC-*`, `REQ-DASH-*`, `REQ-REPORT-*`, `REQ-SEARCH-*`, `REQ-AUDIT-*`, `REQ-SETTINGS-*`, `REQ-EXPORT-*`, and `REQ-FIN-*` feature contracts.
- Authority references: `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `03-UI-UX-RULES.md`, `04-DESIGN-TOKENS.md`, `07-SECURITY-RULES.md`, `10-TEST-PLAN.md`, and `14-TRACEABILITY-MATRIX.md`.
- Deliverables: complete Admin workflow, accessible responsive UI, working print/export integration, and no dead controls.
- Out of scope: client-side financial authority, removing failing required functionality, or adding unapproved features.
- Handoff: Phase 12 receives a complete, buildable application for adversarial QA and deployment verification.
- Acceptance evidence: `TEST-E2E-001`, `TEST-E2E-002`, `TEST-RESP-001`, `TEST-RESP-002`, and `TEST-SEC-001`.

## Phase Metadata

- Status: `NOT STARTED`; requires all feature phases to be complete or their contracts explicitly accepted.
- Preconditions: Phases 01–10 complete; API contracts stable or deviations recorded.
- Handoff rule: every visible required control must call a real authorized path or be removed from the completed experience.

## Objective

Integrate all implemented modules into a coherent, responsive, accessible application and remove every dead or misleading control before final QA.

## Scope

- Connect pages, routes, forms, tables, filters, charts, dialogs, and query invalidation.
- Connect global search across members and transactions through the authorized search API.
- Desktop sidebar, collapsible navigation, and mobile drawer.
- Loading, empty, success, error, disabled, hover, and focus states.
- Confirmation dialogs and unsaved-work protection.
- Responsive financial tables, forms, dialogs, and charts.
- Print and export integration.

## Prerequisites

- Phases 01 through 10 complete.
- `01-REQUIREMENTS.md`, `03-UI-UX-RULES.md`, `04-DESIGN-TOKENS.md`, and `07-SECURITY-RULES.md` reread.
- All required API contracts are stable or deviations are documented.

## Expected files and modules

- Frontend route tree, layouts, shared components, and API query layer.
- Page-level composition for all required features.
- Accessibility, responsive, and interaction tests.

## Implementation requirements

- Every visible required control calls a real, authorized path.
- Use design tokens rather than ad hoc colors.
- Refresh affected queries after a successful financial mutation.
- Prevent duplicate submissions and stale totals.
- Support keyboard and touch use, dialog focus management, and reduced motion.
- Maintain consistent INR and Asia/Kolkata date formatting.

## Prohibited shortcuts

- No dead buttons, fake filters, placeholder pages, or `Coming Soon` for required functionality.
- No client-side-only financial or authorization logic.
- No fixed desktop-only layout that breaks mobile.
- No removal of failing required functionality to obtain green tests.

## Acceptance criteria

- The complete Admin workflow works from login through logout.
- No required control is non-functional or misleading.
- Desktop, tablet, and mobile layouts have no unintended page-level horizontal overflow.
- Forms, tables, dialogs, and charts are readable and usable.
- Focus, hover, disabled, loading, error, and success states are visible and consistent.

## Tests required

- Component and accessibility tests for shared controls and states.
- Global search, filter, sorting, and pagination tests.
- Full browser workflow tests.
- Responsive checks at representative viewports.
- Keyboard, focus, dialog, and touch-target checks.
- Production build verification.

## Documentation updates required

Record final navigation, component usage, accessibility decisions, and any approved deviations.

## Git completion gate

Pass the complete applicable quality gate including E2E, responsive, accessibility, and build checks; inspect secrets; commit; push; verify; record the hash.

## Rollback and recovery

Revert the smallest failing UI or integration change, add or restore a regression test, and rerun the affected area. Do not redesign unrelated modules.

## Completion checklist

- [ ] All required pages and controls are integrated.
- [ ] Every visible control works.
- [ ] Responsive and accessibility checks pass.
- [ ] Browser workflow passes end to end.
- [ ] Documentation, tests, and Git gate complete.
