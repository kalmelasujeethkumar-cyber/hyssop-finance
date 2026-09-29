import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MISSING_MESSAGE,
} from '@hyssop/contracts';
import { validationFailed } from '../errors/domain.errors';
import { IdempotencyRecordRepository } from '../../database/idempotency/idempotency-record.repository';

/**
 * Safe-retry support for every create and mutation endpoint.
 *
 * Authority: `docs/06-API-SPEC.md` — "All create and mutation endpoints require an
 * idempotency key for safe retries. Repeating a request with the same key and hash returns
 * the original result rather than creating a duplicate financial record. A repeated key with
 * a different payload is rejected. Records are retained for 30 days; an expired key is
 * rejected as expired rather than silently reused. Concurrent identical requests are
 * serialized by the database unique constraint."
 *
 * The first record of a retry in this application is a *financial* one, so the guarantee
 * matters more here than for an ordinary create: without it, a double tap on Save in a
 * church ledger produces two contributions and a wrong total. Everything below exists so the
 * stored response and the financial write share one database transaction and therefore
 * commit or roll back together.
 */
export { IDEMPOTENCY_KEY_HEADER };

/**
 * Reads and validates the `Idempotency-Key` header.
 *
 * A missing key is rejected rather than defaulted. Generating one server-side would make
 * the endpoint appear retry-safe while every retry created a new key and therefore a new
 * financial record, which is precisely the duplicate the requirement exists to prevent.
 *
 * The permitted character set is intentionally narrow — visible ASCII without spaces —
 * because the value is stored in a `VarChar(255)` unique key and echoed nowhere. Rejecting
 * control characters and non-ASCII keeps a key from being an injection vector into logs or
 * headers and makes a pasted key predictable.
 */
export function readIdempotencyKey(raw: string | undefined): string {
  if (raw === undefined) {
    throw validationFailed(IDEMPOTENCY_KEY_MISSING_MESSAGE, { field: IDEMPOTENCY_KEY_HEADER });
  }

  const key = raw.trim();

  if (key === '') {
    throw validationFailed(IDEMPOTENCY_KEY_MISSING_MESSAGE, { field: IDEMPOTENCY_KEY_HEADER });
  }

  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw validationFailed(
      `An Idempotency-Key must be ${IDEMPOTENCY_KEY_MAX_LENGTH} characters or fewer.`,
      { field: IDEMPOTENCY_KEY_HEADER },
    );
  }

  if (!/^[\x21-\x7e]+$/.test(key)) {
    throw validationFailed('An Idempotency-Key may contain only printable, non-space characters.', {
      field: IDEMPOTENCY_KEY_HEADER,
    });
  }

  return key;
}

/** The outcome of an idempotent command, including whether it was replayed. */
export interface IdempotentResult<TData> {
  readonly status: number;
  readonly body: TData;
  readonly replayed: boolean;
}

/**
 * The key a service method needs in order to run idempotently.
 *
 * Only the key is passed in from the controller. The request that gets hashed alongside it is
 * built by the service from the values it actually honoured, after its own type-specific rules
 * have been applied, rather than from the raw body. That is deliberate: two requests that
 * *mean* the same thing should hash the same way, and an anonymous donation's replaced
 * description should not make a retry look like a different request.
 */
export interface IdempotencyKey {
  readonly key: string;
}

export interface IdempotentCommand<TData> {
  readonly adminUserId: string;
  /**
   * The endpoint identity the key is scoped to.
   *
   * Scoped per route on purpose: the same key used against a different endpoint is a
   * different command, and treating it as a replay would return a response belonging to a
   * different operation. The API version is included so a future `v2` of the same path
   * cannot collide with a stored `v1` response.
   */
  readonly endpoint: string;
  readonly idempotencyKey: string;
  /** The validated request body, hashed to detect key reuse with a different payload. */
  readonly request: unknown;
  /** Runs inside the write transaction, so its financial effects commit with the record. */
  readonly run: (tx: Prisma.TransactionClient) => Promise<{
    readonly status: number;
    readonly body: TData;
  }>;
}

@Injectable()
export class IdempotentCommandRunner {
  public constructor(private readonly records: IdempotencyRecordRepository) {}

  /**
   * Runs `command` at most once for the given key.
   *
   * `replayed` is surfaced rather than swallowed so a caller can tell the Admin the truth:
   * a retry that returns the original record is a different situation from a fresh write,
   * and the response is otherwise indistinguishable.
   */
  public async run<TData>(command: IdempotentCommand<TData>): Promise<IdempotentResult<TData>> {
    const result = await this.records.runOnce<TData>(
      {
        adminUserId: command.adminUserId,
        endpoint: command.endpoint,
        idempotencyKey: command.idempotencyKey,
        request: command.request,
      },
      // The two shapes are renamed here rather than at every call site: a command describes
      // the response it produces in service terms (`status`/`body`), while the repository
      // stores the persisted column names. Only this adapter knows about both.
      async (tx) => {
        const response = await command.run(tx);

        return { responseStatus: response.status, responseBody: response.body };
      },
    );

    return {
      status: result.responseStatus,
      body: result.responseBody,
      replayed: result.replayed,
    };
  }
}
