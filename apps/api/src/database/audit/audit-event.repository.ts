import { Injectable } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Entity type names used in `audit_event.entity_type`, stable and versioned. */
export const AUDIT_ENTITY_TYPES = {
  transaction: 'financial_transaction',
  member: 'member',
  contributionPeriod: 'contribution_period',
  expenseCategory: 'expense_category',
  transactionDocument: 'transaction_document',
  appSetting: 'app_setting',
  session: 'session',
} as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES];

export interface RecordAuditEventInput {
  readonly action: AuditAction;
  readonly entityType: AuditEntityType;
  readonly entityId?: string | null;
  readonly entityReference?: string | null;
  readonly actorAdminId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
  readonly requestId?: string | null;
  readonly ipHash?: string | null;
}

/** One audit row as a history read needs it: flat, attributed, and already flattened to JSON. */
export interface AuditEventRecord {
  readonly id: string;
  readonly action: string;
  readonly actorDisplayName: string | null;
  readonly occurredAt: Date;
  readonly reason: string | null;
  readonly requestId: string | null;
  readonly before: Prisma.JsonValue;
  readonly after: Prisma.JsonValue;
}

/**
 * Append-only audit persistence.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` (`audit_event` is append-only; the runtime role
 * has no `UPDATE`/`DELETE` grant and the `audit_event_append_only` trigger rejects
 * mutation) and `docs/07-SECURITY-RULES.md` (important actions must be attributable).
 * Only insertion is implemented here, by design.
 */
@Injectable()
export class AuditEventRepository {
  public constructor(private readonly prisma: PrismaService) {}

  /** Records an event inside the caller's transaction so it commits with the change. */
  public async record(
    tx: Prisma.TransactionClient,
    input: RecordAuditEventInput,
  ): Promise<{ readonly id: string }> {
    const created = await tx.auditEvent.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityReference: input.entityReference ?? null,
        actorAdminId: input.actorAdminId ?? null,
        before: toJson(input.before),
        after: toJson(input.after),
        reason: input.reason ?? null,
        requestId: input.requestId ?? null,
        ipHash: input.ipHash ?? null,
      },
      select: { id: true },
    });

    return created;
  }

  /** Records an event outside any business transaction, for reads and rejections. */
  public async recordStandalone(input: RecordAuditEventInput): Promise<{ readonly id: string }> {
    return this.record(this.prisma, input);
  }

  public async countForEntity(entityType: string, entityId: string): Promise<number> {
    return this.prisma.auditEvent.count({ where: { entityType, entityId } });
  }

  /**
   * One entity's audit trail, oldest first.
   *
   * `docs/06-API-SPEC.md` exposes `GET /api/v1/transactions/:id/audit` as a history read, so
   * insertion-only was not sufficient: a financial record has to be explainable after the
   * fact, which is the point of `REQ-FIN-015` and `REQ-FIN-019`. Only `SELECT` was added —
   * the append-only guarantees are unchanged, and the table still has no update or delete
   * path in this repository or in the runtime role's grants.
   *
   * The actor's display name is joined in so a history read can attribute each change
   * without a second round trip. It is read from `admin_user.display_name` rather than the
   * login identifier, so a history view shows who acted; the actor's UUID is deliberately
   * not exposed, because the audit trail is an internal record and the Admin-facing history
   * needs a name, not an internal key.
   *
   * The timestamp is the `occurred_at` column, which the schema names `occurredAt` and which
   * `AuditEventRecord` calls `occurredAt`. Prisma types `findMany` with `SelectSubset`, whose
   * inference accepts an unknown field name without a compile error, so a wrong column reaches
   * the database as a `PrismaClientValidationError` on the first real read rather than failing
   * `npm run typecheck`. That is why the read below is exercised against real PostgreSQL in
   * `apps/api/test/database/income-persistence.db-spec.ts` rather than only through a stub.
   */
  public async listForEntity(
    entityType: string,
    entityId: string,
  ): Promise<readonly AuditEventRecord[]> {
    const rows = await this.prisma.auditEvent.findMany({
      where: { entityType, entityId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        action: true,
        reason: true,
        requestId: true,
        before: true,
        after: true,
        occurredAt: true,
        actorAdmin: { select: { displayName: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorDisplayName: row.actorAdmin?.displayName ?? null,
      occurredAt: row.occurredAt,
      reason: row.reason,
      requestId: row.requestId,
      before: row.before,
      after: row.after,
    }));
  }
}

/**
 * Converts audit payloads to `Prisma.JsonValue`.
 *
 * Money is always serialized as a decimal string, never as a JSON number, so an
 * amount can never lose precision by passing through JSON.
 */
function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined) {
    return Prisma.JsonNull;
  }

  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as Prisma.InputJsonValue;
}
