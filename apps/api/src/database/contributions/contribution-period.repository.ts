import { Injectable } from '@nestjs/common';
import type { ContributionPeriod, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { conflict, notFound, validationFailed } from '../../common/errors/domain.errors';
import { remainingPaise } from '../../common/money/paise';
import { AuditEventRepository, AUDIT_ENTITY_TYPES } from '../audit/audit-event.repository';
import { PrismaService } from '../prisma/prisma.service';
import { deriveContributionStatus, type ContributionStatus } from './contribution-status';

export interface ContributionPeriodInput {
  readonly memberId: string;
  readonly year: number;
  readonly month: number;
  readonly expectedPaise: bigint;
}

export interface ContributionPeriodSummary {
  readonly period: ContributionPeriod;
  readonly receivedPaise: bigint;
  readonly remainingPaise: bigint;
  readonly status: ContributionStatus;
}

/**
 * The largest number of periods one filtered request may read.
 *
 * The `status` filter is applied to derived state, so the rows must be read and summed
 * before it can be answered. Without a bound, a query with no member or year filter would
 * derive every period in the database in one request, so the limit is explicit and the
 * service reports an over-large result rather than silently truncating it.
 */
export const CONTRIBUTION_PERIOD_FILTER_MAX = 500;

function validatedExpectedPaise(expectedPaise: bigint): bigint {
  if (expectedPaise <= 0n) {
    throw validationFailed('The expected contribution must be greater than zero.', {
      field: 'expectedPaise',
    });
  }

  return expectedPaise;
}

function validatePeriodBounds(year: number, month: number): void {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw validationFailed('The contribution year is out of range.', { field: 'year' });
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw validationFailed('The contribution month must be between 1 and 12.', {
      field: 'month',
    });
  }
}

/**
 * Inserts one period inside the write transaction, translating the unique-key race into
 * the documented conflict.
 *
 * The `(member_id, year, month)` key is what makes the rule "one expected amount per member
 * per month" hold even under concurrency. Without the translation the loser of a race would
 * surface as a raw Prisma `P2002` and the global filter would answer `500`, which tells the
 * Admin nothing about the real cause. Racing writers get the same `409 CONFLICT` a validate-
 * then-write path would return, but without the window in which both writers observe
 * "no existing row".
 */
async function upsertContributionPeriod(
  tx: Prisma.TransactionClient,
  input: ContributionPeriodInput,
  expectedPaise: bigint,
): Promise<ContributionPeriod> {
  try {
    return await tx.contributionPeriod.create({
      data: {
        memberId: input.memberId,
        year: input.year,
        month: input.month,
        expectedPaise,
      },
    });
  } catch (error: unknown) {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('A contribution period already exists for this member and month.', {
        field: 'month',
      });
    }

    throw error;
  }
}

/**
 * Expected monthly contribution persistence and derivation.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-CONTRIB-001` to `REQ-CONTRIB-003` and
 * `docs/05-DATABASE-SPEC.md`: one expected amount per member per month, with received
 * and remaining values always derived from active `MEMBER_CONTRIBUTION` transactions.
 * Nothing is cached in a permanent amount column, so a voided or corrected
 * transaction is reflected immediately.
 */
@Injectable()
export class ContributionPeriodRepository {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventRepository,
  ) {}

  /**
   * Creates a period and its audit event in one transaction.
   *
   * The unique `(member_id, year, month)` key is the real concurrency guard: two
   * simultaneous requests for the same month race here, one wins, and the loser
   * surfaces as a documented conflict instead of a duplicate row.
   */
  public async create(
    input: ContributionPeriodInput,
    actorAdminId: string,
  ): Promise<ContributionPeriod> {
    const expectedPaise = validatedExpectedPaise(input.expectedPaise);

    validatePeriodBounds(input.year, input.month);

    return this.prisma.$transaction(async (tx) => {
      const created = await upsertContributionPeriod(tx, input, expectedPaise);

      await this.audit.record(tx, {
        action: 'CONTRIBUTION_PERIOD_SET',
        entityType: AUDIT_ENTITY_TYPES.contributionPeriod,
        entityId: created.id,
        actorAdminId,
        before: null,
        after: {
          memberId: created.memberId,
          year: created.year,
          month: created.month,
          expectedPaise: created.expectedPaise.toString(),
        },
      });

      return created;
    });
  }

  public async find(
    memberId: string,
    year: number,
    month: number,
  ): Promise<ContributionPeriod | null> {
    return this.prisma.contributionPeriod.findUnique({
      where: { memberId_year_month: { memberId, year, month } },
    });
  }

  public async findById(id: string): Promise<ContributionPeriod> {
    const period = await this.prisma.contributionPeriod.findUnique({ where: { id } });

    if (period === null) {
      throw notFound('Contribution period', id);
    }

    return period;
  }

  public async listForMember(memberId: string): Promise<readonly ContributionPeriod[]> {
    return this.prisma.contributionPeriod.findMany({
      where: { memberId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  /**
   * One member's periods for a single year, newest month first.
   *
   * The recent-first order matches `contribution_period_member_recent_idx`, and the
   * `id` tiebreaker keeps the order total even if the unique key were ever relaxed.
   */
  public async listForMemberInYear(
    memberId: string,
    year: number,
  ): Promise<readonly ContributionPeriod[]> {
    return this.prisma.contributionPeriod.findMany({
      where: { memberId, year },
      orderBy: [{ month: 'desc' }, { id: 'asc' }],
    });
  }

  /**
   * Periods matching an optional member, year, and month, newest first.
   *
   * `take` is one greater than `CONTRIBUTION_PERIOD_FILTER_MAX` so the caller can tell a
   * complete result from a truncated one: an extra row means the request was too broad,
   * and the service rejects it instead of returning a silently shortened page.
   */
  public async listFiltered(filter: {
    readonly memberId?: string;
    readonly year?: number;
    readonly month?: number;
  }): Promise<readonly ContributionPeriod[]> {
    return this.prisma.contributionPeriod.findMany({
      where: {
        ...(filter.memberId === undefined ? {} : { memberId: filter.memberId }),
        ...(filter.year === undefined ? {} : { year: filter.year }),
        ...(filter.month === undefined ? {} : { month: filter.month }),
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { id: 'asc' }],
      take: CONTRIBUTION_PERIOD_FILTER_MAX + 1,
    });
  }

  /**
   * Changes the expected amount of an existing period, and records the change.
   *
   * Only the expected amount moves. `receivedPaise` and `status` are never written, so an
   * edit cannot fabricate a payment (`REQ-CONTRIB-004`).
   */
  public async updateExpected(
    id: string,
    expectedPaise: bigint,
    actorAdminId: string,
  ): Promise<ContributionPeriod> {
    const validated = validatedExpectedPaise(expectedPaise);

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.contributionPeriod.findUnique({ where: { id } });

      if (current === null) {
        throw notFound('Contribution period', id);
      }

      const updated = await tx.contributionPeriod.update({
        where: { id },
        data: { expectedPaise: validated, updatedAt: new Date() },
      });

      await this.audit.record(tx, {
        action: 'CONTRIBUTION_PERIOD_SET',
        entityType: AUDIT_ENTITY_TYPES.contributionPeriod,
        entityId: updated.id,
        actorAdminId,
        before: {
          memberId: updated.memberId,
          year: updated.year,
          month: updated.month,
          expectedPaise: current.expectedPaise.toString(),
        },
        after: {
          memberId: updated.memberId,
          year: updated.year,
          month: updated.month,
          expectedPaise: updated.expectedPaise.toString(),
        },
      });

      return updated;
    });
  }

  /**
   * Counts and paise totals by derived status for one member-month.
   *
   * `receivedPaise` is summed from active `MEMBER_CONTRIBUTION` transactions only, so a
   * voided row is excluded from both the count and the total.
   */
  public async summarizeByPeriod(period: {
    readonly year: number;
    readonly month: number;
  }): Promise<{
    readonly configured: number;
    readonly paid: number;
    readonly partiallyPaid: number;
    readonly notPaid: number;
    readonly expectedTotalPaise: bigint;
    readonly receivedTotalPaise: bigint;
    readonly remainingTotalPaise: bigint;
  }> {
    const periods = await this.prisma.contributionPeriod.findMany({
      where: { year: period.year, month: period.month },
    });

    if (periods.length === 0) {
      return {
        configured: 0,
        paid: 0,
        partiallyPaid: 0,
        notPaid: 0,
        expectedTotalPaise: 0n,
        receivedTotalPaise: 0n,
        remainingTotalPaise: 0n,
      };
    }

    const summaries = await this.summarizeMany(periods.map((row) => row.id));

    let paid = 0;
    let partiallyPaid = 0;
    let notPaid = 0;
    let expectedTotalPaise = 0n;
    let receivedTotalPaise = 0n;

    for (const summary of summaries) {
      expectedTotalPaise += summary.period.expectedPaise;
      receivedTotalPaise += summary.receivedPaise;

      if (summary.status === 'PAID') {
        paid += 1;
      } else if (summary.status === 'PARTIALLY PAID') {
        partiallyPaid += 1;
      } else {
        notPaid += 1;
      }
    }

    return {
      configured: summaries.length,
      paid,
      partiallyPaid,
      notPaid,
      expectedTotalPaise,
      receivedTotalPaise,
      remainingTotalPaise: remainingPaise(expectedTotalPaise, receivedTotalPaise),
    };
  }

  /** Derives received, remaining, and status from active transactions only. */
  public async summarize(periodId: string): Promise<ContributionPeriodSummary> {
    const period = await this.findById(periodId);
    const receivedPaise = await this.receivedPaise(periodId);

    return {
      period,
      receivedPaise,
      remainingPaise: remainingPaise(period.expectedPaise, receivedPaise),
      status: deriveContributionStatus(period.expectedPaise, receivedPaise),
    };
  }

  /** Sums active `MEMBER_CONTRIBUTION` amounts for one period. */
  public async receivedPaise(periodId: string): Promise<bigint> {
    const row = await this.prisma.financialTransaction.aggregate({
      where: {
        contributionPeriodId: periodId,
        incomeType: 'MEMBER_CONTRIBUTION',
        status: 'ACTIVE',
      },
      _sum: { amountPaise: true },
    });

    return row._sum.amountPaise ?? 0n;
  }

  /** Derives summaries for many periods in a bounded number of queries. */
  public async summarizeMany(
    periodIds: readonly string[],
  ): Promise<readonly ContributionPeriodSummary[]> {
    if (periodIds.length === 0) {
      return [];
    }

    const periods = await this.prisma.contributionPeriod.findMany({
      where: { id: { in: [...periodIds] } },
    });

    const grouped = await this.prisma.financialTransaction.groupBy({
      by: ['contributionPeriodId'],
      where: {
        contributionPeriodId: { in: [...periodIds] },
        incomeType: 'MEMBER_CONTRIBUTION',
        status: 'ACTIVE',
      },
      _sum: { amountPaise: true },
    });

    const receivedByPeriod = new Map<string, bigint>();
    for (const group of grouped) {
      if (group.contributionPeriodId !== null) {
        receivedByPeriod.set(group.contributionPeriodId, group._sum.amountPaise ?? 0n);
      }
    }

    return periods.map((period) => {
      const receivedPaise = receivedByPeriod.get(period.id) ?? 0n;

      return {
        period,
        receivedPaise,
        remainingPaise: remainingPaise(period.expectedPaise, receivedPaise),
        status: deriveContributionStatus(period.expectedPaise, receivedPaise),
      };
    });
  }
}
