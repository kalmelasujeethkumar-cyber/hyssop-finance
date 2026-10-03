import { Injectable } from '@nestjs/common';
import type { AppSetting } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { notFound, validationFailed } from '../../common/errors/domain.errors';
import { PrismaService } from '../prisma/prisma.service';
import { AuditEventRepository, AUDIT_ENTITY_TYPES } from '../audit/audit-event.repository';
import {
  isAppSettingKey,
  isPaymentMethodName,
  validateAppSettingValue,
  type PaymentMethodName,
} from './app-setting.validation';

/**
 * Validated, non-secret demo configuration.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` (`app_setting` stores validated, non-secret
 * values; writes are validated, audited, and never alter historical financial
 * records) and `docs/01-REQUIREMENTS.md` `REQ-SETTINGS-*`.
 */
@Injectable()
export class AppSettingRepository {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventRepository,
  ) {}

  public async findAll(): Promise<readonly AppSetting[]> {
    return this.prisma.appSetting.findMany({ orderBy: { key: 'asc' } });
  }

  /**
   * The same read, inside a caller's write transaction.
   *
   * A multi-setting change writes several rows and then has to report the state that was actually
   * committed. Reading inside the same transaction is what makes that report true: a read after the
   * transaction closes is a second round trip that could observe somebody else's change and answer
   * with settings the Admin never chose.
   */
  public async findAllWithin(tx: Prisma.TransactionClient): Promise<readonly AppSetting[]> {
    return tx.appSetting.findMany({ orderBy: { key: 'asc' } });
  }

  public async findOne(key: string): Promise<AppSetting> {
    const setting = await this.prisma.appSetting.findUnique({ where: { key } });

    if (setting === null) {
      throw notFound('App setting', key);
    }

    return setting;
  }

  public async enabledPaymentMethods(): Promise<readonly PaymentMethodName[]> {
    const setting = await this.findOne('ENABLED_PAYMENT_METHODS');

    return setting.value
      .split(',')
      .map((method) => method.trim())
      .filter(isPaymentMethodName);
  }

  /**
   * Writes one validated setting and its audit event in a single transaction, so a
   * setting change can never be recorded without its audit trail.
   */
  public async update(key: string, rawValue: string, actorAdminId: string): Promise<AppSetting> {
    if (!isAppSettingKey(key)) {
      throw validationFailed('Unsupported setting key.', { key });
    }

    const value = validateAppSettingValue(key, rawValue);

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.appSetting.findUnique({ where: { key } });
      const updated = await tx.appSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value, updatedAt: new Date() },
      });

      await this.audit.record(tx, {
        action: 'SETTING_UPDATED',
        entityType: AUDIT_ENTITY_TYPES.appSetting,
        entityId: null,
        entityReference: null,
        actorAdminId,
        before: before === null ? null : { value: before.value },
        after: { value: updated.value },
      });

      return updated;
    });
  }

  /**
   * Writes several validated settings and their audit events inside an existing transaction.
   *
   * The idempotent command runner opens a transaction for the whole write; that transaction must
   * include both the settings changes and the audit events they generate, and it must include the
   * idempotency record write. Splitting into a separate transaction would let settings and their
   * audit events be committed or rolled back independently, which is the exact kind of
   * half-recorded change the audit trail is meant to prevent.
   */
  public async updateManyWithin(
    tx: Prisma.TransactionClient,
    entries: readonly { readonly key: string; readonly value: string }[],
    actorAdminId: string,
    requestId: string | null = null,
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const validated = entries.map((entry) => {
      if (!isAppSettingKey(entry.key)) {
        throw validationFailed('Unsupported setting key.', { key: entry.key });
      }

      return { key: entry.key, value: validateAppSettingValue(entry.key, entry.value) };
    });

    for (const entry of validated) {
      const before = await tx.appSetting.findUnique({ where: { key: entry.key } });

      if (before !== null && before.value === entry.value) {
        continue;
      }

      await tx.appSetting.upsert({
        where: { key: entry.key },
        create: { key: entry.key, value: entry.value },
        update: { value: entry.value, updatedAt: new Date() },
      });

      await this.audit.record(tx, {
        action: 'SETTING_UPDATED',
        entityType: AUDIT_ENTITY_TYPES.appSetting,
        entityId: null,
        // The key is the reference, so a history row says *which* setting changed rather than
        // only that "a setting" did.
        entityReference: entry.key,
        actorAdminId,
        before: before === null ? null : { key: entry.key, value: before.value },
        after: { key: entry.key, value: entry.value },
        // The correlation id is recorded so a settings change can be tied to the request that
        // made it, exactly as a transaction change is. `REQ-AUDIT-001` asks for the actor; the
        // request id is what turns "the Admin changed this" into a traceable answer.
        requestId,
      });
    }
  }

  /**
   * Writes several validated settings and their audit events in one transaction.
   *
   * `docs/06-API-SPEC.md` `PATCH /api/v1/settings` may carry more than one setting, and those are
   * one decision by the Admin: enabling `UPI` and raising the expected contribution are made
   * together or not at all. This method exists for callers that do not already own a transaction
   * (for example, future maintenance commands). Callers that do own one must use
   * {@link updateManyWithin} so that settings, their audit events, and the caller's own write are
   * atomic together.
   */
  public async updateMany(
    entries: readonly { readonly key: string; readonly value: string }[],
    actorAdminId: string,
    requestId: string | null = null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.updateManyWithin(tx, entries, actorAdminId, requestId);
    });
  }
}
