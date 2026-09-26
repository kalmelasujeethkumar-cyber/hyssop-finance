import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { ApiErrorBody } from '@hyssop/contracts';
import type { Request, Response } from 'express';
import { StructuredLogger } from '../logging/structured-logger';
import { describeHttpException, INTERNAL_ERROR_MESSAGE } from './error-descriptions';

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
      const { status, code, message } = describeHttpException(exception);

      this.logger.logRequest(
        status >= 500 ? 'error' : 'warn',
        'request rejected',
        { status, code, reason: exception.message },
        requestId,
      );

      this.send(response, status, { error: { code, message, requestId } });
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

  private send(response: Response, status: number, body: ApiErrorBody): void {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.status(status).json(body);
  }
}
