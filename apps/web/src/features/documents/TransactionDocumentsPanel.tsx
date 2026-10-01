import { useCallback, useEffect, useRef, useState } from 'react';
import { documentTypeLabel, formatDocumentByteSize, type DocumentSummary } from '@hyssop/contracts';
import {
  Banner,
  EmptyState,
  FormField,
  LoadingBlock,
  Panel,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  controlClassName,
} from '../../components/ui';
import {
  DOCUMENT_UPLOAD_ACCEPT,
  createIdempotencyKey,
  describeDocumentFailure,
  fetchDocumentObjectUrl,
  hasPathInFilename,
  useRemoveDocument,
  useTransactionDocuments,
  useUploadDocument,
  validateDocumentFile,
  validateRemovalReason,
} from './document-api';

/**
 * The receipt panel for one transaction.
 *
 * Authority: `docs/03-UI-UX-RULES.md` — every visible control must work or be absent, state must
 * be reported honestly, and the interface is for a non-technical pastor. That produces four rules
 * this component exists to honour:
 *
 * - **"Receipt Missing" is stated in words** (`REQ-DOC-003`), not implied by an absent control.
 * - **A removed receipt stays visible** with its reference, reason, and date. `docs/05-DATABASE-SPEC.md`
 *   retains the metadata, so hiding the row would make the history a lie.
 * - **`cleanupPending` is reported as its own state**, never as "still available": the bytes are
 *   gone and unreadable, and a pending physical delete is an operational fact, not a receipt.
 * - **Preview is offered only where `previewAvailable` is true,** which is the server's decision.
 *   A disabled preview button would advertise a file the API will refuse.
 */
/** One Admin's in-progress removal of one receipt: what they typed and the key they committed to. */
interface RemovalIntent {
  readonly reason: string;
  readonly error: string | undefined;
  readonly idempotencyKey: string;
}

export function TransactionDocumentsPanel({
  transactionId,
  transactionReferenceId,
}: {
  readonly transactionId: string;
  readonly transactionReferenceId: string;
}) {
  const documents = useTransactionDocuments(transactionId);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  // One key per upload *intent*. A retry after a failure reuses it, so a request that actually
  // reached the server is not stored twice; choosing a different file is a new intent and gets a
  // new key. A fresh key on every render would defeat the deduplication entirely.
  const [uploadKey, setUploadKey] = useState(createIdempotencyKey);
  const upload = useUploadDocument(transactionId, uploadKey);
  // One intent per document, so several receipts on one transaction do not share a reason box, an
  // error, or an idempotency key. A single shared reason would let the Admin remove receipt B with
  // a reason typed while looking at receipt A.
  const [removals, setRemovals] = useState<Record<string, RemovalIntent>>({});
  const [removingId, setRemovingId] = useState<string | undefined>(undefined);
  const [openError, setOpenError] = useState<string | undefined>(undefined);
  const removalKey = removingId === undefined ? undefined : removals[removingId]?.idempotencyKey;
  const remove = useRemoveDocument(transactionId, removalKey);
  const objectUrls = useRef<string[]>([]);

  // Every object URL this component created is revoked on unmount. A blob URL pins the bytes in
  // memory for the life of the document, so leaking one on every view of a receipt is a slow leak
  // in a long-lived tab.
  useEffect(
    () => () => {
      for (const url of objectUrls.current) {
        URL.revokeObjectURL(url);
      }
    },
    [],
  );

  const openDocument = useCallback(async (path: string) => {
    try {
      const url = await fetchDocumentObjectUrl(path);
      objectUrls.current.push(url);
      setOpenError(undefined);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // Reported rather than swallowed: `docs/03-UI-UX-RULES.md` requires a failed action to be
      // shown, and a silently dead Download control would be exactly the dead control the phase
      // document prohibits.
      setOpenError('The receipt could not be opened. Try again in a moment.');
    }
  }, []);

  function onChoose(chosen: File | undefined): void {
    const pathProblem = chosen === undefined ? undefined : pathFilenameError(chosen.name);

    if (pathProblem !== undefined) {
      setFile(chosen);
      setFileError(pathProblem);

      return;
    }

    setFile(chosen);
    setFileError(validateDocumentFile(chosen));
  }

  function onUpload(): void {
    const problem = validateDocumentFile(file);

    if (problem !== undefined) {
      setFileError(problem);

      return;
    }

    if (file === undefined) {
      return;
    }

    upload.mutate(
      { file },
      {
        onSuccess: () => {
          setFile(undefined);
          setFileError(undefined);
          // The upload succeeded, so the next one is a new intent and needs a new key.
          setUploadKey(createIdempotencyKey());
        },
      },
    );
  }

  function onIntent(documentId: string, reason: string): void {
    // Keeps the same reason and key while the Admin edits, and mints the key on the first keystroke
    // of a fresh intent so a retry after a network failure reuses it.
    const existing = removals[documentId];

    setRemovals((current) => ({
      ...current,
      [documentId]: {
        reason,
        error: undefined,
        idempotencyKey: existing?.idempotencyKey ?? createIdempotencyKey(),
      },
    }));
  }

  function onRemove(document: DocumentSummary): void {
    const intent = removals[document.id];
    const reason = intent?.reason ?? '';
    const problem = validateRemovalReason(reason);

    if (problem !== undefined) {
      setRemovals((current) => ({
        ...current,
        [document.id]: {
          reason,
          error: problem,
          idempotencyKey: intent?.idempotencyKey ?? createIdempotencyKey(),
        },
      }));

      return;
    }

    setRemovingId(document.id);
    remove.mutate(
      { documentId: document.id, reason },
      {
        onSuccess: () => {
          // The intent is complete, so the row starts clean if it is ever available again.
          setRemovals((current) => {
            const next = { ...current };

            delete next[document.id];

            return next;
          });
          setRemovingId(undefined);
        },
        // The reason and key are kept on failure so the Admin's retry is the *same* request, not a
        // second removal attempt under a new key.
        onError: () => setRemovingId(undefined),
      },
    );
  }

  const uploadFailure =
    upload.error === undefined ? undefined : describeDocumentFailure(upload.error);
  const removeFailure =
    remove.error === undefined ? undefined : describeDocumentFailure(remove.error);

  return (
    <Panel title={`Receipt for ${transactionReferenceId}`}>
      <p className="text-supporting text-text-secondary">
        Attach a receipt image or PDF. Uploading one file adds a receipt to this{' '}
        {transactionReferenceId}
        record. Removing a receipt keeps its reference and reason in the history below.
      </p>

      {uploadFailure?.errorMessage === undefined ? null : (
        <Banner tone="danger">{uploadFailure.errorMessage}</Banner>
      )}
      {removeFailure?.errorMessage === undefined ? null : (
        <Banner tone="danger">{removeFailure.errorMessage}</Banner>
      )}
      {openError === undefined ? null : <Banner tone="danger">{openError}</Banner>}

      <UploadControls
        file={file}
        fileError={fileError ?? uploadFailure?.fieldIssues['file']}
        pending={upload.isPending}
        onChoose={onChoose}
        onUpload={onUpload}
      />

      {documents.isPending ? <LoadingBlock label="Loading receipts…" /> : null}

      {documents.isError ? (
        <Banner tone="danger">
          The receipts for this transaction could not be loaded. Reload the page to try again.
        </Banner>
      ) : null}

      {documents.isSuccess && documents.data.length === 0 ? (
        <EmptyState
          title="Receipt Missing"
          description="No receipt is attached to this transaction yet. Uploading a file above adds one, and the transaction stays recorded and counted normally either way."
        />
      ) : null}

      {documents.isSuccess && documents.data.length > 0 ? (
        <ul className="space-y-3">
          {documents.data.map((document) => (
            <li key={document.id}>
              <DocumentRow
                document={document}
                removalReason={removals[document.id]?.reason ?? ''}
                removalError={removals[document.id]?.error}
                removing={remove.isPending && removingId === document.id}
                canRemove={removingId === undefined}
                onOpen={(path) => {
                  void openDocument(path);
                }}
                onReasonChange={(value) => {
                  onIntent(document.id, value);
                }}
                onRemove={() => onRemove(document)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

/** The reason box is shared by every row; the placeholder says which record it applies to. */
function UploadControls({
  file,
  fileError,
  pending,
  onChoose,
  onUpload,
}: {
  readonly file: File | undefined;
  readonly fileError: string | undefined;
  readonly pending: boolean;
  readonly onChoose: (file: File | undefined) => void;
  readonly onUpload: () => void;
}) {
  const inputId = 'transaction-document-upload';

  return (
    <div className="space-y-3">
      <FormField id={inputId} label="Receipt file" error={fileError}>
        <input
          id={inputId}
          type="file"
          accept={DOCUMENT_UPLOAD_ACCEPT}
          disabled={pending}
          onChange={(event) => onChoose(event.target.files?.[0])}
          className="block w-full text-supporting text-text-primary file:mr-3 file:rounded-md file:border-0 file:bg-surface-muted file:px-4 file:py-2 file:text-supporting file:font-semibold file:text-text-primary"
        />
      </FormField>

      <p className="text-supporting text-text-secondary">
        {file === undefined ? 'No file chosen yet.' : `Ready to upload ${file.name}.`}
      </p>

      <button
        type="button"
        className={PRIMARY_BUTTON_CLASS}
        disabled={pending || file === undefined || fileError !== undefined}
        onClick={onUpload}
      >
        {pending ? 'Uploading…' : 'Upload receipt'}
      </button>
    </div>
  );
}

/**
 * One receipt.
 *
 * The available and removed presentations are deliberately different rather than one row with a
 * disabled button: `docs/03-UI-UX-RULES.md` requires an unavailable control to be absent rather
 * than shown dead, and a removed receipt needs its reason on screen to be explainable.
 */
function DocumentRow({
  document,
  removalReason,
  removalError,
  removing,
  canRemove,
  onOpen,
  onReasonChange,
  onRemove,
}: {
  readonly document: DocumentSummary;
  readonly removalReason: string;
  readonly removalError: string | undefined;
  readonly removing: boolean;
  readonly canRemove: boolean;
  readonly onOpen: (path: string) => void;
  readonly onReasonChange: (value: string) => void;
  readonly onRemove: () => void;
}) {
  const reasonId = `document-removal-reason-${document.id}`;
  const isAvailable = document.status === 'AVAILABLE' && document.contentAvailable;
  const isPendingCleanup = document.cleanupPending;

  if (!isAvailable) {
    return (
      <div className="rounded-md border border-border-subtle bg-surface-muted p-3">
        <p className="text-supporting font-semibold text-text-primary">
          {document.originalFilename} ({document.referenceId})
        </p>
        <p className="text-supporting text-text-secondary">This receipt was removed.</p>
        {document.removalReason === null ? null : (
          <p className="text-supporting text-text-secondary">Reason: {document.removalReason}</p>
        )}
        {document.removedAt === null ? null : (
          <p className="text-supporting text-text-secondary">
            Removed on {document.removedAt.slice(0, 10)}.
          </p>
        )}
        {isPendingCleanup ? (
          <p className="text-supporting font-semibold text-warning-800">
            The file is no longer readable and is awaiting deletion from storage.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border-subtle p-3">
      <p className="text-supporting font-semibold text-text-primary">
        {document.originalFilename} ({document.referenceId})
      </p>
      <p className="text-supporting text-text-secondary">
        {documentTypeLabel(document.detectedMimeType)} · {formatDocumentByteSize(document.byteSize)}{' '}
        · uploaded {document.uploadedAt.slice(0, 10)}
      </p>
      {document.declaredMimeType === document.detectedMimeType ? null : (
        <p className="text-supporting text-text-secondary">
          The upload said {document.declaredMimeType}; the file is really{' '}
          {document.detectedMimeType}.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          onClick={() => {
            onOpen(document.downloadPath);
          }}
        >
          Download receipt
        </button>
        {document.previewAvailable && document.previewPath !== null ? (
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            onClick={() => {
              onOpen(document.previewPath as string);
            }}
          >
            Preview receipt
          </button>
        ) : null}
      </div>

      {canRemove ? (
        <div className="space-y-2">
          <FormField id={reasonId} label="Reason for removing this receipt" error={removalError}>
            <textarea
              id={reasonId}
              value={removalReason}
              disabled={removing}
              rows={2}
              onChange={(event) => onReasonChange(event.target.value)}
              className={controlClassName('min-h-16')}
            />
          </FormField>
          <button
            type="button"
            className="rounded-md bg-danger-700 px-4 py-2 text-supporting font-semibold text-text-inverse hover:bg-danger-800 disabled:bg-border-strong"
            disabled={removing}
            onClick={onRemove}
          >
            {removing ? 'Removing…' : 'Remove receipt'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A filename carrying a path is refused by the server, so it is refused before sending. */
function pathFilenameError(filename: string): string | undefined {
  return hasPathInFilename(filename)
    ? 'Remove the folder path from the filename and choose the file again.'
    : undefined;
}
