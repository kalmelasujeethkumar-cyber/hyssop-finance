/**
 * Shared document contract.
 *
 * Owned by `docs/06-API-SPEC.md` "Documents" and shaped by `docs/01-REQUIREMENTS.md`
 * (`REQ-DOC-001` to `REQ-DOC-009`) and `docs/05-DATABASE-SPEC.md`. Both applications depend on
 * this module so an upload response, a document list, and a removal response cannot drift
 * between the API and the browser.
 *
 * Four rules are load-bearing here:
 *
 * - **The document reference is the human-readable one.** `referenceId` is `HY-DOC-000001`, the
 *   same two-identifier arrangement as a transaction and a member: the UUID keys the URL and the
 *   reference is what the Admin reads and the audit trail quotes.
 * - **`status` is `AVAILABLE` or `REMOVED`, and a removed document is still returned.**
 *   `docs/05-DATABASE-SPEC.md` keeps the metadata after removal, so a list that silently dropped
 *   removed documents would make the history a lie. `contentAvailable` is what tells the browser
 *   the difference between "has a file" and "was removed".
 * - **No URL is ever stored or inferred by the client.** `downloadPath` and `previewPath` are
 *   versioned *relative* paths returned by the API. The browser never builds a storage path, and
 *   no absolute filesystem location is exposed.
 * - **Preview availability is a server decision.** `previewAvailable` is true only for the
 *   formats the server is willing to render inline, so the browser cannot offer a preview control
 *   that the API would refuse.
 */

/** `REQ-DOC-002`: the supported demo formats, as the exact strings stored in PostgreSQL. */
export const DOCUMENT_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type DocumentMimeType = (typeof DOCUMENT_MIME_TYPES)[number];

/**
 * The two persisted states of a document's own lifecycle.
 *
 * Deliberately its own small enum rather than a reuse of `DocumentState` from `./transactions`.
 * `DocumentState` describes the *transaction's* lifecycle and includes `VOIDED`, which says nothing
 * about the file — a voided transaction keeps its receipt. Borrowing a three-state enum here would
 * invite a future caller to ask a question about `VOIDED` documents that has no meaning.
 */
export const DOCUMENT_STATUSES = ['AVAILABLE', 'REMOVED'] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** The reference shape, shared so the UI can validate before submitting. */
export const DOCUMENT_REFERENCE_PATTERN = /^HY-DOC-\d{6}$/;

/** `transaction_document.original_filename` is `VARCHAR(255)`. */
export const DOCUMENT_FILENAME_MAX_LENGTH = 255;

/**
 * `REQ-DOC-006` requires a non-empty removal reason, and the persistence layer bounds it, so the
 * browser can size its textarea to exactly what the API will accept.
 */
export const DOCUMENT_REMOVAL_REASON_MAX_LENGTH = 2000;

/** The upload field name, so the browser and the API cannot disagree about the multipart key. */
export const DOCUMENT_UPLOAD_FIELD = 'document';

/**
 * `docs/06-API-SPEC.md` allows "multipart upload, one file per request". One file per request is
 * the documented choice, so `maxDocumentsPerRequest` is 1 and the browser adds files by making
 * more requests rather than by sending a batch shape the API does not implement.
 */
export const DOCUMENT_MAX_FILES_PER_REQUEST = 1;

/**
 * One document as the API reports it.
 *
 * `byteSize` is a plain number because a byte count is exact and small; unlike money, it has no
 * fractional paise problem and does not need a decimal string.
 */
export interface DocumentSummary {
  readonly id: string;
  readonly referenceId: string;
  readonly transactionId: string;
  readonly transactionReferenceId: string;
  /** The Admin's original filename. Metadata only; never used to build a storage path. */
  readonly originalFilename: string;
  /** What the upload declared, after normalisation. */
  readonly declaredMimeType: DocumentMimeType;
  /** What the bytes actually were. Authoritative. */
  readonly detectedMimeType: DocumentMimeType;
  readonly byteSize: number;
  readonly checksumSha256: string;
  readonly status: DocumentStatus;
  /**
   * Whether the bytes can be fetched right now.
   *
   * False exactly when `status` is `REMOVED`, or when the file is recorded as deleted. This is the
   * field a browser uses to stop offering a download control, rather than offering one and
   * discovering a `410` after the Admin clicks it.
   */
  readonly contentAvailable: boolean;
  /** Whether the API will serve this document inline rather than as an attachment. */
  readonly previewAvailable: boolean;
  /** Authenticated, versioned, relative. Never an absolute path or a public URL. */
  readonly downloadPath: string;
  /** Present only when `previewAvailable`; otherwise absent rather than a dead control. */
  readonly previewPath: string | null;
  readonly uploadedAt: string;
  readonly removedAt: string | null;
  /** Retained after removal so the history explains itself (`REQ-DOC-006`). */
  readonly removalReason: string | null;
  /** Whether the file has actually been deleted from storage yet. */
  readonly storageDeleted: boolean;
  /**
   * True when removal succeeded but the file could not be physically deleted.
   *
   * Reported so the interface can tell the Admin the truth: the receipt is gone and unreadable,
   * and the leftover bytes await controlled cleanup. It is never presented as "still available".
   */
  readonly cleanupPending: boolean;
}

/**
 * The attachment state a transaction screen renders.
 *
 * `docs/01-REQUIREMENTS.md` `REQ-DOC-003` requires **Receipt Missing** to be stated in words, so
 * the receipt state is returned as data rather than inferred by the browser from a count. The
 * three states are exhaustive and each has exactly one correct presentation.
 */
export interface TransactionAttachmentState {
  /** `true` only when at least one `AVAILABLE` document exists. */
  readonly hasAvailableDocument: boolean;
  /** Total records, including removed ones, matching `TransactionSummary.documentCount`. */
  readonly documentCount: number;
  /** Non-null only when `hasAvailableDocument` is false. Rendered exactly as given. */
  readonly missingLabel: string | null;
}

/**
 * Narrows an unknown value to a document summary.
 *
 * The browser validates every response it renders, so a payload that does not match the contract
 * fails loudly instead of rendering `undefined` into a receipt panel.
 */
export function isDocumentSummary(value: unknown): value is DocumentSummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['referenceId'] === 'string' &&
    typeof candidate['transactionId'] === 'string' &&
    typeof candidate['transactionReferenceId'] === 'string' &&
    typeof candidate['originalFilename'] === 'string' &&
    isDocumentMimeType(candidate['declaredMimeType']) &&
    isDocumentMimeType(candidate['detectedMimeType']) &&
    typeof candidate['byteSize'] === 'number' &&
    Number.isInteger(candidate['byteSize']) &&
    candidate['byteSize'] > 0 &&
    typeof candidate['checksumSha256'] === 'string' &&
    isDocumentStatus(candidate['status']) &&
    typeof candidate['contentAvailable'] === 'boolean' &&
    typeof candidate['previewAvailable'] === 'boolean' &&
    typeof candidate['downloadPath'] === 'string' &&
    (candidate['previewPath'] === null || typeof candidate['previewPath'] === 'string') &&
    typeof candidate['uploadedAt'] === 'string' &&
    (candidate['removedAt'] === null || typeof candidate['removedAt'] === 'string') &&
    (candidate['removalReason'] === null || typeof candidate['removalReason'] === 'string') &&
    typeof candidate['storageDeleted'] === 'boolean' &&
    typeof candidate['cleanupPending'] === 'boolean'
  );
}

/** Whether a stored or declared type is one the demo accepts. */
export function isDocumentMimeType(value: unknown): value is DocumentMimeType {
  return typeof value === 'string' && (DOCUMENT_MIME_TYPES as readonly string[]).includes(value);
}

export function isDocumentStatus(value: unknown): value is DocumentStatus {
  return typeof value === 'string' && (DOCUMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Whether a removed document is still worth showing.
 *
 * `DocumentState` adds `VOIDED` for the *transaction* projection, and a document cannot be
 * voided itself, so this narrows the transaction's state to the two that apply to a file.
 */
export function isRetainedDocumentState(value: unknown): value is DocumentStatus {
  return isDocumentStatus(value);
}

/**
 * A short, non-technical label for a document type, for Admin-facing lists.
 *
 * Derived from the *detected* type so a renamed file is labelled by what it actually is.
 */
export function documentTypeLabel(detectedMimeType: string): string {
  switch (detectedMimeType) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'JPG image';
    case 'image/png':
      return 'PNG image';
    case 'image/webp':
      return 'WEBP image';
    case 'application/pdf':
      return 'PDF document';
    default:
      return 'Document';
  }
}

/** A readable size for a document list, without a client-side money-style formatter. */
export function formatDocumentByteSize(byteSize: number): string {
  if (byteSize >= 1024 * 1024) {
    return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (byteSize >= 1024) {
    return `${Math.round(byteSize / 1024)} KB`;
  }

  return `${byteSize} bytes`;
}
