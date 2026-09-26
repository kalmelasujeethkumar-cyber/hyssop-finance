import { Injectable } from '@nestjs/common';
import type { DocumentStatus, TransactionDocument } from '@prisma/client';
import { conflict, notFound, validationFailed } from '../../common/errors/domain.errors';
import { AuditEventRepository, AUDIT_ENTITY_TYPES } from '../audit/audit-event.repository';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceAllocatorService } from '../references/reference-allocator.service';

/**
 * Document formats accepted by the demo.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-DOC-001` to `REQ-DOC-013` and the
 * `transaction_document_detected_type_allowed` / `declared_type_allowed` CHECK
 * constraints. Phase 02 stores metadata only; the storage adapter, upload limit, and
 * content inspection belong to the document-storage phase.
 */
export const ALLOWED_DOCUMENT_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

export interface RecordDocumentMetadataInput {
  readonly transactionId: string;
  /** Opaque, server-generated storage key. Raw file bytes are never stored in PostgreSQL. */
  readonly storageKey: string;
  readonly originalFilename: string;
  readonly declaredMimeType: string;
  readonly detectedMimeType: string;
  readonly byteSize: number;
  readonly checksumSha256: string;
  readonly uploadedByAdminId: string;
}

export interface RemoveDocumentInput {
  readonly documentId: string;
  readonly removedByAdminId: string;
  readonly removalReason: string;
}

/**
 * Transaction document metadata persistence.
 *
 * Authority: `docs/05-DATABASE-SPEC.md`: after removal the metadata is retained,
 * content access is denied, and `storage_deleted_at` records successful physical
 * deletion. This repository therefore has no delete and no physical file handling.
 */
@Injectable()
export class TransactionDocumentRepository {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferenceAllocatorService,
    private readonly audit: AuditEventRepository,
  ) {}

  public async record(input: RecordDocumentMetadataInput): Promise<TransactionDocument> {
    assertAllowedMimeType(input.declaredMimeType, 'declaredMimeType');
    assertAllowedMimeType(input.detectedMimeType, 'detectedMimeType');
    assertChecksum(input.checksumSha256);

    if (!Number.isInteger(input.byteSize) || input.byteSize <= 0) {
      throw validationFailed('The document size must be a positive integer.', {
        field: 'byteSize',
      });
    }

    const storageKey = requireText(input.storageKey, 'storageKey', 255);
    const originalFilename = requireText(input.originalFilename, 'originalFilename', 255);

    return this.prisma.$transaction(async (tx) => {
      const referenceId = await this.references.allocate(tx, 'DOCUMENT');
      const document = await tx.transactionDocument.create({
        data: {
          referenceId,
          transactionId: input.transactionId,
          storageKey,
          originalFilename,
          declaredMimeType: input.declaredMimeType,
          detectedMimeType: input.detectedMimeType,
          byteSize: input.byteSize,
          checksumSha256: input.checksumSha256,
          uploadedByAdminId: input.uploadedByAdminId,
        },
      });

      await this.audit.record(tx, {
        action: 'DOCUMENT_UPLOADED',
        entityType: AUDIT_ENTITY_TYPES.transactionDocument,
        entityId: document.id,
        entityReference: document.referenceId,
        actorAdminId: input.uploadedByAdminId,
        after: {
          referenceId: document.referenceId,
          transactionId: document.transactionId,
          declaredMimeType: document.declaredMimeType,
          detectedMimeType: document.detectedMimeType,
          byteSize: document.byteSize,
        },
      });

      return document;
    });
  }

  public async findById(documentId: string): Promise<TransactionDocument> {
    const document = await this.prisma.transactionDocument.findUnique({
      where: { id: documentId },
    });

    if (document === null) {
      throw notFound('Document', documentId);
    }

    return document;
  }

  public async findByStorageKey(storageKey: string): Promise<TransactionDocument> {
    const document = await this.prisma.transactionDocument.findUnique({ where: { storageKey } });

    if (document === null) {
      throw notFound('Document', storageKey);
    }

    return document;
  }

  public async listForTransaction(transactionId: string): Promise<readonly TransactionDocument[]> {
    return this.prisma.transactionDocument.findMany({
      where: { transactionId },
      orderBy: { uploadedAt: 'asc' },
    });
  }

  /**
   * Marks a document `REMOVED` while retaining its metadata.
   *
   * `storageDeletedAt` is set only by the storage layer after it actually deletes the
   * file, so a failed deletion leaves an honest record instead of a false success.
   */
  public async remove(input: RemoveDocumentInput): Promise<TransactionDocument> {
    const removalReason = requireText(input.removalReason, 'removalReason', 2000);

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.transactionDocument.findUnique({ where: { id: input.documentId } });

      if (current === null) {
        throw notFound('Document', input.documentId);
      }

      if (current.status === 'REMOVED') {
        throw conflict('This document has already been removed.', { field: 'status' });
      }

      const updated = await tx.transactionDocument.update({
        where: { id: input.documentId },
        data: {
          status: 'REMOVED',
          removedAt: new Date(),
          removedByAdminId: input.removedByAdminId,
          removalReason,
        },
      });

      await this.audit.record(tx, {
        action: 'DOCUMENT_REMOVED',
        entityType: AUDIT_ENTITY_TYPES.transactionDocument,
        entityId: updated.id,
        entityReference: updated.referenceId,
        actorAdminId: input.removedByAdminId,
        reason: removalReason,
        before: { status: current.status },
        after: { status: updated.status },
      });

      return updated;
    });
  }

  /** Called by the storage adapter only after the file is actually gone. */
  public async markStorageDeleted(documentId: string): Promise<TransactionDocument> {
    const current = await this.findById(documentId);

    if (current.status !== ('REMOVED' satisfies DocumentStatus)) {
      throw conflict('A document can be marked deleted only after it is removed.', {
        field: 'status',
      });
    }

    return this.prisma.transactionDocument.update({
      where: { id: documentId },
      data: { storageDeletedAt: new Date() },
    });
  }
}

function assertAllowedMimeType(value: string, field: string): void {
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(value)) {
    throw validationFailed('The document type is not allowed.', { field });
  }
}

function assertChecksum(value: string): void {
  if (!CHECKSUM_PATTERN.test(value)) {
    throw validationFailed('The checksum must be 64 lowercase hexadecimal characters.', {
      field: 'checksumSha256',
    });
  }
}

function requireText(raw: string, field: string, maxLength: number): string {
  const value = raw.trim();

  if (value === '') {
    throw validationFailed(`A value is required for ${field}.`, { field });
  }

  if (value.length > maxLength) {
    throw validationFailed(`A value for ${field} must be ${maxLength} characters or fewer.`, {
      field,
    });
  }

  return value;
}
