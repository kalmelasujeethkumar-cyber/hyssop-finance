# PHASE 10 — AUDIT AND SETTINGS

## Objective

Complete the dedicated Audit History interface and the limited, useful demo Settings surface while preserving audit immutability and financial integrity.

## Scope

- Audit History for transaction create, edit, and void.
- Document upload and permitted removal events.
- Member, category, and settings change events.
- Relevant authentication and security events.
- Default monthly contribution, expense category management, enabled payment methods, INR currency, and Asia/Kolkata timezone settings.
- Filterable, paginated audit views with useful before/after detail.

## Prerequisites

- Phases 01 through 09 complete.
- `01-REQUIREMENTS.md`, `05-DATABASE-SPEC.md`, `06-API-SPEC.md`, and `07-SECURITY-RULES.md` reread.
- Audit writes already exist on all financial mutations from earlier phases.
- The `app_setting` persistence created in Phase 02 and consumed by Phase 04 is available for the Settings interface.

## Expected files and modules

- Audit read API and immutable audit service.
- Audit History page with filters, pagination, and safe detail rendering.
- Settings API, validation, persistence, and page.
- Audit and settings integration, security, and browser tests.

## Implementation requirements

- Show actor, action, entity reference, timestamp, reason, and safe before/after values.
- Exclude secrets, tokens, raw documents, and unnecessary personal data from audit detail.
- Append audit events atomically with the corresponding change.
- Prevent application updates or deletes of audit rows.
- Keep settings limited to the approved demo configuration.
- Audit important settings changes.

## Prohibited shortcuts

- No fake audit rows, editable audit history, or audit entries created only for display.
- No church identity or branding configuration in the demo.
- No reset-demo-database feature.
- No dead settings controls or unaudited mutation paths.

## Acceptance criteria

- Every important operation listed in the requirements produces a useful audit event.
- Void events include the required reason and appear in history.
- Settings changes are validated, persisted, and audited.
- Audit detail is safe to display and export.
- The interface remains clear for a non-technical user.

## Tests required

- Audit creation, filtering, pagination, and immutability tests.
- Settings validation, persistence, defaults, and audit tests.
- Security tests for unauthorized access and secret redaction.
- Browser tests for audit filters, detail, void history, and settings changes.

## Documentation updates required

Record the final audit event list, settings scope, retention assumptions, and security decisions.

## Git completion gate

Pass the complete applicable quality gate; inspect diff and secrets; commit; push; verify; record the hash.

## Rollback and recovery

Correct audit or settings behavior with a focused change and regression tests. Never rewrite historical audit rows to make a test pass.

## Completion checklist

- [ ] Audit coverage is complete for required events.
- [ ] Audit detail is safe and useful.
- [ ] Settings are limited, validated, and audited.
- [ ] Tests and browser flows pass.
- [ ] Documentation, tests, and Git gate complete.
