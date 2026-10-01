import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TransactionDocument } from '@prisma/client';
import {
  DOCUMENT_REMOVAL_REASON_MAX_LENGTH,
  DOCUMENT_UPLOAD_FIELD,
  type DocumentMimeType,
  type DocumentStatus,
  type DocumentSummary,
} from '@hyssop/contracts';
import { ApiError } from '../common/errors/api-error';
import { IdempotentCommandRunner } from '../common/http/idempotency';
import { getAppEnvironment } from '../config/environment';
import { TransactionDocumentRepository } from '../database/documents/transaction-document.repository';
import { TransactionRepository } from '../database/transactions/transaction.repository';
import {
  contentDispositionFor,
  DOCUMENT_STORAGE,
  type DocumentStorage,
} from '../storage/document-storage';
import { INLINE_PREVIEW_TYPES, inspectUpload, UploadRejected } from './document-content';
import { assertUploadFilename, sanitiseOriginalFilename } from './document-filename';

/** Everything a document mutation needs in order to be attributable. */
export interface DocumentActor {
  readonly adminUserId: string;
  readonly requestId: string | null;
}

/**
 * The endpoint identities idempotency keys are scoped to.
 *
 * The versioned path and the concrete transaction id are both part of the identity, so a key used
 * against a different transaction is a different command rather than a replay of this one. Without
 * the id, uploading to transaction A and then to transaction B with the same key would return A's
 * stored response for B — and a document attached to the wrong expense is precisely the kind of
 * silent data error this application is not allowed to make.
 */
const UPLOAD_ENDPOINT = '/api/v1/transactions';
const REMOVE_ENDPOINT = '/api/v1/documents';

/**
 * The shape the multipart parser hands to this service.
 *
 * Declared structurally rather than as `Express.Multer.File` so this module does not depend on an
 * ambient global type that only exists when a particular multipart library's typings happen to be
 * installed. These are the fields actually used, and each is checked before it is trusted.
 */
export interface UploadedDocumentPart {
  readonly originalname?: string | undefined;
  readonly mimetype?: string | undefined;
  readonly buffer?: Buffer | undefined;
}

/**
 * The content of a document, ready to stream.
 *
 * Carries everything the HTTP layer needs to answer correctly *and* safely: the verified type for
 * `Content-Type`, the original name for `Content-Disposition`, and the exact byte size for
 * `Content-Length`. None of the three can be taken from the upload, because all three are
 * attacker-influenced.
 */
export interface DocumentContent {
  readonly stream: NodeJS.ReadableStream;
  readonly detectedMimeType: string;
  readonly originalFilename: string;
  readonly byteSize: number;
  /** Whether the API will render this inline. Decided here, never by the browser. */
  readonly previewAvailable: boolean;
}

/**
 * Document lifecycle rules.
 *
 * Authority: `docs/02-ARCHITECTURE.md` "Storage boundary" and `docs/01-REQUIREMENTS.md`
 * `REQ-DOC-001` to `REQ-DOC-009`. This service is where the two-part state transition lives, and
 * the ordering it enforces is the substance of the design:
 *
 * - **Upload writes bytes first, metadata second.** The content must be durable before a row can
 *   point at it. If the metadata write then fails, the orphaned object is deleted rather than left
 *   behind, because a file nothing references is invisible garbage no later cleanup would find.
 * - **Removal revokes access before it deletes bytes.** `docs/02-ARCHITECTURE.md` is explicit: the
 *   API commits `AVAILABLE` to `REMOVED` *first* and only then attempts storage deletion. The
 *   reverse order would leave a window in which a document reads as removed while its file is
 *   still readable through the content endpoint.
 * - **A failed deletion never restores access.** `storage_deleted_at` stays null and the document
 *   stays `REMOVED`, which the content route answers with `410 Gone`. The leftover object is a
 *   cleanup condition for a maintenance path, not an availability one.
 * - **Nothing here touches the ledger.** Attaching or removing a receipt must not move a single
 *   financial total, so this service never writes `financial_transaction`. It records only
 *   `DOCUMENT_UPLOADED` and `DOCUMENT_REMOVED`.
 */
@Injectable()
export class DocumentsService {
  public constructor(
    private readonly documents: TransactionDocumentRepository,
    private readonly transactions: TransactionRepository,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly idempotency: IdempotentCommandRunner,
    private readonly config: ConfigService,
  ) {}

  /**
   * Validates an upload and attaches it to a transaction.
   *
   * The transaction is resolved first, so an unknown id is a documented `404` rather than a file
   * written to storage for a transaction that does not exist. Content validation happens before any
   * write, so a rejected upload leaves nothing behind on disk at all.
   *
   * The whole commit is wrapped in the idempotency runner, which is what stops a retried upload
   * from attaching the same receipt twice. That risk is specific to this route: a browser cannot
   * replay a JSON body automatically, but it can absolutely re-send a multipart request after a
   * dropped connection, and two copies of one receipt would make the Admin's document list a lie
   * about what was received. The replay signature is the content checksum and declared name, so an
   * identical resend replays and a genuinely different file under the same key is a conflict.
   */
  public async upload(
    transactionId: string,
    part: UploadedDocumentPart,
    actor: DocumentActor,
    options: { key: string },
  ): Promise<DocumentSummary> {
    const transaction = await this.transactions.findById(transactionId);
    const content = part.buffer;

    if (content === undefined) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'No file was received. Choose a JPG, PNG, WEBP, or PDF document to attach.',
        HttpStatus.BAD_REQUEST,
        { fields: [{ field: DOCUMENT_UPLOAD_FIELD, message: 'A file is required.' }] },
      );
    }

    const inspection = this.inspect(content, part.mimetype ?? '');
    // Asserted, then sanitised. A name containing a separator is refused outright because a file
    // picker never sends one, so its presence means the request was assembled by hand; everything
    // else is reduced to a safe label. Neither step can influence a storage path.
    assertUploadFilename(part.originalname ?? '');
    const originalFilename = sanitiseOriginalFilename(part.originalname ?? '');
    const bytes = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);

    const result = await this.idempotency.run<DocumentSummary>({
      adminUserId: actor.adminUserId,
      endpoint: `${UPLOAD_ENDPOINT}/${transactionId}/documents`,
      idempotencyKey: options.key,
      request: {
        checksumSha256: inspection.checksumSha256,
        originalFilename,
        declaredMimeType: inspection.declaredMimeType,
        byteSize: inspection.byteSize,
      },
      run: async () => {
        const stored = await this.storage.put(bytes);

        try {
          const record = await this.documents.record({
            transactionId,
            storageKey: stored.storageKey,
            originalFilename,
            declaredMimeType: inspection.declaredMimeType,
            detectedMimeType: inspection.detectedMimeType,
            // The stored size is the size of the object that was actually written, not the upload's
            // own claim, so the metadata and the bytes cannot disagree.
            byteSize: stored.byteSize,
            checksumSha256: inspection.checksumSha256,
            uploadedByAdminId: actor.adminUserId,
          });

          return {
            status: 201,
            body: toDocumentSummary(record, transaction.referenceId),
          };
        } catch (error) {
          // The row never committed, so nothing points at this object. Deleting it keeps storage
          // honest: an orphan is invisible to every API surface and would never be cleaned up.
          await this.storage.delete(stored.storageKey).catch(() => false);

          throw error;
        }
      },
    });

    return result.body;
  }

  /**
   * Every document for a transaction, including removed ones.
   *
   * Removed records are returned rather than filtered out, because `docs/05-DATABASE-SPEC.md`
   * requires the metadata to be retained for history. Each is marked `contentAvailable: false` and
   * carries its retained reason, so the Admin sees that a receipt was attached and later removed
   * instead of watching it disappear with no explanation.
   *
   * The transaction reference is resolved once and passed to every projection, so a list of ten
   * documents costs one transaction read rather than ten.
   */
  public async listForTransaction(transactionId: string): Promise<readonly DocumentSummary[]> {
    const transaction = await this.transactions.findById(transactionId);
    const records = await this.documents.listForTransaction(transactionId);

    return records.map((record) => toDocumentSummary(record, transaction.referenceId));
  }

  /** One document's metadata with its authorised links. Never its bytes. */
  public async detail(documentId: string): Promise<DocumentSummary> {
    const record = await this.documents.findById(documentId);
    const transaction = await this.transactions.findById(record.transactionId);

    return toDocumentSummary(record, transaction.referenceId);
  }

  /**
   * Opens a document's bytes for an authenticated read.
   *
   * `disposition` is chosen by the route, not the client: `/documents/:id/download` always
   * downloads and `/documents/:id/preview` serves inline, and only for a format the server will
   * render. Asking for a preview of a PDF is refused with `400` rather than silently downgraded,
   * because a control that appears to work while quietly changing behaviour is exactly the dead
   * control the phase contract forbids.
   *
   * A removed document is `410 Gone`, not `404`. `docs/02-ARCHITECTURE.md` requires that
   * distinction, and it is what lets the browser tell "this never existed" apart from "this existed,
   * was removed, and here is why".
   */
  public async open(
    documentId: string,
    disposition: 'inline' | 'attachment',
  ): Promise<DocumentContent> {
    const record = await this.documents.findById(documentId);

    if (record.status === 'REMOVED') {
      throw removedContentGone();
    }

    const previewAvailable = isInlinePreviewable(record.detectedMimeType);

    if (disposition === 'inline' && !previewAvailable) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'This document format cannot be previewed in the browser. Download it to view the file.',
        HttpStatus.BAD_REQUEST,
        { fields: [{ field: 'preview', message: 'Preview is unavailable for this format.' }] },
      );
    }

    const stream = await this.storage.open(record.storageKey);

    if (stream === null) {
      // The row says the file should exist and it does not. That is not the caller's fault, and
      // reporting `404` would send the Admin hunting for a record they never lost, so it is a
      // server-side condition reported as one.
      throw new ApiError(
        'INTERNAL_ERROR',
        'This document could not be read from storage. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      stream,
      detectedMimeType: record.detectedMimeType,
      originalFilename: record.originalFilename,
      byteSize: record.byteSize,
      previewAvailable,
    };
  }

  /**
   * Controlled removal: reason required, metadata retained, content revoked, then deleted.
   *
   * `REQ-DOC-006` and `docs/07-SECURITY-RULES.md` both require a non-empty reason and an audit
   * event, and `docs/05-DATABASE-SPEC.md` requires the row to survive. So the sequence is: commit
   * `REMOVED` with the reason and the actor, and only then ask storage to delete the bytes.
   *
   * A deletion that fails is *not* an error for the caller. What the Admin asked for is done from
   * the moment the row commits — the document reads as `410 Gone`. The leftover object is reported
   * as `cleanupPending: true` so the condition is visible and retryable, rather than hidden behind
   * a failure the Admin cannot act on.
   *
   * Only the row transition is idempotent, and that is deliberate. The physical deletion is
   * deliberately left outside the runner: it is an attempt whose success or failure is part of the
   * answer the Admin sees, so a replay must re-attempt it rather than replay a stored response that
   * claimed a cleanup that never happened. Replaying the row transition is safe because removing an
   * already-removed document reports the existing removal rather than auditing a second one.
   */
  public async remove(
    documentId: string,
    reason: string,
    actor: DocumentActor,
    options: { key: string },
  ): Promise<DocumentSummary> {
    const removalReason = requireRemovalReason(reason);

    const result = await this.idempotency.run<{
      storageKey: string;
      transactionId: string;
      summary: DocumentSummary;
    }>({
      adminUserId: actor.adminUserId,
      endpoint: `${REMOVE_ENDPOINT}/${documentId}`,
      idempotencyKey: options.key,
      request: { reason: removalReason },
      run: async () => {
        const removed = await this.documents.remove({
          documentId,
          removedByAdminId: actor.adminUserId,
          removalReason,
        });

        const transaction = await this.transactions.findById(removed.transactionId);

        if (!(await this.storage.delete(removed.storageKey))) {
          // Access is already revoked; only the bytes remain. Reported honestly rather than raised.
          return {
            status: 200,
            body: {
              storageKey: removed.storageKey,
              transactionId: removed.transactionId,
              summary: toDocumentSummary(removed, transaction.referenceId),
            },
          };
        }

        return {
          status: 200,
          body: {
            storageKey: removed.storageKey,
            transactionId: removed.transactionId,
            summary: toDocumentSummary(
              await this.documents.markStorageDeleted(removed.id),
              transaction.referenceId,
            ),
          },
        };
      },
    });

    return result.body.summary;
  }

  /**
   * Retries the physical deletion of documents already marked `REMOVED`.
   *
   * This is the controlled maintenance path `docs/02-ARCHITECTURE.md` requires after a storage
   * failure. It can only finish work access control has already revoked: the query it reads
   * returns `REMOVED` rows with no `storage_deleted_at`, so it can never delete a live receipt,
   * and it never restores content access.
   */
  public async retryPendingCleanup(): Promise<readonly string[]> {
    const pending = await this.documents.listPendingStorageDeletion();
    const deleted: string[] = [];

    for (const record of pending) {
      if (await this.storage.delete(record.storageKey)) {
        await this.documents.markStorageDeleted(record.id);
        deleted.push(record.referenceId);
      }
    }

    return deleted;
  }

  /** Runs content validation, translating a rejection into the documented API error. */
  private inspect(content: Buffer, declaredMimeType: string): ReturnType<typeof inspectUpload> {
    const { uploadMaxBytes } = getAppEnvironment(this.config).storage;

    try {
      return inspectUpload(
        new Uint8Array(content.buffer, content.byteOffset, content.byteLength),
        declaredMimeType,
        uploadMaxBytes,
      );
    } catch (error) {
      if (error instanceof UploadRejected) {
        // A field-level message, because the Admin has to be told what to change. A generic
        // "upload failed" would leave them guessing between a wrong format, a file that is too
        // large, and a broken control.
        throw new ApiError('VALIDATION_FAILED', error.rejection.message, HttpStatus.BAD_REQUEST, {
          fields: [{ field: DOCUMENT_UPLOAD_FIELD, message: error.rejection.message }],
        });
      }

      throw error;
    }
  }
}

/**
 * Projects a stored row into the shared contract.
 *
 * `contentAvailable` is true only for an `AVAILABLE` row whose physical deletion has not happened,
 * so the browser never offers a download control the API will answer with `410 Gone`. `previewPath`
 * is null rather than a URL that would fail, so "preview offered only where supported"
 * (`REQ-DOC-005`) is expressed by the payload instead of by a disabled button.
 */
export function toDocumentSummary(
  record: TransactionDocument,
  transactionReferenceId: string,
): DocumentSummary {
  const status: DocumentStatus = record.status === 'REMOVED' ? 'REMOVED' : 'AVAILABLE';
  const contentAvailable = status === 'AVAILABLE' && record.storageDeletedAt === null;
  const previewAvailable = contentAvailable && isInlinePreviewable(record.detectedMimeType);

  return {
    id: record.id,
    referenceId: record.referenceId,
    transactionId: record.transactionId,
    transactionReferenceId,
    originalFilename: record.originalFilename,
    declaredMimeType: record.declaredMimeType as DocumentMimeType,
    detectedMimeType: record.detectedMimeType as DocumentMimeType,
    byteSize: record.byteSize,
    checksumSha256: record.checksumSha256,
    status,
    contentAvailable,
    previewAvailable,
    downloadPath: `/api/v1/documents/${record.id}/download`,
    previewPath: previewAvailable ? `/api/v1/documents/${record.id}/preview` : null,
    uploadedAt: record.uploadedAt.toISOString(),
    removedAt: record.removedAt === null ? null : record.removedAt.toISOString(),
    removalReason: record.removalReason,
    storageDeleted: record.storageDeletedAt !== null,
    cleanupPending: status === 'REMOVED' && record.storageDeletedAt === null,
  };
}

/**
 * Whether the API will serve this type inline rather than as an attachment.
 *
 * Images are previewed; a PDF is not. `docs/02-ARCHITECTURE.md` requires inline serving "only where
 * supported", and a PDF is a container that can carry active content, so it is delivered as a
 * download and opened in the Admin's own PDF viewer instead.
 */
export function isInlinePreviewable(detectedMimeType: string): boolean {
  return INLINE_PREVIEW_TYPES.includes(detectedMimeType);
}

/**
 * The `Content-Disposition` for a served document.
 *
 * Re-exported through this module so the controller has one import for everything a content
 * response needs, and so the disposition decision and the preview decision are stated together
 * instead of drifting apart.
 */
export function contentDisposition(
  content: DocumentContent,
  disposition: 'inline' | 'attachment',
): string {
  return contentDispositionFor(content.detectedMimeType, content.originalFilename, disposition);
}

/**
 * The `410 Gone` answer for a removed document.
 *
 * The status is the requirement; the code is `NOT_FOUND` because the content is indeed absent, and
 * the status carries the extra meaning the browser needs. The message is deliberately generic and
 * does not echo the removal reason, because the reason is free text the Admin wrote and reflecting
 * it into an error body would put uncontrolled input into a response.
 */
export function removedContentGone(): ApiError {
  return new ApiError(
    'NOT_FOUND',
    'This document was removed and its content is no longer available.',
    HttpStatus.GONE,
  );
}

/**
 * Requires a usable removal reason.
 *
 * `REQ-DOC-006` requires a *non-empty* reason, so whitespace does not count: an Admin who typed
 * only spaces has not explained the removal, and storing that would leave the audit trail looking
 * complete while explaining nothing.
 */
export function requireRemovalReason(raw: string): string {
  const reason = raw.trim();

  if (reason === '') {
    throw new ApiError(
      'VALIDATION_FAILED',
      'A reason is required to remove a document, and it is kept with the record.',
      HttpStatus.BAD_REQUEST,
      { fields: [{ field: 'reason', message: 'Enter a reason for removing this document.' }] },
    );
  }

  if (reason.length > DOCUMENT_REMOVAL_REASON_MAX_LENGTH) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `A removal reason must be ${DOCUMENT_REMOVAL_REASON_MAX_LENGTH} characters or fewer.`,
      HttpStatus.BAD_REQUEST,
      { fields: [{ field: 'reason', message: 'The reason is too long.' }] },
    );
  }

  return reason;
}
