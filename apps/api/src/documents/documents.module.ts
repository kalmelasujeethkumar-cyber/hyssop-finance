import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DOCUMENT_STORAGE } from '../storage/document-storage';
import { LocalDocumentStorage } from '../storage/local-document-storage';
import { DocumentsController, TransactionDocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/**
 * Transaction documents: upload, listing, preview, download, and controlled removal.
 *
 * Authority: `docs/02-ARCHITECTURE.md` names a `Documents` module for "upload validation,
 * storage adapter, association, controlled access, download, and removal audit", and its
 * "Cross-phase dependency boundaries" section gives Phase 07 sole ownership of the reusable
 * `DocumentStorage` implementation, the upload/preview/download/removal flows, the validation, and
 * the document UI.
 *
 * Three module-boundary decisions are worth stating, because each is the kind that quietly rots:
 *
 * - **The storage adapter is provided here, not in a global infrastructure module.** Only the
 *   document subsystem can read or write document bytes. A later phase that needs the same adapter
 *   has to import this one, which is what makes "there is exactly one upload path" a structural
 *   fact rather than a convention that a reviewer has to re-check.
 * - **The interface token is bound, not the class.** `DocumentsService` injects
 *   `@Inject(DOCUMENT_STORAGE)`, so it depends on the contract. A production object-storage adapter
 *   replaces one `useExisting` below and no service, controller, or document rule changes — which is
 *   what makes `REQ-DOC-008` checkable rather than aspirational.
 * - **The service is exported but the repositories are not re-provided.** `DatabaseModule` already
 *   exports the document repository; re-exporting it here would create a second path to the same
 *   queries for any future consumer of this module.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [DocumentsController, TransactionDocumentsController],
  providers: [
    DocumentsService,
    LocalDocumentStorage,
    {
      provide: DOCUMENT_STORAGE,
      useExisting: LocalDocumentStorage,
    },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
