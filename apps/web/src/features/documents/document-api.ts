import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  DOCUMENT_FILENAME_MAX_LENGTH,
  DOCUMENT_MIME_TYPES,
  DOCUMENT_REMOVAL_REASON_MAX_LENGTH,
  DOCUMENT_UPLOAD_FIELD,
  isDocumentMimeType,
  type DocumentMimeType,
  type DocumentSummary,
} from '@hyssop/contracts';
import { useApiClient } from '../../app/providers/ApiClientProvider';
import { ApiClientError, ApiTransportError } from '../../lib/api-client';
import { useSession } from '../auth/SessionProvider';
import {
  createIdempotencyKey,
  fieldIssuesByName,
  invalidateTransactionDependents,
} from '../transactions/transaction-api';

/**
 * Document data access for a transaction's receipts.
 *
 * Authority: `docs/02-ARCHITECTURE.md` — the browser holds an API client, typed contracts, and
 * presentation, and never computes authoritative state. `contentAvailable`, `previewAvailable`,
 * `cleanupPending`, and `missingLabel` are all server decisions, so this module reads them rather
 * than deriving them from a filename or a count; a panel that guessed "has a file" from
 * `documentCount > 0` would claim a receipt exists after its removal, which the state-honesty rule
 * in `docs/03-UI-UX-RULES.md` forbids.
 *
 * Three rules shape the code:
 *
 * - **The server's paths are used verbatim.** `downloadPath` and `previewPath` already carry the
 *   versioned prefix, so this module never builds a path from an id. That is what keeps the browser
 *   from inventing a URL that does not exist, and what stops the day the prefix changes from
 *   breaking every stored link.
 * - **Content is fetched, not linked.** The session lives in an HTTP-only cookie the browser must
 *   send with `credentials: 'include'`; a plain `<a href>` cannot guarantee that for a binary
 *   response, and a blob is revoked as soon as the Admin closes it.
 * - **Every write reuses one idempotency key per intent,** supplied by the caller, because the
 *   server deduplicates on it.
 */

export const DOCUMENTS_QUERY_KEY = ['transactions', 'documents'] as const;

/**
 * The browser's own size ceiling.
 *
 * This is a pre-check to spare the Admin a 10 MB round trip, **not** the enforcement point: the
 * authoritative limit is the API's configured `UPLOAD_MAX_BYTES`, and the server rejects anything
 * larger regardless of what the browser allowed. The number matches
 * `DEFAULT_UPLOAD_MAX_BYTES` so the common case agrees, and the message says so rather than
 * implying the browser decides.
 */
export const DOCUMENT_MAX_BYTES = 10_485_760;

export const DOCUMENT_UPLOAD_ACCEPT = DOCUMENT_MIME_TYPES.join(',');

/**
 * The API answers a transaction's documents as a plain array, not a list envelope.
 *
 * `docs/06-API-SPEC.md` documents `GET /transactions/:id/documents` as the full set for one
 * transaction, which is small and bounded by the receipts the Admin attached. It is therefore read
 * with `get` and returned as-is, rather than through the paged list client a variable-length
 * collection would need.
 */
export function transactionDocumentsPath(transactionId: string): string {
  return `/transactions/${transactionId}/documents`;
}

export function documentPath(documentId: string): string {
  return `/documents/${documentId}`;
}

export interface DocumentFailure {
  readonly errorMessage?: string;
  readonly fieldIssues: Readonly<Record<string, string>>;
  /** A `410`, meaning the bytes are gone but the metadata is retained. */
  readonly gone: boolean;
}

const NO_FIELD_ISSUES: Readonly<Record<string, string>> = {};

/**
 * Turns a thrown value into what a panel shows.
 *
 * `410` is separated because it is a state, not a failure to report: `docs/05-DATABASE-SPEC.md`
 * keeps metadata after removal, so the correct presentation is "this receipt was removed", and a
 * generic error banner would tell the Admin nothing and hide the retained history.
 */
export function describeDocumentFailure(error: unknown): DocumentFailure {
  if (error instanceof ApiClientError) {
    return {
      ...(error.status === 410 ? {} : { errorMessage: error.message }),
      fieldIssues: fieldIssuesByName(error),
      gone: error.status === 410,
    };
  }

  if (error instanceof ApiTransportError) {
    return { errorMessage: error.message, fieldIssues: NO_FIELD_ISSUES, gone: false };
  }

  return {
    errorMessage: 'Something went wrong. Please try again.',
    fieldIssues: NO_FIELD_ISSUES,
    gone: false,
  };
}

export interface DocumentFileErrors {
  readonly file?: string;
  readonly reason?: string;
}

/**
 * Rejects an obviously unacceptable file before it is sent.
 *
 * Only what the browser can know honestly is checked: presence, an accepted declared type, a
 * non-empty filename within the persisted length, and the pre-check size. The byte-level truth —
 * what the content actually is, whether it is truncated, whether the declared type matches — is
 * the server's to decide from the bytes, and this never claims otherwise.
 */
export function validateDocumentFile(file: File | undefined): string | undefined {
  if (file === undefined) {
    return 'Choose a receipt file to upload.';
  }

  if (file.size === 0) {
    return 'That file is empty. Choose a file that has content.';
  }

  if (file.size > DOCUMENT_MAX_BYTES) {
    return 'That file is larger than the 10 MB upload limit.';
  }

  if (file.name.length > DOCUMENT_FILENAME_MAX_LENGTH) {
    return `That filename is too long. Use ${DOCUMENT_FILENAME_MAX_LENGTH} characters or fewer.`;
  }

  // The declared type is only a hint and the server re-checks the bytes, so this rejects the
  // obviously unsupported rather than claiming to know what the file really is.
  if (!isDocumentMimeType(file.type)) {
    return 'Choose a JPG, PNG, WEBP, or PDF file.';
  }

  return undefined;
}

/**
 * `REQ-DOC-006` requires a non-empty removal reason, and the column is bounded, so the textarea is
 * sized to exactly what the API will accept instead of letting the server reject a long one.
 */
export function validateRemovalReason(reason: string): string | undefined {
  const trimmed = reason.trim();

  if (trimmed === '') {
    return 'Enter a reason for removing this receipt.';
  }

  if (trimmed.length > DOCUMENT_REMOVAL_REASON_MAX_LENGTH) {
    return `Keep the reason under ${DOCUMENT_REMOVAL_REASON_MAX_LENGTH} characters.`;
  }

  return undefined;
}

/**
 * Rejects a filename carrying a path.
 *
 * `apps/api/src/documents/document-filename.ts` refuses these server-side, so this copy only
 * saves the Admin a round trip. It is worth having in the browser because a Windows path pasted
 * into a file dialog is the common way one arrives, and the failure would otherwise surface as an
 * opaque validation error.
 */
export function hasPathInFilename(filename: string): boolean {
  return filename.includes('/') || filename.includes('\\');
}

/** Builds the multipart body under the documented field name. */
export function buildUploadForm(file: File, declaredMimeType?: DocumentMimeType): FormData {
  const form = new FormData();

  // A re-typed file keeps the bytes the Admin chose and lets the declared type be corrected from
  // what a browser guessed (`application/octet-stream` for a `.heic`, say). It stays optional, so
  // an untyped file is sent untouched and the server decides from the bytes.
  form.append(
    DOCUMENT_UPLOAD_FIELD,
    declaredMimeType === undefined ? file : new File([file], file.name, { type: declaredMimeType }),
  );

  return form;
}

export function useTransactionDocuments(transactionId: string | undefined) {
  const client = useApiClient();

  return useQuery({
    queryKey: [...DOCUMENTS_QUERY_KEY, transactionId],
    queryFn: ({ signal }) =>
      client.get<readonly DocumentSummary[]>(transactionDocumentsPath(transactionId ?? ''), {
        signal,
      }),
    enabled: transactionId !== undefined,
    retry: false,
  });
}

/**
 * An upload.
 *
 * The cache is invalidated rather than patched so the panel shows exactly what the server stored,
 * including the `referenceId` and `checksumSha256` it assigned. A client-generated row could show
 * a reference the database never issued.
 */
export function useUploadDocument(
  transactionId: string | undefined,
  idempotencyKey: string | undefined,
) {
  const client = useApiClient();
  const { withCsrf } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { readonly file: File; readonly declaredMimeType?: DocumentMimeType }) => {
      if (transactionId === undefined || idempotencyKey === undefined) {
        return Promise.reject(new ApiTransportError('No transaction was selected.'));
      }

      return withCsrf((csrfToken) =>
        client.upload<DocumentSummary>(
          transactionDocumentsPath(transactionId),
          buildUploadForm(input.file, input.declaredMimeType),
          { csrfToken, idempotencyKey },
        ),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...DOCUMENTS_QUERY_KEY, transactionId] });
      // `documentCount` is returned by the transaction routes, so the transaction and receipt
      // screens are stale the moment a receipt is attached or removed.
      invalidateTransactionDependents(queryClient);
    },
  });
}

/**
 * A reason-required removal.
 *
 * The row is retained, so this returns the removed document and the panel keeps showing it as
 * removed with its reason. Reporting it as a deletion would contradict the stored audit record.
 */
export function useRemoveDocument(
  transactionId: string | undefined,
  idempotencyKey: string | undefined,
) {
  const client = useApiClient();
  const { withCsrf } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { readonly documentId: string; readonly reason: string }) => {
      if (transactionId === undefined || idempotencyKey === undefined) {
        return Promise.reject(new ApiTransportError('No transaction was selected.'));
      }

      return withCsrf((csrfToken) =>
        client.delete<DocumentSummary>(
          documentPath(input.documentId),
          { reason: input.reason.trim() },
          {
            csrfToken,
            idempotencyKey,
          },
        ),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...DOCUMENTS_QUERY_KEY, transactionId] });
      invalidateTransactionDependents(queryClient);
    },
  });
}

/**
 * The retained history of one transaction.
 *
 * Included in the invalidation set because `documentCount` and the attachment state are part of
 * every transaction projection the Admin sees.
 */
export function invalidateDocumentDependents(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY });
}

/**
 * Fetches document content into a blob URL.
 *
 * Uses the server-supplied `path` verbatim and sends the session cookie. The caller owns the
 * returned URL and must call `URL.revokeObjectURL` on it, which is why this returns the object URL
 * rather than opening a tab that cannot be revoked.
 */
export async function fetchDocumentObjectUrl(path: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(path, {
    // The session is an HTTP-only cookie; without this the request is anonymous and the API
    // answers `401`, which a panel would otherwise report as a missing file.
    credentials: 'include',
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) {
    throw new ApiTransportError('The file could not be loaded.');
  }

  return URL.createObjectURL(await response.blob());
}

export { createIdempotencyKey };
