import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  Version,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DOCUMENT_UPLOAD_FIELD, success, type DocumentSummary } from '@hyssop/contracts';
import type { Response } from 'express';
import { CurrentRequestId, CurrentSession } from '../auth/auth.decorators';
import type { AuthenticatedSession } from '../auth/session.service';
import { IDEMPOTENCY_KEY_HEADER, readIdempotencyKey } from '../common/http/idempotency';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { MAX_UPLOAD_MAX_BYTES } from '../config/environment';
import { DocumentIdParamDto, RemoveDocumentDto, TransactionIdParamDto } from './dto/document.dto';
import {
  contentDisposition,
  DocumentsService,
  type DocumentActor,
  type DocumentContent,
  type UploadedDocumentPart,
} from './documents.service';

/**
 * The document routes of `docs/06-API-SPEC.md`.
 *
 * Every route is protected by the global `SessionGuard`; there is no `@Public()` here, so no
 * document can become reachable without a session by accident, and no static middleware serves the
 * storage directory. `docs/07-SECURITY-RULES.md` requires documents to be reachable *only* through
 * an authenticated endpoint, and that is a property of this controller being the sole reader of the
 * storage adapter.
 *
 * The controller also never sees a filesystem path. It asks the service for a stream and sets
 * response headers, and the only paths it emits are the versioned relative URLs the metadata
 * projection returns.
 */
@Controller('documents')
export class DocumentsController {
  public constructor(private readonly documents: DocumentsService) {}

  /**
   * One document's metadata and its authenticated links.
   *
   * `docs/06-API-SPEC.md` describes this route as "authenticated metadata and download or preview
   * stream". Metadata comes back here and bytes come from the two explicit content routes, so a
   * client that only needs the filename never downloads a file — and a removed document's metadata
   * stays readable even though its content answers `410`.
   */
  @Get(':id')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async documentDetail(
    @Param() params: DocumentIdParamDto,
  ): Promise<{ data: DocumentSummary }> {
    return success(await this.documents.detail(params.id));
  }

  /**
   * The bytes, as a download.
   *
   * `Content-Type` is the *detected* type, never the declared one, so a `.pdf` that is really a PNG
   * is delivered as a PNG and the browser is never invited to parse image bytes as a document.
   * `Content-Disposition` is `attachment` with the extension derived from the detected type.
   */
  @Get(':id/download')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async downloadDocument(
    @Param() params: DocumentIdParamDto,
    @Res() response: Response,
  ): Promise<void> {
    const content = await this.documents.open(params.id, 'attachment');

    await streamDocument(response, content, 'attachment');
  }

  /**
   * The bytes, inline, for the formats that support it.
   *
   * `docs/06-API-SPEC.md` restricts this route to "supported formats". An unsupported format is
   * refused with `400` by the service rather than quietly served as an attachment here, because a
   * preview control that silently downloads the file is a control that lies about what it does.
   */
  @Get(':id/preview')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async previewDocument(
    @Param() params: DocumentIdParamDto,
    @Res() response: Response,
  ): Promise<void> {
    const content = await this.documents.open(params.id, 'inline');

    await streamDocument(response, content, 'inline');
  }

  /**
   * Controlled removal with a required reason.
   *
   * `REQ-DOC-006` requires the reason and the audit event; the service commits `REMOVED` before
   * touching storage, so content access is already revoked by the time this responds. The response
   * is the retained metadata rather than `204`, because the Admin needs to see that the removal
   * happened and whether the physical deletion is still pending.
   */
  @Delete(':id')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async removeDocument(
    @Param() params: DocumentIdParamDto,
    @Body() body: RemoveDocumentDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @CurrentSession() session: AuthenticatedSession,
    @CurrentRequestId() requestId: string | null,
  ): Promise<{ data: DocumentSummary }> {
    return success(
      await this.documents.remove(params.id, body.reason, actorOf(session, requestId), {
        key: readIdempotencyKey(idempotencyKey),
      }),
    );
  }
}

/**
 * The transaction-scoped document routes.
 *
 * `docs/06-API-SPEC.md` places these under `/transactions/:id/documents`, and they live in this
 * module because `docs/02-ARCHITECTURE.md` makes document association a reusable capability owned
 * by Phase 07: "Phases 05 and 06 may expose only the association interface". A separate controller
 * on the same base path keeps that ownership honest without adding a second document rule set.
 */
@Controller('transactions')
export class TransactionDocumentsController {
  public constructor(private readonly documents: DocumentsService) {}

  /**
   * Attaches one document to a transaction.
   *
   * Two size limits, deliberately. The parser's `fileSize` is the absolute ceiling
   * `MAX_UPLOAD_MAX_BYTES`, so an unbounded request can never be buffered regardless of
   * configuration; the *product* limit comes from `UPLOAD_MAX_BYTES` and is enforced by the service
   * against the validated configuration. The parser limit can only ever be looser than the product
   * limit, so a correctly configured larger allowance is never rejected by the parser.
   *
   * The ceiling is a constant rather than a configured read because decorator metadata is evaluated
   * when this file is imported, which is before `ConfigModule` has loaded `.env` into
   * `process.env`. Reading the environment here would silently fall back to the default on every
   * run configured through `.env`.
   *
   * `files: 1` matches the documented "one file per request" shape. A batch is refused by the
   * parser rather than partially accepted, because an Admin who sees a partial success will believe
   * every chosen file was attached.
   */
  @Post(':id/documents')
  @Version('1')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit('upload')
  @UseInterceptors(
    FileInterceptor(DOCUMENT_UPLOAD_FIELD, {
      limits: { files: 1, fileSize: MAX_UPLOAD_MAX_BYTES },
      // The parser strips any directory part from a filename by default, which would silently
      // rewrite `../../etc/passwd.png` into `passwd.png`. Keeping the path lets
      // `assertUploadFilename` see and refuse it, so a traversal attempt is a visible rejection
      // rather than an accepted upload with a quietly altered name.
      preservePath: true,
    }),
  )
  public async uploadDocument(
    @Param() params: TransactionIdParamDto,
    @UploadedFile() file: UploadedDocumentPart | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @CurrentSession() session: AuthenticatedSession,
    @CurrentRequestId() requestId: string | null,
  ): Promise<{ data: DocumentSummary }> {
    return success(
      await this.documents.upload(params.id, file ?? {}, actorOf(session, requestId), {
        key: readIdempotencyKey(idempotencyKey),
      }),
    );
  }

  /** The transaction's documents, oldest first, including records that were removed. */
  @Get(':id/documents')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async listDocuments(
    @Param() params: TransactionIdParamDto,
  ): Promise<{ data: readonly DocumentSummary[] }> {
    return success(await this.documents.listForTransaction(params.id));
  }
}

/**
 * Streams verified document bytes with headers a browser can act on.
 *
 * Written once so the download and preview routes cannot drift apart on `Content-Type`,
 * `Content-Length`, caching, or the security headers. The length is the stored byte size, which is
 * the size of the bytes that were actually written, so a truncated file cannot be reported with a
 * length the browser will wait forever for.
 *
 * `Cache-Control: no-store` is deliberate: a document is private church evidence, and a cached copy
 * in a shared or browser cache would outlive the session that was allowed to read it.
 * `X-Content-Type-Options: nosniff` stops a client re-interpreting bytes the server has already
 * verified, which is the one place an inline response could otherwise be second-guessed.
 */
async function streamDocument(
  response: Response,
  content: DocumentContent,
  disposition: 'inline' | 'attachment',
): Promise<void> {
  response.setHeader('Content-Type', content.detectedMimeType);
  response.setHeader('Content-Length', String(content.byteSize));
  response.setHeader('Content-Disposition', contentDisposition(content, disposition));
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  await new Promise<void>((resolve, reject) => {
    content.stream.on('error', reject);
    response.on('error', reject);
    response.on('finish', () => {
      resolve();
    });
    content.stream.pipe(response);
  });
}

/** The authenticated Admin and the request correlation ID, for audit attribution. */
function actorOf(session: AuthenticatedSession, requestId: string | null): DocumentActor {
  return { adminUserId: session.admin.id, requestId };
}
