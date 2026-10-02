import { Injectable } from '@nestjs/common';
import { normalizePhone, PhoneFormatError } from '@hyssop/contracts';
import type { MemberSortDirection, MemberSortField } from '@hyssop/contracts';
import type { Member, Prisma } from '@prisma/client';
import { notFound, staleRevision, validationFailed } from '../../common/errors/domain.errors';
import { BUSINESS_TIMEZONE, formatBusinessDate } from '../../common/time/business-date';
import { AuditEventRepository, AUDIT_ENTITY_TYPES } from '../audit/audit-event.repository';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceAllocatorService } from '../references/reference-allocator.service';

export interface CreateMemberInput {
  readonly name: string;
  readonly phone?: string | null;
  readonly notes?: string | null;
}

export interface UpdateMemberInput {
  readonly name: string;
  readonly phone?: string | null;
  readonly notes?: string | null;
  readonly expectedRevision: number;
}

export interface MemberSearchFilters {
  readonly search?: string;
  readonly limit: number;
  readonly offset: number;
  readonly sort?: MemberSortField;
  readonly direction?: MemberSortDirection;
}

/** The transaction columns a member history projection reads. */
export type MemberTransactionRow = {
  readonly id: string;
  readonly referenceId: string;
  readonly amountPaise: bigint;
  readonly paymentMethod: string;
  readonly businessDate: Date;
  readonly description: string | null;
  readonly status: 'ACTIVE' | 'VOIDED';
};

/**
 * Builds the `WHERE` clause shared by the page query and its `count`, so a total can
 * never disagree with the rows beside it.
 *
 * A search term is always a *value* passed as a bound parameter, never SQL text, so search
 * input cannot alter query structure. Prisma's `contains` is a literal substring match
 * rather than a SQL `LIKE` pattern, so `%`, `_`, and `\` are ordinary characters here and
 * deliberately receive no escaping: adding backslashes would make a search for a literal
 * `%` fail to find it.
 */
export function memberSearchWhere(search: string | undefined): Prisma.MemberWhereInput {
  const term = search?.trim() ?? '';

  if (term === '') {
    return {};
  }

  return {
    OR: [
      { name: { contains: term, mode: 'insensitive' } },
      { referenceId: { contains: term, mode: 'insensitive' } },
      { phone: { contains: term } },
    ],
  };
}

/**
 * Deterministic ordering. Every sort is completed by `referenceId`, which is unique, so
 * two pages of a large member list can never repeat or skip a row because two names
 * happened to be equal.
 */
function memberOrderBy(
  sort: MemberSortField,
  direction: MemberSortDirection,
): Prisma.MemberOrderByWithRelationInput[] {
  const order: Prisma.SortOrder = direction === 'desc' ? 'desc' : 'asc';

  if (sort === 'createdAt') {
    return [{ createdAt: order }, { referenceId: 'asc' }];
  }

  if (sort === 'referenceId') {
    // `reference_id` is already unique, so no tiebreaker is needed.
    return [{ referenceId: order }];
  }

  return [{ name: order }, { referenceId: 'asc' }];
}

/**
 * Member persistence.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` and `docs/01-REQUIREMENTS.md`
 * (`REQ-MEM-001` to `REQ-MEM-006`): `reference_id` is allocated by the transaction's
 * own allocator and is immutable, names are required and length-limited, phone is
 * optional and stored as national digits, and edits use a `revision` optimistic lock
 * that increments atomically. There is no delete operation.
 */
@Injectable()
export class MemberRepository {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferenceAllocatorService,
    private readonly audit: AuditEventRepository,
  ) {}

  /** Creates a member and its audit event in one transaction. */
  public async create(input: CreateMemberInput, actorAdminId: string): Promise<Member> {
    const name = normalizeName(input.name);
    const phone = normalizeMemberPhone(input.phone ?? null);
    const notes = normalizeOptionalText(input.notes);

    return this.prisma.$transaction(async (tx) => {
      const referenceId = await this.references.allocate(tx, 'MEMBER');
      const member = await tx.member.create({
        data: { referenceId, name, phone, notes },
      });

      await this.audit.record(tx, {
        action: 'MEMBER_CREATED',
        entityType: AUDIT_ENTITY_TYPES.member,
        entityId: member.id,
        entityReference: member.referenceId,
        actorAdminId,
        after: { referenceId: member.referenceId, name: member.name, phone: member.phone },
      });

      return member;
    });
  }

  public async findById(id: string): Promise<Member> {
    const member = await this.prisma.member.findUnique({ where: { id } });

    if (member === null) {
      throw notFound('Member', id);
    }

    return member;
  }

  public async findByReferenceId(referenceId: string): Promise<Member> {
    const member = await this.prisma.member.findUnique({ where: { referenceId } });

    if (member === null) {
      throw notFound('Member', referenceId);
    }

    return member;
  }

  public async search(filters: MemberSearchFilters): Promise<readonly Member[]> {
    return this.prisma.member.findMany({
      where: memberSearchWhere(filters.search),
      orderBy: memberOrderBy(filters.sort ?? 'name', filters.direction ?? 'asc'),
      take: filters.limit,
      skip: filters.offset,
    });
  }

  /** Counts the rows matching the same filter, so the pager total is real. */
  public async countMatching(search?: string): Promise<number> {
    return this.prisma.member.count({ where: memberSearchWhere(search) });
  }

  /**
   * The member's member-contribution transactions, newest first.
   *
   * A read-only projection owned by Phase 04: `REQ-MEM-003` and `REQ-MEM-004` require a
   * member to have history, and that history is always read from the ledger rather than
   * from a stored amount. Voided rows are included so the Admin can see that a payment
   * was voided, and their `status` travels with the row; they are excluded from every
   * derived total by `ContributionPeriodRepository`. Creating or editing these rows is
   * Phase 05's job.
   */
  public async listTransactions(memberId: string): Promise<readonly MemberTransactionRow[]> {
    return this.prisma.financialTransaction.findMany({
      where: { memberId, incomeType: 'MEMBER_CONTRIBUTION' },
      orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        referenceId: true,
        amountPaise: true,
        paymentMethod: true,
        businessDate: true,
        description: true,
        status: true,
      },
    });
  }

  /**
   * Applies an audited member edit.
   *
   * The `revision` guard turns a concurrent edit into a rejected update instead of a
   * silent overwrite, and the reference is never part of the update.
   */
  public async update(id: string, input: UpdateMemberInput, actorAdminId: string): Promise<Member> {
    const name = normalizeName(input.name);
    const phone = normalizeMemberPhone(input.phone ?? null);
    const notes = normalizeOptionalText(input.notes);

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.member.findUnique({ where: { id } });

      if (current === null) {
        throw notFound('Member', id);
      }

      if (current.revision !== input.expectedRevision) {
        throw staleRevision('Member', input.expectedRevision, current.revision);
      }

      const updated = await tx.member.update({
        where: { id, revision: input.expectedRevision },
        data: { name, phone, notes, revision: { increment: 1 }, updatedAt: new Date() },
      });

      await this.audit.record(tx, {
        action: 'MEMBER_UPDATED',
        entityType: AUDIT_ENTITY_TYPES.member,
        entityId: updated.id,
        entityReference: updated.referenceId,
        actorAdminId,
        before: { name: current.name, phone: current.phone, notes: current.notes },
        after: { name: updated.name, phone: updated.phone, notes: updated.notes },
      });

      return updated;
    });
  }

  public async count(): Promise<number> {
    return this.prisma.member.count();
  }

  /**
   * Counts members created on or before an Asia/Kolkata business date.
   *
   * `REQ-DASH-018` requires the dashboard's member figure to be *as of* the period end, not the
   * size of the member table today. Without this boundary a member added in November appears
   * in an October dashboard, which overstates how many people the church had in October.
   *
   * `created_at` is a `TIMESTAMPTZ`, so the comparison converts the instant into the business
   * zone before comparing it with a calendar `DATE`. Comparing the raw instant against
   * `::date` would make the answer depend on the database session time zone: a member created
   * at 02:00 IST on the 1st is the 31st in UTC, and the count would quietly change with the
   * server's configuration.
   */
  public async countCreatedThrough(to: Date): Promise<number> {
    const row = await this.prisma.$queryRaw<readonly [{ readonly member_count: bigint }]>`
      SELECT COUNT(*)::bigint AS "member_count"
      FROM "member"
      WHERE (("created_at" AT TIME ZONE ${BUSINESS_TIMEZONE})::date) <= ${formatBusinessDate(to)}::date
    `;

    return Number(row[0]?.member_count ?? 0n);
  }

  /**
   * Counts members created in each Asia/Kolkata calendar month of a range.
   *
   * The dashboard needs a per-month member denominator for `REQ-CONTRIB-006`'s `Not configured`
   * bucket: for each month, how many members existed by that month's end. This returns the
   * raw per-month creation counts and the caller accumulates them, because a running total
   * across months is a comparison of counts rather than a financial sum — no paise is involved
   * and no rounding can occur.
   *
   * The month is taken from the zoned timestamp, not from the raw instant, for the same reason
   * as `countCreatedThrough`.
   */
  public async countCreatedByMonth(
    from: Date,
    to: Date,
  ): Promise<readonly { readonly year: number; readonly month: number; readonly count: number }[]> {
    const rows = await this.prisma.$queryRaw<
      readonly { readonly year: number; readonly month: number; readonly count: bigint }[]
    >`
      SELECT
        EXTRACT(YEAR FROM ("created_at" AT TIME ZONE ${BUSINESS_TIMEZONE}))::int AS "year",
        EXTRACT(MONTH FROM ("created_at" AT TIME ZONE ${BUSINESS_TIMEZONE}))::int AS "month",
        COUNT(*)::bigint AS "count"
      FROM "member"
      WHERE ("created_at" AT TIME ZONE ${BUSINESS_TIMEZONE})::date
          >= ${formatBusinessDate(from)}::date
        AND ("created_at" AT TIME ZONE ${BUSINESS_TIMEZONE})::date
          <= ${formatBusinessDate(to)}::date
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC
    `;

    return rows.map((row) => ({
      year: row.year,
      month: row.month,
      count: Number(row.count),
    }));
  }
}

function normalizeName(raw: string): string {
  const name = raw.trim();

  if (name === '') {
    throw validationFailed('A member name is required.', { field: 'name' });
  }

  if (name.length > 120) {
    throw validationFailed('A member name must be 120 characters or fewer.', { field: 'name' });
  }

  return name;
}

/**
 * Applies the documented phone rule and reports a violation as a field-level validation
 * error.
 *
 * `normalizePhone` deliberately throws a plain `PhoneFormatError`, because the rule itself
 * is transport-agnostic. This is the boundary where a phone enters persistence, so it is
 * where that error is translated into the documented `VALIDATION_FAILED` envelope. Without
 * the translation the global filter would treat an invalid phone as an unknown failure and
 * answer `500`, which would tell the Admin nothing and would contradict `REQ-MEM-005` and
 * the error-exposure rule in `docs/07-SECURITY-RULES.md`.
 *
 * Exported so the HTTP test double applies the identical rule. A double that stored the
 * phone verbatim would report a `201` for a number production refuses, which is a test that
 * passes while the contract is wrong.
 */
export function normalizeMemberPhone(raw: string | null | undefined): string | null {
  try {
    return normalizePhone(raw);
  } catch (error: unknown) {
    if (error instanceof PhoneFormatError) {
      throw validationFailed(`The phone number is not valid: ${error.message}.`, {
        field: 'phone',
      });
    }

    throw error;
  }
}

function normalizeOptionalText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const value = raw.trim();
  return value === '' ? null : value;
}
