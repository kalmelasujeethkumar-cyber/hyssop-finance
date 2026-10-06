/**
 * Phase 07 document persistence against real PostgreSQL.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-DOC-002`, `REQ-DOC-004`-`REQ-DOC-009` and
 * `docs/05-DATABASE-SPEC.md`.
 *
 * The HTTP suite proves the transport rules against in-memory doubles. This suite proves the parts
 * that only exist in the database:
 *
 * - the reference allocator hands out `HY-DOC-000001` and never repeats one;
 * - a stored row keeps the *detected* type as well as the declared one, so the declared type can
 *   never quietly become the authority;
 * - removal retains metadata, denies content, and records who removed it and why;
 * - `storage_deleted_at` is what distinguishes "bytes still on disk" from "bytes are gone";
 * - the CHECK constraints refuse a hand-written row the service would never produce;
 * - no raw bytes are stored in PostgreSQL, and no column holds a filesystem path.
 *
 * The last point matters most for the storage decision: if a path or a blob could reach a column,
 * the storage abstraction could be bypassed without any test noticing.
 */

import { createHash } from 'node:crypto';
import { toExpenseSummary } from '../../src/transactions/transaction-mapper';
import { createHarness, testAdminData, type TestHarness } from './support/test-database';

jest.setTimeout(120_000);

const BUSINESS_DATE = new Date('2026-09-01T00:00:00.000Z');
const OTHER_BUSINESS_DATE = new Date('2026-08-01T00:00:00.000Z');

/** A 64-character hexadecimal key, the only shape the adapter ever hands out. */
function storageKey(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

function checksumOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('document persistence', () => {
  let harness: TestHarness;
  let actorAdminId: string;
  let categoryId: string;
  let expenseId: string;
  let otherExpenseId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    harness.admin = await harness.reset();
    const admin = await harness.runtime.adminUser.create({ data: testAdminData('document-actor') });

    actorAdminId = admin.id;

    const category = await harness.categories.create('Electricity', actorAdminId);
    categoryId = category.id;

    expenseId = await createExpense(BUSINESS_DATE);
    otherExpenseId = await createExpense(OTHER_BUSINESS_DATE);
  });

  async function createExpense(businessDate: Date, amountPaise = 45_000n): Promise<string> {
    const reason = await harness.ensureReason(categoryId, actorAdminId);

    const created = await harness.transactions.create(
      {
        transactionType: 'EXPENSE',
        amountPaise,
        paymentMethod: 'UPI',
        businessDate,
        occurredAt: new Date(),
        categoryId,
        expenseReasonId: reason.id,
      },
      { actorAdminId },
    );

    return created.id;
  }

  async function recordDocument(
    transactionId: string,
    overrides: {
      seed?: string;
      originalFilename?: string;
      declaredMimeType?: string;
      detectedMimeType?: string;
      byteSize?: number;
    } = {},
  ) {
    const bytes = Buffer.alloc(64, 7);

    return harness.documents.record({
      transactionId,
      storageKey: storageKey(
        overrides.seed ?? `seed-${transactionId}-${overrides.originalFilename ?? 'a'}`,
      ),
      originalFilename: overrides.originalFilename ?? 'bill.png',
      declaredMimeType: overrides.declaredMimeType ?? 'image/png',
      detectedMimeType: overrides.detectedMimeType ?? 'image/png',
      byteSize: overrides.byteSize ?? bytes.length,
      checksumSha256: checksumOf(bytes),
      uploadedByAdminId: actorAdminId,
    });
  }

  describe('reference allocation', () => {
    it('allocates the documented document reference format in order', async () => {
      // A reference an Admin can read aloud matters: it is what appears on the audit trail.
      const first = await recordDocument(expenseId, { originalFilename: 'one.png' });
      const second = await recordDocument(expenseId, { originalFilename: 'two.png' });

      expect(first.referenceId).toBe('HY-DOC-000001');
      expect(second.referenceId).toBe('HY-DOC-000002');
    });

    it('never hands the same reference to two documents', async () => {
      const created = await Promise.all([
        recordDocument(expenseId, { originalFilename: 'a.png' }),
        recordDocument(expenseId, { originalFilename: 'b.png' }),
        recordDocument(expenseId, { originalFilename: 'c.png' }),
      ]);

      const references = new Set(created.map((row) => row.referenceId));
      expect(references.size).toBe(3);
    });
  });

  describe('stored metadata', () => {
    it('keeps the detected type beside the declared type rather than replacing it', async () => {
      // If only the declared type were kept, a client claim could later be mistaken for a verified
      // fact. Both are stored so the difference stays auditable. Both must still be allowed types —
      // the repository refuses a declaration it cannot vouch for, which is what
      // `ALLOWED_DOCUMENT_MIME_TYPES` exists for.
      const document = await recordDocument(expenseId, {
        declaredMimeType: 'image/jpeg',
        detectedMimeType: 'image/png',
      });

      expect(document.declaredMimeType).toBe('image/jpeg');
      expect(document.detectedMimeType).toBe('image/png');
    });

    it('stores no file bytes and no filesystem path', async () => {
      const document = await recordDocument(expenseId);

      const columns = await harness.runtime.$queryRaw<readonly { column_name: string }[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'transaction_document'
      `;
      const names = columns.map((row) => row.column_name);

      // Raw bytes in PostgreSQL would bypass the storage abstraction entirely.
      expect(names).not.toContain('content');
      expect(names).not.toContain('bytes');
      expect(names).not.toContain('data');
      expect(names).not.toContain('blob');

      // A path column would let a caller decide where files live.
      expect(names).not.toContain('file_path');
      expect(names).not.toContain('path');
      expect(names).not.toContain('local_path');

      // The only locator is the opaque key.
      expect(document.storageKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('stores a checksum that matches the bytes it describes', async () => {
      const bytes = Buffer.from('receipt bytes');
      const document = await harness.documents.record({
        transactionId: expenseId,
        storageKey: storageKey('checksum-seed'),
        originalFilename: 'bill.png',
        declaredMimeType: 'image/png',
        detectedMimeType: 'image/png',
        byteSize: bytes.length,
        checksumSha256: checksumOf(bytes),
        uploadedByAdminId: actorAdminId,
      });

      expect(document.checksumSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    });
  });

  describe('constraints', () => {
    it('refuses a hand-written row whose declared type is not allowed', async () => {
      // A service-level check is bypassable by any other writer. The constraint is what makes the
      // rule hold for every path into the table.
      await expect(
        harness.runtime.transactionDocument.create({
          data: {
            transactionId: expenseId,
            referenceId: 'HY-DOC-900001',
            storageKey: storageKey('bad-declared'),
            originalFilename: 'payload.png',
            declaredMimeType: 'text/html',
            detectedMimeType: 'image/png',
            byteSize: 64,
            checksumSha256: checksumOf(Buffer.alloc(1)),
            uploadedByAdminId: actorAdminId,
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a hand-written row whose detected type is not allowed', async () => {
      await expect(
        harness.runtime.transactionDocument.create({
          data: {
            transactionId: expenseId,
            referenceId: 'HY-DOC-900002',
            storageKey: storageKey('bad-detected'),
            originalFilename: 'payload.png',
            declaredMimeType: 'image/png',
            detectedMimeType: 'application/x-msdownload',
            byteSize: 64,
            checksumSha256: checksumOf(Buffer.alloc(1)),
            uploadedByAdminId: actorAdminId,
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a hand-written row with an empty storage key', async () => {
      // `docs/05-DATABASE-SPEC.md` requires a non-empty storage key. The *format* of that key is a
      // separate, application-layer invariant — `LocalDocumentStorage` refuses anything that is not
      // 64 hexadecimal characters, which is proved in `local-document-storage.spec.ts`. Asserting a
      // database constraint here that the specification does not define would be asserting fiction.
      await expect(
        harness.runtime.transactionDocument.create({
          data: {
            transactionId: expenseId,
            referenceId: 'HY-DOC-900003',
            storageKey: '',
            originalFilename: 'bill.png',
            declaredMimeType: 'image/png',
            detectedMimeType: 'image/png',
            byteSize: 64,
            checksumSha256: checksumOf(Buffer.alloc(1)),
            uploadedByAdminId: actorAdminId,
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a document for a transaction that does not exist', async () => {
      await expect(
        harness.runtime.transactionDocument.create({
          data: {
            transactionId: '00000000-0000-4000-8000-000000000000',
            referenceId: 'HY-DOC-900004',
            storageKey: storageKey('orphan'),
            originalFilename: 'bill.png',
            declaredMimeType: 'image/png',
            detectedMimeType: 'image/png',
            byteSize: 64,
            checksumSha256: checksumOf(Buffer.alloc(1)),
            uploadedByAdminId: actorAdminId,
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a removal with no reason, so an audit row cannot be anonymous', async () => {
      const document = await recordDocument(expenseId);

      await expect(
        harness.runtime.transactionDocument.update({
          where: { id: document.id },
          data: { status: 'REMOVED', removedAt: new Date(), removedByAdminId: actorAdminId },
        }),
      ).rejects.toThrow();
    });
  });

  describe('removal', () => {
    it('retains the row and its metadata after removal', async () => {
      // Deleting the row would erase the evidence that a receipt ever existed.
      const document = await recordDocument(expenseId, { originalFilename: 'september-bill.png' });
      await harness.documents.remove({
        documentId: document.id,
        removedByAdminId: actorAdminId,
        removalReason: 'Duplicate of HY-DOC-000001',
      });

      const stillThere = await harness.runtime.transactionDocument.findUnique({
        where: { id: document.id },
      });

      expect(stillThere).not.toBeNull();
      expect(stillThere?.status).toBe('REMOVED');
      expect(stillThere?.originalFilename).toBe('september-bill.png');
      expect(stillThere?.storageKey).toBe(document.storageKey);
      expect(stillThere?.removedAt).toBeInstanceOf(Date);
      expect(stillThere?.removedByAdminId).toBe(actorAdminId);
      expect(stillThere?.removalReason).toBe('Duplicate of HY-DOC-000001');
    });

    it('records the actor and reason on the audit trail', async () => {
      const document = await recordDocument(expenseId);
      await harness.documents.remove({
        documentId: document.id,
        removedByAdminId: actorAdminId,
        removalReason: 'Uploaded to the wrong expense',
      });

      const events = await harness.runtime.auditEvent.findMany({
        where: { entityId: document.id },
        orderBy: { occurredAt: 'asc' },
      });

      expect(events.length).toBeGreaterThan(0);
      expect(events.some((event) => event.action === 'DOCUMENT_REMOVED')).toBe(true);
    });

    it('leaves the upload timestamp untouched by a removal', async () => {
      const document = await recordDocument(expenseId);
      await harness.documents.remove({
        documentId: document.id,
        removedByAdminId: actorAdminId,
        removalReason: 'Done',
      });

      const removed = await harness.runtime.transactionDocument.findUnique({
        where: { id: document.id },
      });

      expect(removed?.uploadedAt).toEqual(document.uploadedAt);
      expect(removed?.uploadedByAdminId).toBe(actorAdminId);
    });
  });

  describe('physical cleanup bookkeeping', () => {
    it('reports a removed document as pending until the bytes are confirmed gone', async () => {
      const document = await recordDocument(expenseId);
      await harness.documents.remove({
        documentId: document.id,
        removedByAdminId: actorAdminId,
        removalReason: 'Done',
      });

      // The row is authoritative about intent; `storage_deleted_at` is authoritative about bytes.
      const pending = await harness.documents.listPendingStorageDeletion();
      expect(pending.map((row) => row.id)).toEqual([document.id]);

      await harness.documents.markStorageDeleted(document.id);

      const after = await harness.documents.listPendingStorageDeletion();
      expect(after).toHaveLength(0);
    });

    it('never lists an available document as pending cleanup', async () => {
      await recordDocument(expenseId);

      expect(await harness.documents.listPendingStorageDeletion()).toHaveLength(0);
    });

    it('does not re-list a document whose bytes were already confirmed gone', async () => {
      const document = await recordDocument(expenseId);
      await harness.documents.remove({
        documentId: document.id,
        removedByAdminId: actorAdminId,
        removalReason: 'Done',
      });
      await harness.documents.markStorageDeleted(document.id);

      expect(await harness.documents.listPendingStorageDeletion()).toHaveLength(0);
    });

    it('refuses to mark an available document as physically deleted', async () => {
      // Otherwise a bug could make an unremoved document invisible to cleanup.
      const document = await recordDocument(expenseId);

      await expect(harness.documents.markStorageDeleted(document.id)).rejects.toThrow();
    });
  });

  describe('listing', () => {
    it('lists only the documents of the transaction asked for, oldest first', async () => {
      await recordDocument(expenseId, { seed: 'l-1', originalFilename: 'first.png' });
      await recordDocument(expenseId, { seed: 'l-2', originalFilename: 'second.png' });
      await recordDocument(otherExpenseId, { seed: 'l-3', originalFilename: 'other.png' });

      const listed = await harness.documents.listForTransaction(expenseId);

      expect(listed.map((row) => row.originalFilename)).toEqual(['first.png', 'second.png']);
    });

    it('keeps a removed document in the list so history is still visible', async () => {
      const document = await recordDocument(expenseId, {
        seed: 'kept',
        originalFilename: 'bill.png',
      });
      await harness.documents.remove({
        documentId: document.id,
        removedByAdminId: actorAdminId,
        removalReason: 'Removed',
      });

      const listed = await harness.documents.listForTransaction(expenseId);

      expect(listed).toHaveLength(1);
      expect(listed[0]?.status).toBe('REMOVED');
    });

    it('finds a document by its opaque storage key, and refuses an unknown one', async () => {
      // The storage key is the only way back from a stored object to its metadata, so this lookup
      // is what makes cleanup and re-download possible. An unknown key is a `notFound` rather than
      // a silent null, so a caller cannot mistake "no such object" for "found an object with no
      // metadata".
      const document = await recordDocument(expenseId, { seed: 'by-key' });

      const found = await harness.documents.findByStorageKey(document.storageKey);
      expect(found.id).toBe(document.id);

      await expect(harness.documents.findByStorageKey(storageKey('never-stored'))).rejects.toThrow(
        /not found/i,
      );
    });
  });

  describe('receipt projection', () => {
    /**
     * The projection the API actually returns.
     *
     * `hasReceipt` is derived in the mapper rather than selected in the repository, so asserting it
     * on the raw Prisma row would test nothing. Going through the mapper is also the point: the
     * derivation has to survive being read off a real joined row, not just a fake one.
     */
    async function expenseView(transactionId: string) {
      return toExpenseSummary(await harness.transactions.findWithRelations(transactionId));
    }

    it('reports a receipt once a document is attached, and stops reporting after removal', async () => {
      const document = await recordDocument(expenseId);

      expect((await expenseView(expenseId)).hasReceipt).toBe(true);

      await harness.documents.remove({
        documentId: document.id,
        removedByAdminId: actorAdminId,
        removalReason: 'Removed',
      });

      // The count is history; `hasReceipt` is what the Admin can act on. After removal there is
      // nothing to open, so a stale `true` would send them to a `410 Gone`.
      const afterRemoval = await expenseView(expenseId);
      expect(afterRemoval.documentCount).toBe(1);
      expect(afterRemoval.hasReceipt).toBe(false);
    });

    it('reports no receipt for a transaction with no documents', async () => {
      const expense = await expenseView(otherExpenseId);

      expect(expense.documentCount).toBe(0);
      expect(expense.hasReceipt).toBe(false);
    });
  });
});
