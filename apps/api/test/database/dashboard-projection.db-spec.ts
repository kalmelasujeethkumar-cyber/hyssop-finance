/**
 * The dashboard projection against real PostgreSQL.
 *
 * Authority: `docs/10-TEST-PLAN.md` (`TEST-DASH-001`, `TEST-DASH-002`, `TEST-FIN-001`,
 * `TEST-FIN-003`), `docs/01-REQUIREMENTS.md` `REQ-DASH-001` to `REQ-DASH-018`,
 * `REQ-FIN-004` to `REQ-FIN-014`, `REQ-CONTRIB-005`, and `REQ-CONTRIB-006`, and
 * `docs/02-ARCHITECTURE.md` (the canonical calculation layer is built from persisted data).
 *
 * This suite exists because the dashboard's correctness is almost entirely a question about SQL
 * rather than about TypeScript. `SUM` filters, `FILTER (WHERE ...)` predicates, `EXTRACT` on a
 * `DATE`, and a `LEFT JOIN` from transactions to categories all behave in ways a mocked
 * repository cannot reproduce. Every figure asserted here is therefore the number a real
 * PostgreSQL returned, and the deliberately awkward fixtures — an odd paise amount, a voided
 * row, a negative method balance, a member created after the period end — are the cases where a
 * plausible-looking implementation produces a wrong but plausible-looking dashboard.
 */

import { DashboardService } from '../../src/dashboard/dashboard.service';
import { resolveCustomPeriod, resolvePresetPeriod } from '../../src/dashboard/period.resolver';
import { parseBusinessDate } from '../../src/common/time/business-date';
import { createHarness, testAdminData, type TestHarness } from './support/test-database';

jest.setTimeout(120_000);

const AUGUST = parseBusinessDate('2026-08-01');
const SEPTEMBER = parseBusinessDate('2026-09-01');
const SEPTEMBER_END = parseBusinessDate('2026-09-30');
const OCTOBER = parseBusinessDate('2026-10-01');

describe('dashboard projection against real PostgreSQL', () => {
  let harness: TestHarness;
  let dashboard: DashboardService;
  let actorAdminId: string;
  let electricityId: string;

  beforeAll(async () => {
    harness = await createHarness();
    dashboard = new DashboardService(
      harness.reconciliation,
      harness.members,
      harness.contributions,
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    harness.admin = await harness.reset();
    const admin = await harness.runtime.adminUser.create({ data: testAdminData('actor') });
    actorAdminId = admin.id;
    electricityId = (await harness.categories.create('Electricity', actorAdminId)).id;
  });

  async function income(
    amountPaise: bigint,
    businessDate: Date,
    incomeType: 'OFFERING' | 'DONATION' = 'OFFERING',
    paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER' = 'CASH',
  ): Promise<{ readonly id: string; readonly referenceId: string }> {
    return harness.transactions.create(
      {
        transactionType: 'INCOME',
        amountPaise,
        paymentMethod,
        businessDate,
        occurredAt: new Date(),
        incomeType,
      },
      { actorAdminId },
    );
  }

  /**
   * Backdates a member's `created_at`.
   *
   * The fixtures are September 2026 records, but `member.created_at` defaults to the real
   * clock. A member whose creation time is later than the period cannot belong to that period's
   * denominator, so every test that expects a member to be counted has to state the creation date
   * it is asserting about rather than inherit whatever day the suite happens to run on.
   */
  async function setMemberCreatedAt(memberId: string, createdAt: string): Promise<void> {
    await harness.runtime.member.update({
      where: { id: memberId },
      data: { createdAt: new Date(createdAt) },
    });
  }

  async function expense(
    amountPaise: bigint,
    businessDate: Date,
    categoryId: string = electricityId,
    paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER' = 'CASH',
  ): Promise<{ readonly id: string; readonly referenceId: string }> {
    return harness.transactions.create(
      {
        transactionType: 'EXPENSE',
        amountPaise,
        paymentMethod,
        businessDate,
        occurredAt: new Date(),
        categoryId,
      },
      { actorAdminId },
    );
  }

  describe('period movement and ending balances are different projections (REQ-FIN-009, REQ-FIN-014)', () => {
    it('reports a September movement that excludes August income', async () => {
      await income(400_000n, AUGUST);
      await income(150_000n, SEPTEMBER);

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      // The movement is the selected period only.
      expect(view.movement.income).toBe('1500.00');
      // The ending balance is every month through the period end.
      expect(view.balances.cumulativeIncome).toBe('5500.00');
      expect(view.balances.total).toBe('5500.00');
      expect(view.availableBalanceForPeriod).toBe('1500.00');
    });

    it('labels the movement and the ending balance distinctly (REQ-FIN-014)', async () => {
      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.movement.label).toBe('Period movement');
      expect(view.balances.label).toBe('Available balance as of period end');
      expect(view.movement.label).not.toBe(view.balances.label);
    });

    it('sums the three method balances into the reported total (REQ-FIN-013)', async () => {
      await income(100_000n, SEPTEMBER, 'OFFERING', 'CASH');
      await income(200_000n, SEPTEMBER, 'OFFERING', 'UPI');
      await expense(50_000n, SEPTEMBER, electricityId, 'BANK_TRANSFER');

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.balances.cash).toBe('1000.00');
      expect(view.balances.upi).toBe('2000.00');
      expect(view.balances.bank).toBe('-500.00');
      expect(view.balances.total).toBe('2500.00');
    });

    it('keeps a negative method balance rather than clamping it (REQ-FIN-012)', async () => {
      // An expense recorded before its matching income is legitimate; a pastor must be able to
      // see that the bank account is short, not be shown a fabricated zero.
      await expense(120_000n, SEPTEMBER, electricityId, 'BANK_TRANSFER');

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.balances.bank).toBe('-1200.00');
      expect(view.balances.total).toBe('-1200.00');
      expect(view.balances.cumulativeExpenses).toBe('1200.00');
    });

    it('subtracts expenses from income to produce the period available balance (REQ-DASH-003)', async () => {
      await income(200_000n, SEPTEMBER);
      await expense(75_000n, SEPTEMBER);

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.movement.income).toBe('2000.00');
      expect(view.movement.expenses).toBe('750.00');
      expect(view.movement.net).toBe('1250.00');
      expect(view.comparison.movement).toBe('1250.00');
      expect(view.availableBalanceForPeriod).toBe('1250.00');
    });

    it('returns exact zero paise for a church with no activity', async () => {
      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.movement.income).toBe('0.00');
      expect(view.movement.expenses).toBe('0.00');
      expect(view.movement.net).toBe('0.00');
      expect(view.balances.total).toBe('0.00');
      expect(view.incomeBreakdown.slices).toEqual([]);
      expect(view.recentTransactions).toEqual([]);
      expect(view.memberCount).toBe(0);
    });
  });

  describe('active-only accounting (REQ-FIN-001, REQ-FIN-002)', () => {
    it('excludes a voided row from every dashboard figure while retaining it in the ledger', async () => {
      const kept = await income(100_000n, SEPTEMBER);
      const voided = await income(999_999n, SEPTEMBER);
      const expenseRow = await expense(10_000n, SEPTEMBER);

      await harness.transactions.voidTransaction(voided.id, 'Entered twice', { actorAdminId });

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.movement.income).toBe('1000.00');
      expect(view.balances.cumulativeIncome).toBe('1000.00');
      expect(view.incomeBreakdown.total).toBe('1000.00');
      expect(view.trend.map((point) => point.income)).toEqual(['1000.00']);

      // Both remaining active rows appear, and the voided one appears in neither. Asserted on
      // membership rather than on exact order because the two rows share a business date and
      // the ordering falls back to `occurred_at`.
      const recentIds = view.recentTransactions.map((row) => row.id);
      expect(recentIds).toHaveLength(2);
      expect(recentIds).toContain(kept.id);
      expect(recentIds).toContain(expenseRow.id);
      expect(recentIds).not.toContain(voided.id);

      // The voided row is still a real, auditable record; it is only excluded from totals.
      const retained = await harness.transactions.findById(voided.id);
      expect(retained.status).toBe('VOIDED');
      expect(retained.amountPaise).toBe(999_999n);
      expect(await harness.audit.countForEntity('financial_transaction', voided.id)).toBe(2);
    });

    it('excludes a voided expense from the category breakdown total', async () => {
      await expense(50_000n, SEPTEMBER);
      const voided = await expense(70_000n, SEPTEMBER);

      await harness.transactions.voidTransaction(voided.id, 'Duplicate entry', { actorAdminId });

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.expenseBreakdown.total).toBe('500.00');
      expect(view.expenseBreakdown.slices).toHaveLength(1);
      expect(view.expenseBreakdown.slices[0]?.amount).toBe('500.00');
    });
  });

  describe('trend (REQ-DASH-012)', () => {
    it('emits one point per calendar month in the period, oldest first', async () => {
      await income(100_000n, SEPTEMBER);
      await income(200_000n, OCTOBER);

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-08-01', to: '2026-10-31' }),
      );

      expect(view.trend.map((point) => point.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    });

    it('fills a month with no activity with exact zeros rather than skipping it', async () => {
      // A chart that omitted August would compress the axis and imply August did not happen.
      await income(100_000n, SEPTEMBER);

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-07-01', to: '2026-09-30' }),
      );

      expect(view.trend[0]).toMatchObject({ month: '2026-07', income: '0.00', expenses: '0.00' });
      expect(view.trend[1]).toMatchObject({ month: '2026-08', income: '0.00', expenses: '0.00' });
      expect(view.trend[2]).toMatchObject({ month: '2026-09', income: '1000.00' });
    });

    it('produces twelve points for thisYear and three for last3Months', async () => {
      const year = await dashboard.dashboard(resolvePresetPeriod('thisYear', SEPTEMBER));
      const quarter = await dashboard.dashboard(resolvePresetPeriod('last3Months', SEPTEMBER));

      expect(year.trend).toHaveLength(12);
      expect(quarter.trend.map((point) => point.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    });

    it('reports a negative monthly movement when expenses exceed income', async () => {
      await income(10_000n, SEPTEMBER);
      await expense(60_000n, SEPTEMBER);

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.trend[0]?.movement).toBe('-500.00');
    });
  });

  describe('breakdowns (REQ-DASH-009, REQ-DASH-010)', () => {
    it('groups income by income type with exact whole-percentage shares', async () => {
      await income(300_000n, SEPTEMBER, 'OFFERING');
      await income(100_000n, SEPTEMBER, 'DONATION');

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.incomeBreakdown.total).toBe('4000.00');
      const offering = view.incomeBreakdown.slices.find((slice) => slice.key === 'OFFERING');
      const donation = view.incomeBreakdown.slices.find((slice) => slice.key === 'DONATION');

      expect(offering?.amount).toBe('3000.00');
      expect(offering?.sharePercent).toBe('75.00');
      expect(donation?.sharePercent).toBe('25.00');
    });

    it('rounds a repeating share exactly rather than truncating or drifting', async () => {
      // Three equal parts of a total that does not divide by three: 1000 paise each of 3001.
      // A floating-point share would report 33.33 three times, which does not reach 100.00.
      await income(1_000n, SEPTEMBER, 'OFFERING');
      await income(1_000n, SEPTEMBER, 'DONATION');
      await expense(1_001n, SEPTEMBER, electricityId, 'CASH');

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      const total = view.expenseBreakdown.slices[0];
      expect(total?.sharePercent).toBe('100.00');
    });

    it('reports a zero share rather than dividing by zero on an empty breakdown', async () => {
      await income(500n, SEPTEMBER);

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.expenseBreakdown.slices).toEqual([]);
      expect(view.incomeBreakdown.slices[0]?.sharePercent).toBe('100.00');
    });

    it('labels an expense category with its stored name and flags it as a custom label', async () => {
      const food = await harness.categories.create('Food', actorAdminId);
      await expense(50_000n, SEPTEMBER, electricityId);
      await expense(25_000n, SEPTEMBER, food.id);

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.expenseBreakdown.total).toBe('750.00');
      expect(view.expenseBreakdown.slices.map((slice) => slice.label)).toEqual([
        'Electricity',
        'Food',
      ]);
      // Admin-entered text, so the browser must render it as plain text rather than markup.
      expect(view.expenseBreakdown.slices.every((slice) => slice.customLabel)).toBe(true);
      expect(view.expenseBreakdown.slices[0]?.sharePercent).toBe('66.67');
    });

    it('marks a closed income-type label as not custom', async () => {
      await income(100_000n, SEPTEMBER, 'OFFERING');

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.incomeBreakdown.slices[0]?.customLabel).toBe(false);
    });
  });

  describe('member count as of the period end (REQ-DASH-004, REQ-DASH-018)', () => {
    it('counts only members created on or before the period end', async () => {
      const early = await harness.members.create({ name: 'Anil Thomas' }, actorAdminId);
      const late = await harness.members.create({ name: 'Mary Joseph' }, actorAdminId);

      // Backdate the first member into August and push the second into November.
      await harness.runtime.member.update({
        where: { id: early.id },
        data: { createdAt: new Date('2026-08-15T06:00:00.000Z') },
      });
      await harness.runtime.member.update({
        where: { id: late.id },
        data: { createdAt: new Date('2026-11-02T06:00:00.000Z') },
      });

      const september = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );
      const november = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-11-01', to: '2026-11-30' }),
      );

      // A member added in November must not appear in an October or September dashboard.
      expect(september.memberCount).toBe(1);
      expect(november.memberCount).toBe(2);
    });

    it('counts a member created late on the period-end date in Asia/Kolkata', async () => {
      // 20:30 UTC on the 30th is 02:00 on the 31st in Asia/Kolkata, so this member exists on the
      // 31st and must not count toward a period ending on the 30th.
      const member = await harness.members.create({ name: 'Joseph Kurian' }, actorAdminId);
      await harness.runtime.member.update({
        where: { id: member.id },
        data: { createdAt: new Date('2026-09-30T20:30:00.000Z') },
      });

      const throughSeptember = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );
      const throughOctober = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-10-01' }),
      );

      expect(throughSeptember.memberCount).toBe(0);
      expect(throughOctober.memberCount).toBe(1);
    });
  });

  describe('contribution buckets (REQ-CONTRIB-005, REQ-CONTRIB-006)', () => {
    it('counts paid, partially paid, and unpaid member-months separately', async () => {
      const paid = await harness.members.create({ name: 'Paid Member' }, actorAdminId);
      const partial = await harness.members.create({ name: 'Partial Member' }, actorAdminId);
      const unpaid = await harness.members.create({ name: 'Unpaid Member' }, actorAdminId);

      // All three joined before September. Their `created_at` is backdated because the fixtures
      // are September records: a member who joined in October could not have a September
      // contribution, and leaving the real clock time in place would make `membersByMonthEnd`
      // zero and hide the very distinction these tests exist to prove.
      await setMemberCreatedAt(paid.id, '2026-06-01T06:00:00.000Z');
      await setMemberCreatedAt(partial.id, '2026-06-01T06:00:00.000Z');
      await setMemberCreatedAt(unpaid.id, '2026-06-01T06:00:00.000Z');

      await harness.contributions.create(
        { memberId: paid.id, year: 2026, month: 9, expectedPaise: 50_000n },
        actorAdminId,
      );
      await harness.contributions.create(
        { memberId: partial.id, year: 2026, month: 9, expectedPaise: 50_000n },
        actorAdminId,
      );
      await harness.contributions.create(
        { memberId: unpaid.id, year: 2026, month: 9, expectedPaise: 50_000n },
        actorAdminId,
      );

      const paidPeriod = await harness.contributions.find(paid.id, 2026, 9);
      const partialPeriod = await harness.contributions.find(partial.id, 2026, 9);

      await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 50_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          incomeType: 'MEMBER_CONTRIBUTION',
          memberId: paid.id,
          contributionPeriodId: paidPeriod?.id ?? null,
        },
        { actorAdminId },
      );
      await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 20_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          incomeType: 'MEMBER_CONTRIBUTION',
          memberId: partial.id,
          contributionPeriodId: partialPeriod?.id ?? null,
        },
        { actorAdminId },
      );

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      const september = view.contributionStatus.months[0];
      expect(september?.counts).toMatchObject({
        paid: 1,
        partiallyPaid: 1,
        notPaid: 1,
        configured: 3,
        notConfigured: 0,
        membersByMonthEnd: 3,
      });
    });

    it('reports a member with no expected period as not configured, not unpaid', async () => {
      // The whole point of REQ-CONTRIB-006: a month nobody configured must not be read as a
      // month somebody failed to pay.
      const configured = await harness.members.create({ name: 'Configured' }, actorAdminId);
      const unconfigured = await harness.members.create({ name: 'Unconfigured' }, actorAdminId);

      // Both joined before September; only one has a September expectation.
      await setMemberCreatedAt(configured.id, '2026-06-01T06:00:00.000Z');
      await setMemberCreatedAt(unconfigured.id, '2026-06-01T06:00:00.000Z');

      await harness.contributions.create(
        { memberId: configured.id, year: 2026, month: 9, expectedPaise: 50_000n },
        actorAdminId,
      );

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      const september = view.contributionStatus.months[0];
      expect(september?.counts).toMatchObject({
        configured: 1,
        notPaid: 1,
        notConfigured: 1,
        membersByMonthEnd: 2,
      });
      expect(unconfigured.id).toBeTruthy();
    });

    it('uses a member denominator that grows as members are added across the period', async () => {
      const august = await harness.members.create({ name: 'August Member' }, actorAdminId);
      await setMemberCreatedAt(august.id, '2026-08-10T06:00:00.000Z');
      const september = await harness.members.create({ name: 'September Member' }, actorAdminId);
      await setMemberCreatedAt(september.id, '2026-09-10T06:00:00.000Z');

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-08-01', to: '2026-09-30' }),
      );

      const [augustBucket, septemberBucket] = view.contributionStatus.months;
      expect(augustBucket?.month).toBe('2026-08');
      expect(augustBucket?.counts.membersByMonthEnd).toBe(1);
      expect(septemberBucket?.month).toBe('2026-09');
      expect(septemberBucket?.counts.membersByMonthEnd).toBe(2);
    });

    it('counts each month of the period separately rather than each member once', async () => {
      const member = await harness.members.create({ name: 'Multi Month' }, actorAdminId);
      await setMemberCreatedAt(member.id, '2026-07-01T06:00:00.000Z');

      await harness.contributions.create(
        { memberId: member.id, year: 2026, month: 8, expectedPaise: 50_000n },
        actorAdminId,
      );
      await harness.contributions.create(
        { memberId: member.id, year: 2026, month: 9, expectedPaise: 50_000n },
        actorAdminId,
      );

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-08-01', to: '2026-09-30' }),
      );

      // Two configured member-months for one member, so `configured` is 2 across the period.
      expect(view.contributionStatus.totals.configured).toBe(2);
      expect(view.contributionStatus.months).toHaveLength(2);
    });

    it('lowers a bucket back to unpaid when the contribution is voided', async () => {
      const member = await harness.members.create({ name: 'Voided Payer' }, actorAdminId);
      await setMemberCreatedAt(member.id, '2026-06-01T06:00:00.000Z');
      await harness.contributions.create(
        { memberId: member.id, year: 2026, month: 9, expectedPaise: 50_000n },
        actorAdminId,
      );
      const period = await harness.contributions.find(member.id, 2026, 9);

      const contribution = await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 50_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          incomeType: 'MEMBER_CONTRIBUTION',
          memberId: member.id,
          contributionPeriodId: period?.id ?? null,
        },
        { actorAdminId },
      );

      const before = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );
      expect(before.contributionStatus.months[0]?.counts.paid).toBe(1);

      await harness.transactions.voidTransaction(contribution.id, 'Wrong member', {
        actorAdminId,
      });

      const after = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );
      expect(after.contributionStatus.months[0]?.counts.paid).toBe(0);
      expect(after.contributionStatus.months[0]?.counts.notPaid).toBe(1);
      expect(after.movement.income).toBe('0.00');
    });
  });

  describe('recent transactions (REQ-DASH-013)', () => {
    it('returns newest business date first', async () => {
      const older = await income(100_000n, SEPTEMBER);
      const newer = await income(200_000n, new Date('2026-09-20T00:00:00.000Z'));

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.recentTransactions.map((row) => row.id)).toEqual([newer.id, older.id]);
      expect(view.recentTransactionCount).toBe(2);
    });

    it('returns the entry recorded last first within a single business date', async () => {
      // `occurred_at` is the start of the business date, so it is identical for every row
      // sharing that date and cannot order them. The recorded instant must break the tie.
      const first = await income(100_000n, SEPTEMBER);
      const second = await income(200_000n, SEPTEMBER);
      const third = await income(300_000n, SEPTEMBER);

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.recentTransactions.map((row) => row.id)).toEqual([third.id, second.id, first.id]);
    });

    it('keeps the newest entry inside the bound when many share one business date', async () => {
      const rows = [];
      for (let index = 0; index < 14; index += 1) {
        rows.push(await income(BigInt(1000 + index), SEPTEMBER));
      }

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      const last = rows[rows.length - 1];
      expect(view.recentTransactions).toHaveLength(10);
      expect(view.recentTransactions[0]?.id).toBe(last?.id);
      expect(view.recentTransactions.map((row) => row.id)).not.toContain(rows[0]?.id);
    });

    it('bounds the list and reports how many rows it returned', async () => {
      for (let index = 0; index < 14; index += 1) {
        await income(
          BigInt(1000 + index),
          new Date(`2026-09-${String(index + 1).padStart(2, '0')}`),
        );
      }

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.recentTransactions).toHaveLength(10);
      expect(view.recentTransactionCount).toBe(10);
    });

    it('carries the labels the recent row shows', async () => {
      const member = await harness.members.create({ name: 'Grace Maria' }, actorAdminId);
      await harness.contributions.create(
        { memberId: member.id, year: 2026, month: 9, expectedPaise: 50_000n },
        actorAdminId,
      );
      const period = await harness.contributions.find(member.id, 2026, 9);

      const contribution = await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 50_000n,
          paymentMethod: 'UPI',
          businessDate: SEPTEMBER,
          occurredAt: new Date(),
          incomeType: 'MEMBER_CONTRIBUTION',
          memberId: member.id,
          contributionPeriodId: period?.id ?? null,
          description: 'September offering',
        },
        { actorAdminId },
      );

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );
      const row = view.recentTransactions[0];

      expect(row).toMatchObject({
        id: contribution.id,
        type: 'INCOME',
        amount: '500.00',
        paymentMethod: 'UPI',
        businessDate: '2026-09-01',
        description: 'September offering',
        incomeType: 'MEMBER_CONTRIBUTION',
        memberName: 'Grace Maria',
        hasReceipt: false,
        active: true,
      });
      expect(row?.referenceId).toMatch(/^HY-INC-/);
    });

    it('reports has_receipt only for an available document', async () => {
      const withReceipt = await expense(50_000n, SEPTEMBER);

      await harness.documents.record({
        transactionId: withReceipt.id,
        storageKey: 'dashboard/receipt-test.pdf',
        originalFilename: 'receipt.pdf',
        declaredMimeType: 'application/pdf',
        detectedMimeType: 'application/pdf',
        byteSize: 1_024,
        checksumSha256: 'a'.repeat(64),
        uploadedByAdminId: actorAdminId,
      });

      await expense(60_000n, SEPTEMBER);

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );
      const byId = new Map(view.recentTransactions.map((row) => [row.id, row]));

      expect(byId.get(withReceipt.id)?.hasReceipt).toBe(true);
      // The other expense has no document at all.
      const withoutReceipt = view.recentTransactions.find((row) => !row.hasReceipt);
      expect(withoutReceipt).toBeDefined();
    });

    it('reports has_receipt false once the document is removed', async () => {
      const withReceipt = await expense(50_000n, SEPTEMBER);
      const document = await harness.documents.record({
        transactionId: withReceipt.id,
        storageKey: 'dashboard/receipt-removed.pdf',
        originalFilename: 'receipt.pdf',
        declaredMimeType: 'application/pdf',
        detectedMimeType: 'application/pdf',
        byteSize: 1_024,
        checksumSha256: 'b'.repeat(64),
        uploadedByAdminId: actorAdminId,
      });

      const before = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );
      expect(before.recentTransactions[0]?.hasReceipt).toBe(true);

      await harness.documents.remove({
        documentId: document.id,
        removalReason: 'Uploaded to the wrong record',
        removedByAdminId: actorAdminId,
      });

      const after = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );
      // A removed receipt must not be offered as a link that would answer 410.
      expect(after.recentTransactions[0]?.hasReceipt).toBe(false);
    });
  });

  describe('period view (REQ-DASH-016)', () => {
    it('returns the exact inclusive bounds it used, not just the preset name', async () => {
      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-05', to: '2026-09-20' }),
      );

      expect(view.period).toEqual({
        preset: 'custom',
        label: '2026-09-05 to 2026-09-20',
        from: '2026-09-05',
        to: '2026-09-20',
        timezone: 'Asia/Kolkata',
      });
    });

    it('reports the preset name for a named period', async () => {
      const view = await dashboard.dashboard(resolvePresetPeriod('lastMonth', SEPTEMBER));

      expect(view.period.preset).toBe('lastMonth');
      expect(view.period.label).toBe('Last Month');
    });

    it('always reports INR as the currency', async () => {
      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.currency).toBe('INR');
    });
  });

  describe('boundaries (REQ-DASH-017)', () => {
    it('includes the period end date and excludes the day after it', async () => {
      await income(100_000n, SEPTEMBER_END);
      await income(200_000n, OCTOBER);

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.movement.income).toBe('1000.00');
    });

    it('includes the period start date and excludes the day before it', async () => {
      await income(300_000n, SEPTEMBER);
      await income(400_000n, AUGUST);

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' }),
      );

      expect(view.movement.income).toBe('3000.00');
    });

    it('covers every transaction on a single-day period', async () => {
      await income(100_000n, SEPTEMBER);
      await income(200_000n, new Date('2026-09-02T00:00:00.000Z'));

      const view = await dashboard.dashboard(
        resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-01' }),
      );

      expect(view.movement.income).toBe('1000.00');
      expect(view.trend).toHaveLength(1);
      expect(view.contributionStatus.months).toHaveLength(1);
    });
  });
});
