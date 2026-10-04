import { ConfigService } from '@nestjs/config';
import { S3DocumentStorage } from './s3-document-storage';

/**
 * The S3 storage adapter.
 *
 * Authority: `REQ-DOC-008` and `docs/02-ARCHITECTURE.md` "Storage boundary": the adapter is
 * selected by configuration and reads only the validated `environment.storage` object produced by
 * `parseStorageEnvironment`. This suite exists because the first deployed build shipped an adapter
 * that read a top-level `storage` key, which `ConfigService` never returns — the validated object
 * lives under the `environment` namespace — so startup failed with a message blaming environment
 * variables that were in fact configured.
 */

const COMPLETE_S3 = {
  driver: 's3' as const,
  localStoragePath: './storage/uploads',
  uploadMaxBytes: 10 * 1024 * 1024,
  s3Endpoint: 'https://s3.example.test',
  s3Region: 'us-east-1',
  s3Bucket: 'hyssop-documents',
  s3AccessKeyId: 'access-key',
  s3SecretAccessKey: 'secret-key',
};

function configWith(storage: unknown): ConfigService {
  return new ConfigService({ environment: { storage } });
}

describe('S3DocumentStorage', () => {
  it('constructs from the validated environment.storage namespace', () => {
    expect(() => new S3DocumentStorage(configWith(COMPLETE_S3))).not.toThrow();
  });

  it('fails loudly when a required S3 setting is absent', () => {
    const incomplete = { ...COMPLETE_S3, s3Bucket: null };

    expect(() => new S3DocumentStorage(configWith(incomplete))).toThrow(
      /S3 document storage requires/,
    );
  });

  it('does not accept a top-level storage key, because the loader nests it under environment', () => {
    // Regression guard: the settings are only ever read from `environment.storage`, so a config
    // that carries a top-level `storage` key is rejected instead of silently used.
    const config = new ConfigService({ storage: COMPLETE_S3 });

    expect(() => new S3DocumentStorage(config)).toThrow(/environment/);
  });
});
