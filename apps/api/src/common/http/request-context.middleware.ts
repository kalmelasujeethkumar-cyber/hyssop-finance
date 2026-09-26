import { Injectable, type NestMiddleware } from '@nestjs/common';
import { REQUEST_ID_HEADER } from '@hyssop/contracts';
import type { NextFunction, Request, Response } from 'express';
import { StructuredLogger } from '../logging/structured-logger';
import { resolveRequestId } from './request-id';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

/**
 * Assigns the per-request ID and emits the access log line. The request path is
 * logged without its query string, and no headers, cookies, or bodies are logged.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  public constructor(private readonly logger: StructuredLogger) {}

  public use(request: Request, response: Response, next: NextFunction): void {
    const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER]);
    request.requestId = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);

    const startedAt = process.hrtime.bigint();

    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const level = response.statusCode >= 500 ? 'error' : 'info';

      this.logger.logRequest(
        level,
        'request completed',
        {
          method: request.method,
          path: request.path,
          status: response.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        },
        requestId,
      );
    });

    next();
  }
}
