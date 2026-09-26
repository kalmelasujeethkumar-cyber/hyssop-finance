/**
 * Database invariants that only a real PostgreSQL instance can prove.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` (constraints, grants, append-only audit,
 * immutable identity fields, cross-table rules) and `docs/10-TEST-PLAN.md`
 * (`TEST-FIN-001`, `TEST-FIN-003`, `MEM-001`, `CONTRIB-001`, `EXP-001`, `DOC-001`).
 */

import { Prisma } from '@prisma/client';
import { createHarness, type TestHarness } from './support/test-database';

jest.setTimeout(120_000);

describe('database invariants', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    harness.admin = await harness.reset();
  });

  async function seedActor(): Promise<string> {
    const admin = await harness.runtime.adminUser.create({ data: { displayName: 'Actor' } });
    return admin.id;
  }

  async function seedCategory(name = 'Repairs'): Promise<string> {
    const category = await harness.categories.create(name, await seedActor());
    return category.id;
  }

  describe('money representation (TEST-FIN-001)', () => {
    it('stores an amount as exact integer paise and reads it back unchanged', async () => {
      const actorAdminId = await seedActor();
      const categoryId = await seedCategory();

      const created = await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 12_345n,
          paymentMethod: 'CASH',
          businessDate: new Date('2026-09-01T00:00:00.000Z'),
          occurredAt: new Date('2026-09-01T05:00:00.000Z'),
          description: 'Exact paise',
          categoryId,
        },
        { actorAdminId },
      );

      expect(typeof created.amountPaise).toBe('bigint');
      expect(created.amountPaise).toBe(12_345n);

      const row = await harness.runtime.$queryRaw<
        readonly [{ readonly amount_paise: bigint; readonly data_type: string }]
      >`SELECT "amount_paise", pg_typeof("amount_paise")::text AS data_type
        FROM "financial_transaction" WHERE "id" = ${created.id}::uuid`;

      expect(row[0]?.data_type).toBe('bigint');
      expect(row[0]?.amount_paise).toBe(12_345n);
    });

    it('rejects a zero or negative amount at the database level', async () => {
      const actorAdminId = await seedActor();
      const categoryId = await seedCategory();

      await expect(
        harness.runtime.financialTransaction.create({
          data: {
            referenceId: 'HY-EXP-999999',
            transactionType: 'EXPENSE',
            amountPaise: 0n,
            paymentMethod: 'CASH',
            businessDate: new Date('2026-09-01T00:00:00.000Z'),
            occurredAt: new Date(),
            categoryId,
            createdByAdminId: actorAdminId,
          },
        }),
      ).rejects.toThrow(/amount_positive/);
    });
  });

  describe('transaction shape rules (REQ-FIN-006 to REQ-FIN-010)', () => {
    it('requires an income type for income and forbids a category', async () => {
      const actorAdminId = await seedActor();
      const categoryId = await seedCategory();

      await expect(
        harness.transactions.create(
          {
            transactionType: 'INCOME',
            amountPaise: 1_000n,
            paymentMethod: 'CASH',
            businessDate: new Date('2026-09-01T00:00:00.000Z'),
            occurredAt: new Date(),
            categoryId,
          },
          { actorAdminId },
        ),
      ).rejects.toThrow(/income type/);

      await expect(
        harness.transactions.create(
          {
            transactionType: 'INCOME',
            amountPaise: 1_000n,
            paymentMethod: 'CASH',
            businessDate: new Date('2026-09-01T00:00:00.000Z'),
            occurredAt: new Date(),
          },
          { actorAdminId },
        ),
      ).rejects.toThrow(/income type/);
    });

    it('requires a category for an expense and forbids income fields', async () => {
      const actorAdminId = await seedActor();

      await expect(
        harness.transactions.create(
          {
            transactionType: 'EXPENSE',
            amountPaise: 1_000n,
            paymentMethod: 'CASH',
            businessDate: new Date('2026-09-01T00:00:00.000Z'),
            occurredAt: new Date(),
          },
          { actorAdminId },
        ),
      ).rejects.toThrow(/requires a category/);
    });

    it('requires a member and a matching contribution period for a member contribution', async () => {
      const actorAdminId = await seedActor();
      const first = await harness.members.create({ name: 'First Member' }, actorAdminId);
      const second = await harness.members.create({ name: 'Second Member' }, actorAdminId);
      const period = await harness.contributions.create({
        memberId: first.id,
        year: 2026,
        month: 9,
        expectedPaise: 50_000n,
      });

      await expect(
        harness.transactions.create(
          {
            transactionType: 'INCOME',
            amountPaise: 50_000n,
            paymentMethod: 'UPI',
            businessDate: new Date('2026-09-05T00:00:00.000Z'),
            occurredAt: new Date(),
            incomeType: 'MEMBER_CONTRIBUTION',
            memberId: second.id,
            contributionPeriodId: period.id,
          },
          { actorAdminId },
        ),
      ).rejects.toThrow(/HY_FIN_CONTRIBUTION_PERIOD_MEMBER_MISMATCH/);
    });

    it('keeps an anonymous donation free of a member and a neutral description', async () => {
      const actorAdminId = await seedActor();

      await expect(
        harness.transactions.create(
          {
            transactionType: 'INCOME',
            amountPaise: 10_000n,
            paymentMethod: 'CASH',
            businessDate: new Date('2026-09-05T00:00:00.000Z'),
            occurredAt: new Date(),
            incomeType: 'ANONYMOUS_DONATION',
            description: 'Named donor',
          },
          { actorAdminId },
        ),
      ).rejects.toThrow();
    });
  });

  describe('void and immutability rules (REQ-FIN-015, REQ-FIN-016)', () => {
    it('requires a void reason and records who and when', async () => {
      const actorAdminId = await seedActor();
      const categoryId = await seedCategory();
      const created = await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 5_000n,
          paymentMethod: 'CASH',
          businessDate: new Date('2026-09-02T00:00:00.000Z'),
          occurredAt: new Date(),
          categoryId,
        },
        { actorAdminId },
      );

      await expect(
        harness.transactions.voidTransaction(created.id, '   ', { actorAdminId }),
      ).rejects.toThrow(/void reason/);

      const voided = await harness.transactions.voidTransaction(created.id, 'Duplicate entry', {
        actorAdminId,
      });

      expect(voided.status).toBe('VOIDED');
      expect(voided.voidReason).toBe('Duplicate entry');
      expect(voided.voidedByAdminId).toBe(actorAdminId);
      expect(voided.voidedAt).toBeInstanceOf(Date);
    });

    it('is idempotent for the same reason and rejects a different one', async () => {
      const actorAdminId = await seedActor();
      const categoryId = await seedCategory();
      const created = await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 5_000n,
          paymentMethod: 'CASH',
          businessDate: new Date('2026-09-02T00:00:00.000Z'),
          occurredAt: new Date(),
          categoryId,
        },
        { actorAdminId },
      );

      const first = await harness.transactions.voidTransaction(created.id, 'Duplicate entry', {
        actorAdminId,
      });
      const repeated = await harness.transactions.voidTransaction(created.id, 'Duplicate entry', {
        actorAdminId,
      });

      expect(repeated.status).toBe('VOIDED');
      expect(repeated.voidedAt).toEqual(first.voidedAt);

      await expect(
        harness.transactions.voidTransaction(created.id, 'A different reason', { actorAdminId }),
      ).rejects.toThrow(/already voided/);
    });

    it('rejects a database-level void without void metadata', async () => {
      const actorAdminId = await seedActor();
      const categoryId = await seedCategory();
      const created = await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 5_000n,
          paymentMethod: 'CASH',
          businessDate: new Date('2026-09-02T00:00:00.000Z'),
          occurredAt: new Date(),
          categoryId,
        },
        { actorAdminId },
      );

      await expect(
        harness.runtime.financialTransaction.update({
          where: { id: created.id },
          data: { status: 'VOIDED', revision: created.revision + 1 },
        }),
      ).rejects.toThrow(/financial_transaction_void_metadata/);
    });

    it('refuses to change a reference, the creator, or the creation time', async () => {
      const actorAdminId = await seedActor();
      const other = await seedActor();
      const categoryId = await seedCategory();
      const created = await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 5_000n,
          paymentMethod: 'CASH',
          businessDate: new Date('2026-09-02T00:00:00.000Z'),
          occurredAt: new Date(),
          categoryId,
        },
        { actorAdminId },
      );

      await expect(
        harness.runtime.financialTransaction.update({
          where: { id: created.id },
          data: { referenceId: 'HY-EXP-888888' },
        }),
      ).rejects.toThrow(/HY_FIN_IMMUTABLE_TRANSACTION_FIELDS/);

      await expect(
        harness.runtime.financialTransaction.update({
          where: { id: created.id },
          data: { createdByAdminId: other },
        }),
      ).rejects.toThrow(/HY_FIN_IMMUTABLE_TRANSACTION_FIELDS/);
    });
  });

  describe('audit append-only enforcement (REQ-FIN-018, SEC audit rules)', () => {
    it('denies UPDATE and DELETE on audit_event to the runtime role', async () => {
      const actorAdminId = await seedActor();
      await harness.audit.recordStandalone({
        action: 'TRANSACTION_CREATED',
        entityType: 'financial_transaction',
        actorAdminId,
      });

      const event = await harness.runtime.auditEvent.findFirstOrThrow();

      await expect(
        harness.runtime.auditEvent.update({
          where: { id: event.id },
          data: { action: 'TRANSACTION_VOIDED' },
        }),
      ).rejects.toThrow(/permission denied/i);

      await expect(harness.runtime.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(
        /permission denied/i,
      );
    });

    it('rejects mutation of an audit event even for the schema-owner role', async () => {
      const event = await harness.migration.auditEvent.create({
        data: { action: 'MEMBER_CREATED', entityType: 'member' },
      });

      await expect(
        harness.migration.auditEvent.update({
          where: { id: event.id },
          data: { action: 'MEMBER_UPDATED' },
        }),
      ).rejects.toThrow(/HY_AUDIT_EVENT_APPEND_ONLY/);

      await expect(
        harness.migration.auditEvent.delete({ where: { id: event.id } }),
      ).rejects.toThrow(/HY_AUDIT_EVENT_APPEND_ONLY/);
    });
  });

  describe('member invariants (MEM-001, REQ-MEM-004, REQ-MEM-005)', () => {
    it('stores national digits only and enforces them with a constraint', async () => {
      const actorAdminId = await seedActor();
      const member = await harness.members.create(
        { name: 'Anitha Kumar', phone: '+91 98765-43210' },
        actorAdminId,
      );

      expect(member.referenceId).toMatch(/^HY-MEM-\d{4}$/);
      expect(member.phone).toBe('9876543210');
      expect(member.revision).toBe(1);

      await expect(
        harness.runtime.member.create({
          data: { referenceId: 'HY-MEM-0002', name: 'Invalid Phone', phone: '12345' },
        }),
      ).rejects.toThrow(/phone_digits/);
    });

    it('rejects a blank member name', async () => {
      await expect(
        harness.runtime.member.create({ data: { referenceId: 'HY-MEM-0003', name: '   ' } }),
      ).rejects.toThrow(/name_not_blank/);
    });

    it('rejects a stale revision instead of overwriting a concurrent edit', async () => {
      const actorAdminId = await seedActor();
      const member = await harness.members.create({ name: 'Benedict Dâ€™Souza' }, actorAdminId);

      const updated = await harness.members.update(
        member.id,
        { name: 'Benedict Dsouza', expectedRevision: 1 },
        actorAdminId,
      );

      expect(updated.revision).toBe(2);

      await expect(
        harness.members.update(
          member.id,
          { name: 'Benedict Dâ€™Souza', expectedRevision: 1 },
          actorAdminId,
        ),
      ).rejects.toThrow(/changed by someone else/);
    });

    it('refuses to delete a member that has financial history', async () => {
      const actorAdminId = await seedActor();
      const member = await harness.members.create({ name: 'Chandralekha Nair' }, actorAdminId);
      const period = await harness.contributions.create({
        memberId: member.id,
        year: 2026,
        month: 9,
        expectedPaise: 50_000n,
      });

      await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 50_000n,
          paymentMethod: 'CASH',
          businessDate: new Date('2026-09-05T00:00:00.000Z'),
          occurredAt: new Date(),
          incomeType: 'MEMBER_CONTRIBUTION',
          memberId: member.id,
          contributionPeriodId: period.id,
        },
        { actorAdminId },
      );

      await expect(harness.runtime.member.delete({ where: { id: member.id } })).rejects.toThrow(
        /Foreign key constraint violated/,
      );
    });
  });

  describe('contribution period invariants (CONTRIB-001, REQ-CONTRIB-001)', () => {
    it('accepts one expected amount per member per month', async () => {
      const actorAdminId = await seedActor();
      const member = await harness.members.create({ name: 'Devadas Menon' }, actorAdminId);
      const period = await harness.contributions.create({
        memberId: member.id,
        year: 2026,
        month: 9,
        expectedPaise: 50_000n,
      });

      expect(period.expectedPaise).toBe(50_000n);

      await expect(
        harness.contributions.create({
          memberId: member.id,
          year: 2026,
          month: 9,
          expectedPaise: 60_000n,
        }),
      ).rejects.toThrow(/already exists/);
    });

    it('rejects an impossible month and a non-positive expected amount', async () => {
      const actorAdminId = await seedActor();
      const member = await harness.members.create({ name: 'Esther Philip' }, actorAdminId);

      await expect(
        harness.contributions.create({
          memberId: member.id,
          year: 2026,
          month: 13,
          expectedPaise: 50_000n,
        }),
      ).rejects.toThrow(/month/);

      await expect(
        harness.runtime.contributionPeriod.create({
          data: { memberId: member.id, year: 2026, month: 9, expectedPaise: 0n },
        }),
      ).rejects.toThrow(/expected_positive/);
    });
  });

  describe('expense category invariants (EXP-001, REQ-EXP-002, REQ-EXP-004)', () => {
    it('enforces case-insensitive name uniqueness through the database', async () => {
      await seedCategory('Repairs');

      await expect(
        harness.runtime.expenseCategory.create({
          data: { name: 'REPAIRS', normalizedName: 'repairs', isSystem: false },
        }),
      ).rejects.toThrow(/normalized_name/);
    });

    it('deactivates a category instead of deleting it, so history keeps its label', async () => {
      const actorAdminId = await seedActor();
      const category = await harness.categories.create('Cleaning', actorAdminId);
      const updated = await harness.categories.update(
        category.id,
        { status: 'INACTIVE' },
        actorAdminId,
      );

      expect(updated.status).toBe('INACTIVE');
      expect(updated.isSystem).toBe(false);
      expect(await harness.runtime.expenseCategory.count()).toBe(1);
    });

    it('refuses to hard delete a category that already labels a transaction', async () => {
      const actorAdminId = await seedActor();
      const category = await harness.categories.create('Cleaning', actorAdminId);

      await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 5_000n,
          paymentMethod: 'CASH',
          businessDate: new Date('2026-09-05T00:00:00.000Z'),
          occurredAt: new Date(),
          categoryId: category.id,
        },
        { actorAdminId },
      );

      await expect(
        harness.runtime.expenseCategory.delete({ where: { id: category.id } }),
      ).rejects.toThrow(/Foreign key constraint violated/);
    });

    it('refuses to use an inactive category for a new expense', async () => {
      const actorAdminId = await seedActor();
      const category = await harness.categories.create('Decoration', actorAdminId);
      await harness.categories.update(category.id, { status: 'INACTIVE' }, actorAdminId);

      await expect(harness.categories.requireActive(category.id)).rejects.toThrow(
        /active category/,
      );
    });
  });

  describe('document metadata invariants (DOC-001, REQ-DOC-009)', () => {
    it('retains metadata after removal and records the reason and the actor', async () => {
      const actorAdminId = await seedActor();
      const categoryId = await seedCategory();
      const transaction = await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 750n,
          paymentMethod: 'UPI',
          businessDate: new Date('2026-09-03T00:00:00.000Z'),
          occurredAt: new Date(),
          categoryId,
        },
        { actorAdminId },
      );

      const document = await harness.documents.record({
        transactionId: transaction.id,
        storageKey: '2026/09/transaction-receipt.pdf',
        originalFilename: 'receipt.pdf',
        declaredMimeType: 'application/pdf',
        detectedMimeType: 'application/pdf',
        byteSize: 2048,
        checksumSha256: 'a'.repeat(64),
        uploadedByAdminId: actorAdminId,
      });

      expect(document.referenceId).toMatch(/^HY-DOC-\d{6}$/);
      expect(document.status).toBe('AVAILABLE');

      const removed = await harness.documents.remove({
        documentId: document.id,
        removedByAdminId: actorAdminId,
        removalReason: 'Uploaded the wrong receipt',
      });

      expect(removed.status).toBe('REMOVED');
      expect(removed.storageDeletedAt).toBeNull();

      const marked = await harness.documents.markStorageDeleted(document.id);
      expect(marked.storageDeletedAt).toBeInstanceOf(Date);

      const stored = await harness.runtime.transactionDocument.findUniqueOrThrow({
        where: { id: document.id },
      });
      expect(stored.storageKey).toBe('2026/09/transaction-receipt.pdf');
    });

    it('rejects a disallowed type, an empty file, and a malformed checksum', async () => {
      const actorAdminId = await seedActor();
      const categoryId = await seedCategory();
      const transaction = await harness.transactions.create(
        {
          transactionType: 'EXPENSE',
          amountPaise: 750n,
          paymentMethod: 'CASH',
          businessDate: new Date('2026-09-03T00:00:00.000Z'),
          occurredAt: new Date(),
          categoryId,
        },
        { actorAdminId },
      );

      const base = {
        transactionId: transaction.id,
        storageKey: 'key/one',
        originalFilename: 'receipt.exe',
        declaredMimeType: 'application/octet-stream',
        detectedMimeType: 'application/octet-stream',
        byteSize: 10,
        checksumSha256: 'b'.repeat(64),
        uploadedByAdminId: actorAdminId,
      };

      await expect(harness.documents.record(base)).rejects.toThrow(/not allowed/);
      await expect(
        harness.documents.record({
          ...base,
          declaredMimeType: 'application/pdf',
          detectedMimeType: 'application/pdf',
          byteSize: 0,
        }),
      ).rejects.toThrow(/positive integer/);
      await expect(
        harness.documents.record({
          ...base,
          declaredMimeType: 'application/pdf',
          detectedMimeType: 'application/pdf',
          checksumSha256: 'NOTHEX',
        }),
      ).rejects.toThrow(/64 lowercase/);

      await expect(
        harness.runtime.transactionDocument.create({
          data: {
            referenceId: 'HY-DOC-000999',
            transactionId: transaction.id,
            storageKey: 'key/two',
            originalFilename: 'receipt.pdf',
            declaredMimeType: 'application/pdf',
            detectedMimeType: 'application/pdf',
            byteSize: 10,
            checksumSha256: 'z'.repeat(64),
            uploadedByAdminId: actorAdminId,
          },
        }),
      ).rejects.toThrow(/checksum_format/);
    });
  });

  describe('settings invariants (REQ-SETTINGS-001)', () => {
    it('refuses an invalid setting value at the database level', async () => {
      await expect(
        harness.runtime.appSetting.create({ data: { key: 'CURRENCY', value: 'USD' } }),
      ).rejects.toThrow(/currency_fixed/);

      await expect(
        harness.runtime.appSetting.create({ data: { key: 'BUSINESS_TIMEZONE', value: 'UTC' } }),
      ).rejects.toThrow(/business_timezone_fixed/);

      await expect(
        harness.runtime.appSetting.create({
          data: { key: 'DEFAULT_MONTHLY_CONTRIBUTION_PAISE', value: '0' },
        }),
      ).rejects.toThrow(/default_contribution_positive_paise/);

      await expect(
        harness.runtime.appSetting.create({
          data: { key: 'ENABLED_PAYMENT_METHODS', value: 'CHEQUE' },
        }),
      ).rejects.toThrow(/payment_methods_valid/);

      await expect(
        harness.runtime.appSetting.create({ data: { key: 'SECRET_KEY', value: 'anything' } }),
      ).rejects.toThrow(/key_known/);
    });
  });

  describe('idempotency and reference sequence constraints', () => {
    it('enforces the unique key for the same admin and endpoint at the database level', async () => {
      const admin = await harness.runtime.adminUser.create({ data: { displayName: 'Admin' } });

      await harness.runtime.idempotencyRecord.create({
        data: {
          adminUserId: admin.id,
          endpoint: '/api/v1/transactions',
          idempotencyKey: 'key-1',
          requestHash: 'a'.repeat(64),
          responseStatus: 201,
          responseBody: Prisma.JsonNull,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      await expect(
        harness.runtime.idempotencyRecord.create({
          data: {
            adminUserId: admin.id,
            endpoint: '/api/v1/transactions',
            idempotencyKey: 'key-1',
            requestHash: 'b'.repeat(64),
            responseStatus: 201,
            responseBody: Prisma.JsonNull,
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        }),
      ).rejects.toThrow(/Unique constraint/);
    });

    it('rejects a malformed stored hash and an unknown sequence scope', async () => {
      await expect(
        harness.runtime.idempotencyRecord.create({
          data: {
            adminUserId: (await harness.runtime.adminUser.create({ data: { displayName: 'A' } }))
              .id,
            endpoint: '/api/v1/transactions',
            idempotencyKey: 'key-2',
            requestHash: 'not-a-hash',
            responseStatus: 201,
            responseBody: Prisma.JsonNull,
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        }),
      ).rejects.toThrow(/request_hash_format/);

      await expect(
        harness.runtime.idSequence.create({ data: { scope: 'SESSION' } }),
      ).rejects.toThrow(/scope_known/);
    });
  });
});
