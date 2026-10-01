import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  isApiErrorCode,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiFieldIssue,
} from '@hyssop/contracts';
import type { Request, Response } from 'express';
import { StructuredLogger } from '../logging/structured-logger';
import { describeMultipartError } from './multipart-error';
import { ApiError } from './api-error';
import { DomainError, type DomainErrorKind } from './domain.errors';
import {
  describeHttpException,
  INTERNAL_ERROR_MESSAGE,
  isSafeClientMessage,
} from './error-descriptions';

/** How a `DomainError` kind becomes an HTTP status and a documented error code. */
const DOMAIN_STATUS_BY_KIND: Readonly<Record<DomainErrorKind, number>> = {
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  // A stale optimistic lock conflicts with the current state; it is not a server fault.
  STALE_REVISION: 409,
  CONSTRAINT_VIOLATION: 409,
};

const DOMAIN_CODE_BY_KIND: Readonly<Record<DomainErrorKind, ApiErrorCode>> = {
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CONFLICT: 'CONFLICT',
  STALE_REVISION: 'CONFLICT',
  CONSTRAINT_VIOLATION: 'CONFLICT',
};

/**
 * Converts every thrown value into the single error envelope defined by
 * `docs/06-API-SPEC.md`. Nothing internal, and no stack trace, is returned to a
 * client; the real cause is written to the structured log with the request ID.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  public constructor(private readonly logger: StructuredLogger) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = request.requestId ?? 'unknown';

    if (exception instanceof DomainError) {
      this.catchDomainError(exception, requestId, response);
      return;
    }

    if (exception instanceof HttpException) {
      const { status, code, message, fields, retryAfterSeconds } = this.describe(exception);

      this.logger.logRequest(
        status >= 500 ? 'error' : 'warn',
        'request rejected',
        { status, code, reason: exception.message },
        requestId,
      );

      if (retryAfterSeconds !== undefined) {
        response.setHeader('Retry-After', String(retryAfterSeconds));
      }

      this.send(response, status, {
        error: { code, message, requestId, ...(fields === undefined ? {} : { fields }) },
      });
      return;
    }

    const multipart = describeMultipartError(exception);

    if (multipart !== undefined) {
      this.logger.logRequest(
        'warn',
        'request rejected',
        { status: multipart.status, code: multipart.code, reason: 'multipart parse failure' },
        requestId,
      );

      this.send(response, multipart.status, {
        error: {
          code: multipart.code,
          message: multipart.message,
          requestId,
          fields: multipart.fields,
        },
      });
      return;
    }

    this.logger.logRequest(
      'error',
      'unhandled exception',
      {
        status: 500,
        reason: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? (exception.stack ?? null) : null,
      },
      requestId,
    );

    this.send(response, 500, {
      error: { code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE, requestId },
    });
  }

  /**
   * Maps a persistence-layer `DomainError` onto the documented envelope.
   *
   * Authority: `docs/06-API-SPEC.md` requires a `404` for a missing resource, field-level
   * validation errors, and a `409` for a conflict. Phase 02 kept `DomainError`
   * transport-agnostic because no route exposed it; Phase 04 is the first phase whose
   * routes do, so the translation is centralized here rather than repeated per controller.
   *
   * Only `details.field` survives. A `DomainError` may also carry an internal identifier
   * such as the requested UUID, and that is logged rather than returned, so a client can
   * never learn an internal value from a rejection.
   */
  private catchDomainError(error: DomainError, requestId: string, response: Response): void {
    const status = DOMAIN_STATUS_BY_KIND[error.kind] ?? HttpStatus.BAD_REQUEST;
    const code = DOMAIN_CODE_BY_KIND[error.kind] ?? 'REQUEST_FAILED';
    const field = error.details['field'];
    const fields: readonly ApiFieldIssue[] | undefined =
      typeof field === 'string' && field.length > 0
        ? [{ field, message: error.message }]
        : undefined;

    this.logger.logRequest(
      status >= 500 ? 'error' : 'warn',
      'request rejected',
      { status, code, reason: error.message, kind: error.kind },
      requestId,
    );

    this.send(response, status, {
      error: {
        code,
        message: error.message,
        requestId,
        ...(fields === undefined ? {} : { fields }),
      },
    });
  }

  /**
   * Only the application's own `ApiError` may choose the client-facing code and
   * message, and only when both are safe. Any other `HttpException` — including every
   * framework exception, whose message can contain the requested path — falls back to
   * the fixed per-status description.
   */
  private describe(exception: HttpException): {
    status: number;
    code: ReturnType<typeof describeHttpException>['code'];
    message: string;
    fields?: readonly ApiFieldIssue[];
    retryAfterSeconds?: number;
  } {
    const fallback = describeHttpException(exception);

    if (!(exception instanceof ApiError)) {
      return fallback;
    }

    const body: unknown = exception.getResponse();
    const message =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)['message']
        : undefined;

    return {
      status: fallback.status,
      code: isApiErrorCode(exception.code) ? exception.code : fallback.code,
      message: isSafeClientMessage(message) ? message : fallback.message,
      ...(exception.fields === undefined ? {} : { fields: exception.fields }),
      ...(exception.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: exception.retryAfterSeconds }),
    };
  }

  private send(response: Response, status: number, body: ApiErrorBody): void {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.status(status).json(body);
  }
}
