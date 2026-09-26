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
