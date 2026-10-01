import type { Readable } from 'node:stream';

/**
 * The dependency-injection token for {@link DocumentStorage}.
 *
 * The interface itself cannot be a Nest token — TypeScript erases it at runtime — so it needs a
 * real value to bind against. A symbol is used rather than a string so the token cannot collide
 * with any other provider name by accident.
 *
 * Services inject `@Inject(DOCUMENT_STORAGE)` and therefore depend on the *contract*, not on the
 * local adapter. That is what makes `REQ-DOC-008` checkable: a production object-storage adapter
 * replaces one binding in the documents module, and no service, controller, or document rule
 * changes. Injecting `LocalDocumentStorage` directly would make the local adapter a de facto
 * contract, and swapping it later would mean editing every consumer.
 */
export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');

/**
 * The replaceable boundary between document metadata and document bytes.
 *
 * Authority: `docs/02-ARCHITECTURE.md` "Storage boundary" and `REQ-DOC-008`: PostgreSQL
 * holds metadata and references, raw bytes live only behind this interface, and a production
 * object-storage adapter may replace the local one without any change to financial or document
 * rules.
 *
 * The interface deliberately has four operations and no path-shaped escape hatch. Nothing here
 * accepts or returns a filesystem path, so no caller can build one, and no caller can address an
 * object that was not handed to it by {@link DocumentStorage.put}. `open` takes the *opaque
 * storage key* recorded in PostgreSQL rather than a filename, which is what keeps the storage
 * key the only route to content and keeps a user-supplied filename out of path construction.
 */
export interface DocumentStorage {
  /**
   * Writes bytes under a freshly generated opaque key and returns it.
   *
   * The caller never chooses the key. `put` generates it from cryptographic randomness, so two
   * uploads of the same file cannot collide and an attacker cannot predict where their own file
   * will land. `originalFilename` is accepted only to be recorded in metadata by the caller; the
   * adapter must not use it to build a path.
   *
   * The write is atomic: a reader must never observe a partially written object, and a failed
   * write must not leave a truncated file that looks readable.
   */
  put(content: Uint8Array): Promise<StoredDocumentObject>;

  /**
   * Opens the bytes for reading.
   *
   * Returns a stream rather than a buffer so a large document is not held in memory twice, and
   * so the HTTP layer can stream it. A missing object is an ordinary `null` result, not an
   * exception: the caller decides what a missing object means for its own state transition, and
   * during controlled removal the honest answer to "does the file still exist" is often "no".
   */
  open(storageKey: string): Promise<Readable | null>;

  /**
   * Physically deletes the bytes.
   *
   * Returns `true` when the object is gone afterwards and `false` when it could not be deleted.
   * A `false` result must never mean "still readable": the caller has already revoked access, and
   * a leftover object is a controlled-cleanup condition rather than an availability one.
   */
  delete(storageKey: string): Promise<boolean>;

  /** Reports whether bytes currently exist for a key, without opening them. */
  exists(storageKey: string): Promise<boolean>;
}

export interface StoredDocumentObject {
  /** The opaque, server-generated key. This is the only value that can address the object. */
  readonly storageKey: string;
  /** Number of bytes actually written, for an honest record rather than an assumed size. */
  readonly byteSize: number;
}

/**
 * Formats an allowed document type for a response.
 *
 * `docs/02-ARCHITECTURE.md` requires inline preview only "where supported" and safe
 * attachment behaviour otherwise. A PDF is rendered by the browser's built-in viewer, but an
 * arbitrary uploaded PDF can contain active content, so it is served as an attachment rather
 * than inline. Images are the only format previewed inline, and only after the bytes have been
 * verified to be that image type.
 */
export function contentDispositionFor(
  detectedMimeType: string,
  originalFilename: string,
  disposition: 'inline' | 'attachment',
): string {
  const fallback = `document${extensionFor(detectedMimeType)}`;
  const safeName = sanitiseForHeader(originalFilename) || fallback;

  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/**
 * The extension implied by the *detected* type.
 *
 * Not by the filename: a `.pdf` that is actually a PNG must be served with a `.png` name, or the
 * browser would be invited to parse image bytes as a document. This is the one place a filename
 * reaches a response header, and it is derived from verified content rather than user input.
 */
export function extensionFor(detectedMimeType: string): string {
  return EXTENSION_BY_TYPE[detectedMimeType] ?? '';
}

/**
 * Makes an original filename safe to place in a `Content-Disposition` header.
 *
 * The ASCII `filename` form is the sanitised base name so that an injected quote, comma,
 * semicolon, backslash, control character, or newline cannot terminate the parameter or split
 * the header into extra directives. `filename*` carries the readable UTF-8 name, which is safe
 * because it is percent-encoded.
 *
 * The result is never used to build a filesystem path; it exists so the Admin recognises their
 * own file after a download.
 */
export function sanitiseForHeader(originalFilename: string): string {
  const baseName = originalFilename.split(/[\\/]/).pop() ?? '';
  // `no-control-regex` is disabled deliberately: stripping control characters from a value that is
  // about to become a response header is the point of this function, and a newline or NUL arriving
  // here is precisely the injection this guards against.
  // eslint-disable-next-line no-control-regex
  const withoutControls = baseName.replace(/[\u0000-\u001f\u007f]/g, '');
  const withoutDangerous = withoutControls.replace(/["\\;,]/g, '_').trim();

  if (withoutDangerous === '' || withoutDangerous === '.' || withoutDangerous === '..') {
    return '';
  }

  return withoutDangerous.slice(0, 120);
}
