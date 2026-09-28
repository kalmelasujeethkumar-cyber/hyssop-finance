import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import { isApiErrorCode, type ApiErrorBody, type ApiFieldIssue } from '@hyssop/contracts';
import type { Request, Response } from 'express';
import { StructuredLogger } from '../logging/structured-logger';
import { ApiError } from './api-error';
import {
  describeHttpException,
  INTERNAL_ERROR_MESSAGE,
  isSafeClientMessage,
} from './error-descriptions';

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
