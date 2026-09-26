import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { formatReference, type ReferenceScope } from './reference-formats';

/**
 * Allocates human-readable references.
 *
 * Authority: `docs/05-DATABASE-SPEC.md`: "`id_sequence` rows allocate the next value
 * inside the same database transaction that creates the record. A failed transaction
 * must not consume a committed business reference permanently for the caller, and
 * concurrent allocation must never produce duplicates."
 *
 * The allocation is therefore never called with the root client: it requires the
 * caller's transaction client, so the counter increment rolls back with the record.
 * The upsert takes a row lock, which serializes concurrent allocators per scope and
 * makes a duplicate reference impossible even under parallel requests.
 */
@Injectable()
export class ReferenceAllocatorService {
  public async allocate(tx: Prisma.TransactionClient, scope: ReferenceScope): Promise<string> {
    const rows = await tx.$queryRaw<readonly { readonly last_value: bigint }[]>`
      INSERT INTO id_sequence (scope, last_value, updated_at)
      VALUES (${scope}, 1, now())
      ON CONFLICT (scope) DO UPDATE
        SET last_value = id_sequence.last_value + 1, updated_at = now()
      RETURNING last_value
    `;

    const row = rows[0];

    if (row === undefined) {
      throw new Error(`Reference allocation returned no value for scope ${scope}.`);
    }

    return formatReference(scope, row.last_value);
  }
}
