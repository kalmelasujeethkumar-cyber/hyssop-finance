import { HttpStatus, type HttpException } from '@nestjs/common';
import type { ApiErrorCode } from '@hyssop/contracts';

const STATUS_TO_ERROR_CODE: Readonly<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'REQUEST_FAILED',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'REQUEST_FAILED',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_FAILED',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

const STATUS_TO_CLIENT_MESSAGE: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'The request could not be validated.',
  [HttpStatus.UNAUTHORIZED]: 'Authentication is required.',
  [HttpStatus.FORBIDDEN]: 'You do not have permission to perform this action.',
  [HttpStatus.NOT_FOUND]: 'The requested resource was not found.',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'This method is not allowed for the requested resource.',
  [HttpStatus.CONFLICT]: 'The request conflicts with the current state of the resource.',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'The request payload is too large.',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'The request could not be validated.',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests. Please try again later.',
};

export const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred. Please try again.';

/**
 * A message may only be reflected to the client when it is a single short line. The
 * patterns reject the shapes that would leak something: a stack frame, a filesystem
 * path, a SQL fragment, a URL, or a JSON/array dump. This is a second gate behind the
 * `ApiError` type check, not the primary one.
 */
const UNSAFE_MESSAGE_PATTERN =
  /[\n\r\t]|\bat\s+\w+\s*\(|node_modules|[A-Za-z]:[\\/]|SELECT\s|INSERT\s|UPDATE\s|DELETE\s|https?:\/\/|\{|\}/i;

export function isSafeClientMessage(message: unknown): message is string {
  return (
    typeof message === 'string' &&
    message.length > 0 &&
    message.length <= 200 &&
    !UNSAFE_MESSAGE_PATTERN.test(message)
  );
}

export function errorCodeForStatus(status: number): ApiErrorCode {
  return STATUS_TO_ERROR_CODE[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED');
}

/**
 * Client messages are fixed per status instead of reflecting exception text, so a
 * raw path, SQL fragment, or internal identifier can never be echoed to a browser.
 */
export function clientMessageForStatus(status: number): string {
  return STATUS_TO_CLIENT_MESSAGE[status] ?? 'The request could not be completed.';
}

/**
 * Describes any `HttpException` from its status alone. A framework exception such as
 * `NotFoundException` carries the requested path in its message, which is exactly the
 * kind of internal detail that must not be reflected, so the body is never inspected
 * here. Only the application's own `ApiError` may supply a code and a message.
 */
export function describeHttpException(exception: HttpException): {
  status: number;
  code: ApiErrorCode;
  message: string;
} {
  const status = exception.getStatus();

  return {
    status,
    code: errorCodeForStatus(status),
    message: status >= 500 ? INTERNAL_ERROR_MESSAGE : clientMessageForStatus(status),
  };
}
