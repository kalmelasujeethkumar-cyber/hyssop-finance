# PHASE 07 — DOCUMENTS

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
- Preserve metadata and audit history on controlled removal, including the removal reason.
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
- Files persist after application restart and remain outside Git.

## Tests required

- Storage-path, content-signature, and validation unit tests.
- Upload, list, stream, preview, download, removal, and authorization integration tests.
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
