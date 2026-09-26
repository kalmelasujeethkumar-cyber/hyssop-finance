import { Injectable } from '@nestjs/common';
import type { ContributionPeriod } from '@prisma/client';
import { conflict, notFound, validationFailed } from '../../common/errors/domain.errors';
import { remainingPaise } from '../../common/money/paise';
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
  public constructor(private readonly prisma: PrismaService) {}

  public async create(input: ContributionPeriodInput): Promise<ContributionPeriod> {
    if (input.expectedPaise <= 0n) {
      throw validationFailed('The expected contribution must be greater than zero.', {
        field: 'expectedPaise',
      });
    }

    if (!Number.isInteger(input.year) || input.year < 1970 || input.year > 9999) {
      throw validationFailed('The contribution year is out of range.', { field: 'year' });
    }

    if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
      throw validationFailed('The contribution month must be between 1 and 12.', {
        field: 'month',
      });
    }

    const existing = await this.find(input.memberId, input.year, input.month);

    if (existing !== null) {
      throw conflict('A contribution period already exists for this member and month.', {
        field: 'month',
      });
    }

    return this.prisma.contributionPeriod.create({
      data: {
        memberId: input.memberId,
        year: input.year,
        month: input.month,
        expectedPaise: input.expectedPaise,
      },
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
