import { HttpStatus } from '@nestjs/common';
import type { ApiErrorCode, ApiFieldIssue } from '@hyssop/contracts';
import { DOCUMENT_UPLOAD_FIELD } from '@hyssop/contracts';

/**
 * Multipart-parser failures, described as the documented error envelope.
 *
 * The parser rejects several conditions before any handler code runs — a body over the byte
 * limit, more files than the route accepts, or a malformed multipart envelope. Each arrives as a
 * plain `Error` carrying a `MulterError` code rather than as an `HttpException`, so the global
 * exception filter has to recognise them explicitly; otherwise every one of them is classified as
 * an unhandled `500`.
 *
 * That would be both wrong and unhelpful. An oversized upload is a client mistake the Admin can fix
 * by choosing a smaller file, and reporting it as a server fault would tell them to retry a request
 * that can never succeed. Each code therefore maps to a message that says what to change, and the
 * parser's own message is never reflected: it can echo part of the request, and
 * `docs/07-SECURITY-RULES.md` requires error responses to leak nothing internal.
 *
 * This lives beside the global filter rather than in a route-scoped filter because a route-scoped
 * `@Catch()` filter also intercepts exceptions thrown by guards — an unauthenticated or CSRF-less
 * upload would have been reported as a generic `400` instead of `401`/`403`.
 */
export interface MultipartErrorDescription {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly fields: readonly ApiFieldIssue[];
}

export function describeMultipartError(exception: unknown): MultipartErrorDescription | undefined {
  const code = multipartErrorCode(exception);

  if (code === undefined) {
    return undefined;
  }

  if (code === 'LIMIT_FILE_SIZE') {
    return {
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      code: 'REQUEST_FAILED',
      message: 'The selected file is larger than the allowed upload limit. Choose a smaller file.',
      fields: [
        { field: DOCUMENT_UPLOAD_FIELD, message: 'The file is larger than the upload limit.' },
      ],
    };
  }

  if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_FAILED',
      message: 'Attach one document at a time. Choose a single file and upload it again.',
      fields: [
        {
          field: DOCUMENT_UPLOAD_FIELD,
          message: 'Exactly one document may be attached per upload.',
        },
      ],
    };
  }

  return {
    status: HttpStatus.BAD_REQUEST,
    code: 'VALIDATION_FAILED',
    message: 'The upload could not be read. Choose the file again and try once more.',
    fields: [{ field: DOCUMENT_UPLOAD_FIELD, message: 'The upload could not be read.' }],
  };
}

/**
 * The parser's error code, or `undefined` when the value is not one of its errors.
 *
 * Read from the `code` property structurally rather than through `instanceof`, because the parser
 * runs inside `@nestjs/platform-express` and a duplicate copy of its error class in the dependency
 * tree would make an `instanceof` check fail for a genuine parser error.
 *
 * Membership in the known code set is required as well as the name: the global filter sees every
 * exception, and a filesystem error such as `EACCES` also carries a string `code`. Matching on a
 * string code alone would turn a genuine server fault into a `400` the Admin cannot act on.
 */
const MULTER_ERROR_CODES: ReadonlySet<string> = new Set([
  'LIMIT_PART_COUNT',
  'LIMIT_FILE_SIZE',
  'LIMIT_FILE_COUNT',
  'LIMIT_FIELD_KEY',
  'LIMIT_FIELD_VALUE',
  'LIMIT_FIELD_COUNT',
  'LIMIT_UNEXPECTED_FILE',
]);

function multipartErrorCode(exception: unknown): string | undefined {
  if (typeof exception !== 'object' || exception === null) {
    return undefined;
  }

  const candidate = exception as { code?: unknown };

  if (typeof candidate.code !== 'string' || !MULTER_ERROR_CODES.has(candidate.code)) {
    return undefined;
  }

  return candidate.code;
}
