import { createHash, randomUUID } from 'node:crypto';
import type { DocumentStatus, TransactionDocument } from '@prisma/client';
import type {
  RecordDocumentMetadataInput,
  RemoveDocumentInput,
} from '../../src/database/documents/transaction-document.repository';
import { notFound } from '../../src/common/errors/domain.errors';
import type { DocumentStorage, StoredDocumentObject } from '../../src/storage/document-storage';
import { Readable } from 'node:stream';

/**
 * In-memory document doubles for the HTTP contract suite.
 *
 * These live in their own file rather than in `fake-ledger.ts` because documents are the only
 * subsystem with real byte handling, and the doubles have to model that faithfully: the storage fake
 * holds actual `Buffer` contents, and the repository fake enforces the same reference format,
 * uniqueness, and state-transition rules the real one does.
 *
 * A suite that stubbed the storage adapter's bytes away would prove nothing about whether the
 * served `Content-Type` matches what was uploaded — which is the security property most worth
 * testing here.
 */

/** An opaque key of the same shape the local adapter generates. */
function generatedKey(seed: number): string {
  return createHash('sha256').update(`document-${seed}`).digest('hex');
}

export class FakeDocumentStorage implements DocumentStorage {
  /** Key to bytes. Public so a test can corrupt or inspect what was actually persisted. */
  public readonly objects = new Map<string, Buffer>();

  /** Set to make the next deletion report failure, proving cleanup-pending behaviour. */
  public failNextDelete = false;

  private counter = 0;

  public async put(content: Uint8Array): Promise<StoredDocumentObject> {
    this.counter += 1;
    const storageKey = generatedKey(this.counter);
    this.objects.set(storageKey, Buffer.from(content));

    return { storageKey, byteSize: content.byteLength };
  }

  public async open(storageKey: string): Promise<Readable | null> {
    const bytes = this.objects.get(storageKey);

    return bytes === undefined ? null : Readable.from([bytes]);
  }

  public async delete(storageKey: string): Promise<boolean> {
    if (this.failNextDelete) {
      this.failNextDelete = false;

      return false;
    }

    // An already-absent object is reported as deleted, matching the real adapter.
    this.objects.delete(storageKey);

    return true;
  }

  public async exists(storageKey: string): Promise<boolean> {
    return this.objects.has(storageKey);
  }
}

/**
 * The slice of the ledger this double needs in order to keep a transaction's stored
 * `documentCount` truthful. Accepting it keeps the transaction projection observable from the
 * document suite without the two doubles being otherwise coupled.
 */
export interface FakeLedgerDocumentCounts {
  row(id: string): { documentCount: number } | undefined;
}

export class FakeDocuments {
  public readonly rows = new Map<string, TransactionDocument>();

  /** Every removal audit recorded, so a test can assert the audit actually happened. */
  public readonly removals: string[] = [];

  /** Every upload audit recorded. */
  public readonly uploads: string[] = [];

  private counter = 0;

  public constructor(private readonly ledger?: FakeLedgerDocumentCounts) {}

  private nextReference(): string {
    this.counter += 1;

    // The documented `HY-DOC-000001` shape, allocated the same way the real allocator does.
    return `HY-DOC-${String(this.counter).padStart(6, '0')}`;
  }

  private row(
    id: string,
    input: RecordDocumentMetadataInput,
    status: DocumentStatus = 'AVAILABLE',
  ): TransactionDocument {
    const now = new Date();

    return {
      id,
      referenceId: this.nextReference(),
      transactionId: input.transactionId,
      storageKey: input.storageKey,
      originalFilename: input.originalFilename,
      declaredMimeType: input.declaredMimeType,
      detectedMimeType: input.detectedMimeType,
      byteSize: input.byteSize,
      checksumSha256: input.checksumSha256,
      status,
      storageDeletedAt: null,
      uploadedByAdminId: input.uploadedByAdminId,
      uploadedAt: now,
      removedAt: null,
      removedByAdminId: null,
      removalReason: null,
    };
  }

  public async record(input: RecordDocumentMetadataInput): Promise<TransactionDocument> {
    const record = this.row(randomUUID(), input);
    this.rows.set(record.id, record);
    this.uploads.push(record.id);

    // Keep the transaction projection truthful: an attached document must show up as a receipt.
    const transaction = this.ledger?.row(input.transactionId);

    if (transaction !== undefined) {
      transaction.documentCount += 1;
    }

    return record;
  }

  public async findById(documentId: string): Promise<TransactionDocument> {
    const found = this.rows.get(documentId);

    if (found === undefined) {
      // The documented domain error, not a bare `Error`: an unknown document has to reach the browser
      // as the same `404` envelope the real repository produces, or this suite would be asserting
      // against a different contract than production.
      throw notFound('Document', documentId);
    }

    return found;
  }

  public async findByStorageKey(storageKey: string): Promise<TransactionDocument> {
    // Throws rather than returning null, matching the real repository: "no such object" must not
    // be silently indistinguishable from "found, but no metadata".
    const found = [...this.rows.values()].find((row) => row.storageKey === storageKey);

    if (found === undefined) {
      throw notFound('Document', storageKey);
    }

    return found;
  }

  public async listForTransaction(transactionId: string): Promise<readonly TransactionDocument[]> {
    return [...this.rows.values()].filter((row) => row.transactionId === transactionId);
  }

  public async remove(input: RemoveDocumentInput): Promise<TransactionDocument> {
    const current = this.rows.get(input.documentId);

    if (current === undefined) {
      throw notFound('Document', input.documentId);
    }

    const removed: TransactionDocument = {
      ...current,
      status: 'REMOVED',
      removedAt: new Date(),
      removedByAdminId: input.removedByAdminId,
      removalReason: input.removalReason,
    };

    this.rows.set(removed.id, removed);
    this.removals.push(removed.id);

    return removed;
  }

  public async markStorageDeleted(documentId: string): Promise<TransactionDocument> {
    const current = this.rows.get(documentId);

    if (current === undefined || current.status !== 'REMOVED') {
      throw new Error(`Cannot mark ${documentId} deleted`);
    }

    const updated: TransactionDocument = { ...current, storageDeletedAt: new Date() };
    this.rows.set(documentId, updated);

    return updated;
  }

  public async listPendingStorageDeletion(): Promise<readonly TransactionDocument[]> {
    return [...this.rows.values()].filter(
      (row) => row.status === 'REMOVED' && row.storageDeletedAt === null,
    );
  }
}
