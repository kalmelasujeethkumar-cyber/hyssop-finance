import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DOCUMENT_UPLOAD_FIELD, type DocumentSummary } from '@hyssop/contracts';
import { renderRoute } from '../../test/render';
import { ApiClientError } from '../../lib/api-client';
import {
  EXPENSE_ONE,
  notFound,
  stubApiClient,
  transportFailure,
  type StubApiClient,
} from '../../test/stub-client';
import {
  DOCUMENT_MAX_BYTES,
  describeDocumentFailure,
  hasPathInFilename,
  validateDocumentFile,
  validateRemovalReason,
} from './document-api';

/**
 * Browser document tests: the receipt state stated in words, a real upload, the retained history
 * after a removal, and every honest-failure presentation.
 *
 * These satisfy `TEST-DOC-001` and `TEST-DOC-002` in the browser layer. They run against the real
 * route tree and a stateful stub that really appends an uploaded file and really flips a removal,
 * so a dead upload button, a lost removal reason, or a panel that hid the audit record would fail
 * here rather than only in a browser run against a real API.
 */

const EXPENSE_PATH = `/expenses/${EXPENSE_ONE.id}`;

/** A small, real file: the stub records the name, size, and type the panel actually sent. */
function receiptFile(name = 'bill.jpg', bytes = 3): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });
}

function availableDocument(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: 'dddddddd1-0000-4000-8000-000000000001',
    referenceId: 'HY-DOC-000001',
    transactionId: EXPENSE_ONE.id,
    transactionReferenceId: EXPENSE_ONE.referenceId,
    originalFilename: 'bill.jpg',
    declaredMimeType: 'image/jpeg',
    detectedMimeType: 'image/jpeg',
    byteSize: 3,
    checksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'AVAILABLE',
    contentAvailable: true,
    previewAvailable: true,
    downloadPath: `/api/v1/documents/dddddddd1-0000-4000-8000-000000000001/download`,
    previewPath: `/api/v1/documents/dddddddd1-0000-4000-8000-000000000001/preview`,
    uploadedAt: '2026-09-12T07:20:00.000Z',
    removedAt: null,
    removalReason: null,
    storageDeleted: false,
    cleanupPending: false,
    ...overrides,
  };
}

/**
 * The stub with a seeded document list.
 *
 * Tests that need a *failure* call `stubApiClient` directly, so the scripted failure is stated at
 * the call site instead of being threaded through a helper's second parameter.
 */
function clientWithDocuments(rows: readonly DocumentSummary[] = []): StubApiClient {
  return stubApiClient({
    documents: { documentsByTransactionId: { [EXPENSE_ONE.id]: rows } },
  });
}

/** The panel heading, used as the scope for row queries. */
function receiptPanel(): HTMLElement {
  return screen.getByRole('region', { name: /receipt for/i });
}

describe('receipt state on the expense screen', () => {
  it('states Receipt Missing in words and still offers a working upload', async () => {
    renderRoute({ path: EXPENSE_PATH, client: clientWithDocuments() });

    expect(await screen.findByText('Receipt Missing')).toBeInTheDocument();
    expect(screen.getByText(/no receipt is attached to this transaction yet/i)).toBeInTheDocument();
    // The control is real, not a placeholder: the Admin can attach a receipt now.
    expect(screen.getByLabelText(/receipt file/i)).toBeEnabled();
    expect(screen.getByRole('button', { name: /upload receipt/i })).toBeInTheDocument();
  });

  it('uploads a chosen file and shows the stored document the server returned', async () => {
    const user = userEvent.setup();
    const client = clientWithDocuments();
    renderRoute({ path: EXPENSE_PATH, client });

    await screen.findByText('Receipt Missing');
    await user.upload(screen.getByLabelText(/receipt file/i), receiptFile('september.jpg', 5));
    await user.click(screen.getByRole('button', { name: /upload receipt/i }));

    // The row that appears carries the server's reference and the file the Admin chose, not a
    // locally generated placeholder.
    expect(await screen.findByText(/september\.jpg \(HY-DOC-000001\)/)).toBeInTheDocument();

    const upload = client.calls.find((call) => call.method === 'POST');

    expect(upload?.path).toBe(`/transactions/${EXPENSE_ONE.id}/documents`);
    expect(upload?.body).toBeInstanceOf(FormData);
    expect((upload?.body as FormData).get(DOCUMENT_UPLOAD_FIELD)).toBeInstanceOf(File);
    expect(client.documentsFor(EXPENSE_ONE.id)).toHaveLength(1);
  });

  it('reports the server refusal against the upload instead of failing silently', async () => {
    const user = userEvent.setup();
    const client = stubApiClient({
      documents: {
        documentsByTransactionId: { [EXPENSE_ONE.id]: [] },
        uploadFails: new ApiClientError(
          400,
          'VALIDATION_FAILED',
          'The file content is not a supported image or PDF.',
          'req-doc-1',
        ),
      },
    });
    renderRoute({ path: EXPENSE_PATH, client });

    await screen.findByText('Receipt Missing');
    await user.upload(screen.getByLabelText(/receipt file/i), receiptFile());
    await user.click(screen.getByRole('button', { name: /upload receipt/i }));

    expect(
      await screen.findByText('The file content is not a supported image or PDF.'),
    ).toBeInTheDocument();
    expect(client.documentsFor(EXPENSE_ONE.id)).toHaveLength(0);
  });

  it('reuses one idempotency key when a failed upload is retried', async () => {
    const user = userEvent.setup();
    const client = stubApiClient({
      documents: {
        documentsByTransactionId: { [EXPENSE_ONE.id]: [] },
        // A dropped connection: the request may well have been stored, so the retry must not
        // create a second receipt.
        firstUploadFails: transportFailure,
      },
    });
    renderRoute({ path: EXPENSE_PATH, client });

    await screen.findByText('Receipt Missing');
    await user.upload(screen.getByLabelText(/receipt file/i), receiptFile());

    await user.click(screen.getByRole('button', { name: /upload receipt/i }));
    await screen.findByText('The API could not be reached.');

    await user.click(screen.getByRole('button', { name: /upload receipt/i }));

    await waitFor(() => {
      expect(client.documentsFor(EXPENSE_ONE.id)).toHaveLength(1);
    });

    const keys = client.calls
      .filter((call) => call.method === 'POST')
      .map((call) => call.idempotencyKey);

    expect(keys[0]).toBe(keys[1]);
  });

  it('requires a removal reason and sends the trimmed value with the removal', async () => {
    const user = userEvent.setup();
    const client = clientWithDocuments([availableDocument()]);
    renderRoute({ path: EXPENSE_PATH, client });

    await screen.findByText(/bill\.jpg \(HY-DOC-000001\)/);
    await user.click(screen.getByRole('button', { name: /remove receipt/i }));

    // `REQ-DOC-006`: an empty reason is refused before a request is made.
    expect(
      await screen.findByText(/enter a reason for removing this receipt/i),
    ).toBeInTheDocument();
    expect(client.calls.some((call) => call.method === 'DELETE')).toBe(false);

    await user.type(
      screen.getByLabelText(/reason for removing this receipt/i),
      '  uploaded by mistake  ',
    );
    await user.click(screen.getByRole('button', { name: /remove receipt/i }));

    await waitFor(() => {
      expect(client.calls.some((call) => call.method === 'DELETE')).toBe(true);
    });

    const removal = client.calls.find((call) => call.method === 'DELETE');

    expect(removal?.path).toBe('/documents/dddddddd1-0000-4000-8000-000000000001');
    expect(removal?.body).toEqual({ reason: 'uploaded by mistake' });
  });

  it('keeps the removed receipt visible with its reason and a removal date', async () => {
    const user = userEvent.setup();
    const client = clientWithDocuments([availableDocument()]);
    renderRoute({ path: EXPENSE_PATH, client });

    await screen.findByText(/bill\.jpg \(HY-DOC-000001\)/);
    await user.type(screen.getByLabelText(/reason for removing this receipt/i), 'duplicate');
    await user.click(screen.getByRole('button', { name: /remove receipt/i }));

    const panel = receiptPanel();

    // The audit record is retained, so the row stays and explains itself rather than vanishing.
    expect(await within(panel).findByText('This receipt was removed.')).toBeInTheDocument();
    expect(within(panel).getByText('Reason: duplicate')).toBeInTheDocument();
    expect(within(panel).getByText(/removed on 2026-03-02/i)).toBeInTheDocument();
    // No dead controls on a removed receipt: nothing to download or preview.
    expect(
      within(panel).queryByRole('button', { name: /download receipt/i }),
    ).not.toBeInTheDocument();
    expect(
      within(panel).queryByRole('button', { name: /preview receipt/i }),
    ).not.toBeInTheDocument();
  });

  it('gives each receipt its own removal reason and removes only the receipt the Admin chose', async () => {
    const user = userEvent.setup();
    const second = availableDocument({
      id: 'dddddddd2-0000-4000-8000-000000000002',
      referenceId: 'HY-DOC-000002',
      originalFilename: 'invoice.jpg',
      downloadPath: '/api/v1/documents/dddddddd2-0000-4000-8000-000000000002/download',
      previewPath: '/api/v1/documents/dddddddd2-0000-4000-8000-000000000002/preview',
    });
    const client = clientWithDocuments([availableDocument(), second]);
    renderRoute({ path: EXPENSE_PATH, client });

    await screen.findByText(/bill\.jpg \(HY-DOC-000001\)/);

    const rows = within(receiptPanel()).getAllByRole('listitem');

    expect(rows).toHaveLength(2);

    // A shared reason box would let the Admin remove receipt B with a reason typed while looking at
    // receipt A. Each row must hold its own.
    const firstReason = within(rows[0] as HTMLElement).getByLabelText(
      /reason for removing this receipt/i,
    );
    const secondReason = within(rows[1] as HTMLElement).getByLabelText(
      /reason for removing this receipt/i,
    );

    await user.type(firstReason, 'uploaded by mistake');

    expect(secondReason).toHaveValue('');

    await user.click(
      within(rows[1] as HTMLElement).getByRole('button', { name: /remove receipt/i }),
    );

    // The second row is the one under removal, and it is still refused without a reason of its own.
    expect(
      await within(rows[1] as HTMLElement).findByText(/enter a reason for removing this receipt/i),
    ).toBeInTheDocument();
    expect(client.calls.some((call) => call.method === 'DELETE')).toBe(false);
    // The first row's typed reason was not consumed by the second row's refusal.
    expect(firstReason).toHaveValue('uploaded by mistake');
  });

  it('removes several receipts with one idempotency key each, not one key for the panel', async () => {
    const user = userEvent.setup();
    const second = availableDocument({
      id: 'dddddddd2-0000-4000-8000-000000000002',
      referenceId: 'HY-DOC-000002',
      originalFilename: 'invoice.jpg',
    });
    const client = clientWithDocuments([availableDocument(), second]);
    renderRoute({ path: EXPENSE_PATH, client });

    await screen.findByText(/bill\.jpg \(HY-DOC-000001\)/);

    for (const reason of ['first reason', 'second reason']) {
      const rows = within(receiptPanel()).getAllByRole('listitem');
      const target = rows.find((row) => within(row).queryByLabelText(/reason for/i) !== null);

      if (target === undefined) {
        throw new Error('expected another available receipt to remove');
      }

      await user.type(within(target).getByLabelText(/reason for removing this receipt/i), reason);
      await user.click(within(target).getByRole('button', { name: /remove receipt/i }));
      await waitFor(() => {
        expect(
          client.calls.filter((call) => call.method === 'DELETE' && call.body !== undefined),
        ).toHaveLength(reason === 'first reason' ? 1 : 2);
      });
    }

    const keys = client.calls
      .filter((call) => call.method === 'DELETE')
      .map((call) => call.idempotencyKey);

    expect(keys).toHaveLength(2);
    // One key per removal intent, so a retry of one removal cannot deduplicate against the other.
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('keeps one removal key across a retry of the same receipt', async () => {
    const user = userEvent.setup();
    const client = stubApiClient({
      documents: {
        documentsByTransactionId: { [EXPENSE_ONE.id]: [availableDocument()] },
        removeFails: new Error('nope'),
      },
    });
    renderRoute({ path: EXPENSE_PATH, client });

    await screen.findByText(/bill\.jpg \(HY-DOC-000001\)/);

    await user.type(screen.getByLabelText(/reason for removing this receipt/i), 'duplicate');
    await user.click(screen.getByRole('button', { name: /remove receipt/i }));

    await waitFor(() => {
      expect(client.calls.some((call) => call.method === 'DELETE')).toBe(true);
    });

    const firstKey = client.calls.find((call) => call.method === 'DELETE')?.idempotencyKey;

    await user.click(screen.getByRole('button', { name: /remove receipt/i }));
    await waitFor(() => {
      expect(client.calls.filter((call) => call.method === 'DELETE').length).toBe(2);
    });

    const keys = client.calls
      .filter((call) => call.method === 'DELETE')
      .map((call) => call.idempotencyKey);

    // A retry of the *same* removal must reuse its key, or a request that reached the server is
    // not recognised as the same intent.
    expect(keys).toStrictEqual([firstKey, firstKey]);
  });

  it('reports a failed download instead of leaving a control that silently does nothing', async () => {
    const user = userEvent.setup();
    renderRoute({
      path: EXPENSE_PATH,
      client: clientWithDocuments([availableDocument()]),
    });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 410, blob: () => Promise.resolve(new Blob()) }),
    );

    try {
      await screen.findByText(/bill\.jpg \(HY-DOC-000001\)/);
      await user.click(screen.getByRole('button', { name: /download receipt/i }));

      expect(await screen.findByText(/the receipt could not be opened/i)).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never offers a preview for a format the server will not render inline', async () => {
    renderRoute({
      path: EXPENSE_PATH,
      client: clientWithDocuments([
        availableDocument({
          originalFilename: 'statement.pdf',
          declaredMimeType: 'application/pdf',
          detectedMimeType: 'application/pdf',
          // The server's decision, and the browser obeys it rather than guessing from `.pdf`.
          previewAvailable: false,
          previewPath: null,
        }),
      ]),
    });

    expect(await screen.findByText(/statement\.pdf \(HY-DOC-000001\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download receipt/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preview receipt/i })).not.toBeInTheDocument();
  });

  it('says a removed receipt awaiting deletion is unreadable, not available', async () => {
    renderRoute({
      path: EXPENSE_PATH,
      client: clientWithDocuments([
        availableDocument({
          status: 'REMOVED',
          contentAvailable: false,
          previewAvailable: false,
          previewPath: null,
          removedAt: '2026-03-02T09:00:00.000Z',
          removalReason: 'wrong receipt',
          storageDeleted: false,
          // Removal succeeded but the bytes could not be physically deleted yet.
          cleanupPending: true,
        }),
      ]),
    });

    expect(await screen.findByText('This receipt was removed.')).toBeInTheDocument();
    expect(
      screen.getByText(/no longer readable and is awaiting deletion from storage/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download receipt/i })).not.toBeInTheDocument();
  });

  it('shows the declared and detected types when the upload was mislabelled', async () => {
    renderRoute({
      path: EXPENSE_PATH,
      client: clientWithDocuments([
        availableDocument({ declaredMimeType: 'image/jpeg', detectedMimeType: 'image/png' }),
      ]),
    });

    expect(
      await screen.findByText(/the upload said image\/jpeg; the file is really image\/png/i),
    ).toBeInTheDocument();
  });

  it('reports a failed document list without claiming the receipt does not exist', async () => {
    renderRoute({
      path: EXPENSE_PATH,
      client: stubApiClient({
        documents: {
          documentsByTransactionId: { [EXPENSE_ONE.id]: [] },
          listFails: transportFailure,
        },
      }),
    });

    expect(
      await screen.findByText(/receipts for this transaction could not be loaded/i),
    ).toBeInTheDocument();
    // A failed read is not evidence of a missing receipt, so "Receipt Missing" is not shown.
    expect(screen.queryByText('Receipt Missing')).not.toBeInTheDocument();
  });

  it('reports a 404 on the list as a load failure rather than an empty history', async () => {
    renderRoute({
      path: EXPENSE_PATH,
      client: stubApiClient({
        documents: {
          documentsByTransactionId: { [EXPENSE_ONE.id]: [] },
          listFails: notFound,
        },
      }),
    });

    expect(
      await screen.findByText(/receipts for this transaction could not be loaded/i),
    ).toBeInTheDocument();
  });

  it('names the transaction the receipt panel belongs to', async () => {
    renderRoute({ path: EXPENSE_PATH, client: clientWithDocuments() });

    expect(
      await screen.findByRole('heading', { name: `Receipt for ${EXPENSE_ONE.referenceId}` }),
    ).toBeInTheDocument();
  });
});

describe('document rules the browser can check before sending', () => {
  it('requires a file, and rejects an empty or unsupported one', () => {
    expect(validateDocumentFile(undefined)).toMatch(/choose a receipt file/i);
    expect(validateDocumentFile(new File([], 'bill.jpg', { type: 'image/jpeg' }))).toMatch(
      /that file is empty/i,
    );
    expect(validateDocumentFile(new File(['x'], 'notes.txt', { type: 'text/plain' }))).toMatch(
      /choose a jpg, png, webp, or pdf file/i,
    );
  });

  it('rejects a file above the pre-check size limit and says what the limit is', () => {
    const oversized = new File([new Uint8Array(1)], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversized, 'size', { value: DOCUMENT_MAX_BYTES + 1 });

    expect(validateDocumentFile(oversized)).toMatch(/larger than the 10 mb upload limit/i);
  });

  it('rejects a filename carrying a path, which the server would refuse', () => {
    expect(hasPathInFilename('C:\\Users\\pastor\\bill.jpg')).toBe(true);
    expect(hasPathInFilename('../../etc/passwd.jpg')).toBe(true);
    expect(hasPathInFilename('bill.jpg')).toBe(false);
  });

  it('requires a removal reason and bounds its length', () => {
    expect(validateRemovalReason('   ')).toMatch(/enter a reason/i);
    expect(validateRemovalReason('x'.repeat(2001))).toMatch(/keep the reason under 2000/i);
    expect(validateRemovalReason('duplicate')).toBeUndefined();
  });

  it('treats a 410 as a retained state rather than an error to report', () => {
    // The API answers a removed document's content with status `410` and code `NOT_FOUND`: the
    // status is what carries the extra meaning, so the browser keys off the status.
    const gone = new ApiClientError(
      410,
      'NOT_FOUND',
      'This document was removed and its content is no longer available.',
      'req-doc-2',
    );

    expect(describeDocumentFailure(gone)).toEqual({ fieldIssues: {}, gone: true });
  });

  it('shows a server message for an ordinary failure and nothing internal', () => {
    expect(describeDocumentFailure(transportFailure).errorMessage).toBe(
      'The API could not be reached.',
    );
    expect(describeDocumentFailure(new Error('postgres exploded')).errorMessage).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
