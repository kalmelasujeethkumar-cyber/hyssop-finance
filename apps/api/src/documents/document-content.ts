import { createHash } from 'node:crypto';

/**
 * Content-signature validation for uploaded documents.
 *
 * Authority: `docs/07-SECURITY-RULES.md` "Document security" requires validating "the detected
 * type from file content, not only the browser-declared MIME type or filename extension", and
 * rejecting "unexpected file signatures". `docs/01-REQUIREMENTS.md` `REQ-DOC-002` fixes the
 * supported set to JPG, JPEG, PNG, WEBP, and PDF.
 *
 * Signatures are compared as byte sequences against real format markers rather than by trusting
 * any string the client sent. Two independent signals are then required to agree:
 *
 * 1. the detected type from the leading bytes, and
 * 2. the declared type from the multipart part.
 *
 * A file whose bytes are a PNG but whose part claims `application/pdf` is a spoof attempt, not a
 * browser quirk, so it is rejected. When the browser sends the common-but-wrong
 * `application/octet-stream` or an empty string — which real browsers do — the bytes are
 * authoritative and the upload succeeds, because refusing it would reject honest uploads on the
 * strength of a field the security rules say not to trust.
 */

/** The formats the demo accepts, as the exact strings persisted in PostgreSQL. */
export const ALLOWED_DOCUMENT_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type AllowedDocumentType = (typeof ALLOWED_DOCUMENT_TYPES)[number];

/** Only images are previewed inline; see `contentDispositionFor` in `document-storage.ts`. */
export const INLINE_PREVIEW_TYPES: readonly string[] = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

interface SignatureRule {
  readonly type: AllowedDocumentType;
  /** Bytes that must appear at the very start of the file. */
  readonly prefix: readonly number[];
  /** Bytes that must appear at a fixed offset after the prefix, when the format requires them. */
  readonly offset?: number;
  readonly offsetBytes?: readonly number[];
  /**
   * A byte value at {@link offset} that would make the match a spoof rather than a real file.
   *
   * Expressed as an exclusion because "must not equal" cannot be expressed as a prefix list. For
   * JPEG the fourth byte starts a marker and is never `00` or `FF`, so a file carrying only the
   * three-byte prefix fails here.
   */
  readonly forbiddenByteAtOffset?: number;
}

/**
 * Format markers.
 *
 * Deliberately narrow: a rule accepts only what is unambiguously one of the five allowed
 * formats. A format with no reliable fixed signature is not added with a guess, because a
 * permissive rule here would be exactly the "unexpected file signature" the security rules
 * require to be rejected.
 *
 * - JPEG starts `FF D8 FF` and the fourth byte is a marker, not `00` or `FF`. The stricter fourth
 *   byte check is what stops a file that merely begins with the JPEG start-of-image prefix from
 *   being accepted as a JPEG.
 * - PNG is the eight-byte signature plus the `IHDR` chunk type that must immediately follow, so
 *   a truncated or unrelated blob carrying only the signature is not accepted.
 * - WEBP requires the `RIFF` container, a declared length that covers the whole file, and the
 *   `WEBP` four-character code. The length check is the part that matters: it is what makes a
 *   renamed RIFF container of some other format fail rather than pass on a `WEBP` string found
 *   anywhere in the body.
 * - PDF requires `%PDF-` at offset 0. A PDF whose header is preceded by junk is refused rather
 *   than tolerated, because a permissive search would accept any file that merely mentions
 *   `%PDF-` in its body.
 */
const SIGNATURE_RULES: readonly SignatureRule[] = [
  { type: 'image/jpeg', prefix: [0xff, 0xd8, 0xff], offset: 3, forbiddenByteAtOffset: 0x00 },
  {
    type: 'image/png',
    prefix: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    offset: 12,
    offsetBytes: [0x49, 0x48, 0x44, 0x52],
  },
  { type: 'application/pdf', prefix: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

/** Declared types a browser may legitimately send for a real image or PDF. */
const NORMALISED_DECLARED_TYPES: Readonly<Record<string, AllowedDocumentType>> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpg',
  'image/pjpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/x-png': 'image/png',
  'image/webp': 'image/webp',
  'application/pdf': 'application/pdf',
  'application/x-pdf': 'application/pdf',
};

/**
 * Declared types that carry no information about the content.
 *
 * A browser chooses `application/octet-stream` when it does not recognise an extension, and some
 * send an empty string. Neither is evidence of a spoof attempt, and neither is trustworthy
 * either, so the bytes decide and the declared value is simply not compared.
 */
const NEUTRAL_DECLARED_TYPES: readonly string[] = [
  '',
  'application/octet-stream',
  'binary/octet-stream',
];

/** Enough leading bytes to evaluate every rule, including the WEBP length header. */
const INSPECTION_BYTES = 32;

export interface ContentInspection {
  /**
   * The type the upload declared, normalised and persisted as the schema requires.
   *
   * When the browser sent an uninformative type such as `application/octet-stream`, the detected
   * type is recorded instead, because the alternative would be metadata asserting a type that was
   * never verified. When the browser sent nothing at all, the database constraint
   * `transaction_document_declared_type_allowed` would reject the row outright, so this fallback
   * is also what keeps an honest upload from failing on a label the browser chose.
   */
  readonly declaredMimeType: AllowedDocumentType;
  /** The type read from the file's own bytes. This is the authoritative one. */
  readonly detectedMimeType: AllowedDocumentType;
  readonly byteSize: number;
  readonly checksumSha256: string;
}

/**
 * Describes what is wrong with an upload in terms the Admin can act on.
 *
 * The two failure modes are reported separately because they need different fixes: an
 * unsupported *format* needs a different file, while a type *mismatch* means the file is not what
 * its name or its upload dialog claimed, which is a security signal and is never something the
 * Admin can resolve by renaming.
 */
export type UploadRejectionReason = 'EMPTY' | 'UNSUPPORTED_FORMAT' | 'TYPE_MISMATCH' | 'TOO_LARGE';

export interface UploadRejection {
  readonly reason: UploadRejectionReason;
  /** Safe, single-line, Admin-facing. Never echoes the filename or the bytes. */
  readonly message: string;
}

export class UploadRejected extends Error {
  public constructor(public readonly rejection: UploadRejection) {
    super(rejection.message);
    this.name = 'UploadRejected';
  }
}

/**
 * Inspects uploaded bytes and returns the record the persistence layer will store.
 *
 * The order is the security-relevant part. Empty and oversized content are rejected before any
 * type decision, then the signature is read from the bytes, and only then is the declared type
 * compared. Deciding the type from the declared header first would mean an attacker chooses which
 * validation branch runs.
 */
export function inspectUpload(
  content: Uint8Array,
  declaredMimeType: string,
  maxBytes: number,
): ContentInspection {
  if (content.byteLength === 0) {
    throw new UploadRejected({
      reason: 'EMPTY',
      message: 'The selected file is empty. Choose a file that contains a receipt image or PDF.',
    });
  }

  if (content.byteLength > maxBytes) {
    throw new UploadRejected({
      reason: 'TOO_LARGE',
      message: `The selected file is larger than the ${describeBytes(maxBytes)} limit.`,
    });
  }

  const detectedMimeType = detectMimeType(content);

  // Nothing matched a supported signature. This is checked before the declared type is consulted,
  // because a declared type is only ever a *claim*: without a recognised signature there is no
  // verified type to record, and `docs/05-DATABASE-SPEC.md` requires `detected_mime_type` to be one
  // of the allowed formats. An unrecognised file is rejected even if it claims to be a PNG.
  if (detectedMimeType === null) {
    throw new UploadRejected({
      reason: 'UNSUPPORTED_FORMAT',
      message:
        'The file contents are not a JPG, PNG, WEBP, or PDF document. Choose a file in one of those formats.',
    });
  }

  const declared = NORMALISED_DECLARED_TYPES[declaredMimeType.trim().toLowerCase()];

  if (declared === undefined) {
    if (NEUTRAL_DECLARED_TYPES.includes(declaredMimeType.trim().toLowerCase())) {
      // Uninformative declared type: the bytes decide, and the declared value is not persisted
      // as if it had been verified.
      return buildInspection(detectedMimeType, content, declaredMimeType);
    }

    throw new UploadRejected({
      reason: 'UNSUPPORTED_FORMAT',
      message:
        'Only JPG, JPEG, PNG, WEBP, and PDF documents are supported. Choose a file in one of those formats.',
    });
  }

  if (!declaredTypesAgree(declared, detectedMimeType)) {
    throw new UploadRejected({
      reason: 'TYPE_MISMATCH',
      message:
        'The file contents do not match the format the upload declared, so it was rejected. Open the file and confirm it is a JPG, PNG, WEBP, or PDF, then try again.',
    });
  }

  return buildInspection(detectedMimeType, content, declared);
}

/**
 * Whether the declared type and the detected type describe the same format.
 *
 * Compared as formats rather than as strings, because `image/jpg` is not a real media type — it
 * is a widespread mistake, it is allowed in the stored set for that reason, and rejecting a real
 * JPEG because of a label the browser invented would punish an honest upload.
 */
export function declaredTypesAgree(
  declared: AllowedDocumentType,
  detected: AllowedDocumentType,
): boolean {
  if (declared === detected) {
    return true;
  }

  return normaliseFamily(declared) === normaliseFamily(detected);
}

function normaliseFamily(type: AllowedDocumentType): 'jpeg' | 'png' | 'webp' | 'pdf' {
  if (type === 'image/jpeg' || type === 'image/jpg') {
    return 'jpeg';
  }

  if (type === 'image/png') {
    return 'png';
  }

  if (type === 'image/webp') {
    return 'webp';
  }

  return 'pdf';
}

function buildInspection(
  detectedMimeType: AllowedDocumentType,
  content: Uint8Array,
  declaredMimeType: string,
): ContentInspection {
  const rawDeclared = declaredMimeType.trim().toLowerCase();
  const declared = NORMALISED_DECLARED_TYPES[rawDeclared];

  return {
    declaredMimeType: declared ?? detectedMimeType,
    detectedMimeType,
    byteSize: content.byteLength,
    checksumSha256: createHash('sha256').update(content).digest('hex'),
  };
}

/**
 * Detects the format from the leading bytes.
 *
 * Returns `null` when nothing matches, and the caller turns that into a rejection. WEBP is checked
 * separately because its rule depends on a declared length that has to be compared against the
 * actual file size, which is not a fixed-offset signature.
 */
export function detectMimeType(content: Uint8Array): AllowedDocumentType | null {
  const head = content.subarray(0, Math.min(content.byteLength, INSPECTION_BYTES));

  for (const rule of SIGNATURE_RULES) {
    if (matchesPrefix(head, rule.prefix) && matchesOffset(head, rule)) {
      return rule.type;
    }
  }

  return detectWebp(head, content.byteLength);
}

function matchesPrefix(head: Uint8Array, prefix: readonly number[]): boolean {
  if (head.byteLength < prefix.length) {
    return false;
  }

  return prefix.every((byte, index) => head[index] === byte);
}

/**
 * The extra check that keeps a "looks like it" prefix from being accepted as a real format.
 *
 * For JPEG this rejects the fourth byte being `00` or `FF`, neither of which starts a valid
 * marker; for PNG it requires the `IHDR` chunk name at offset 12. A file that only carries the
 * magic prefix — which a spoofed upload almost always does, because the prefix is the only part
 * an attacker needs to copy — fails here.
 */
function matchesOffset(head: Uint8Array, rule: SignatureRule): boolean {
  if (rule.offset === undefined) {
    return true;
  }

  if (rule.forbiddenByteAtOffset !== undefined) {
    return head[rule.offset] !== rule.forbiddenByteAtOffset;
  }

  if (rule.offsetBytes === undefined) {
    return true;
  }

  const end = rule.offset + rule.offsetBytes.length;

  if (head.byteLength < end) {
    return false;
  }

  return rule.offsetBytes.every((byte, index) => head[rule.offset! + index] === byte);
}

/**
 * The WEBP rule, which needs the file length.
 *
 * A RIFF container declares its payload length in bytes 4-7 as a little-endian unsigned 32-bit
 * value. Requiring `8 + declaredLength === totalBytes` rejects a renamed RIFF container of a
 * different format: such a file declares the length of the format it actually is, which will not
 * match its own size here, and it will not carry the `WEBP` code in bytes 8-11.
 */
function detectWebp(head: Uint8Array, totalBytes: number): AllowedDocumentType | null {
  if (
    !matchesPrefix(head, [0x52, 0x49, 0x46, 0x46]) ||
    !matchesPrefix(head.subarray(8, 12), [0x57, 0x45, 0x42, 0x50])
  ) {
    return null;
  }

  if (head.byteLength < 12) {
    return null;
  }

  const declaredLength = readUint32LittleEndian(head, 4);

  if (declaredLength === null) {
    return null;
  }

  return 8 + declaredLength === totalBytes ? 'image/webp' : null;
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number | null {
  if (bytes.byteLength < offset + 4) {
    return null;
  }

  return (
    (bytes[offset] ?? 0) +
    ((bytes[offset + 1] ?? 0) << 8) +
    ((bytes[offset + 2] ?? 0) << 16) +
    ((bytes[offset + 3] ?? 0) << 24)
  );
}

/**
 * A short, single-line byte size for a rejection message.
 *
 * Written rather than computed per call site so the Admin sees one consistent wording, and so the
 * message never contains a value that varies between requests and would be awkward to assert on.
 */
export function describeBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} bytes`;
}
