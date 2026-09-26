/**
 * Command behaviour that depends on real persistence: audited edits, settings writes,
 * and idempotent retries.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-FIN-014`, `REQ-FIN-017`, `REQ-SETTINGS-*`,
 * and `docs/05-DATABASE-SPEC.md` (audited writes, append-only audit, 30 day idempotency
 * retention).
 */

import type { Prisma } from '@prisma/client';
import { createHarness, type TestHarness } from './support/test-database';

jest.setTimeout(120_000);

const SEPTEMBER = new Date('2026-09-01T00:00:00.000Z');

describe('audited persistence commands', () => {
  let harness: TestHarness;
  let actorAdminId: string;
  let categoryId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    harness.admin = await harness.reset();
    const admin = await harness.runtime.adminUser.create({ data: { displayName: 'Actor' } });
    actorAdminId = admin.id;
    const category = await harness.categories.create('Church Maintenance', actorAdminId);
    categoryId = category.id;
  });

  it('records the previous and new values for a correction and increments the revision', async () => {
    const created = await harness.transactions.create(
      {
        transactionType: 'EXPENSE',
        amountPaise: 100_00n,
        paymentMethod: 'CASH',
        businessDate: SEPTEMBER,
        occurredAt: new Date(),
        description: 'Original amount',
        categoryId,
      },
      { actorAdminId },
    );

    const corrected = await harness.transactions.correct(
      created.id,
      { amountPaise: 125_00n, description: 'Corrected amount', expectedRevision: created.revision },
      { actorAdminId },
    );

    expect(corrected.amountPaise).toBe(12_500n);
    expect(corrected.revision).toBe(created.revision + 1);

    const events = await harness.runtime.auditEvent.findMany({
      where: { entityId: created.id },
      orderBy: { occurredAt: 'asc' },
    });

    expect(events).toHaveLength(2);
    expect(events[1]?.action).toBe('TRANSACTION_UPDATED');
    expect(events[1]?.before).toMatchObject({
      amountPaise: '10000',
      description: 'Original amount',
    });
    expect(events[1]?.after).toMatchObject({
      amountPaise: '12500',
      description: 'Corrected amount',
    });
  });

  it('rejects a stale correction and leaves the record untouched', async () => {
    const created = await harness.transactions.create(
      {
        transactionType: 'EXPENSE',
        amountPaise: 10_000n,
        paymentMethod: 'CASH',
        businessDate: SEPTEMBER,
        occurredAt: new Date(),
        categoryId,
      },
      { actorAdminId },
    );

    await harness.transactions.correct(
      created.id,
      { amountPaise: 11_000n, expectedRevision: created.revision },
      { actorAdminId },
    );

    await expect(
      harness.transactions.correct(
        created.id,
        { amountPaise: 12_000n, expectedRevision: created.revision },
        { actorAdminId },
      ),
    ).rejects.toThrow(/changed by someone else/);

    const stored = await harness.transactions.findById(created.id);
    expect(stored.amountPaise).toBe(11_000n);
  });

  it('refuses to edit a voided transaction', async () => {
    const created = await harness.transactions.create(
      {
        transactionType: 'EXPENSE',
        amountPaise: 10_000n,
        paymentMethod: 'CASH',
        businessDate: SEPTEMBER,
        occurredAt: new Date(),
        categoryId,
      },
      { actorAdminId },
    );

    const voided = await harness.transactions.voidTransaction(created.id, 'Duplicate', {
      actorAdminId,
    });

    await expect(
      harness.transactions.correct(
        created.id,
        { amountPaise: 12_000n, expectedRevision: voided.revision },
        { actorAdminId },
      ),
    ).rejects.toThrow(/voided transaction cannot be edited/);
  });

  it('writes a setting together with its audit event', async () => {
    const updated = await harness.settings.update(
      'DEFAULT_MONTHLY_CONTRIBUTION_PAISE',
      '75000',
      actorAdminId,
    );

    expect(updated.value).toBe('75000');

    const event = await harness.runtime.auditEvent.findFirstOrThrow({
      where: { action: 'SETTING_UPDATED' },
    });

    expect(event.actorAdminId).toBe(actorAdminId);
    expect(event.after).toMatchObject({ value: '75000' });
  });

  it('replays an identical retry and rejects a changed payload under the same key', async () => {
    const request = { amount: '100.00', method: 'CASH' };

    const first = await harness.idempotency.runOnce(
      {
        adminUserId: actorAdminId,
        endpoint: '/api/v1/transactions',
        idempotencyKey: 'retry-key-1',
        request,
      },
      async (tx) => {
        await createExpenseIn(harness, tx, actorAdminId, categoryId);

        return { responseStatus: 201, responseBody: { data: { referenceId: 'HY-EXP-000001' } } };
      },
    );

    expect(first.replayed).toBe(false);
    expect(first.responseStatus).toBe(201);

    const replay = await harness.idempotency.runOnce(
      {
        adminUserId: actorAdminId,
        endpoint: '/api/v1/transactions',
        idempotencyKey: 'retry-key-1',
        request,
      },
      () => Promise.reject(new Error('a replayed request must not execute the command again')),
    );

    expect(replay.replayed).toBe(true);
    expect(replay.responseBody).toEqual({ data: { referenceId: 'HY-EXP-000001' } });
    expect(await harness.runtime.financialTransaction.count()).toBe(1);

    await expect(
      harness.idempotency.runOnce(
        {
          adminUserId: actorAdminId,
          endpoint: '/api/v1/transactions',
          idempotencyKey: 'retry-key-1',
          request: { amount: '200.00', method: 'CASH' },
        },
        () => Promise.resolve({ responseStatus: 201, responseBody: {} }),
      ),
    ).rejects.toThrow(/different request/);
  });

  it('rejects an expired key rather than creating a second financial operation', async () => {
    const request = { amount: '100.00' };

    await harness.idempotency.runOnce(
      {
        adminUserId: actorAdminId,
        endpoint: '/api/v1/transactions',
        idempotencyKey: 'retry-key-2',
        request,
      },
      async (tx) => {
        await createExpenseIn(harness, tx, actorAdminId, categoryId);

        return { responseStatus: 201, responseBody: { data: {} } };
      },
    );

    const stored = await harness.idempotency.find(
      actorAdminId,
      '/api/v1/transactions',
      'retry-key-2',
    );

    if (stored === null) {
      throw new Error('expected a stored idempotency record');
    }

    await harness.migration.idempotencyRecord.update({
      where: { id: stored.id },
      data: {
        createdAt: new Date(Date.now() - 40 * 86_400_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    await expect(
      harness.idempotency.runOnce(
        {
          adminUserId: actorAdminId,
          endpoint: '/api/v1/transactions',
          idempotencyKey: 'retry-key-2',
          request,
        },
        () => Promise.resolve({ responseStatus: 201, responseBody: {} }),
      ),
    ).rejects.toThrow(/expired/);
  });

  it('rolls back the record and the command together so a failed command can be retried', async () => {
    const request = { amount: '100.00' };

    await expect(
      harness.idempotency.runOnce(
        {
          adminUserId: actorAdminId,
          endpoint: '/api/v1/transactions',
          idempotencyKey: 'retry-key-3',
          request,
        },
        async (tx) => {
          await createExpenseIn(harness, tx, actorAdminId, categoryId);

          throw new Error('simulated command failure');
        },
      ),
    ).rejects.toThrow(/simulated command failure/);

    expect(await harness.runtime.idempotencyRecord.count()).toBe(0);
    expect(await harness.runtime.financialTransaction.count()).toBe(0);

    const retried = await harness.idempotency.runOnce(
      {
        adminUserId: actorAdminId,
        endpoint: '/api/v1/transactions',
        idempotencyKey: 'retry-key-3',
        request,
      },
      async (tx) => {
        await createExpenseIn(harness, tx, actorAdminId, categoryId);

        return { responseStatus: 201, responseBody: { data: { referenceId: 'HY-EXP-000001' } } };
      },
    );

    expect(retried.replayed).toBe(false);
    expect(await harness.runtime.idempotencyRecord.count()).toBe(1);
    expect(await harness.runtime.financialTransaction.count()).toBe(1);
  });

  it('serializes concurrent identical requests into one execution', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        harness.idempotency.runOnce(
          {
            adminUserId: actorAdminId,
            endpoint: '/api/v1/transactions',
            idempotencyKey: 'retry-key-4',
            request: { amount: '100.00' },
          },
          async (tx) => {
            await createExpenseIn(harness, tx, actorAdminId, categoryId);

            return {
              responseStatus: 201,
              responseBody: { data: { referenceId: 'HY-EXP-000001' } },
            };
          },
        ),
      ),
    );

    expect(results.every((result) => result.responseStatus === 201)).toBe(true);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(await harness.runtime.idempotencyRecord.count()).toBe(1);
    expect(await harness.runtime.financialTransaction.count()).toBe(1);
  });
});

async function createExpenseIn(
  harness: TestHarness,
  tx: Prisma.TransactionClient,
  actorAdminId: string,
  categoryId: string,
): Promise<void> {
  const referenceId = await harness.references.allocate(tx, 'EXPENSE');

  await tx.financialTransaction.create({
    data: {
      referenceId,
      transactionType: 'EXPENSE',
      amountPaise: 10_000n,
      paymentMethod: 'CASH',
      status: 'ACTIVE',
      businessDate: new Date('2026-09-10T00:00:00.000Z'),
      occurredAt: new Date(),
      categoryId,
      createdByAdminId: actorAdminId,
    },
  });
}
