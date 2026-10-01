import { inspectUpload, detectMimeType, UploadRejected } from './document-content';

/**
 * Content validation for uploads.
 *
 * Authority: `REQ-DOC-002` (supported formats), `REQ-DOC-004` (server-side size and type
 * validation), and `docs/07-SECURITY-RULES.md` ("a declared MIME type alone must never be trusted
 * — inspect the bytes").
 *
 * The tests here are built from real file signatures rather than from mock detections, because the
 * whole security claim is that the bytes decide. A suite that stubbed `detectMimeType` would pass
 * even if the signature table were empty, which is the defect most worth guarding against.
 */

const MAX_BYTES = 1024;

/**
 * A minimal byte sequence that starts with `signature`, padded so the file has a plausible size.
 *
 * Padded with zero bytes deliberately: a validator that only inspected the first few bytes would
 * accept a truncated or mostly-empty file, and these fixtures make that failure visible.
 */
function fileStartingWith(signature: readonly number[], totalBytes = 64): Uint8Array {
  const bytes = new Uint8Array(totalBytes);
  bytes.set(signature, 0);

  return bytes;
}

/** A structurally valid 1x1 PNG: signature, IHDR chunk, then filler. */
function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(64);

  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR chunk length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  bytes.set([0x49, 0x49, 0x44, 0x41], 24); // "IIDA" payload marker

  return bytes;
}

/** A structurally valid JPEG: SOI, APP0/JFIF, then filler. */
function jpegBytes(): Uint8Array {
  const bytes = new Uint8Array(64);

  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  bytes.set([0x00, 0x10], 4); // APP0 segment length
  bytes.set([0x4a, 0x46, 0x49, 0x46, 0x00], 6); // "JFIF\0"

  return bytes;
}

/**
 * A WEBP container whose RIFF length is consistent with the real file size.
 *
 * WEBP has no fixed-length signature — its chunk layout is variable — so the validator must also
 * compare the declared RIFF length against the actual byte count. These tests assert that it does.
 */
function webpBytes(totalBytes = 64): Uint8Array {
  const bytes = new Uint8Array(totalBytes);

  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  new DataView(bytes.buffer).setUint32(4, totalBytes - 8, true); // little-endian RIFF length
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"

  return bytes;
}

/** A minimal PDF header, which is a plain-text prefix rather than a binary signature. */
function pdfBytes(totalBytes = 64): Uint8Array {
  const bytes = new Uint8Array(totalBytes);

  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0); // "%PDF-"

  return bytes;
}

describe('detectMimeType', () => {
  it('recognises every format REQ-DOC-002 requires', () => {
    expect(detectMimeType(jpegBytes())).toBe('image/jpeg');
    expect(detectMimeType(pngBytes())).toBe('image/png');
    expect(detectMimeType(webpBytes())).toBe('image/webp');
    expect(detectMimeType(pdfBytes())).toBe('application/pdf');
  });

  it('returns null for content that is none of the supported formats', () => {
    // A ZIP header: a real format, but not one this application accepts.
    expect(detectMimeType(fileStartingWith([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(detectMimeType(fileStartingWith([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(detectMimeType(new Uint8Array(64))).toBeNull();
  });

  it('refuses a WEBP whose declared RIFF length contradicts the real file size', () => {
    // Same "RIFF....WEBP" text, but claiming a 4 GiB payload. Accepting this would let any file
    // that happens to start with those letters pass as a verified WEBP.
    const bytes = webpBytes(64);
    new DataView(bytes.buffer).setUint32(4, 0xfffffff0, true);

    expect(detectMimeType(bytes)).toBeNull();
  });

  it('refuses a JPEG whose SOI is followed by a byte that cannot appear there', () => {
    // FF D8 FF is required; a NUL in the fourth byte is not a valid marker continuation.
    const bytes = jpegBytes();
    bytes[3] = 0x00;

    expect(detectMimeType(bytes)).toBeNull();
  });

  it('refuses content too short to carry any signature', () => {
    expect(detectMimeType(new Uint8Array(0))).toBeNull();
    expect(detectMimeType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(detectMimeType(new Uint8Array([0x25, 0x50, 0x44]))).toBeNull();
  });
});

describe('inspectUpload', () => {
  it('records the verified type, the exact size, and a checksum for an honest upload', () => {
    const content = pngBytes();

    const inspection = inspectUpload(content, 'image/png', MAX_BYTES);

    expect(inspection.detectedMimeType).toBe('image/png');
    expect(inspection.declaredMimeType).toBe('image/png');
    expect(inspection.byteSize).toBe(64);
    // A real SHA-256 hex digest, so the stored checksum is verifiable later.
    expect(inspection.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same checksum for the same bytes, and a different one otherwise', () => {
    const first = inspectUpload(pngBytes(), 'image/png', MAX_BYTES);
    const identical = inspectUpload(pngBytes(), 'image/png', MAX_BYTES);
    const different = inspectUpload(jpegBytes(), 'image/jpeg', MAX_BYTES);

    expect(identical.checksumSha256).toBe(first.checksumSha256);
    expect(different.checksumSha256).not.toBe(first.checksumSha256);
  });

  it('rejects an empty upload', () => {
    expect(() => inspectUpload(new Uint8Array(0), 'image/png', MAX_BYTES)).toThrow(UploadRejected);

    try {
      inspectUpload(new Uint8Array(0), 'image/png', MAX_BYTES);
    } catch (error) {
      expect((error as UploadRejected).rejection.reason).toBe('EMPTY');
    }
  });

  it('rejects an upload over the configured limit, and accepts one exactly at it', () => {
    const content = pngBytes();
    const exactLimit = inspectUpload(content, 'image/png', content.byteLength);

    expect(exactLimit.byteSize).toBe(content.byteLength);
    expect(() => inspectUpload(content, 'image/png', content.byteLength - 1)).toThrow(
      UploadRejected,
    );
  });

  it('rejects a file whose declared type contradicts its bytes', () => {
    // The most security-relevant case in this file: a PNG renamed to .pdf and declared as one.
    // Trusting the declaration would let arbitrary bytes be served back with a PDF content type.
    try {
      inspectUpload(pngBytes(), 'application/pdf', MAX_BYTES);
      throw new Error('expected the mismatched upload to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(UploadRejected);
      expect((error as UploadRejected).rejection.reason).toBe('TYPE_MISMATCH');
    }
  });

  it('rejects a file whose bytes are not a supported format at all', () => {
    // The bytes decide first: there is no verified type to record, so a confident declaration
    // cannot rescue it.
    try {
      inspectUpload(fileStartingWith([0x50, 0x4b, 0x03, 0x04]), 'image/png', MAX_BYTES);
      throw new Error('expected the unrecognised upload to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(UploadRejected);
      expect((error as UploadRejected).rejection.reason).toBe('UNSUPPORTED_FORMAT');
    }
  });

  it('rejects a declared type outside the supported set', () => {
    try {
      inspectUpload(pngBytes(), 'application/x-msdownload', MAX_BYTES);
      throw new Error('expected the unsupported declared type to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(UploadRejected);
      expect((error as UploadRejected).rejection.reason).toBe('UNSUPPORTED_FORMAT');
    }
  });

  it('accepts the widespread image/jpg label for a real JPEG', () => {
    // `image/jpg` is not a real media type, but it is what browsers and tools emit in practice.
    // Rejecting an honest JPEG over that label would punish a correct upload.
    expect(inspectUpload(jpegBytes(), 'image/jpg', MAX_BYTES).detectedMimeType).toBe('image/jpeg');
    expect(inspectUpload(jpegBytes(), 'image/pjpeg', MAX_BYTES).detectedMimeType).toBe(
      'image/jpeg',
    );
  });

  it('falls back to the verified type when the declaration carries no information', () => {
    // Some clients send `application/octet-stream`. That is not a lie to punish, it is an absence
    // of information — the bytes decide and the detected type is what gets recorded.
    const neutral = inspectUpload(pngBytes(), 'application/octet-stream', MAX_BYTES);

    expect(neutral.detectedMimeType).toBe('image/png');
    expect(neutral.declaredMimeType).toBe('image/png');
    expect(inspectUpload(pngBytes(), '', MAX_BYTES).detectedMimeType).toBe('image/png');
  });

  it('agrees on case and surrounding whitespace in the declaration', () => {
    expect(inspectUpload(pngBytes(), 'IMAGE/PNG', MAX_BYTES).detectedMimeType).toBe('image/png');
    expect(inspectUpload(pngBytes(), ' image/png ', MAX_BYTES).detectedMimeType).toBe('image/png');
  });
});
