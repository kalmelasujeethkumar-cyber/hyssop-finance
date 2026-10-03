/**
 * The Phase 10 settings commands and audit-history read against real PostgreSQL.
 *
 * Authority: `docs/10-TEST-PLAN.md`, `docs/01-REQUIREMENTS.md` `REQ-SETTINGS-001` to
 * `REQ-SETTINGS-009`, `REQ-AUDIT-001`, `REQ-AUDIT-002`, `REQ-FIN-018`, `REQ-FIN-021`,
 * `docs/06-API-SPEC.md` "Settings" and "Audit History", `docs/05-DATABASE-SPEC.md`
 * (`app_setting`, append-only `audit_event`), and `docs/07-SECURITY-RULES.md`.
 *
 * Like the report suite next to it, this file exists because the failure modes are the ones that
 * produce a *plausible* wrong answer rather than an exception:
 *
 * - A settings change that stored the decimal rupees string in a paise column would read back as
 *   a contribution one hundred times too large, and the browser would show a valid-looking amount.
 * - A no-op save that still emitted a `SETTING_UPDATED` event would fill the audit trail with
 *   changes that never happened; a genuine change that emitted *no* event would hide one that did.
 * - An audit read that applied `>= from` / `<= to` to the wrong instant would drop the morning of
 *   the first business day, which reads as a missing sign-in rather than a filter bug.
 * - An audit detail projection that dropped a sensitive field instead of redacting it would
 *   misrepresent the record as incomplete.
 *
 * Every setting value and every audit row below is what real PostgreSQL returned. Both services go
 * through the same repositories the API uses, over the least-privilege runtime role, so the grants
 * and the append-only trigger are part of what is being exercised rather than bypassed.
 */

import type { Prisma } from '@prisma/client';
import { SettingsService } from '../../src/settings/settings.service';
import { AuditEventsService } from '../../src/audit/audit-events.service';
import { IdempotentCommandRunner } from '../../src/common/http/idempotency';
import { REDACTED_VALUE } from '../../src/common/logging/redaction';
import { createHarness, testAdminData, type TestHarness } from './support/test-database';

jest.setTimeout(120_000);

const SEPTEMBER = new Date('2026-09-01T00:00:00.000Z');
const CONTRIBUTION_KEY = 'DEFAULT_MONTHLY_CONTRIBUTION_PAISE';
const METHODS_KEY = 'ENABLED_PAYMENT_METHODS';

// `audit_event.request_id` is a UUID column, so a correlation id used in these tests has to be a
// real UUID rather than the readable request names the HTTP layer happens to generate.
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_MULTI = '33333333-3333-4333-8333-333333333333';
const REQUEST_MEMBER = '22222222-2222-4222-8222-222222222222';

describe('settings commands and audit history against real PostgreSQL', () => {
  let harness: TestHarness;
  let settings: SettingsService;
  let auditHistory: AuditEventsService;
  let actorAdminId: string;

  const actor = (requestId: string | null = REQUEST_ID): SettingsActorInput => ({
    adminUserId: actorAdminId,
    requestId,
  });

  beforeAll(async () => {
    harness = await createHarness();
    settings = new SettingsService(
      harness.settings,
      new IdempotentCommandRunner(harness.idempotency),
    );
    auditHistory = new AuditEventsService(harness.audit);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    harness.admin = await harness.reset();
    const admin = await harness.runtime.adminUser.create({ data: testAdminData('actor') });
    actorAdminId = admin.id;
  });

  async function storedSetting(key: string): Promise<string | undefined> {
    return (await harness.runtime.appSetting.findUnique({ where: { key } }))?.value;
  }

  async function settingEvents(): Promise<
    { readonly after: unknown; readonly before: unknown; readonly requestId: string | null }[]
  > {
    return harness.runtime.auditEvent.findMany({
      where: { action: 'SETTING_UPDATED' },
      orderBy: { occurredAt: 'asc' },
    });
  }

  describe('settings persistence (REQ-SETTINGS-001 to REQ-SETTINGS-009)', () => {
    it('reads the migrated settings with the fixed currency and timezone', async () => {
      const state = await settings.read();

      expect(state.currency).toBe('INR');
      expect(state.businessTimezone).toBe('Asia/Kolkata');
      // `50000` paise is exactly `500.00`, formatted once from the stored integer.
      expect(state.defaultMonthlyContribution).toBe('500.00');
      expect(state.enabledPaymentMethods).toEqual(['CASH', 'UPI', 'BANK_TRANSFER']);
      // The two fixed settings report themselves as not editable, which is what stops the screen
      // from rendering a control the API would refuse.
      expect(state.editable).toEqual({
        defaultMonthlyContribution: true,
        enabledPaymentMethods: true,
        currency: false,
        businessTimezone: false,
      });
      expect(state.minimumEnabledPaymentMethods).toBe(1);
    });

    it('stores an updated contribution as exact integer paise and audits the change', async () => {
      const state = await settings.update({ defaultMonthlyContribution: '750.50' }, actor(), {
        key: 'settings-update-1',
      });

      expect(state.defaultMonthlyContribution).toBe('750.50');
      // The column is a paise count, never the decimal text the browser sent.
      expect(await storedSetting(CONTRIBUTION_KEY)).toBe('75050');

      const events = await settingEvents();

      expect(events).toHaveLength(1);
      expect(events[0]?.before).toMatchObject({ key: CONTRIBUTION_KEY, value: '50000' });
      expect(events[0]?.after).toMatchObject({ key: CONTRIBUTION_KEY, value: '75050' });
      expect(events[0]?.requestId).toBe(REQUEST_ID);
    });

    it('sorts the enabled methods into the documented order and removes a duplicate', async () => {
      const state = await settings.update(
        { enabledPaymentMethods: ['UPI', 'CASH', 'UPI'] },
        actor(),
        { key: 'settings-update-2' },
      );

      // `UPI,CASH` and `CASH,UPI` are the same setting, so the stored value is canonical and the
      // audit trail can never show an order change that did not happen.
      expect(state.enabledPaymentMethods).toEqual(['CASH', 'UPI']);
      expect(await storedSetting(METHODS_KEY)).toBe('CASH,UPI');
    });

    it('writes no row and no audit event when the value is unchanged', async () => {
      // The migrated default is already `50000` paise, so this is a genuine no-op.
      const state = await settings.update({ defaultMonthlyContribution: '500.00' }, actor(), {
        key: 'settings-update-3',
      });

      expect(state.defaultMonthlyContribution).toBe('500.00');
      expect(await storedSetting(CONTRIBUTION_KEY)).toBe('50000');
      expect(await settingEvents()).toHaveLength(0);
    });

    it('commits several settings together and audits each one', async () => {
      await settings.update(
        { defaultMonthlyContribution: '600.00', enabledPaymentMethods: ['BANK_TRANSFER'] },
        actor(REQUEST_MULTI),
        { key: 'settings-update-4' },
      );

      expect(await storedSetting(CONTRIBUTION_KEY)).toBe('60000');
      expect(await storedSetting(METHODS_KEY)).toBe('BANK_TRANSFER');

      const events = await settingEvents();
      const references = events.map((event) => (event.after as { key: string }).key).sort();

      expect(references).toEqual([CONTRIBUTION_KEY, METHODS_KEY].sort());
    });

    it('replays an identical change without a second write or a second event', async () => {
      const input = { defaultMonthlyContribution: '800.00' };

      const first = await settings.update(input, actor(), { key: 'settings-replay' });
      const replay = await settings.update(input, actor(), { key: 'settings-replay' });

      expect(replay).toEqual(first);
      expect(await storedSetting(CONTRIBUTION_KEY)).toBe('80000');
      expect(await settingEvents()).toHaveLength(1);
    });

    it('refuses an empty update, a zero amount, and an empty method list without writing', async () => {
      await expect(settings.update({}, actor(), { key: 'settings-bad-empty' })).rejects.toThrow(
        /Change the contribution amount/,
      );

      await expect(
        settings.update({ defaultMonthlyContribution: '0' }, actor(), { key: 'settings-bad-zero' }),
      ).rejects.toThrow(/greater than zero/);

      await expect(
        settings.update({ enabledPaymentMethods: [] }, actor(), { key: 'settings-bad-methods' }),
      ).rejects.toThrow(/at least one payment method/);

      // None of the three reached the database.
      expect(await storedSetting(CONTRIBUTION_KEY)).toBe('50000');
      expect(await storedSetting(METHODS_KEY)).toBe('CASH,UPI,BANK_TRANSFER');
      expect(await settingEvents()).toHaveLength(0);
    });

    it('stores the contribution-default route as paise and replays the same intent', async () => {
      const first = await settings.setDefaultContribution(
        { defaultMonthlyContribution: '650' },
        actor(),
        { key: 'contribution-default-1' },
      );

      expect(first.defaultMonthlyContribution).toBe('650.00');
      expect(await storedSetting(CONTRIBUTION_KEY)).toBe('65000');

      // `650` and `650.00` are the same amount, so the retry replays rather than writing again.
      const replay = await settings.setDefaultContribution(
        { defaultMonthlyContribution: '650.00' },
        actor(),
        { key: 'contribution-default-1' },
      );

      expect(replay).toEqual(first);
      expect(await settingEvents()).toHaveLength(1);
    });

    it('rejects a different amount under the same key rather than applying it', async () => {
      await settings.setDefaultContribution({ defaultMonthlyContribution: '650.00' }, actor(), {
        key: 'contribution-default-2',
      });

      await expect(
        settings.setDefaultContribution({ defaultMonthlyContribution: '700.00' }, actor(), {
          key: 'contribution-default-2',
        }),
      ).rejects.toThrow(/different request/);

      expect(await storedSetting(CONTRIBUTION_KEY)).toBe('65000');
    });

    it('does not retroactively change a transaction recorded through a now-disabled method', async () => {
      const recorded = await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 10_000n,
          paymentMethod: 'UPI',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          incomeType: 'OFFERING',
        },
        { actorAdminId },
      );

      await settings.update({ enabledPaymentMethods: ['CASH'] }, actor(), {
        key: 'settings-disable-upi',
      });

      const stored = await harness.runtime.financialTransaction.findUniqueOrThrow({
        where: { id: recorded.id },
      });

      // The setting decides what a *new* entry may use; it is not applied retroactively.
      expect(stored.paymentMethod).toBe('UPI');
      expect(stored.status).toBe('ACTIVE');
      expect(stored.amountPaise).toBe(10_000n);
    });
  });

  describe('audit history projection (REQ-AUDIT-001, REQ-AUDIT-002, REQ-FIN-018)', () => {
    async function insertEvent(input: {
      readonly action: 'TRANSACTION_CREATED' | 'MEMBER_CREATED' | 'MEMBER_UPDATED';
      readonly entityType: string;
      readonly occurredAt: Date;
      readonly entityReference?: string;
      readonly requestId?: string;
      readonly before?: unknown;
      readonly after?: unknown;
    }): Promise<string> {
      const event = await harness.migration.auditEvent.create({
        data: {
          action: input.action,
          entityType: input.entityType,
          occurredAt: input.occurredAt,
          entityReference: input.entityReference ?? null,
          requestId: input.requestId ?? null,
          actorAdminId,
          ...(input.before === undefined ? {} : { before: input.before as Prisma.InputJsonValue }),
          ...(input.after === undefined ? {} : { after: input.after as Prisma.InputJsonValue }),
        },
      });

      return event.id;
    }

    it('returns the newest event first with its labels and attribution', async () => {
      await insertEvent({
        action: 'MEMBER_CREATED',
        entityType: 'member',
        entityReference: 'HY-MEM-0001',
        occurredAt: new Date('2026-09-01T04:00:00.000Z'),
      });
      await insertEvent({
        action: 'MEMBER_UPDATED',
        entityType: 'member',
        entityReference: 'HY-MEM-0001',
        requestId: REQUEST_MEMBER,
        occurredAt: new Date('2026-09-02T04:00:00.000Z'),
      });

      const result = await auditHistory.list({});

      expect(result.rows[0]?.action).toBe('MEMBER_UPDATED');
      expect(result.rows[0]?.actionLabel).toBe('Member corrected');
      expect(result.rows[0]?.entityLabel).toBe('Member');
      expect(result.rows[0]?.entityReference).toBe('HY-MEM-0001');
      expect(result.rows[0]?.actorDisplayName).toBe('actor');
      expect(result.rows[0]?.requestId).toBe(REQUEST_MEMBER);
      expect(result.rows).toHaveLength(2);
    });

    it('filters by entity type and by action, and rejects an unknown value', async () => {
      await settings.update({ defaultMonthlyContribution: '600.00' }, actor(), {
        key: 'settings-audit-filter',
      });
      await insertEvent({
        action: 'MEMBER_CREATED',
        entityType: 'member',
        occurredAt: new Date('2026-09-03T04:00:00.000Z'),
      });

      const settingsOnly = await auditHistory.list({ entityType: 'app_setting' });

      expect(settingsOnly.rows.length).toBeGreaterThan(0);
      expect(settingsOnly.rows.every((row) => row.entityType === 'app_setting')).toBe(true);
      expect(settingsOnly.filters.entityType).toBe('app_setting');

      const voidedOnly = await auditHistory.list({ action: 'TRANSACTION_VOIDED' });

      expect(voidedOnly.rows).toEqual([]);

      await expect(auditHistory.list({ entityType: 'not_a_type' })).rejects.toThrow(
        /Choose one of/,
      );
    });

    it('includes both business-day boundaries and excludes the next day', async () => {
      // 00:00 Asia/Kolkata on 2026-09-15 is 2026-09-14T18:30Z; the start-of-day boundary must be
      // inclusive or a morning event silently disappears.
      const boundaryStart = await insertEvent({
        action: 'MEMBER_CREATED',
        entityType: 'member',
        occurredAt: new Date('2026-09-14T18:30:00.000Z'),
      });
      const midMorning = await insertEvent({
        action: 'MEMBER_CREATED',
        entityType: 'member',
        occurredAt: new Date('2026-09-15T06:00:00.000Z'),
      });
      // 00:00 Asia/Kolkata on 2026-09-16 is the first instant of the next business day.
      const nextDay = await insertEvent({
        action: 'MEMBER_CREATED',
        entityType: 'member',
        occurredAt: new Date('2026-09-15T18:30:00.000Z'),
      });

      const result = await auditHistory.list({ from: '2026-09-15', to: '2026-09-15' });
      const ids = result.rows.map((row) => row.id);

      expect(ids).toContain(boundaryStart);
      expect(ids).toContain(midMorning);
      expect(ids).not.toContain(nextDay);
      expect(result.filters.from).toBe('2026-09-15');
      expect(result.filters.to).toBe('2026-09-15');
    });

    it('redacts a sensitive field rather than dropping it', async () => {
      const id = await insertEvent({
        action: 'MEMBER_UPDATED',
        entityType: 'member',
        occurredAt: new Date('2026-09-04T04:00:00.000Z'),
        after: { name: 'Anitha', password: 'hunter2', contact: { apiKey: 'secret-value' } },
      });

      const result = await auditHistory.list({ entityType: 'member' });
      const row = result.rows.find((entry) => entry.id === id);

      const password = row?.after.find((field) => field.key === 'password');

      expect(password?.value).toBe(REDACTED_VALUE);
      expect(password?.redacted).toBe(true);

      const apiKey = row?.after.find((field) => field.key === 'contact.apiKey');

      expect(apiKey?.value).toBe(REDACTED_VALUE);
      expect(apiKey?.redacted).toBe(true);
      // The non-sensitive field is still readable.
      expect(row?.after.find((field) => field.key === 'name')?.value).toBe('Anitha');
    });

    it('distinguishes a recorded empty snapshot from an absent one', async () => {
      const creation = await insertEvent({
        action: 'MEMBER_CREATED',
        entityType: 'member',
        occurredAt: new Date('2026-09-05T04:00:00.000Z'),
        after: {},
      });
      const correction = await insertEvent({
        action: 'MEMBER_UPDATED',
        entityType: 'member',
        occurredAt: new Date('2026-09-06T04:00:00.000Z'),
        before: { name: 'Old' },
        after: { name: 'New' },
      });

      const result = await auditHistory.list({ entityType: 'member' });
      const created = result.rows.find((row) => row.id === creation);
      const corrected = result.rows.find((row) => row.id === correction);

      // A creation has no before at all; "nothing was recorded" is not the same as "empty".
      expect(created?.beforeRecorded).toBe(false);
      expect(created?.before).toEqual([]);
      expect(created?.afterRecorded).toBe(true);
      expect(created?.after).toHaveLength(1);
      expect(created?.after[0]?.value).toBe('(empty)');

      expect(corrected?.beforeRecorded).toBe(true);
      expect(corrected?.before.find((field) => field.key === 'name')?.value).toBe('Old');
    });

    it('pages the whole history with a real total and no duplicate row', async () => {
      for (let index = 0; index < 5; index += 1) {
        await insertEvent({
          action: 'MEMBER_CREATED',
          entityType: 'member',
          entityReference: `HY-MEM-000${index}`,
          occurredAt: new Date(`2026-09-1${index}T04:00:00.000Z`),
        });
      }

      const first = await auditHistory.list({ page: 1, pageSize: 2 });
      const second = await auditHistory.list({ page: 2, pageSize: 2 });
      const third = await auditHistory.list({ page: 3, pageSize: 2 });

      const ids = [
        ...first.rows.map((row) => row.id),
        ...second.rows.map((row) => row.id),
        ...third.rows.map((row) => row.id),
      ];

      expect(first.pagination.totalItems).toBe(5);
      expect(new Set(ids).size).toBe(5);
      expect(ids).toHaveLength(5);
    });
  });
});

interface SettingsActorInput {
  readonly adminUserId: string;
  readonly requestId: string | null;
}
