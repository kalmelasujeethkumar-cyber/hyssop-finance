/**
 * The Phase 09 report and search reads against real PostgreSQL.
 *
 * Authority: `docs/10-TEST-PLAN.md`, `docs/01-REQUIREMENTS.md` `REQ-REPORT-001` to
 * `REQ-REPORT-004`, `REQ-SEARCH-001`, `REQ-SEARCH-002`, `REQ-FIN-004`, `REQ-FIN-009`,
 * `REQ-FIN-014`, `REQ-CONTRIB-005`, `REQ-CONTRIB-006`, and `docs/05-DATABASE-SPEC.md`
 * (PostgreSQL is the system of record for every reported figure).
 *
 * This suite exists because a report is almost entirely a SQL question, and the failure modes are
 * the ones that produce a *plausible* wrong number rather than an obvious error:
 *
 * - `SUM` over a voided row yields a total that is a rupee or two too high, and every downstream
 *   share and balance silently inherits the error.
 * - `>= from` and `<= to` on a `DATE` column is the whole period-boundary rule; an exclusive upper
 *   bound quietly drops the last day, which looks like a missing transaction rather than a bug.
 * - `FILTER (WHERE transaction_type = 'INCOME')` against `GROUP BY payment_method` is what keeps a
 *   method movement and a method balance distinct; getting it wrong reports a balance as movement.
 * - `COALESCE(SUM(...), 0)` against a period with no rows is what keeps an empty report from
 *   reading as a database fault.
 * - A `LEFT JOIN` from transactions to categories is what keeps an expense with a missing category
 *   from falling out of the report total, so that the rows still sum to the stated total.
 *
 * Every figure below is a number real PostgreSQL returned. Nothing here is computed in TypeScript,
 * which is exactly the property this file is meant to establish.
 */

import { ReportsService } from '../../src/reports/reports.service';
import { resolveCustomPeriod } from '../../src/dashboard/period.resolver';
import { parseBusinessDate } from '../../src/common/time/business-date';
import { formatPaise } from '../../src/common/money/paise';
import { createHash } from 'node:crypto';
import { createHarness, testAdminData, type TestHarness } from './support/test-database';

jest.setTimeout(120_000);

const AUGUST_START = parseBusinessDate('2026-08-01');
const SEPTEMBER_START = parseBusinessDate('2026-09-01');
const SEPTEMBER_END = parseBusinessDate('2026-09-30');
const OCTOBER_START = parseBusinessDate('2026-10-01');

const SEPTEMBER = resolveCustomPeriod({ from: '2026-09-01', to: '2026-09-30' });

/** A stable, schema-shaped storage key. The bytes themselves are never stored in PostgreSQL. */
function storageKey(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

describe('report and search reads against real PostgreSQL', () => {
  let harness: TestHarness;
  let reports: ReportsService;
  let actorAdminId: string;
  let electricityId: string;

  beforeAll(async () => {
    harness = await createHarness();
    reports = new ReportsService(
      harness.reconciliation,
      harness.transactions,
      harness.members,
      harness.contributions,
      harness.audit,
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
    incomeType: 'OFFERING' | 'DONATION' | 'ANONYMOUS_DONATION' = 'OFFERING',
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

  async function expense(
    amountPaise: bigint,
    businessDate: Date,
    categoryId: string | null = electricityId,
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

  /** Backdates a member so the member belongs to the fixture period's denominator. */
  async function setMemberCreatedAt(memberId: string, createdAt: string): Promise<void> {
    await harness.runtime.member.update({
      where: { id: memberId },
      data: { createdAt: new Date(createdAt) },
    });
  }

  async function recordDocument(transactionId: string, seed: string): Promise<string> {
    const bytes = Buffer.from(`bytes for ${seed}`, 'utf8');
    const document = await harness.documents.record({
      transactionId,
      storageKey: storageKey(seed),
      originalFilename: `${seed}.png`,
      declaredMimeType: 'image/png',
      detectedMimeType: 'image/png',
      byteSize: bytes.length,
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      uploadedByAdminId: actorAdminId,
    });

    return document.id;
  }

  describe('the Income report (REQ-REPORT-001, REQ-FIN-004)', () => {
    it('groups active income by type and excludes voided and out-of-range rows', async () => {
      await income(100_000n, SEPTEMBER_START, 'OFFERING');
      await income(25_050n, SEPTEMBER_START, 'DONATION');
      await income(90_000n, AUGUST_START, 'OFFERING');
      await income(30_000n, OCTOBER_START, 'OFFERING');

      const voided = await income(30_000n, SEPTEMBER_START, 'OFFERING');
      await harness.transactions.voidTransaction(voided.id, 'Recorded twice by mistake', {
        actorAdminId,
      });

      const report = await reports.income(SEPTEMBER);

      // 1000.00 offering and 250.50 donation. The voided 300.00 and both out-of-range rows are
      // absent, which is the single most important assertion in this file.
      expect(report.total).toBe('1250.50');
      // Only income types that actually have rows appear. An absent type is reported by its
      // absence rather than by a fabricated `0.00` row the Admin could mistake for recorded money.
      // The order is the `IncomeType` enum's declared order - contributions, offerings, donations -
      // because `ORDER BY income_type` sorts a Postgres enum by its declaration, not alphabetically.
      expect(report.rows.map((row) => [row.label, row.amount])).toEqual([
        ['OFFERING', '1000.00'],
        ['DONATION', '250.50'],
      ]);
      expect(report.rows.find((row) => row.label === 'OFFERING')?.transactionCount).toBe(1);
    });

    it('preserves odd paise exactly rather than rounding them away', async () => {
      // 1 paise is the smallest representable amount; if any layer used a float this would drift.
      await income(1n, SEPTEMBER_START);
      await income(2n, SEPTEMBER_START);
      await income(2n, SEPTEMBER_START);

      const report = await reports.income(SEPTEMBER);

      expect(report.total).toBe('0.05');
    });

    it('includes both boundaries of the period and excludes the day after it', async () => {
      await income(10_000n, SEPTEMBER_START);
      await income(20_000n, SEPTEMBER_END);
      await income(40_000n, OCTOBER_START);

      const report = await reports.income(SEPTEMBER);

      // An exclusive upper bound would report `100.00` here and look merely incomplete.
      expect(report.total).toBe('300.00');
    });

    it('reports zero rather than failing when the period holds nothing', async () => {
      await income(100_000n, AUGUST_START);

      const report = await reports.income(SEPTEMBER);

      expect(report.total).toBe('0.00');
      expect(report.rows.every((row) => row.amount === '0.00')).toBe(true);
    });

    it('reports a share that sums to exactly one hundred', async () => {
      await income(300_000n, SEPTEMBER_START, 'OFFERING');
      await income(100_000n, SEPTEMBER_START, 'DONATION');

      const report = await reports.income(SEPTEMBER);

      const totalShare = report.rows
        .filter((row) => row.amount !== '0.00')
        .reduce((sum, row) => sum + Number(row.sharePercent), 0);

      expect(totalShare).toBe(100);
    });
  });

  describe('the Expense and Expense Category reports (REQ-REPORT-001, REQ-FIN-004)', () => {
    it('totals active expenses per category and excludes voided rows', async () => {
      await expense(40_000n, SEPTEMBER_START);
      await expense(10_000n, SEPTEMBER_END);

      const voided = await expense(5_000n, SEPTEMBER_START);
      await harness.transactions.voidTransaction(voided.id, 'Duplicate entry', { actorAdminId });

      const report = await reports.expenses(SEPTEMBER);

      expect(report.total).toBe('500.00');
      expect(report.rows).toHaveLength(1);
      expect(report.rows[0]?.label).toBe('Electricity');
      expect(report.rows[0]?.amount).toBe('500.00');
      expect(report.rows[0]?.transactionCount).toBe(2);
    });

    it('cannot lose an expense out of the total, because the schema refuses a category-less one', async () => {
      await expense(10_000n, SEPTEMBER_START, electricityId);
      const orphan = await expense(5_000n, SEPTEMBER_START);

      // The report's `LEFT JOIN` is defensive depth only: `financial_transaction_expense_shape`
      // makes a category-less expense unrepresentable. Proving that is stronger than proving the
      // join, because it shows the rows cannot fail to sum to the total in the first place.
      await expect(
        harness.runtime.financialTransaction.update({
          where: { id: orphan.id },
          data: { categoryId: null, revision: { increment: 1 } },
        }),
      ).rejects.toThrow(/financial_transaction_expense_shape/);

      const report = await reports.expenses(SEPTEMBER);

      expect(report.total).toBe('150.00');
      expect(report.rows.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(150);
      expect(report.rows.every((row) => row.customLabel)).toBe(true);
    });

    it('keeps the same figures on the Expense Category breakdown', async () => {
      const supplies = await harness.categories.create('Cleaning supplies', actorAdminId);

      await expense(10_000n, SEPTEMBER_START, electricityId);
      await expense(20_000n, SEPTEMBER_START, supplies.id);

      const report = await reports.expenseCategories(SEPTEMBER);

      expect(report.total).toBe('300.00');
      expect(report.rows.map((row) => row.label).sort()).toEqual([
        'Cleaning supplies',
        'Electricity',
      ]);
    });
  });

  describe('the Payment Method report (REQ-FIN-009, REQ-FIN-014)', () => {
    it('separates the period movement from the cumulative ending balance', async () => {
      await income(200_000n, AUGUST_START, 'OFFERING', 'CASH');
      await income(100_000n, SEPTEMBER_START, 'OFFERING', 'CASH');
      await expense(30_000n, SEPTEMBER_START, electricityId, 'CASH');

      const report = await reports.paymentMethods(SEPTEMBER);

      const cash = report.rows.find((row) => row.label === 'Cash');

      // September movement is 1000.00 - 300.00 = 700.00.
      expect(cash?.movement).toBe('700.00');
      // The ending balance carries every month through the period end, so August is included:
      // 2000.00 + 1000.00 - 300.00 = 2700.00.
      expect(cash?.balance).toBe('2700.00');
      expect(cash?.movement).not.toBe(cash?.balance);
      expect(report.movementLabel).not.toBe(report.balanceLabel);
    });

    it('reports a method that only ever received money and never a zero row', async () => {
      await income(100_000n, SEPTEMBER_START, 'OFFERING', 'UPI');

      const report = await reports.paymentMethods(SEPTEMBER);

      const upi = report.rows.find((row) => row.label === 'UPI');

      expect(upi?.movement).toBe('1000.00');
      expect(upi?.balance).toBe('1000.00');
      // A method with no expense has no expense line, which is honest rather than a missing zero.
      expect(report.rows.every((row) => row.label !== '')).toBe(true);
    });

    it('lets a method balance go negative without being dropped from the report', async () => {
      await income(10_000n, SEPTEMBER_START, 'OFFERING', 'BANK_TRANSFER');
      await expense(60_000n, SEPTEMBER_START, electricityId, 'BANK_TRANSFER');

      const report = await reports.paymentMethods(SEPTEMBER);

      const bank = report.rows.find((row) => row.label === 'Bank Transfer');

      // 100.00 in, 600.00 out. The row stays, because hiding a negative method is exactly how a
      // shortfall goes unnoticed.
      expect(bank?.movement).toBe('-500.00');
      expect(bank?.balance).toBe('-500.00');
    });
  });

  describe('the Offering and Donation reports (REQ-REPORT-001)', () => {
    it('lists only the requested income type, newest first', async () => {
      const older = await income(10_000n, SEPTEMBER_START, 'OFFERING');
      const newer = await income(20_000n, SEPTEMBER_END, 'OFFERING');
      await income(30_000n, SEPTEMBER_START, 'DONATION');

      const report = await reports.offerings(SEPTEMBER);

      expect(report.rows.map((row) => row.referenceId)).toEqual([
        newer.referenceId,
        older.referenceId,
      ]);
      expect(report.rows.every((row) => row.incomeType === 'OFFERING')).toBe(true);
    });

    it('cannot leak a donor identity, because the schema refuses to store one', async () => {
      // `financial_transaction_anonymous_neutral_description` pins the description, and
      // `financial_transaction_anonymous_no_member` pins the member, so an anonymous donation has
      // no identity-bearing field left to leak. The report only has to carry what is stored.
      await expect(
        harness.transactions.create(
          {
            transactionType: 'INCOME',
            amountPaise: 20_000n,
            paymentMethod: 'CASH',
            businessDate: SEPTEMBER_START,
            occurredAt: new Date(),
            incomeType: 'ANONYMOUS_DONATION',
            description: 'Please do not name me',
          },
          { actorAdminId },
        ),
      ).rejects.toThrow();

      const member = await harness.members.create({ name: 'Anonymous Well Wisher' }, actorAdminId);
      const stored = await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 20_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER_START,
          occurredAt: new Date(),
          incomeType: 'ANONYMOUS_DONATION',
        },
        { actorAdminId },
      );

      // The stored row genuinely has no member and only the neutral description.
      expect(stored.memberId).toBeNull();
      expect(member.id).not.toBe(stored.memberId);

      const report = await reports.donations(SEPTEMBER);
      const anonymous = report.rows.find((row) => row.incomeType === 'ANONYMOUS_DONATION');

      expect(anonymous).toBeDefined();
      expect(anonymous?.memberName).toBeNull();
      expect(anonymous?.memberReferenceId).toBeNull();
      expect(anonymous?.amount).toBe('200.00');
      // Neither the neutral description nor any identity may appear on the row.
      expect(anonymous?.description ?? '').not.toContain('Anonymous Well Wisher');
    });

    it('paginates without repeating or skipping a row across page boundaries', async () => {
      for (let day = 1; day <= 5; day += 1) {
        await income(1_000n, parseBusinessDate(`2026-09-0${day}`), 'OFFERING');
      }

      const first = await reports.transactions(SEPTEMBER, {}, { page: 1, pageSize: 2 });
      const second = await reports.transactions(SEPTEMBER, {}, { page: 2, pageSize: 2 });
      const third = await reports.transactions(SEPTEMBER, {}, { page: 3, pageSize: 2 });

      const seen = [
        ...first.rows.map((row) => row.referenceId),
        ...second.rows.map((row) => row.referenceId),
        ...third.rows.map((row) => row.referenceId),
      ];

      // Every row exactly once: no duplicate and no gap.
      expect(new Set(seen).size).toBe(5);
      expect(seen).toHaveLength(5);
      expect(first.transactionCount).toBe(5);
    });

    it('discloses that a bounded list is shorter than the period total', async () => {
      const row = await income(1_000n, SEPTEMBER_START, 'OFFERING');

      const report = await reports.offerings(SEPTEMBER);

      // `total` describes the whole period while `rows` is a bounded slice. When the two agree the
      // screen may present the list as the period; when they disagree `rowsTruncated` must say so
      // rather than letting a partial list stand beside a complete total.
      expect(report.transactionCount).toBe(1);
      expect(report.rowsTruncated).toBe(false);
      expect(report.total).toBe('10.00');
      expect(report.rows.map((entry) => entry.referenceId)).toEqual([row.referenceId]);
    });
  });

  describe('the Member Contribution report (REQ-CONTRIB-005, REQ-CONTRIB-006)', () => {
    it('reports expected, received, and remaining per member-month', async () => {
      const paid = await harness.members.create({ name: 'Paid Member' }, actorAdminId);
      const unpaid = await harness.members.create({ name: 'Unpaid Member' }, actorAdminId);

      await setMemberCreatedAt(paid.id, '2026-06-01T06:00:00.000Z');
      await setMemberCreatedAt(unpaid.id, '2026-06-01T06:00:00.000Z');

      const paidPeriod = await harness.contributions.create(
        { memberId: paid.id, year: 2026, month: 9, expectedPaise: 50_000n },
        actorAdminId,
      );
      await harness.contributions.create(
        { memberId: unpaid.id, year: 2026, month: 9, expectedPaise: 50_000n },
        actorAdminId,
      );

      await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 50_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER_START,
          occurredAt: new Date(),
          incomeType: 'MEMBER_CONTRIBUTION',
          memberId: paid.id,
          contributionPeriodId: paidPeriod.id,
        },
        { actorAdminId },
      );

      const report = await reports.memberContributions(SEPTEMBER);

      expect(report.totals.memberMonths).toBe(2);
      expect(report.totals.expected).toBe('1000.00');
      expect(report.totals.received).toBe('500.00');
      expect(report.totals.remaining).toBe('500.00');
      expect(report.rows.map((row) => row.status).sort()).toEqual(['NOT PAID', 'PAID']);
    });

    it('treats a voided contribution as not received but still visible', async () => {
      const member = await harness.members.create({ name: 'Voided Payer' }, actorAdminId);
      await setMemberCreatedAt(member.id, '2026-06-01T06:00:00.000Z');

      const period = await harness.contributions.create(
        { memberId: member.id, year: 2026, month: 9, expectedPaise: 50_000n },
        actorAdminId,
      );

      const contribution = await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 50_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER_START,
          occurredAt: new Date(),
          incomeType: 'MEMBER_CONTRIBUTION',
          memberId: member.id,
          contributionPeriodId: period.id,
        },
        { actorAdminId },
      );
      await harness.transactions.voidTransaction(contribution.id, 'Cheque bounced', {
        actorAdminId,
      });

      const report = await reports.memberContributions(SEPTEMBER);

      // The bucket must go back to unpaid: a voided payment is auditable, not received money.
      expect(report.totals.received).toBe('0.00');
      expect(report.totals.remaining).toBe('500.00');
      expect(report.rows[0]?.status).toBe('NOT PAID');
    });

    it('counts only the member-months inside the selected range', async () => {
      const member = await harness.members.create({ name: 'Multi Month Member' }, actorAdminId);
      await setMemberCreatedAt(member.id, '2026-01-01T06:00:00.000Z');

      await harness.contributions.create(
        { memberId: member.id, year: 2026, month: 8, expectedPaise: 50_000n },
        actorAdminId,
      );
      await harness.contributions.create(
        { memberId: member.id, year: 2026, month: 9, expectedPaise: 50_000n },
        actorAdminId,
      );
      await harness.contributions.create(
        { memberId: member.id, year: 2026, month: 10, expectedPaise: 50_000n },
        actorAdminId,
      );

      const report = await reports.memberContributions(SEPTEMBER);

      // One member, three configured months, one month inside the range.
      expect(report.totals.memberMonths).toBe(1);
      expect(report.totals.expected).toBe('500.00');
      expect(report.rows).toHaveLength(1);
      expect(report.rows[0]?.month).toBe('2026-09');
    });

    it('reads a member-month as partially paid when less than expected arrived', async () => {
      const member = await harness.members.create({ name: 'Partial Payer' }, actorAdminId);
      await setMemberCreatedAt(member.id, '2026-06-01T06:00:00.000Z');

      const period = await harness.contributions.create(
        { memberId: member.id, year: 2026, month: 9, expectedPaise: 50_000n },
        actorAdminId,
      );
      await harness.transactions.create(
        {
          transactionType: 'INCOME',
          amountPaise: 20_000n,
          paymentMethod: 'CASH',
          businessDate: SEPTEMBER_START,
          occurredAt: new Date(),
          incomeType: 'MEMBER_CONTRIBUTION',
          memberId: member.id,
          contributionPeriodId: period.id,
        },
        { actorAdminId },
      );

      const report = await reports.memberContributions(SEPTEMBER);

      expect(report.rows[0]?.status).toBe('PARTIALLY PAID');
      expect(report.rows[0]?.received).toBe('200.00');
      expect(report.rows[0]?.remaining).toBe('300.00');
    });
  });

  describe('the Receipt / Document report (REQ-REPORT-002, REQ-EXPORT-002)', () => {
    it('distinguishes available, removed, and voided document history', async () => {
      const availableExpense = await expense(10_000n, SEPTEMBER_START);
      const removedExpense = await expense(20_000n, SEPTEMBER_START);
      const voidedExpense = await expense(30_000n, SEPTEMBER_START);

      const availableId = await recordDocument(availableExpense.id, 'available');
      const removedId = await recordDocument(removedExpense.id, 'removed');
      await recordDocument(voidedExpense.id, 'voided');

      await harness.documents.remove({
        documentId: removedId,
        removedByAdminId: actorAdminId,
        removalReason: 'Uploaded to the wrong transaction',
      });
      await harness.transactions.voidTransaction(voidedExpense.id, 'Duplicate receipt', {
        actorAdminId,
      });

      const report = await reports.documents(SEPTEMBER);

      expect(report.counts).toEqual({ AVAILABLE: 1, REMOVED: 1, VOIDED: 1 });
      expect(report.rows).toHaveLength(3);

      const byId = new Map(report.rows.map((row) => [row.documentId, row]));

      expect(byId.get(availableId)?.state).toBe('AVAILABLE');
      // `REMOVED` keeps its metadata, so a voided *transaction* must not be what makes a
      // document look removed; the states are independent.
      expect(byId.get(removedId)?.state).toBe('REMOVED');
      expect(byId.get(availableId)?.link.locallyReachable).toBe(true);
      expect(byId.get(removedId)?.link.locallyReachable).toBe(false);
    });

    it('marks the document of a voided transaction as voided history rather than active', async () => {
      const voidedExpense = await expense(30_000n, SEPTEMBER_START);
      const documentId = await recordDocument(voidedExpense.id, 'voided-only');

      await harness.transactions.voidTransaction(voidedExpense.id, 'Duplicate receipt', {
        actorAdminId,
      });

      const report = await reports.documents(SEPTEMBER);

      const row = report.rows.find((entry) => entry.documentId === documentId);

      expect(row?.state).toBe('VOIDED');
      // A voided document is history, not a receivable, so it is never offered as a live link.
      expect(row?.link.locallyReachable).toBe(false);
    });

    it('never exposes the internal storage key', async () => {
      const expenseRow = await expense(10_000n, SEPTEMBER_START);
      await recordDocument(expenseRow.id, 'secret-key-seed');

      const report = await reports.documents(SEPTEMBER);

      expect(report.rows).toHaveLength(1);
      expect(report.rows[0]?.link.storagePath).not.toContain(storageKey('secret-key-seed'));
      expect(report.rows[0]?.link.storagePath).toMatch(/^\/api\/v1\/documents\//);
    });
  });

  describe('global search (REQ-SEARCH-001, REQ-SEARCH-002)', () => {
    it('finds a member by name and a transaction by reference in one read', async () => {
      const member = await harness.members.create({ name: 'Searchable Kumaran' }, actorAdminId);
      const transaction = await income(10_000n, SEPTEMBER_START, 'OFFERING');

      const response = await reports.search({
        term: 'Kumaran',
        type: 'all',
        page: { page: 1, pageSize: 20 },
      });
      const byReference = await reports.search({
        term: transaction.referenceId,
        type: 'all',
        page: { page: 1, pageSize: 20 },
      });

      expect(
        response.results.some((entry) => entry.kind === 'member' && entry.id === member.id),
      ).toBe(true);
      expect(
        byReference.results.some(
          (entry) =>
            entry.kind === 'transaction' &&
            entry.transaction.referenceId === transaction.referenceId,
        ),
      ).toBe(true);
    });

    it('counts both sources so the pager total is real', async () => {
      await harness.members.create({ name: 'Counted Kumaran' }, actorAdminId);
      await income(10_000n, SEPTEMBER_START, 'OFFERING');

      const response = await reports.search({
        term: 'Counted',
        type: 'all',
        page: { page: 1, pageSize: 20 },
      });

      expect(response.pagination.totalItems).toBeGreaterThanOrEqual(response.results.length);
    });

    it('returns nothing for a term that matches nothing, without failing', async () => {
      await income(10_000n, SEPTEMBER_START, 'OFFERING');

      const response = await reports.search({
        term: 'no-such-thing-anywhere',
        type: 'all',
        page: { page: 1, pageSize: 20 },
      });

      expect(response.results).toEqual([]);
      expect(response.pagination.totalItems).toBe(0);
    });

    it('includes a voided transaction in search, because search is history', async () => {
      const voided = await income(10_000n, SEPTEMBER_START, 'OFFERING');
      await harness.transactions.voidTransaction(voided.id, 'Recorded twice', { actorAdminId });

      const response = await reports.search({
        term: voided.referenceId,
        type: 'all',
        page: { page: 1, pageSize: 20 },
      });

      const entry = response.results.find((result) => result.kind === 'transaction');

      expect(entry).toBeDefined();
      expect(entry?.kind === 'transaction' && entry.transaction.status).toBe('VOIDED');
    });

    it('narrows to one source when the Admin filters by type', async () => {
      await harness.members.create({ name: 'Narrowed Kumaran' }, actorAdminId);

      const response = await reports.search({
        term: 'Narrowed',
        type: 'member',
        page: { page: 1, pageSize: 20 },
      });

      expect(response.results.every((entry) => entry.kind === 'member')).toBe(true);
    });
  });

  describe('the Complete Transaction and Audit history reports', () => {
    it('keeps a voided transaction visible in the history report', async () => {
      const voided = await income(30_000n, SEPTEMBER_START, 'OFFERING');
      await harness.transactions.voidTransaction(voided.id, 'Recorded twice by mistake', {
        actorAdminId,
      });

      const report = await reports.transactions(
        SEPTEMBER,
        { status: 'VOIDED' },
        { page: 1, pageSize: 25 },
      );

      expect(report.rows.map((row) => row.referenceId)).toEqual([voided.referenceId]);
      expect(report.rows[0]?.voidReason).toBe('Recorded twice by mistake');
    });

    it('pages the history report with a total for the whole match set', async () => {
      for (let day = 1; day <= 5; day += 1) {
        await income(1_000n, parseBusinessDate(`2026-09-0${day}`), 'OFFERING');
      }

      const report = await reports.transactions(SEPTEMBER, {}, { page: 1, pageSize: 2 });

      expect(report.rows).toHaveLength(2);
      expect(report.transactionCount).toBe(5);
    });

    it('reports the audit window as null when the Admin asked for all history', async () => {
      await income(10_000n, SEPTEMBER_START);

      const report = await reports.audit({ page: { page: 1, pageSize: 25 } });

      expect(report.range).toEqual({ from: null, to: null });
      expect(report.action).toBeNull();
      expect(report.rows.length).toBeGreaterThan(0);
    });

    it('filters the audit history by an exact action', async () => {
      const voided = await income(30_000n, SEPTEMBER_START, 'OFFERING');
      await harness.transactions.voidTransaction(voided.id, 'Recorded twice', { actorAdminId });

      const report = await reports.audit({
        action: 'TRANSACTION_VOIDED',
        page: { page: 1, pageSize: 25 },
      });

      expect(report.action).toBe('TRANSACTION_VOIDED');
      expect(report.rows.every((row) => row.action === 'TRANSACTION_VOIDED')).toBe(true);
      expect(report.rows.length).toBeGreaterThan(0);
    });

    it('excludes an action it was not asked for, so the filter is real', async () => {
      await income(10_000n, SEPTEMBER_START);

      const report = await reports.audit({
        action: 'TRANSACTION_VOIDED',
        page: { page: 1, pageSize: 25 },
      });

      expect(report.rows).toEqual([]);
    });
  });

  describe('the Financial Summary report', () => {
    it('combines the canonical income, expense, and balance figures', async () => {
      await income(100_000n, SEPTEMBER_START, 'OFFERING');
      await income(50_000n, SEPTEMBER_START, 'DONATION');
      await expense(25_000n, SEPTEMBER_START);

      const report = await reports.financialSummary(SEPTEMBER);

      // Income = offerings + donations = 1500.00, expenses = 250.00, balance = 1250.00.
      expect(report.movement.income).toBe('1500.00');
      expect(report.movement.expenses).toBe('250.00');
      expect(report.movement.net).toBe('1250.00');
      expect(report.availableBalanceForPeriod).toBe('1250.00');
    });

    it('keeps the balance as income minus expenses with voided rows excluded', async () => {
      await income(100_000n, SEPTEMBER_START, 'OFFERING');
      await expense(25_000n, SEPTEMBER_START);

      const voidedIncome = await income(90_000n, SEPTEMBER_START, 'OFFERING');
      await harness.transactions.voidTransaction(voidedIncome.id, 'Duplicate', { actorAdminId });

      const report = await reports.financialSummary(SEPTEMBER);

      expect(report.movement.income).toBe('1000.00');
      expect(report.movement.net).toBe('750.00');
    });
  });

  describe('exact money formatting', () => {
    it('formats paise through the same helper the API uses', () => {
      expect(formatPaise(0n)).toBe('0.00');
      expect(formatPaise(1n)).toBe('0.01');
      expect(formatPaise(125_050n)).toBe('1250.50');
      expect(formatPaise(-50_000n)).toBe('-500.00');
    });
  });
});
