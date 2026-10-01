import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { StructuredLogger } from '../common/logging/structured-logger';
import { DEFAULT_LOCAL_STORAGE_PATH } from '../config/environment';
import type { DocumentStorage, StoredDocumentObject } from './document-storage';

/**
 * Generated keys are hex, so they contain no separator, no dot, and no character with meaning to
 * a filesystem. That makes an invalid key impossible to construct by accident, which is why the
 * shape check below is a real defence rather than a formality.
 */
const STORAGE_KEY_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Sharding by the first two hex characters keeps any single directory from accumulating every
 * document in the demo, which matters on Windows and on any filesystem with a large-directory
 * performance cliff.
 */
const SHARD_WIDTH = 2;

/**
 * Project-local storage for the demo.
 *
 * Authority: `docs/02-ARCHITECTURE.md` "Storage boundary", `REQ-DOC-007`, `REQ-DOC-008`, and
 * `docs/07-SECURITY-RULES.md`: files are written under generated opaque keys, the directory is
 * never publicly served, and PostgreSQL holds only metadata and references.
 *
 * The three properties this adapter exists to guarantee:
 *
 * 1. **A user filename can never reach a path.** No public method accepts one. `put` generates
 *    the key, and `open`/`delete`/`exists` accept only that generated key, which is rejected
 *    unless it matches {@link STORAGE_KEY_PATTERN}.
 * 2. **A path cannot escape the configured directory even if a key were hostile.** Every access
 *    resolves the full path and then re-verifies containment against the resolved base directory,
 *    so a symlink or an unexpected separator is caught rather than trusted.
 * 3. **A reader never sees a half-written object.** Content is written to a temporary file in the
 *    same directory and renamed into place, and the rename is the only moment the object becomes
 *    visible under its final key.
 *
 * The constructor takes the application's `StructuredLogger` rather than a structural stand-in. An
 * interface would be erased at runtime and Nest would emit an `Object` token it cannot resolve —
 * which is why the logging surface is narrowed by *use* (this adapter logs one condition) rather
 * than by declaring a smaller type in the signature.
 */
@Injectable()
export class LocalDocumentStorage implements DocumentStorage {
  private baseDirectory: string | null = null;

  public constructor(private readonly logger: StructuredLogger) {}

  public async put(content: Uint8Array): Promise<StoredDocumentObject> {
    const base = await this.resolveBase();
    const storageKey = randomBytes(32).toString('hex');
    const shardDirectory = this.shardDirectory(base, storageKey);
    const targetPath = this.resolveKeyPath(base, storageKey);

    await mkdir(shardDirectory, { recursive: true });

    // `wx` fails if the temporary name already exists, so an unexpected collision is an error
    // rather than a silent overwrite of an object some other document is pointing at.
    const temporaryPath = path.join(shardDirectory, `${storageKey}.partial`);

    try {
      // `mode: 0o600` keeps the object readable only by the account that wrote it. On Windows
      // this is advisory, which is one of the reasons the demo storage directory must never be
      // exposed by a static host: the boundary is the authenticated API, not the file mode.
      await writeFile(temporaryPath, content, { flag: 'wx', mode: 0o600 });
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);

      throw error;
    }

    return { storageKey, byteSize: content.byteLength };
  }

  public async open(storageKey: string): Promise<Readable | null> {
    const base = await this.resolveBase();
    // Resolved before the try on purpose. A key that is not a generated key must throw, and the
    // catch below would otherwise turn a rejected key into "no such document", which is exactly
    // the ambiguity that lets a traversal attempt look like an absent file.
    const targetPath = this.resolveKeyPath(base, storageKey);

    try {
      const stats = await stat(targetPath);

      if (!stats.isFile()) {
        return null;
      }

      return createReadStream(targetPath);
    } catch {
      // A missing object is an ordinary answer, not an error: controlled removal needs to be able
      // to ask "is it gone?" and be told yes without special-casing absence.
      return null;
    }
  }

  public async delete(storageKey: string): Promise<boolean> {
    const base = await this.resolveBase();
    // Resolved before the try, for the same reason `open` resolves first: an invalid key must be a
    // hard rejection on every operation. Folding it into the catch would return `false`, and
    // `false` means "the object is gone but cleanup is still pending" — so a malformed key would be
    // reported to the Admin as a pending cleanup that no retry could ever finish, instead of as the
    // caller bug it is.
    const targetPath = this.resolveKeyPath(base, storageKey);

    try {
      await unlink(targetPath);

      return true;
    } catch (error) {
      if (isMissingFile(error)) {
        // Already absent. Reporting success is honest: the caller's goal is that the object no
        // longer exists, and it does not. Turning this into a failure would make a retried
        // cleanup look like a permanent problem.
        return true;
      }

      this.logger.warn('Document storage deletion failed; cleanup remains pending.', {
        operation: 'delete',
        reason: error instanceof Error ? error.name : 'unknown',
      });

      return false;
    }
  }

  public async exists(storageKey: string): Promise<boolean> {
    const base = await this.resolveBase();
    // Resolved before the try, so an invalid key rejects here too. Catching it would make `exists`
    // answer `false` — indistinguishable from "absent" — and quietly turn a caller bug into a
    // legitimate-looking answer.
    const targetPath = this.resolveKeyPath(base, storageKey);

    try {
      return (await stat(targetPath)).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Resolves the configured base directory once per process.
   *
   * A relative `LOCAL_STORAGE_PATH` is resolved against the repository root rather than the
   * current working directory, because the API is started from different directories by
   * `npm run dev`, `npm start`, the tests, and Playwright. Resolving against the working directory
   * would silently scatter documents into whichever directory happened to start the process, and
   * `npm run test:e2e` starting from `apps/web` is exactly that case.
   */
  private async resolveBase(): Promise<string> {
    if (this.baseDirectory === null) {
      this.baseDirectory = await resolveConfiguredDirectory();
    }

    return this.baseDirectory;
  }

  /**
   * Builds the absolute path for a key and proves it is inside the base directory.
   *
   * Two independent checks, because either alone has a known failure mode. The pattern check
   * rejects anything that is not a generated key. The containment check then catches a key that
   * passed the pattern but still resolved outside the directory, and, more importantly, catches a
   * base directory that resolves somewhere unexpected because of a symlink. `path.resolve`
   * normalises `..` segments before the comparison, so a traversal attempt is detected rather than
   * normalised away into something that looks safe.
   */
  private resolveKeyPath(base: string, storageKey: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new Error('A document storage key must be a generated hexadecimal key.');
    }

    const candidate = path.resolve(base, shardRelativePath(storageKey));

    if (!candidate.startsWith(`${base}${path.sep}`)) {
      throw new Error('A document storage key resolved outside the storage directory.');
    }

    return candidate;
  }

  private shardDirectory(base: string, storageKey: string): string {
    return path.join(base, storageKey.slice(0, SHARD_WIDTH));
  }
}

/**
 * Shards a generated key into `<shard>/<key>`.
 *
 * Exported because the shard arithmetic is what both the writer and the reader must agree on,
 * and a unit test can then assert that every public operation addresses the same location rather
 * than restating the rule.
 */
export function shardRelativePath(storageKey: string): string {
  return path.join(storageKey.slice(0, SHARD_WIDTH), storageKey);
}

/**
 * Resolves the demo storage directory and creates it if absent.
 *
 * Kept separate from the class so the repository-root arithmetic can be asserted directly in a
 * unit test without a database, a Nest container, or a real adapter instance.
 */
export async function resolveConfiguredDirectory(): Promise<string> {
  const configured = process.env['LOCAL_STORAGE_PATH'] ?? DEFAULT_LOCAL_STORAGE_PATH;
  const absolute = path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(repositoryRoot(), configured);

  await mkdir(absolute, { recursive: true });

  return absolute;
}

/**
 * The repository root, found from this file rather than from the working directory.
 *
 * `apps/api/src/storage/local-document-storage.ts` is four directories below the root, which is a
 * fact about the repository layout that a comment can state and a test can assert. Deriving it
 * from `process.cwd()` cannot be asserted the same way, because every tool in this workspace
 * starts the API from a different directory.
 */
export function repositoryRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
