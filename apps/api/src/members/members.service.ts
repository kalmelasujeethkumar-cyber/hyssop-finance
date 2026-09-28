import { Injectable } from '@nestjs/common';
import {
  list,
  MEMBER_PAGE_SIZE_DEFAULT,
  MEMBER_PAGE_SIZE_MAX,
  type ApiListEnvelope,
  type ContributionPeriodSummary,
  type MemberDetail,
  type MemberSortDirection,
  type MemberSortField,
  type MemberSummary,
  type MemberTransactionView,
  type ContributionPeriodView,
} from '@hyssop/contracts';
import { formatPaise, parsePositivePaise, remainingPaise } from '../common/money/paise';
import { validationFailed } from '../common/errors/domain.errors';
import { BUSINESS_TIMEZONE, formatBusinessDate } from '../common/time/business-date';
import { deriveContributionStatus } from '../database/contributions/contribution-status';
// A value import, not `import type`: Nest resolves the constructor argument from the
// runtime class, and a type-only import erases it and breaks dependency injection.
import {
  CONTRIBUTION_PERIOD_FILTER_MAX,
  ContributionPeriodRepository,
} from '../database/contributions/contribution-period.repository';
import { MemberRepository } from '../database/members/member.repository';
import { AppSettingRepository } from '../database/settings/app-setting.repository';
import { defaultContributionPaise } from '../database/settings/app-setting.validation';
import type { CreateMemberDto, UpdateMemberDto } from './dto/member.dto';

export interface MemberListRequest {
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly sort?: MemberSortField;
  readonly direction?: MemberSortDirection;
}

export interface ContributionPeriodRequest {
  readonly memberId: string;
  readonly year: number;
  readonly month: number;
  /**
   * The amount the Admin typed. Optional, because a period that does not exist yet may
   * take the configured default instead (`docs/phases/PHASE-04-MEMBERS.md`).
   */
  readonly expectedPaise?: string;
  readonly actorAdminId: string;
}

export interface ContributionPeriodQuery {
  readonly memberId?: string;
  readonly year?: number;
  readonly month?: number;
  readonly status?: 'PAID' | 'PARTIALLY PAID' | 'NOT PAID';
}

/**
 * Member use cases.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-MEM-001` to `REQ-MEM-006` and
 * `REQ-CONTRIB-001` to `REQ-CONTRIB-004`; transport shape from
 * `docs/06-API-SPEC.md`.
 *
 * This layer owns three rules that must not leak downward:
 *
 * 1. **A member has two identifiers, and only one is human-facing.** `referenceId`
 *    (`HY-MEM-0001`) is the Admin-visible member ID, is immutable, and is what search,
 *    lists, and detail views show. `id` is the opaque UUID that keys the URL and the
 *    `If-Match` edit; it is returned because a client has to address the member, and it
 *    is never rendered (`REQ-MEM-001`).
 * 2. **Money crosses the boundary as a decimal string** produced by the strict paise
 *    formatter, never a JSON number, so no amount can lose precision.
 * 3. **A contribution period stores only the expected amount.** Received, remaining, and
 *    status are always read back from active transactions, so a void or a correction is
 *    reflected immediately and a client cannot assert its own status.
 */
@Injectable()
export class MembersService {
  public constructor(
    private readonly members: MemberRepository,
    private readonly periods: ContributionPeriodRepository,
    private readonly settings: AppSettingRepository,
  ) {}

  public async list(request: MemberListRequest): Promise<ApiListEnvelope<MemberSummary>> {
    const pageSize = clampPageSize(request.pageSize);
    // A page below 1 is impossible, and clamping instead of rejecting keeps a stale bookmark
    // usable rather than turning it into an error the Admin cannot act on.
    const page = Math.max(1, request.page ?? 1);
    const offset = (page - 1) * pageSize;

    const [rows, totalItems] = await Promise.all([
      this.members.search({
        ...(request.search === undefined ? {} : { search: request.search }),
        limit: pageSize,
        offset,
        ...(request.sort === undefined ? {} : { sort: request.sort }),
        ...(request.direction === undefined ? {} : { direction: request.direction }),
      }),
      this.members.countMatching(request.search),
    ]);

    return list(rows.map(toMemberSummary), { page, pageSize, totalItems });
  }

  public async detail(id: string, year?: number): Promise<MemberDetail> {
    const member = await this.members.findById(id);
    const transactions = await this.members.listTransactions(id);
    const periodViews = await this.periodViewsForYear(id, year);

    return {
      ...toMemberSummary(member),
      contributionPeriods: periodViews,
      transactions: transactions.map(toTransactionView),
    };
  }

  public async create(input: CreateMemberDto, actorAdminId: string): Promise<MemberSummary> {
    const member = await this.members.create(
      {
        name: input.name,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
      },
      actorAdminId,
    );

    return toMemberSummary(member);
  }

  /**
   * Applies an audited edit.
   *
   * The caller must supply the revision it read. A mismatch is rejected as a conflict, so
   * two open edit forms cannot silently overwrite each other, and the `HY-MEM-` reference
   * is never part of the update because it is immutable.
   */
  public async update(
    id: string,
    input: UpdateMemberDto,
    expectedRevision: number,
    actorAdminId: string,
  ): Promise<MemberSummary> {
    const member = await this.members.update(
      id,
      {
        name: input.name,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
        expectedRevision,
      },
      actorAdminId,
    );

    return toMemberSummary(member);
  }

  /**
   * Sets the expected amount for one member-month, idempotently.
   *
   * Authority: `docs/06-API-SPEC.md` — "PUT is idempotent for the same expected amount."
   * A repeat of the same value returns the same period without an error, and a different
   * value updates it, which is what makes the endpoint safe to retry.
   *
   * A missing amount is only honoured while *opening* a period, and it is the one place
   * `app_setting` is read: `docs/phases/PHASE-04-MEMBERS.md` requires the initialized
   * `DEFAULT_MONTHLY_CONTRIBUTION_PAISE` row to be used when a new period is opened, and
   * the full Settings interface is not delivered until Phase 10. Re-sending the request
   * without an amount against a period that already exists is rejected rather than
   * silently resetting the Admin's expected amount back to the default, because losing
   * that number would misreport the member as unpaid.
   */
  public async setContributionPeriod(
    request: ContributionPeriodRequest,
  ): Promise<ContributionPeriodView> {
    // Confirms the member exists, so an unknown member is a 404 rather than an orphan period.
    await this.members.findById(request.memberId);

    const existing = await this.periods.find(request.memberId, request.year, request.month);

    if (existing !== null && request.expectedPaise === undefined) {
      throw validationFailed(
        'The expected amount is required to change an existing contribution period.',
        { field: 'expectedPaise' },
      );
    }

    const expectedPaise =
      request.expectedPaise === undefined
        ? await this.defaultMonthlyContributionPaise()
        : parseExpectedPaise(request.expectedPaise);

    if (existing === null) {
      const created = await this.periods.create(
        {
          memberId: request.memberId,
          year: request.year,
          month: request.month,
          expectedPaise,
        },
        request.actorAdminId,
      );
      const receivedPaise = await this.periods.receivedPaise(created.id);

      return toPeriodView(created, created.expectedPaise, receivedPaise);
    }

    if (existing.expectedPaise !== expectedPaise) {
      const updated = await this.periods.updateExpected(
        existing.id,
        expectedPaise,
        request.actorAdminId,
      );
      const receivedPaise = await this.periods.receivedPaise(updated.id);

      return toPeriodView(updated, updated.expectedPaise, receivedPaise);
    }

    // Same value: report the current derived state instead of writing again.
    const receivedPaise = await this.periods.receivedPaise(existing.id);

    return toPeriodView(existing, existing.expectedPaise, receivedPaise);
  }

  /** Month-wise expected, received, remaining, and status for one member. */
  public async contributionsForMember(
    memberId: string,
    year?: number,
  ): Promise<readonly ContributionPeriodView[]> {
    // Confirms the member exists, so an unknown member is a 404 rather than an empty list.
    await this.members.findById(memberId);

    return this.periodViewsForYear(memberId, year);
  }

  /**
   * The member's own contribution transactions, newest first.
   *
   * A separate read of the ledger rather than a slice of the detail payload, because
   * history grows without bound while the detail view is a month-scoped summary. The
   * member is confirmed first so an unknown member is a 404 rather than an empty history,
   * which would be indistinguishable from a member who has never paid.
   */
  public async transactionsForMember(memberId: string): Promise<readonly MemberTransactionView[]> {
    await this.members.findById(memberId);
    const rows = await this.members.listTransactions(memberId);

    return rows.map(toTransactionView);
  }

  /**
   * Periods filtered by member, year, month, or derived status.
   *
   * The `status` filter is applied to *derived* state, so it can only be answered by
   * first reading the ledger; that is intentional, because filtering on a stored status
   * column would be exactly the caching `REQ-CONTRIB-003` forbids.
   */
  public async listContributionPeriods(
    query: ContributionPeriodQuery,
  ): Promise<readonly ContributionPeriodView[]> {
    const periods = await this.periods.listFiltered({
      ...(query.memberId === undefined ? {} : { memberId: query.memberId }),
      ...(query.year === undefined ? {} : { year: query.year }),
      ...(query.month === undefined ? {} : { month: query.month }),
    });

    if (periods.length > CONTRIBUTION_PERIOD_FILTER_MAX) {
      // The repository reads one row past the bound, so this is a real overflow rather than
      // a guess. Reporting it beats returning a silently shortened list that the Admin
      // would read as the complete answer.
      throw validationFailed(
        'Too many contribution periods match this filter. Narrow it by member, year, or month.',
        { field: 'status', maxItems: String(CONTRIBUTION_PERIOD_FILTER_MAX) },
      );
    }

    const summaries = await this.periods.summarizeMany(periods.map((period) => period.id));
    const views = summaries.map((summary) =>
      toPeriodView(summary.period, summary.period.expectedPaise, summary.receivedPaise),
    );

    if (query.status === undefined) {
      return views;
    }

    return views.filter((view) => view.status === query.status);
  }

  /**
   * The configured default monthly contribution, in paise.
   *
   * Read from `app_setting` rather than hard-coded, so Phase 10's Settings screen can
   * change the default without touching financial logic. The stored value is already a
   * count of paise, so it is read with `defaultContributionPaise` and never re-parsed as
   * a rupee decimal; treating `"50000"` as rupees would bill a member ₹50,000 instead of
   * ₹500.
   *
   * A missing or malformed row is a server fault, not a validation problem: silently
   * falling back to a baked-in amount would let two deployments disagree about what a
   * member owes. `findOne` raises a `NOT_FOUND` domain error when the row is absent, which
   * the global filter reports as a 500 without leaking the setting name.
   */
  private async defaultMonthlyContributionPaise(): Promise<bigint> {
    const setting = await this.settings.findOne('DEFAULT_MONTHLY_CONTRIBUTION_PAISE');

    return defaultContributionPaise(setting.value);
  }

  /** Counts and totals per derived status for one member-month. */
  public async contributionSummary(
    year: number,
    month: number,
  ): Promise<ContributionPeriodSummary> {
    const summary = await this.periods.summarizeByPeriod({ year, month });

    return {
      year,
      month,
      configured: summary.configured,
      paid: summary.paid,
      partiallyPaid: summary.partiallyPaid,
      notPaid: summary.notPaid,
      expectedTotalPaise: formatPaise(summary.expectedTotalPaise),
      receivedTotalPaise: formatPaise(summary.receivedTotalPaise),
      remainingTotalPaise: formatPaise(summary.remainingTotalPaise),
    };
  }

  /** The requested year, defaulting to the current business year. */
  private async periodViewsForYear(
    memberId: string,
    year?: number,
  ): Promise<readonly ContributionPeriodView[]> {
    const periods = await this.periods.listForMemberInYear(memberId, year ?? currentBusinessYear());
    const summaries = await this.periods.summarizeMany(periods.map((period) => period.id));

    return summaries.map((summary) =>
      toPeriodView(summary.period, summary.period.expectedPaise, summary.receivedPaise),
    );
  }
}

export function toMemberSummary(member: {
  readonly id: string;
  readonly referenceId: string;
  readonly name: string;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): MemberSummary {
  return {
    id: member.id,
    referenceId: member.referenceId,
    name: member.name,
    phone: member.phone,
    notes: member.notes,
    revision: member.revision,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  };
}

export function toPeriodView(
  period: {
    readonly id: string;
    readonly year: number;
    readonly month: number;
    readonly expectedPaise: bigint;
  },
  expectedPaise: bigint,
  receivedPaise: bigint,
): ContributionPeriodView {
  return {
    id: period.id,
    year: period.year,
    month: period.month,
    expectedPaise: formatPaise(expectedPaise),
    receivedPaise: formatPaise(receivedPaise),
    remainingPaise: formatPaise(remainingPaise(expectedPaise, receivedPaise)),
    status: deriveContributionStatus(expectedPaise, receivedPaise),
  };
}

export function toTransactionView(row: {
  readonly id: string;
  readonly referenceId: string;
  readonly amountPaise: bigint;
  readonly paymentMethod: string;
  readonly businessDate: Date;
  readonly description: string | null;
  readonly status: 'ACTIVE' | 'VOIDED';
}): MemberTransactionView {
  return {
    id: row.id,
    referenceId: row.referenceId,
    amountPaise: formatPaise(row.amountPaise),
    paymentMethod: row.paymentMethod,
    businessDate: formatBusinessDate(row.businessDate),
    description: row.description,
    status: row.status,
  };
}

function clampPageSize(requested: number | undefined): number {
  if (requested === undefined) {
    return MEMBER_PAGE_SIZE_DEFAULT;
  }

  return Math.min(Math.max(1, Math.trunc(requested)), MEMBER_PAGE_SIZE_MAX);
}

function parseExpectedPaise(raw: string): bigint {
  try {
    return parsePositivePaise(raw);
  } catch {
    throw validationFailed('The expected amount must be a positive amount.', {
      field: 'expectedPaise',
    });
  }
}

/**
 * The current business year in Asia/Kolkata.
 *
 * Uses the IANA zone rather than UTC because the accounting year is a church-local
 * concept; a New Year boundary must not flip a member's default period at 05:30 IST.
 */
function currentBusinessYear(): number {
  const now = new Date();
  const year = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
  }).format(now);

  return Number.parseInt(year, 10);
}
