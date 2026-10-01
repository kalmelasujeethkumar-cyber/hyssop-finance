import { Module } from '@nestjs/common';
import { IdempotentCommandRunner } from '../common/http/idempotency';
import { AuditEventRepository } from './audit/audit-event.repository';
import { AdminSessionRepository } from './auth/admin-session.repository';
import { AdminUserRepository } from './auth/admin-user.repository';
import { AuthCsrfTokenRepository } from './auth/auth-csrf-token.repository';
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
 *
 * `IdempotentCommandRunner` lives here rather than in `TransactionsModule` because it is a shared
 * command-replay utility, not a transaction concern. Every module that accepts a mutation needs it,
 * and it is backed by `IdempotencyRecordRepository` — so providing and exporting it once, next to
 * the repository that stores the record, is what keeps a new module from having to import an
 * unrelated domain module just to be allowed to replay a request safely.
 */
@Module({
  providers: [
    ReferenceAllocatorService,
    AuditEventRepository,
    AdminUserRepository,
    AdminSessionRepository,
    AuthCsrfTokenRepository,
    MemberRepository,
    ContributionPeriodRepository,
    ExpenseCategoryRepository,
    TransactionRepository,
    TransactionDocumentRepository,
    AppSettingRepository,
    IdempotencyRecordRepository,
    IdempotentCommandRunner,
    ReconciliationService,
  ],
  exports: [
    ReferenceAllocatorService,
    AuditEventRepository,
    AdminUserRepository,
    AdminSessionRepository,
    AuthCsrfTokenRepository,
    MemberRepository,
    ContributionPeriodRepository,
    ExpenseCategoryRepository,
    TransactionRepository,
    TransactionDocumentRepository,
    AppSettingRepository,
    IdempotencyRecordRepository,
    IdempotentCommandRunner,
    ReconciliationService,
  ],
})
export class DatabaseModule {}
