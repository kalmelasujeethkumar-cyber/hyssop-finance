/**
 * Shared harness for the real-PostgreSQL tests.
 *
 * The repositories are constructed directly with a real generated client instead of
 * through Nest's injector, so each test exercises the same code paths the API uses
 * while keeping setup explicit and fast.
 *
 * Every suite starts from an empty database: `reset` truncates all application tables
 * through the schema-owner connection, and all application traffic uses the
 * least-privilege runtime role, which proves the grants are sufficient.
 */

import { ConfigService } from '@nestjs/config';
import type { AdminUser } from '@prisma/client';
import { StructuredLogger } from '../../../src/common/logging/structured-logger';
import type { AppEnvironment } from '../../../src/config/environment';
import { AuditEventRepository } from '../../../src/database/audit/audit-event.repository';
import { ExpenseCategoryRepository } from '../../../src/database/categories/expense-category.repository';
import { ContributionPeriodRepository } from '../../../src/database/contributions/contribution-period.repository';
import { TransactionDocumentRepository } from '../../../src/database/documents/transaction-document.repository';
import { IdempotencyRecordRepository } from '../../../src/database/idempotency/idempotency-record.repository';
import { MemberRepository } from '../../../src/database/members/member.repository';
import { PrismaService } from '../../../src/database/prisma/prisma.service';
import { ReconciliationService } from '../../../src/database/reconciliation/reconciliation.service';
import { ReferenceAllocatorService } from '../../../src/database/references/reference-allocator.service';
import { AppSettingRepository } from '../../../src/database/settings/app-setting.repository';
import { TransactionRepository } from '../../../src/database/transactions/transaction.repository';
import { requireTestDatabaseUrls } from './database-connection';

const TABLES_TO_TRUNCATE = [
  'audit_event',
  'idempotency_record',
  'transaction_document',
  'financial_transaction',
  'contribution_period',
  'expense_category',
  'member',
  'app_setting',
  'id_sequence',
  'admin_user',
] as const;

export interface TestHarness {
  readonly runtime: PrismaService;
  readonly migration: PrismaService;
  admin: AdminUser;
  readonly references: ReferenceAllocatorService;
  readonly audit: AuditEventRepository;
  readonly members: MemberRepository;
  readonly contributions: ContributionPeriodRepository;
  readonly categories: ExpenseCategoryRepository;
  readonly transactions: TransactionRepository;
  readonly documents: TransactionDocumentRepository;
  readonly settings: AppSettingRepository;
  readonly idempotency: IdempotencyRecordRepository;
  readonly reconciliation: ReconciliationService;
  reset(): Promise<AdminUser>;
  close(): Promise<void>;
}

export function createPrismaClient(url: string): PrismaService {
  const environment: AppEnvironment = {
    nodeEnv: 'test',
    port: 0,
    corsAllowedOrigins: ['http://localhost:5173'],
    logLevel: 'error',
    databaseUrl: url,
    directDatabaseUrl: null,
  };

  const service = new PrismaService(
    new ConfigService({ environment }),
    new StructuredLogger('error', () => undefined),
  );
  service.attachClientLogging();

  return service;
}

export async function createHarness(): Promise<TestHarness> {
  const { runtimeUrl, migrationUrl } = requireTestDatabaseUrls();
  const runtime = createPrismaClient(runtimeUrl);
  const migration = createPrismaClient(migrationUrl);

  const references = new ReferenceAllocatorService();
  const audit = new AuditEventRepository(runtime);
  const members = new MemberRepository(runtime, references, audit);
  const contributions = new ContributionPeriodRepository(runtime);
  const categories = new ExpenseCategoryRepository(runtime, audit);
  const transactions = new TransactionRepository(runtime, references, audit);
  const documents = new TransactionDocumentRepository(runtime, references, audit);
  const settings = new AppSettingRepository(runtime, audit);
  const idempotency = new IdempotencyRecordRepository(runtime);
  const reconciliation = new ReconciliationService(runtime);

  const reset = async (): Promise<AdminUser> => {
    await migration.$executeRawUnsafe(
      `TRUNCATE TABLE ${TABLES_TO_TRUNCATE.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );

    return migration.adminUser.create({ data: { displayName: 'Test Admin' } });
  };

  const admin = await reset();

  return {
    runtime,
    migration,
    admin,
    references,
    audit,
    members,
    contributions,
    categories,
    transactions,
    documents,
    settings,
    idempotency,
    reconciliation,
    reset,
    close: async () => {
      await runtime.$disconnect();
      await migration.$disconnect();
    },
  };
}
