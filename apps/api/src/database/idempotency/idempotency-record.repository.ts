import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type IdempotencyRecord } from '@prisma/client';
import { conflict, validationFailed } from '../../common/errors/domain.errors';
import { PrismaService } from '../prisma/prisma.service';

/** Demo retention for stored responses. */
export const IDEMPOTENCY_RETENTION_DAYS = 30;

export interface IdempotentCommandInput {
  readonly adminUserId: string;
  readonly endpoint: string;
  readonly idempotencyKey: string;
  readonly request: unknown;
}

export interface StoredIdempotentResponse<TBody = unknown> {
  readonly responseStatus: number;
  readonly responseBody: TBody;
}

/** Stable SHA-256 hash of a request body, used to detect key reuse with a different payload. */
export function hashRequest(request: unknown): string {
  return createHash('sha256').update(stableStringify(request)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

/**
 * Safe retry records for create and mutation commands.
 *
 * Authority: `docs/05-DATABASE-SPEC.md`: the unique key
 * `(admin_user_id, endpoint, idempotency_key)` serializes concurrent identical
 * requests, a repeat with a different request hash is rejected, records are retained
 * for 30 days, and an expired key is rejected as expired rather than silently creating
 * a new financial operation.
 *
 * The record is written inside the same transaction as the command it protects. That
 * is what makes a retry safe: if the command fails, the record rolls back with it and
 * the caller may retry, and if a concurrent duplicate loses the unique-constraint race,
 * its whole transaction — including the financial write — is discarded. No placeholder
 * row and no half-completed state is ever visible.
 */
@Injectable()
export class IdempotencyRecordRepository {
  public constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `command` at most once for the given key.
   *
   * Returns `replayed: true` with the stored response when an identical request already
   * succeeded, and `replayed: false` with the fresh response when this call was the one
   * that executed the command.
   */
  public async runOnce<TBody>(
    input: IdempotentCommandInput,
    command: (tx: Prisma.TransactionClient) => Promise<StoredIdempotentResponse<TBody>>,
  ): Promise<{
    readonly replayed: boolean;
    readonly responseStatus: number;
    readonly responseBody: TBody;
  }> {
    const endpoint = requireText(input.endpoint, 'endpoint', 255);
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey', 255);
    const requestHash = hashRequest(input.request);
    const lookup = { adminUserId: input.adminUserId, endpoint, idempotencyKey };

    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { adminUserId_endpoint_idempotencyKey: lookup },
    });

    if (existing !== null) {
      return this.replay(existing, requestHash);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const response = await command(tx);

        if (
          !Number.isInteger(response.responseStatus) ||
          response.responseStatus < 100 ||
          response.responseStatus > 599
        ) {
          throw validationFailed('A stored response status must be a valid HTTP status.', {
            field: 'responseStatus',
          });
        }

        await tx.idempotencyRecord.create({
          data: {
            adminUserId: input.adminUserId,
            endpoint,
            idempotencyKey,
            requestHash,
            responseStatus: response.responseStatus,
            responseBody: toJsonBody(response.responseBody),
            expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_DAYS * 86_400_000),
          },
        });

        return {
          replayed: false,
          responseStatus: response.responseStatus,
          responseBody: response.responseBody,
        };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const raced = await this.prisma.idempotencyRecord.findUnique({
        where: { adminUserId_endpoint_idempotencyKey: lookup },
      });

      if (raced === null) {
        throw error;
      }

      return this.replay(raced, requestHash);
    }
  }

  public async find(
    adminUserId: string,
    endpoint: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | null> {
    return this.prisma.idempotencyRecord.findUnique({
      where: {
        adminUserId_endpoint_idempotencyKey: { adminUserId, endpoint, idempotencyKey },
      },
    });
  }

  private replay<TBody>(
    record: IdempotencyRecord,
    requestHash: string,
  ): { readonly replayed: true; readonly responseStatus: number; readonly responseBody: TBody } {
    if (record.requestHash !== requestHash) {
      throw conflict('This idempotency key was already used with a different request.', {
        field: 'idempotencyKey',
      });
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw conflict('This idempotency key has expired. Refresh and submit a new request.', {
        field: 'idempotencyKey',
      });
    }

    return {
      replayed: true,
      responseStatus: record.responseStatus,
      responseBody: record.responseBody as TBody,
    };
  }
}

function toJsonBody(body: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(body ?? null, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'P2002'
  );
}

function requireText(raw: string, field: string, maxLength: number): string {
  const value = raw.trim();

  if (value === '') {
    throw validationFailed(`A value is required for ${field}.`, { field });
  }

  if (value.length > maxLength) {
    throw validationFailed(`A value for ${field} must be ${maxLength} characters or fewer.`, {
      field,
    });
  }

  return value;
}
