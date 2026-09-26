import { Injectable } from '@nestjs/common';
import type { AppSetting } from '@prisma/client';
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
}
