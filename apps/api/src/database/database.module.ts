import { Module } from '@nestjs/common';
import { AuditEventRepository } from './audit/audit-event.repository';
import { ExpenseCategoryRepository } from './categories/expense-category.repository';
import { ContributionPeriodRepository } from './contributions/contribution-period.repository';
import { TransactionDocumentRepository } from './documents/transaction-document.repository';
import { IdempotencyRecordRepository } from './idempotency/idempotency-record.repository';
import { MemberRepository } from './members/member.repository';
import { ReconciliationService } from './reconciliation/reconciliation.service';
import { ReferenceAllocatorService } from './references/reference-allocator.service';
import { AppSettingRepository } from './settings/app-setting.repository';
import { TransactionRepository } from './transactions/transaction.repository';

/**
 * The single data-access boundary.
 *
 * Authority: `docs/02-ARCHITECTURE.md`: repositories own all queries so controllers and
 * future calculation services never build their own. `PrismaModule` is global, so the
 * generated client is injected here without being re-imported.
 */
@Module({
  providers: [
    ReferenceAllocatorService,
    AuditEventRepository,
    MemberRepository,
    ContributionPeriodRepository,
    ExpenseCategoryRepository,
    TransactionRepository,
    TransactionDocumentRepository,
    AppSettingRepository,
    IdempotencyRecordRepository,
    ReconciliationService,
  ],
  exports: [
    ReferenceAllocatorService,
    AuditEventRepository,
    MemberRepository,
    ContributionPeriodRepository,
    ExpenseCategoryRepository,
    TransactionRepository,
    TransactionDocumentRepository,
    AppSettingRepository,
    IdempotencyRecordRepository,
    ReconciliationService,
  ],
})
export class DatabaseModule {}
