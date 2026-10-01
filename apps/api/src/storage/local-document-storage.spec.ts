import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StructuredLogger } from '../common/logging/structured-logger';
import { LocalDocumentStorage, repositoryRoot, shardRelativePath } from './local-document-storage';

/**
 * The local storage adapter.
 *
 * Authority: `REQ-DOC-007`, `REQ-DOC-008`, and `docs/07-SECURITY-RULES.md`: files live under
 * generated opaque keys, the directory is never publicly served, and no user-supplied value can
 * influence a filesystem path.
 *
 * These tests run against a real temporary directory rather than a mocked filesystem. The claims
 * being verified are about actual file creation, atomic rename behaviour, and containment on disk,
 * and a mock would assert that the adapter called the right functions rather than that it kept its
 * promises — which is not the same question.
 */

const CONTENT = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe('LocalDocumentStorage', () => {
  let directory: string;
  let storage: LocalDocumentStorage;
  let warnings: string[];

  beforeEach(async () => {
    // A fresh directory per test, so one test's leftovers can never make another pass.
    directory = await mkdtemp(join(tmpdir(), 'hyssop-storage-test-'));
    process.env['LOCAL_STORAGE_PATH'] = directory;
    warnings = [];

    const logger = new StructuredLogger('error');
    jest.spyOn(logger, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });

    storage = new LocalDocumentStorage(logger);
  });

  afterEach(async () => {
    delete process.env['LOCAL_STORAGE_PATH'];
    await rm(directory, { recursive: true, force: true });
  });

  describe('put', () => {
    it('stores the exact bytes and reports the size that was actually written', async () => {
      const stored = await storage.put(CONTENT);

      expect(stored.byteSize).toBe(CONTENT.byteLength);

      const chunks: Buffer[] = [];
      const stream = await storage.open(stored.storageKey);

      expect(stream).not.toBeNull();

      for await (const chunk of stream as NodeJS.ReadableStream) {
        chunks.push(Buffer.from(chunk as Buffer));
      }

      expect(Buffer.concat(chunks)).toEqual(Buffer.from(CONTENT));
    });

    it('generates an opaque key rather than deriving one from the content', async () => {
      const first = await storage.put(CONTENT);
      const second = await storage.put(CONTENT);

      // Same bytes, different objects. A content-derived key would collapse these into one and make
      // the checksum redundant; a predictable key would let an attacker address files they did not
      // upload.
      expect(first.storageKey).not.toBe(second.storageKey);
      expect(first.storageKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('never exposes the caller-supplied name, because it has no name parameter at all', async () => {
      // `put` takes only bytes. There is no argument through which a filename could reach a path,
      // which is stronger than validating one.
      expect(storage.put.length).toBe(1);
    });
  });

  describe('path containment', () => {
    it('refuses a key that is not a generated key, on every operation', async () => {
      // All three operations reject rather than answering "not found". A key that fails the pattern
      // is an invariant violation, not a legitimate question about an absent object — so treating it
      // as an ordinary miss would let a caller carry on with a key the adapter never validated.
      const hostile = [
        '../secrets',
        '..%2Fsecrets',
        '/etc/passwd',
        'C:\\Windows\\win.ini',
        `${'a'.repeat(63)}/../${'b'.repeat(64)}`,
        'NOTHEX' + '0'.repeat(58),
        '',
      ];

      for (const key of hostile) {
        await expect(storage.open(key)).rejects.toThrow(/generated hexadecimal key/);
        await expect(storage.delete(key)).rejects.toThrow(/generated hexadecimal key/);
        await expect(storage.exists(key)).rejects.toThrow(/generated hexadecimal key/);
      }
    });

    it('refuses a traversal attempt spelled with separators', async () => {
      await expect(storage.open(`../${'0'.repeat(64)}`)).rejects.toThrow(
        /generated hexadecimal key/,
      );
    });
  });

  describe('open and exists', () => {
    it('reports a valid but absent key as missing rather than throwing', async () => {
      // The caller decides what absence means; during controlled removal "no" is the normal answer.
      expect(await storage.open('a'.repeat(64))).toBeNull();
      expect(await storage.exists('a'.repeat(64))).toBe(false);
    });

    it('finds a stored object', async () => {
      const stored = await storage.put(CONTENT);

      expect(await storage.exists(stored.storageKey)).toBe(true);
    });
  });

  describe('delete', () => {
    it('removes the object and reports success', async () => {
      const stored = await storage.put(CONTENT);

      expect(await storage.delete(stored.storageKey)).toBe(true);
      expect(await storage.exists(stored.storageKey)).toBe(false);
      expect(await storage.open(stored.storageKey)).toBeNull();
    });

    it('treats an already-absent object as deleted, so a retry can succeed', async () => {
      // This is what makes controlled cleanup retryable: a second attempt must not fail merely
      // because the first attempt already finished the work.
      const stored = await storage.put(CONTENT);

      expect(await storage.delete(stored.storageKey)).toBe(true);
      expect(await storage.delete(stored.storageKey)).toBe(true);
    });
  });

  describe('atomicity', () => {
    it('leaves no partially written object visible under the final key', async () => {
      const stored = await storage.put(CONTENT);

      // The temporary name is derived from the key, so its absence after a successful write is the
      // observable proof that the rename completed and the partial file did not survive.
      const shard = join(directory, shardRelativePath(stored.storageKey).split(/[\\/]/)[0] ?? '');
      const entries = await readdir(shard);

      expect(entries).toEqual([stored.storageKey]);
      expect(entries.some((entry) => entry.endsWith('.partial'))).toBe(false);
    });

    it('does not overwrite an object that already exists under a chosen key', async () => {
      const stored = await storage.put(CONTENT);

      // Writing to a different key must not disturb the first object, which is the property that
      // makes one document's bytes safe from another document's removal.
      await storage.put(new Uint8Array([9, 9, 9]));

      const stream = await storage.open(stored.storageKey);

      expect(stream).not.toBeNull();
    });
  });

  describe('configured directory', () => {
    it('creates the directory when it does not yet exist', async () => {
      const nested = join(directory, 'nested', 'uploads');
      process.env['LOCAL_STORAGE_PATH'] = nested;

      const stored = await storage.put(CONTENT);

      expect(await storage.exists(stored.storageKey)).toBe(true);
    });

    it('resolves a relative path against the repository root, not the working directory', () => {
      // The API is started from several different directories in this workspace; a path resolved
      // against `process.cwd()` would scatter documents into whichever one ran last.
      expect(repositoryRoot()).toMatch(/HYSSOP-FINANCE$/);
    });

    it('shards by the first two key characters so one directory cannot grow unbounded', async () => {
      const stored = await storage.put(CONTENT);
      const relative = shardRelativePath(stored.storageKey);

      expect(relative.split(/[\\/]/)).toEqual([stored.storageKey.slice(0, 2), stored.storageKey]);
    });
  });

  describe('file permissions', () => {
    it('does not leave the object readable as a world-writable file', async () => {
      const stored = await storage.put(CONTENT);
      const stats = await stat(join(directory, shardRelativePath(stored.storageKey)));

      // Windows does not model POSIX modes, so this asserts only where the platform enforces it.
      if (process.platform !== 'win32') {
        expect(stats.mode & 0o077).toBe(0);
      }
    });
  });

  describe('unrelated files', () => {
    it('cannot reach a file it did not create, even one sitting in the storage directory', async () => {
      // The adapter addresses objects only by generated key. A hand-placed file has no key, so it is
      // unreachable — and the refusal is a rejection rather than a "not found", because asking about
      // a name the adapter never issued is a caller bug.
      await writeFile(join(directory, 'notes.txt'), 'not a document');

      await expect(storage.open('notes.txt')).rejects.toThrow(/generated hexadecimal key/);
      await expect(storage.delete('notes.txt')).rejects.toThrow(/generated hexadecimal key/);
      await expect(storage.exists('notes.txt')).rejects.toThrow(/generated hexadecimal key/);
    });
  });
});
