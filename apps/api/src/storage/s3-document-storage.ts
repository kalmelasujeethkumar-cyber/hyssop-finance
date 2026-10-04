import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { getAppEnvironment } from '../config/environment';
import type { DocumentStorage, StoredDocumentObject } from './document-storage';

export class S3DocumentStorage implements DocumentStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: ConfigService) {
    const { storage } = getAppEnvironment(config);

    const endpoint = storage.s3Endpoint;
    const region = storage.s3Region || 'us-east-1';
    const accessKeyId = storage.s3AccessKeyId;
    const secretAccessKey = storage.s3SecretAccessKey;
    this.bucket = storage.s3Bucket || '';
    this.prefix = (process.env.STORAGE_S3_PREFIX || 'documents').replace(/^\/+|\/+$/g, '');

    if (!endpoint || !accessKeyId || !secretAccessKey || !this.bucket) {
      throw new Error(
        'S3 document storage requires STORAGE_S3_ENDPOINT, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY, and STORAGE_S3_BUCKET',
      );
    }

    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async put(content: Uint8Array): Promise<StoredDocumentObject> {
    const key = `${this.prefix}/${randomUUID()}-${randomBytes(24).toString('hex')}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
      }),
    );

    return { storageKey: key, byteSize: content.byteLength };
  }

  async open(storageKey: string): Promise<Readable | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
        }),
      );

      return result.Body ? (result.Body as Readable) : null;
    } catch (error: unknown) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  async delete(storageKey: string): Promise<boolean> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      }),
    );

    return true;
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
        }),
      );

      return true;
    } catch (error: unknown) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return false;
      throw error;
    }
  }
}
