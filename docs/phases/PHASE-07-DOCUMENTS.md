# PHASE 07 — DOCUMENTS

## Document Responsibility

- Owns: the reusable `DocumentStorage` abstraction, local adapter, document metadata lifecycle, upload/preview/download/removal behavior, and missing-receipt presentation.
- Does not own: business formulas, income/expense command rules, dashboard aggregation, or requirement definitions.
- Primary owned requirements: `REQ-DOC-001`, `REQ-DOC-002`, `REQ-DOC-004`–`REQ-DOC-009`.
- Consumed requirements: `REQ-AUTH-*`, `REQ-EXP-003`, `REQ-INCOME-*`, `REQ-RESP-005`, `REQ-RESP-006`, `REQ-RESP-008`, and `REQ-FIN-025`.
- Authority references: `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `05-DATABASE-SPEC.md`, `06-API-SPEC.md`, `07-SECURITY-RULES.md`, `10-TEST-PLAN.md`, `12-DEPLOYMENT-PLAN.md`, and `14-TRACEABILITY-MATRIX.md`.
- Deliverables: storage interface, safe local adapter, validated document flows, authorized access, removal audit, and deployment limitation record.
- Out of scope: raw bytes in PostgreSQL, a public upload directory, and hosted object storage before Phase 12.
- Handoff: Phases 05, 06, 08, 09, and 10 consume the same document metadata and access contract.
- Acceptance evidence: `TEST-DOC-001`, `TEST-DOC-002`, `TEST-SEC-001`, and the missing-receipt portion of `TEST-E2E-001`.

## Phase Metadata

- Status: `NOT STARTED`; requires Phases 01–06 complete.
- Preconditions: shared document metadata and audit persistence exist; storage path is project-local and ignored by Git.
- Handoff rule: no earlier phase may bypass this adapter or create a duplicate upload path.

## Objective

Implement transaction documents through a replaceable storage abstraction with safe local demo storage, multiple files per transaction, authenticated preview/open/download, controlled removal, and a visible missing-receipt state.

## Scope

- Storage interface and local filesystem adapter.
- Upload, metadata, association, list, preview, download, and removal endpoints.
- JPG, JPEG, PNG, WEBP, and PDF validation with size limits.
- Document UI, progress, errors, and **Receipt Missing** indication.
- Document audit events and `HY-DOC-000001` references.
- Controlled removal requiring a non-empty reason that is stored and audited.

## Prerequisites

- Phases 01 through 06 complete.
- `01-REQUIREMENTS.md`, `02-ARCHITECTURE.md`, `05-DATABASE-SPEC.md`, `06-API-SPEC.md`, and `07-SECURITY-RULES.md` reread.
- Local storage path is inside the project and is ignored by Git.

## Expected files and modules

- Storage abstraction and local adapter.
- Document persistence, validation, streaming, and audit services.
- Document upload and viewer components.
- Document integration, security, and browser tests.

## Implementation requirements

- Store metadata in PostgreSQL and bytes only in the storage adapter.
- Validate declared and detected content type, byte size, and safe filenames.
- Generate opaque storage keys; never use user filenames for paths.
- Require authentication and transaction authorization for every read.
- Support multiple documents and safe inline or attachment responses per format.
- Preserve metadata and audit history on controlled removal, including the removal reason, `REMOVED` state, `410 Gone` content behavior, and controlled cleanup retry after storage failure.
- Make the storage path configuration explicit and replaceable for production.

## Prohibited shortcuts

- No raw file bytes in PostgreSQL.
- No publicly served uploads directory.
- No client-side-only type validation or filename trust.
- No dead upload, preview, download, or remove control.
- No silent removal without confirmation and audit.

## Acceptance criteria

- Each allowed format uploads and is associated with the correct transaction.
- Multiple documents work for one transaction.
- Preview is offered only where supported; other valid files open or download safely.
- Missing expense evidence is clearly labeled **Receipt Missing**.
- Invalid, oversized, and unauthorized uploads are rejected.
- Files persist after application restart and remain outside Git; after controlled removal, metadata remains while content is inaccessible and physical deletion is tracked.

## Tests required

- Storage-path, content-signature, and validation unit tests.
- Upload, list, stream, preview, download, removal, post-removal access, storage-failure compensation, and authorization integration tests.
- Restart-persistence test.
- Path traversal, MIME spoofing, oversized upload, and unauthorized access tests.
- Browser tests for upload, multiple files, preview, download, removal confirmation, and missing receipt.

## Documentation updates required

Record storage adapter behavior, limits, supported formats, and deployment limitations.

## Git completion gate

Pass lint, typecheck, unit, integration, database, E2E, security, and build gates; inspect ignored local files and secrets; commit; push; verify; record the hash.

## Rollback and recovery

Remove only project-local test documents when needed. Never delete arbitrary user files. If a storage change would affect external data, stop and ask the user.

## Completion checklist

- [ ] Storage abstraction and local adapter implemented.
- [ ] Upload, preview, download, and removal work.
- [ ] Validation and authorization pass.
- [ ] Missing-receipt state is visible.
- [ ] Documentation, tests, and Git gate complete.
