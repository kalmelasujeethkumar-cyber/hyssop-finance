import { DOCUMENT_FILENAME_MAX_LENGTH } from '@hyssop/contracts';
import { ApiError } from '../common/errors/api-error';
import { HttpStatus } from '@nestjs/common';

/**
 * The original filename is metadata, never a path.
 *
 * Authority: `docs/07-SECURITY-RULES.md` requires storing files under generated opaque keys and
 * "never using an uploaded filename to build a path", and `docs/05-DATABASE-SPEC.md` says the
 * original filename "must never be used to construct a filesystem path".
 *
 * That rule is enforced structurally rather than by sanitising: no code in this project accepts a
 * filename where a path is expected, and the storage adapter generates every key itself. What this
 * module does is make the *retained* filename safe to store and to echo back:
 *
 * - Path separators and directory components are stripped, so `../../etc/passwd` is recorded as
 *   `passwd` and could not be replayed as a path by any future consumer.
 * - Control characters are removed, so a filename cannot corrupt a log line or a header.
 * - A Windows reserved device name is replaced, because a document the Admin can see listed but
 *   never save is a worse outcome than a slightly different name.
 * - Length is bounded to the `VARCHAR(255)` column, so an over-long name is a clear rejection
 *   rather than a database error surfaced as a `500`.
 */

/** Reserved on Windows, so a stored document could never be written out under that name. */
const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

/**
 * Control characters to strip from a filename.
 *
 * `no-control-regex` is disabled here on purpose: matching control characters *is* the intent.
 * Uploading `receipt\0.pdf` or a name containing a newline is a real case, and these classes are
 * exactly what must be removed before the name is stored or placed in a response header.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/**
 * The same class without the global flag.
 *
 * `.test` on a global regex is stateful — `lastIndex` carries between calls — so a shared global
 * pattern would make validation depend on whether a previous call happened to match. Testing uses
 * this non-global copy instead, which is why two patterns exist rather than one.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS_TEST = /[\u0000-\u001f\u007f]/;

/**
 * Reduces an uploaded filename to a safe, bounded, human-recognisable base name.
 *
 * Never throws and never returns an empty string: a file with no usable name is still a valid
 * upload, and the Admin must still be able to attach it. The fallback is deliberate — refusing the
 * upload would punish the Admin for something the browser did, and the filename is only ever a
 * label because the *detected* type is what the interface shows for the file's format.
 */
export function sanitiseOriginalFilename(raw: string): string {
  // `split` on both separators rather than `basename`, so a Windows-style path submitted from a
  // Linux-hosted client is reduced the same way as a POSIX-style one.
  const segments = raw.split(/[\\/]/);
  const lastSegment = segments[segments.length - 1] ?? '';
  const withoutControls = lastSegment.replace(CONTROL_CHARACTERS, '').trim();

  const withoutDangerous = withoutDangerousCharacters(withoutControls);

  if (withoutDangerous === '') {
    return FALLBACK_FILENAME;
  }

  if (WINDOWS_RESERVED_NAMES.has(withoutDangerous.split('.')[0]?.toLowerCase() ?? '')) {
    return `_${withoutDangerous}`;
  }

  return truncateFilename(withoutDangerous);
}

/**
 * Rejects a filename that cannot be stored as it stands.
 *
 * Distinct from sanitising because a path-shaped name is a signal, not a formatting problem. The
 * Admin's browser sends a bare filename, so a submitted value containing a separator means the
 * request was assembled by something other than a file picker — which is exactly the "no
 * client-side-only filename trust" the phase contract forbids. It is refused with a message that
 * says what to do rather than silently rewritten, so a correct upload never fails on this.
 */
export function assertUploadFilename(raw: string): void {
  const value = raw.trim();

  if (value === '') {
    throw new ApiError(
      'VALIDATION_FAILED',
      'The file has no name. Choose the file again and it will be attached with its name.',
      HttpStatus.BAD_REQUEST,
      { fields: [{ field: 'file', message: 'A named file is required.' }] },
    );
  }

  if (value.length > DOCUMENT_FILENAME_MAX_LENGTH) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `The file name must be ${DOCUMENT_FILENAME_MAX_LENGTH} characters or fewer.`,
      HttpStatus.BAD_REQUEST,
      { fields: [{ field: 'file', message: 'The file name is too long.' }] },
    );
  }

  if (CONTROL_CHARACTERS_TEST.test(value)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'The file name contains characters that cannot be stored.',
      HttpStatus.BAD_REQUEST,
      { fields: [{ field: 'file', message: 'The file name contains unsupported characters.' }] },
    );
  }

  if (/[\\/]/.test(value)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'The upload supplied a path instead of a file name. Choose the file again from your computer.',
      HttpStatus.BAD_REQUEST,
      { fields: [{ field: 'file', message: 'A file name, not a path, is required.' }] },
    );
  }
}

/**
 * The name recorded when a file arrived with nothing usable.
 *
 * Never rendered as the type. `toDocumentSummary` carries `detectedMimeType` separately and the
 * browser labels the document from that, so this string cannot make a file look like a different
 * format than its bytes.
 */
const FALLBACK_FILENAME = 'uploaded-document';

/**
 * Removes characters that would let a filename act as a directive or a separator elsewhere.
 *
 * Quotes, angle brackets, semicolons, and backslashes matter because the name is echoed into
 * `Content-Disposition` and shown in the interface; a name containing them could split a header or
 * inject markup. Replaced with an underscore rather than dropped so the name stays recognisable.
 */
function withoutDangerousCharacters(value: string): string {
  return value.replace(/[<>"';|]/g, '_');
}

/**
 * Truncates while keeping the extension.
 *
 * Cutting at the column limit would otherwise turn `averylongname.png` into a name with no
 * extension, and the Admin would lose the one clue that identifies the file. The extension is
 * preserved because it is part of recognition, never part of the type decision.
 */
function truncateFilename(value: string): string {
  if (value.length <= DOCUMENT_FILENAME_MAX_LENGTH) {
    return value;
  }

  const dotIndex = value.lastIndexOf('.');

  if (dotIndex <= 0 || value.length - dotIndex > 16) {
    return value.slice(0, DOCUMENT_FILENAME_MAX_LENGTH);
  }

  const extension = value.slice(dotIndex);
  const stem = value.slice(0, DOCUMENT_FILENAME_MAX_LENGTH - extension.length);

  return `${stem}${extension}`;
}
