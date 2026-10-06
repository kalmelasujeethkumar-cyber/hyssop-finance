/**
 * Shared harness for the real-PostgreSQL tests.
 *
 * The repositories are constructed directly with a real generated client instead of
 * through Nest's injector, so each test exercises the same code paths the API uses
 * while keeping setup explicit and fast.
 *
 * Every suite starts from an empty database: `reset` truncates all application tables
 * through the schema-owner connection, restores the configuration the repositories cannot work
 * without, and all application traffic uses the least-privilege runtime role, which proves the
 * grants are sufficient.
 */

import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { UNPROVISIONED_PASSWORD_HASH, type AdminProfile } from '@hyssop/contracts';
import type { AdminUser, ExpenseReason } from '@prisma/client';
import { StructuredLogger } from '../../../src/common/logging/structured-logger';
import {
  DEFAULT_ARGON2_ITERATIONS,
  DEFAULT_ARGON2_MEMORY_KIB,
  DEFAULT_ARGON2_PARALLELISM,
  DEFAULT_CSRF_TTL_MINUTES,
  DEFAULT_EXPORT_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  DEFAULT_LOGIN_RATE_LIMIT_WINDOW_MINUTES,
  DEFAULT_MUTATION_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_RATE_LIMIT_WINDOW_MINUTES,
  DEFAULT_SEARCH_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_SESSION_TTL_HOURS,
  DEFAULT_UPLOAD_MAX_BYTES,
  DEFAULT_UPLOAD_RATE_LIMIT_MAX_REQUESTS,
  type AppEnvironment,
} from '../../../src/config/environment';
import { AuditEventRepository } from '../../../src/database/audit/audit-event.repository';
import { AdminSessionRepository } from '../../../src/database/auth/admin-session.repository';
import { AdminUserRepository } from '../../../src/database/auth/admin-user.repository';
import { AuthCsrfTokenRepository } from '../../../src/database/auth/auth-csrf-token.repository';
import { ExpenseCategoryRepository } from '../../../src/database/categories/expense-category.repository';
import { ContributionPeriodRepository } from '../../../src/database/contributions/contribution-period.repository';
import { TransactionDocumentRepository } from '../../../src/database/documents/transaction-document.repository';
import { IdempotencyRecordRepository } from '../../../src/database/idempotency/idempotency-record.repository';
import { MemberRepository } from '../../../src/database/members/member.repository';
import { PrismaService } from '../../../src/database/prisma/prisma.service';
import { ReconciliationService } from '../../../src/database/reconciliation/reconciliation.service';
import { ReferenceAllocatorService } from '../../../src/database/references/reference-allocator.service';
import { ExpenseReasonRepository } from '../../../src/database/reasons/expense-reason.repository';
import { AppSettingRepository } from '../../../src/database/settings/app-setting.repository';
import { INITIAL_APP_SETTING_VALUES } from '../../../src/database/settings/app-setting.validation';
import { TransactionRepository } from '../../../src/database/transactions/transaction.repository';
import { requireTestDatabaseUrls } from './database-connection';

const TABLES_TO_TRUNCATE = [
  'audit_event',
  'auth_csrf_token',
  'admin_session',
  'idempotency_record',
  'transaction_document',
  'financial_transaction',
  'contribution_period',
  'expense_reason',
  'expense_category',
  'member',
  'app_setting',
  'id_sequence',
  'admin_user',
] as const;

export const TEST_SESSION_COOKIE = 'hyssop_session';
export const TEST_CSRF_COOKIE = 'hyssop_csrf';

export const TEST_ADMIN_IDENTIFIER = 'test-admin';
export const TEST_ADMIN_DISPLAY_NAME = 'Test Admin';

export interface TestHarness {
  readonly runtime: PrismaService;
  readonly migration: PrismaService;
  admin: AdminUser;
  readonly references: ReferenceAllocatorService;
  readonly audit: AuditEventRepository;
  readonly admins: AdminUserRepository;
  readonly sessions: AdminSessionRepository;
  readonly csrfTokens: AuthCsrfTokenRepository;
  readonly members: MemberRepository;
  readonly contributions: ContributionPeriodRepository;
  readonly categories: ExpenseCategoryRepository;
  readonly reasons: ExpenseReasonRepository;
  readonly transactions: TransactionRepository;
  readonly documents: TransactionDocumentRepository;
  readonly settings: AppSettingRepository;
  readonly idempotency: IdempotencyRecordRepository;
  readonly reconciliation: ReconciliationService;
  reset(): Promise<AdminUser>;
  ensureReason(categoryId: string, actorAdminId: string, name?: string): Promise<ExpenseReason>;
  close(): Promise<void>;
}

/**
 * The environment the test application and repositories run with. Costs are at the
 * documented minimums; the login limiter window is opened wide so an unrelated test can
 * never be rate-limited by another.
 */
export function testAuthEnvironment(
  overrides: Partial<AppEnvironment['auth']> = {},
): AppEnvironment['auth'] {
  return {
    sessionCookieName: TEST_SESSION_COOKIE,
    csrfCookieName: TEST_CSRF_COOKIE,
    cookieSameSite: 'lax',
    cookieSecure: false,
    sessionTtlHours: DEFAULT_SESSION_TTL_HOURS,
    csrfTtlMinutes: DEFAULT_CSRF_TTL_MINUTES,
    argon2: {
      memoryKib: DEFAULT_ARGON2_MEMORY_KIB,
      iterations: DEFAULT_ARGON2_ITERATIONS,
      parallelism: DEFAULT_ARGON2_PARALLELISM,
    },
    loginRateLimitMaxAttempts: DEFAULT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    loginRateLimitWindowMinutes: DEFAULT_LOGIN_RATE_LIMIT_WINDOW_MINUTES,
    ...overrides,
  };
}

export function testAppEnvironment(overrides: Partial<AppEnvironment> = {}): AppEnvironment {
  return {
    nodeEnv: 'test',
    port: 0,
    corsAllowedOrigins: ['http://localhost:5173'],
    logLevel: 'error',
    databaseUrl: 'postgresql://unused/used-by-injection',
    directDatabaseUrl: null,
    auth: testAuthEnvironment(),
    rateLimit: testRateLimitEnvironment(),
    storage: {
      driver: 'local',
      localStoragePath: join(tmpdir(), 'hyssop-finance-test-storage'),
      uploadMaxBytes: DEFAULT_UPLOAD_MAX_BYTES,
    },
    ...overrides,
  };
}

/** Documented default abuse ceilings, so a repository suite cannot accidentally be limited. */
export function testRateLimitEnvironment(
  overrides: Partial<AppEnvironment['rateLimit']> = {},
): AppEnvironment['rateLimit'] {
  return {
    mutation: {
      maxRequests: DEFAULT_MUTATION_RATE_LIMIT_MAX_REQUESTS,
      windowMinutes: DEFAULT_RATE_LIMIT_WINDOW_MINUTES,
    },
    search: {
      maxRequests: DEFAULT_SEARCH_RATE_LIMIT_MAX_REQUESTS,
      windowMinutes: DEFAULT_RATE_LIMIT_WINDOW_MINUTES,
    },
    upload: {
      maxRequests: DEFAULT_UPLOAD_RATE_LIMIT_MAX_REQUESTS,
      windowMinutes: DEFAULT_RATE_LIMIT_WINDOW_MINUTES,
    },
    export: {
      maxRequests: DEFAULT_EXPORT_RATE_LIMIT_MAX_REQUESTS,
      windowMinutes: DEFAULT_RATE_LIMIT_WINDOW_MINUTES,
    },
    ...overrides,
  };
}

export function createPrismaClient(url: string): PrismaService {
  const service = new PrismaService(
    new ConfigService({ environment: testAppEnvironment({ databaseUrl: url }) }),
    new StructuredLogger('error', () => undefined),
  );
  service.attachClientLogging();

  return service;
}

export function adminProfileOf(admin: AdminUser): AdminProfile {
  return { id: admin.id, identifier: admin.identifier, displayName: admin.displayName };
}

/**
 * Column values for an extra Admin actor.
 *
 * `identifier` became unique in Phase 03, and several suites create more than one actor
 * inside a single test, so each call gets its own identifier. Every row carries the
 * unusable-credential sentinel: an extra test actor must never be able to sign in.
 */
export function testAdminData(displayName = 'Test Actor'): {
  identifier: string;
  displayName: string;
  passwordHash: string;
} {
  return {
    identifier: `test-actor-${randomBytes(8).toString('hex')}`,
    displayName,
    passwordHash: UNPROVISIONED_PASSWORD_HASH,
  };
}

export async function createHarness(): Promise<TestHarness> {
  const { runtimeUrl, migrationUrl } = requireTestDatabaseUrls();
  const runtime = createPrismaClient(runtimeUrl);
  const migration = createPrismaClient(migrationUrl);

  const references = new ReferenceAllocatorService();
  const audit = new AuditEventRepository(runtime);
  const admins = new AdminUserRepository(runtime);
  const sessions = new AdminSessionRepository(runtime, audit);
  const csrfTokens = new AuthCsrfTokenRepository(runtime);
  const members = new MemberRepository(runtime, references, audit);
  const contributions = new ContributionPeriodRepository(runtime, audit);
  const categories = new ExpenseCategoryRepository(runtime, audit);
  const reasons = new ExpenseReasonRepository(runtime, audit);
  const transactions = new TransactionRepository(runtime, references, audit);
  const documents = new TransactionDocumentRepository(runtime, references, audit);
  const settings = new AppSettingRepository(runtime, audit);
  const idempotency = new IdempotencyRecordRepository(runtime);
  const reconciliation = new ReconciliationService(runtime);

  /**
   * Returns the suite to a known empty state and creates the Admin actor. The truncate
   * runs through the schema-owner connection because the least-privilege runtime role has
   * no `TRUNCATE` grant, which is itself part of what the suite proves.
   *
   * `app_setting` is truncated together with the application data and is then restored
   * immediately. The initial key set is not demo content owned by the seed: the forward
   * migration `20260929210000_app_setting_initial_keys` owns it, and the application treats a
   * missing row as a server fault rather than guessing a default. Leaving the table empty here
   * therefore left the shared `_test` database unusable for every later consumer — the browser
   * suite that runs against the same database answered `App setting was not found.` and could
   * not record a member contribution. `skipDuplicates` keeps a reset idempotent and preserves a
   * value a test changed on purpose.
   *
   * `expense_reason` is truncated with the rest because `REQ-EXP-005` makes every expense carry
   * one, so a reason left over from an earlier suite would make the pairing assertions read rows
   * the test never created. It starts empty for the same reason as the categories below.
   *
   * `expense_category` is deliberately left empty: these suites exercise the repositories
   * directly and assert on exactly the rows they created, so a reset that pre-filled the table
   * would force every suite to reason about the product's starting set. The browser run, which
   * does need that set, provisions it itself through
   * `test/database/support/baseline-configuration.ts`.
   */
  const reset = async (): Promise<AdminUser> => {
    await migration.$executeRawUnsafe(
      `TRUNCATE TABLE ${TABLES_TO_TRUNCATE.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );

    await migration.appSetting.createMany({
      data: Object.entries(INITIAL_APP_SETTING_VALUES).map(([key, value]) => ({ key, value })),
      skipDuplicates: true,
    });

    return migration.adminUser.create({
      data: {
        identifier: TEST_ADMIN_IDENTIFIER,
        displayName: TEST_ADMIN_DISPLAY_NAME,
        // Authentication suites overwrite this with a real Argon2id hash; financial
        // suites never sign in and must not carry a usable credential.
        passwordHash: UNPROVISIONED_PASSWORD_HASH,
      },
    });
  };

  const admin = await reset();

  /**
   * An active reason under `categoryId`, created on first use through the real repository.
   *
   * `REQ-EXP-005` makes a reason part of every expense, so a suite that files an expense under a
   * category has to have one. The lookup-then-create shape keeps a repeated call cheap while
   * still writing through `ExpenseReasonRepository`, so a suite cannot accidentally pass by
   * inserting a row the application would have refused.
   */
  const ensureReason = async (
    categoryId: string,
    actorAdminId: string,
    name = 'Other',
  ): Promise<ExpenseReason> => {
    const existing = await reasons.findByNormalizedName(categoryId, name);

    return existing ?? (await reasons.create(categoryId, name, actorAdminId));
  };

  return {
    runtime,
    migration,
    admin,
    references,
    audit,
    admins,
    sessions,
    csrfTokens,
    members,
    contributions,
    categories,
    reasons,
    transactions,
    documents,
    settings,
    idempotency,
    reconciliation,
    reset,
    ensureReason,
    close: async () => {
      await runtime.$disconnect();
      await migration.$disconnect();
    },
  };
}
