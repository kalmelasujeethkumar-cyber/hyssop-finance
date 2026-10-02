import { Injectable } from '@nestjs/common';
import type {
  FinancialTransaction,
  IncomeType,
  PaymentMethod,
  Prisma,
  TransactionType,
} from '@prisma/client';
import { INCOME_TYPES, TRANSACTION_TYPES } from '@hyssop/contracts';
import {
  conflict,
  notFound,
  staleRevision,
  validationFailed,
} from '../../common/errors/domain.errors';
import { AuditEventRepository, AUDIT_ENTITY_TYPES } from '../audit/audit-event.repository';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceAllocatorService } from '../references/reference-allocator.service';
import { referenceScopeForTransactionType } from '../references/reference-formats';

/**
 * Fields an Admin may correct on an existing transaction.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-FIN-005` and `docs/05-DATABASE-SPEC.md`:
 * identity and history fields (`id`, `reference_id`, `created_at`, `created_by_admin_id`)
 * are immutable and enforced by the `financial_transaction_guard_update` trigger, so
 * they are not accepted here either.
 *
 * `memberId` is correctable, and `null` is a real value rather than "field omitted":
 * `TransactionsService` permits detaching a member from a named offering or donation so a
 * mis-keyed record can be corrected without voiding it. It must stay in `CORRECTABLE_FIELDS`
 * — when it was absent, a member-only correction was rejected as "changes nothing" and a
 * member correction sent alongside an amount was silently dropped, so the API answered 200
 * while the stored record was unchanged. A correctable field the service computes but this
 * allow-list omits is a silent data-loss defect, not a harmless omission.
 */
export interface CorrectableTransactionFields {
  readonly amountPaise?: bigint;
  readonly paymentMethod?: PaymentMethod;
  readonly businessDate?: Date;
  readonly occurredAt?: Date;
  readonly description?: string | null;
  readonly notes?: string | null;
  readonly memberId?: string | null;
  readonly categoryId?: string | null;
}

export interface CreateTransactionInput {
  readonly transactionType: TransactionType;
  readonly amountPaise: bigint;
  readonly paymentMethod: PaymentMethod;
  /** Asia/Kolkata accounting date, stored as a PostgreSQL `DATE`. */
  readonly businessDate: Date;
  /** Recorded instant, stored as `TIMESTAMPTZ`. */
  readonly occurredAt: Date;
  readonly description?: string | null;
  readonly notes?: string | null;
  readonly incomeType?: IncomeType | null;
  readonly memberId?: string | null;
  readonly contributionPeriodId?: string | null;
  readonly categoryId?: string | null;
}

export interface CorrectTransactionInput extends CorrectableTransactionFields {
  readonly expectedRevision: number;
}

export interface TransactionCommandContext {
  readonly actorAdminId: string;
  readonly requestId?: string | null;
}

const CORRECTABLE_FIELDS: readonly (keyof CorrectableTransactionFields)[] = [
  'amountPaise',
  'paymentMethod',
  'businessDate',
  'occurredAt',
  'description',
  'notes',
  'memberId',
  'categoryId',
];

/**
 * Canonical financial transaction persistence.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-FIN-001` to `REQ-FIN-020` and
 * `docs/05-DATABASE-SPEC.md`:
 *   * one canonical income and expense record, never a mutable total;
 *   * `INCOME` requires `income_type` and forbids `category_id`; `EXPENSE` requires
 *     `category_id` and forbids `income_type` and `contribution_period_id`;
 *   * `MEMBER_CONTRIBUTION` requires both a member and a contribution period, and the
 *     database trigger additionally verifies the period belongs to that member;
 *   * `ANONYMOUS_DONATION` carries no member and a neutral description;
 *   * voiding requires a reason, records who and when, and keeps the row auditable
 *     while excluding it from active totals;
 *   * an edit preserves history, increments `revision`, and is written to
 *     `audit_event` with previous and new values.
 */
/**
 * The validated, indexed filter set for a transaction list.
 *
 * Every field is already narrowed by the DTO before it reaches here, so this layer can map
 * each one to exactly one column or a bounded range. That is what keeps
 * `docs/07-SECURITY-RULES.md`'s "filters are validated and cannot inject arbitrary query
 * structure" true at the data layer as well as at the transport layer: a caller cannot
 * pass an ordering, a relation traversal, or a column name through this interface.
 */
export interface TransactionQueryFilters {
  readonly transactionType?: TransactionType;
  readonly status?: 'ACTIVE' | 'VOIDED';
  readonly paymentMethod?: PaymentMethod;
  readonly incomeType?: IncomeType;
  readonly categoryId?: string;
  readonly memberId?: string;
  /** Exact reference match on `HY-INC-000001` / `HY-EXP-000001`. */
  readonly referenceId?: string;
  /** Inclusive `business_date` lower bound, as UTC midnight. */
  readonly from?: Date;
  /** Inclusive `business_date` upper bound, as UTC midnight. */
  readonly to?: Date;
  readonly minAmountPaise?: bigint;
  readonly maxAmountPaise?: bigint;
  /**
   * Bounded free text over the reference, the description, and the named member or
   * category, as `REQ-SEARCH-002` allows. It never reaches `notes`, which is how an
   * anonymous donation's private note cannot be turned into a search result.
   */
  readonly search?: string;
}

export type TransactionSortField = 'businessDate' | 'amount' | 'referenceId' | 'createdAt';

export type TransactionSortDirection = 'asc' | 'desc';

/** A transaction row with every relation a list or detail view needs. */
export type TransactionWithRelations = Prisma.FinancialTransactionGetPayload<{
  include: typeof TRANSACTION_LIST_INCLUDE;
}>;

/**
 * The single relation set used by every transaction read.
 *
 * Listing needs the member name, the category label, the period, and the attachment state.
 * Selecting them in one place means the list, the detail, the receipt, and the audit view cannot
 * disagree about what a transaction shows, which is the `docs/02-ARCHITECTURE.md` requirement for
 * one canonical representation.
 *
 * Two document figures are selected because they answer different questions and must not be
 * conflated. `_count.documents` counts *every* record, including removed ones, because the audit
 * history is `docs/05-DATABASE-SPEC.md`-required to keep removed documents. `documents` is
 * filtered to `AVAILABLE` because `REQ-DOC-003` asks whether a receipt is currently attached, and
 * a removed receipt is not one — reporting `true` after a removal would claim the Admin can open a
 * file the API will answer with `410 Gone`.
 */
const TRANSACTION_LIST_INCLUDE = {
  member: { select: { id: true, referenceId: true, name: true } },
  category: { select: { id: true, name: true, status: true } },
  contributionPeriod: { select: { id: true, year: true, month: true } },
  documents: { where: { status: 'AVAILABLE' }, select: { id: true } },
  _count: { select: { documents: true } },
} as const satisfies Prisma.FinancialTransactionInclude;

@Injectable()
export class TransactionRepository {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferenceAllocatorService,
    private readonly audit: AuditEventRepository,
  ) {}

  /** Creates a transaction, its reference, and its audit event atomically. */
  public async create(
    input: CreateTransactionInput,
    context: TransactionCommandContext,
  ): Promise<TransactionWithRelations> {
    return this.prisma.$transaction((tx) => this.createWithinTransaction(tx, input, context));
  }

  /**
   * The same create, inside a transaction the caller already opened.
   *
   * Required by the idempotency contract in `docs/06-API-SPEC.md`: the stored response and
   * the financial write must commit together or not at all, so a retry can never be recorded
   * for a financial operation that rolled back, and a recorded retry can never point at a
   * write that did not happen. Opening a second `prisma.$transaction` here would use a
   * different connection and break exactly that guarantee, so the outer transaction is
   * reused instead.
   */
  public async createWithinTransaction(
    tx: Prisma.TransactionClient,
    input: CreateTransactionInput,
    context: TransactionCommandContext,
  ): Promise<TransactionWithRelations> {
    const data = this.toCreateData(input, context.actorAdminId);
    const referenceId = await this.references.allocate(
      tx,
      referenceScopeForTransactionType(data.transactionType),
    );

    const created = await tx.financialTransaction.create({
      data: { ...data, referenceId },
      include: TRANSACTION_LIST_INCLUDE,
    });

    await this.audit.record(tx, {
      action: 'TRANSACTION_CREATED',
      entityType: AUDIT_ENTITY_TYPES.transaction,
      entityId: created.id,
      entityReference: created.referenceId,
      actorAdminId: context.actorAdminId,
      requestId: context.requestId ?? null,
      after: this.toAuditSnapshot(created),
    });

    return created;
  }

  /**
   * Applies a correction. The `revision` guard rejects a stale edit instead of
   * overwriting someone else's change, and the audit event keeps the previous values.
   */
  public async correct(
    id: string,
    input: CorrectTransactionInput,
    context: TransactionCommandContext,
  ): Promise<TransactionWithRelations> {
    return this.prisma.$transaction((tx) => this.correctWithinTransaction(tx, id, input, context));
  }

  /** The same correction, inside a transaction the caller already opened. */
  public async correctWithinTransaction(
    tx: Prisma.TransactionClient,
    id: string,
    input: CorrectTransactionInput,
    context: TransactionCommandContext,
  ): Promise<TransactionWithRelations> {
    const changes = this.toCorrectableData(input);
    const changeCount = Object.keys(changes).length;

    if (changeCount === 0) {
      throw validationFailed('A correction must change at least one field.');
    }

    const current = await tx.financialTransaction.findUnique({ where: { id } });

    if (current === null) {
      throw notFound('Transaction', id);
    }

    if (current.status === 'VOIDED') {
      throw conflict('A voided transaction cannot be edited.', { field: 'status' });
    }

    if (current.revision !== input.expectedRevision) {
      throw staleRevision('Transaction', input.expectedRevision, current.revision);
    }

    const updated = await tx.financialTransaction.update({
      where: { id, revision: input.expectedRevision },
      data: { ...changes, revision: { increment: 1 }, updatedAt: new Date() },
      include: TRANSACTION_LIST_INCLUDE,
    });

    await this.audit.record(tx, {
      action: 'TRANSACTION_UPDATED',
      entityType: AUDIT_ENTITY_TYPES.transaction,
      entityId: updated.id,
      entityReference: updated.referenceId,
      actorAdminId: context.actorAdminId,
      requestId: context.requestId ?? null,
      before: this.toAuditSnapshot(current),
      after: this.toAuditSnapshot(updated),
    });

    return updated;
  }

  /**
   * Voids a transaction with a required reason.
   *
   * Authority: `docs/05-DATABASE-SPEC.md`: voiding is idempotent for the same request
   * key and target, so repeating the identical reason returns the existing record,
   * while a second void with a different reason is rejected clearly. The row is kept
   * for audit and excluded from active totals by its `status`.
   */
  public async voidTransaction(
    id: string,
    reason: string,
    context: TransactionCommandContext,
  ): Promise<TransactionWithRelations> {
    return this.prisma.$transaction((tx) => this.voidWithinTransaction(tx, id, reason, context));
  }

  /** The same void, inside a transaction the caller already opened. */
  public async voidWithinTransaction(
    tx: Prisma.TransactionClient,
    id: string,
    reason: string,
    context: TransactionCommandContext,
  ): Promise<TransactionWithRelations> {
    const voidReason = reason.trim();

    if (voidReason === '') {
      throw validationFailed('A void reason is required.', { field: 'reason' });
    }

    const current = await tx.financialTransaction.findUnique({ where: { id } });

    if (current === null) {
      throw notFound('Transaction', id);
    }

    if (current.status === 'VOIDED') {
      if (current.voidReason === voidReason) {
        // The same reason again is a no-op rather than a conflict, so a retried void is
        // safe. A *different* reason is rejected below: silently re-voiding would overwrite
        // the recorded reason and destroy the original explanation of the void.
        return tx.financialTransaction.findUniqueOrThrow({
          where: { id },
          include: TRANSACTION_LIST_INCLUDE,
        });
      }

      throw conflict('This transaction is already voided with a different reason.', {
        field: 'reason',
      });
    }

    const voidedAt = new Date();
    const updated = await tx.financialTransaction.update({
      where: { id, revision: current.revision },
      data: {
        status: 'VOIDED',
        voidedAt,
        voidedByAdminId: context.actorAdminId,
        voidReason,
        revision: { increment: 1 },
        updatedAt: voidedAt,
      },
      include: TRANSACTION_LIST_INCLUDE,
    });

    await this.audit.record(tx, {
      action: 'TRANSACTION_VOIDED',
      entityType: AUDIT_ENTITY_TYPES.transaction,
      entityId: updated.id,
      entityReference: updated.referenceId,
      actorAdminId: context.actorAdminId,
      requestId: context.requestId ?? null,
      reason: voidReason,
      before: this.toAuditSnapshot(current),
      after: this.toAuditSnapshot(updated),
    });

    return updated;
  }

  public async findById(id: string): Promise<FinancialTransaction> {
    const transaction = await this.prisma.financialTransaction.findUnique({ where: { id } });

    if (transaction === null) {
      throw notFound('Transaction', id);
    }

    return transaction;
  }

  /** One transaction with its relations, for a detail, receipt, or audit view. */
  public async findWithRelations(id: string): Promise<TransactionWithRelations> {
    const transaction = await this.prisma.financialTransaction.findUnique({
      where: { id },
      include: TRANSACTION_LIST_INCLUDE,
    });

    if (transaction === null) {
      throw notFound('Transaction', id);
    }

    return transaction;
  }

  /**
   * A filtered, ordered, paged page of transactions.
   *
   * Ordering always ends with `referenceId`, which is unique, so the order is total: two
   * rows with the same business date and amount still come back in a fixed sequence and a
   * page boundary cannot show a row twice or drop one. `docs/06-API-SPEC.md` requires
   * deterministic ordering and pagination, and without the tiebreaker a page could repeat or
   * omit a row whenever the Admin sorted by a non-unique column.
   */
  public async list(
    filters: TransactionQueryFilters,
    page: {
      readonly limit: number;
      readonly offset: number;
      readonly sort: TransactionSortField;
      readonly direction: TransactionSortDirection;
    },
  ): Promise<readonly TransactionWithRelations[]> {
    return this.prisma.financialTransaction.findMany({
      where: toPrismaWhere(filters),
      include: TRANSACTION_LIST_INCLUDE,
      orderBy: [{ [page.sort]: page.direction }, { referenceId: page.direction }],
      take: page.limit,
      skip: page.offset,
    });
  }

  /** The total number of rows matching the same filter, across all pages. */
  public async countMatching(filters: TransactionQueryFilters): Promise<number> {
    return this.prisma.financialTransaction.count({ where: toPrismaWhere(filters) });
  }

  /**
   * The exact paise total of every row matching the same filter, across all pages.
   *
   * Added for the Phase 09 reports, which show a period total *beside* a page of rows. Summing
   * the returned page would report the total of one page as though it were the total of the
   * report, which is a wrong number rather than a missing one — the exact failure the canonical
   * calculation layer exists to prevent.
   *
   * It reuses {@link toPrismaWhere}, so a report total can never be computed over a different
   * filter set than the rows beside it.
   */
  public async sumMatching(filters: TransactionQueryFilters): Promise<bigint> {
    const row = await this.prisma.financialTransaction.aggregate({
      where: toPrismaWhere(filters),
      _sum: { amountPaise: true },
    });

    return row._sum.amountPaise ?? 0n;
  }

  /**
   * The Admin-wide global search over transactions.
   *
   * `REQ-SEARCH-001` requires search to cover "transaction reference, category, transaction type",
   * which is a *wider* field set than {@link TransactionQueryFilters.search}: that filter covers
   * reference, description, member, and category, and exists to drive the income and expense
   * *list* screens where a type match would be noise. Widening it would have changed what those
   * screens return, so this is a separate, purpose-built read.
   *
   * The added match on `transaction_type` and `income_type` is an equality against the closed
   * enum, not a `LIKE` pattern, and only applies when the term is exactly one of those values.
   * `notes` is still excluded for the same `REQ-INCOME-005` reason as everywhere else: an
   * anonymous donation's private note must not become an attributable search hit.
   *
   * Ordering is `business_date DESC, created_at DESC, id DESC`, the same total order the dashboard
   * recent list uses, so a page boundary cannot repeat or drop a row.
   */
  public async searchGlobally(
    term: string,
    page: { readonly limit: number; readonly offset: number },
  ): Promise<readonly TransactionWithRelations[]> {
    const trimmed = term.trim();

    const typed =
      (TRANSACTION_TYPES as readonly string[]).includes(trimmed) ||
      (INCOME_TYPES as readonly string[]).includes(trimmed);

    return this.prisma.financialTransaction.findMany({
      where: {
        OR: [
          { referenceId: { contains: trimmed, mode: 'insensitive' } },
          { description: { contains: trimmed, mode: 'insensitive' } },
          { member: { is: { name: { contains: trimmed, mode: 'insensitive' } } } },
          { member: { is: { referenceId: { contains: trimmed, mode: 'insensitive' } } } },
          { category: { is: { name: { contains: trimmed, mode: 'insensitive' } } } },
          ...(typed ? [{ transactionType: trimmed as TransactionType }] : []),
          ...(typed ? [{ incomeType: trimmed as IncomeType }] : []),
        ],
      },
      include: TRANSACTION_LIST_INCLUDE,
      orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit,
      skip: page.offset,
    });
  }

  /** The number of transactions the global search matches, for the pager. */
  public async countSearchGlobally(term: string): Promise<number> {
    const trimmed = term.trim();

    const typed =
      (TRANSACTION_TYPES as readonly string[]).includes(trimmed) ||
      (INCOME_TYPES as readonly string[]).includes(trimmed);

    return this.prisma.financialTransaction.count({
      where: {
        OR: [
          { referenceId: { contains: trimmed, mode: 'insensitive' } },
          { description: { contains: trimmed, mode: 'insensitive' } },
          { member: { is: { name: { contains: trimmed, mode: 'insensitive' } } } },
          { member: { is: { referenceId: { contains: trimmed, mode: 'insensitive' } } } },
          { category: { is: { name: { contains: trimmed, mode: 'insensitive' } } } },
          ...(typed ? [{ transactionType: trimmed as TransactionType }] : []),
          ...(typed ? [{ incomeType: trimmed as IncomeType }] : []),
        ],
      },
    });
  }

  /**
   * Active income rows for a set of income types within a period, for the Offering and Donation
   * reports.
   *
   * Donation legitimately spans two `income_type` values — `DONATION` and `ANONYMOUS_DONATION`
   * — because `REQ-INCOME-006`'s anonymous donation *is* a donation and excluding it would
   * understate the donation total. The existing `TransactionQueryFilters.incomeType` accepts
   * exactly one value, and widening it to a list would have changed what the income list route
   * returns, so this is a purpose-built read for the two reports.
   *
   * Ordering is the same total order the recent list uses, so the report pages deterministically.
   */
  public async listReportIncome(
    incomeTypes: readonly IncomeType[],
    period: { readonly from: Date; readonly to: Date },
    page: { readonly limit: number; readonly offset: number },
  ): Promise<readonly TransactionWithRelations[]> {
    return this.prisma.financialTransaction.findMany({
      where: {
        transactionType: 'INCOME',
        status: 'ACTIVE',
        incomeType: { in: [...incomeTypes] },
        businessDate: { gte: period.from, lte: period.to },
      },
      include: TRANSACTION_LIST_INCLUDE,
      orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit,
      skip: page.offset,
    });
  }

  /** The number of income rows matching the same income types and period. */
  public async countReportIncome(
    incomeTypes: readonly IncomeType[],
    period: { readonly from: Date; readonly to: Date },
  ): Promise<number> {
    return this.prisma.financialTransaction.count({
      where: {
        transactionType: 'INCOME',
        status: 'ACTIVE',
        incomeType: { in: [...incomeTypes] },
        businessDate: { gte: period.from, lte: period.to },
      },
    });
  }

  /** The exact paise total of the same income rows, so a report total is not a page sum. */
  public async sumReportIncome(
    incomeTypes: readonly IncomeType[],
    period: { readonly from: Date; readonly to: Date },
  ): Promise<bigint> {
    const row = await this.prisma.financialTransaction.aggregate({
      where: {
        transactionType: 'INCOME',
        status: 'ACTIVE',
        incomeType: { in: [...incomeTypes] },
        businessDate: { gte: period.from, lte: period.to },
      },
      _sum: { amountPaise: true },
    });

    return row._sum.amountPaise ?? 0n;
  }

  public async findByReferenceId(referenceId: string): Promise<FinancialTransaction> {
    const transaction = await this.prisma.financialTransaction.findUnique({
      where: { referenceId },
    });

    if (transaction === null) {
      throw notFound('Transaction', referenceId);
    }

    return transaction;
  }

  public async listDocuments(
    transactionId: string,
  ): Promise<readonly { readonly id: string; readonly status: string }[]> {
    return this.prisma.transactionDocument.findMany({
      where: { transactionId },
      select: { id: true, status: true },
      orderBy: { uploadedAt: 'asc' },
    });
  }

  /**
   * Validates and normalizes creation input.
   *
   * The same shape rules exist as database CHECK constraints; checking here produces
   * a clear message instead of a raw constraint failure, and the database remains the
   * final authority.
   */
  private toCreateData(
    input: CreateTransactionInput,
    actorAdminId: string,
  ): Omit<Prisma.FinancialTransactionUncheckedCreateInput, 'referenceId'> {
    if (input.amountPaise <= 0n) {
      throw validationFailed('The amount must be greater than zero.', { field: 'amountPaise' });
    }

    const incomeType = input.incomeType ?? null;
    const memberId = input.memberId ?? null;
    const contributionPeriodId = input.contributionPeriodId ?? null;
    const categoryId = input.categoryId ?? null;

    if (input.transactionType === 'INCOME') {
      if (incomeType === null) {
        throw validationFailed('An income transaction requires an income type.', {
          field: 'incomeType',
        });
      }

      if (categoryId !== null) {
        throw validationFailed('An income transaction cannot have a category.', {
          field: 'categoryId',
        });
      }
    } else {
      if (categoryId === null) {
        throw validationFailed('An expense transaction requires a category.', {
          field: 'categoryId',
        });
      }

      if (incomeType !== null) {
        throw validationFailed('An expense transaction cannot have an income type.', {
          field: 'incomeType',
        });
      }

      if (contributionPeriodId !== null) {
        throw validationFailed('An expense transaction cannot have a contribution period.', {
          field: 'contributionPeriodId',
        });
      }
    }

    if (
      incomeType === 'MEMBER_CONTRIBUTION' &&
      (memberId === null || contributionPeriodId === null)
    ) {
      throw validationFailed('A member contribution requires a member and a contribution period.', {
        field: 'contributionPeriodId',
      });
    }

    if (incomeType === 'ANONYMOUS_DONATION') {
      if (memberId !== null || contributionPeriodId !== null) {
        throw validationFailed('An anonymous donation cannot have a member or a period.', {
          field: 'memberId',
        });
      }
    }

    if ((incomeType === 'OFFERING' || incomeType === 'DONATION') && contributionPeriodId !== null) {
      throw validationFailed('An offering or donation cannot be linked to a contribution period.', {
        field: 'contributionPeriodId',
      });
    }

    return {
      transactionType: input.transactionType,
      amountPaise: input.amountPaise,
      paymentMethod: input.paymentMethod,
      businessDate: input.businessDate,
      occurredAt: input.occurredAt,
      description: input.description ?? null,
      notes: input.notes ?? null,
      incomeType,
      memberId,
      contributionPeriodId,
      categoryId,
      createdByAdminId: actorAdminId,
    };
  }

  private toCorrectableData(
    input: CorrectTransactionInput,
  ): Prisma.FinancialTransactionUncheckedUpdateInput {
    const data: Prisma.FinancialTransactionUncheckedUpdateInput = {};

    for (const field of CORRECTABLE_FIELDS) {
      if (field === 'amountPaise') {
        if (input.amountPaise !== undefined) {
          if (input.amountPaise <= 0n) {
            throw validationFailed('The amount must be greater than zero.', {
              field: 'amountPaise',
            });
          }
          data.amountPaise = input.amountPaise;
        }
        continue;
      }

      if (
        field === 'description' ||
        field === 'notes' ||
        field === 'memberId' ||
        field === 'categoryId'
      ) {
        const value = input[field];

        if (value !== undefined) {
          data[field] = value;
        }
        continue;
      }

      const value = input[field];

      if (value !== undefined) {
        data[field] = value;
      }
    }

    return data;
  }

  /**
   * Audit snapshot. `amountPaise` is a decimal string, never a JSON number, so an
   * amount cannot lose precision while being written to the audit trail.
   */
  private toAuditSnapshot(transaction: FinancialTransaction): Record<string, unknown> {
    return {
      referenceId: transaction.referenceId,
      transactionType: transaction.transactionType,
      amountPaise: transaction.amountPaise.toString(),
      paymentMethod: transaction.paymentMethod,
      status: transaction.status,
      businessDate: transaction.businessDate.toISOString().slice(0, 10),
      occurredAt: transaction.occurredAt.toISOString(),
      description: transaction.description,
      notes: transaction.notes,
      incomeType: transaction.incomeType,
      categoryId: transaction.categoryId,
      memberId: transaction.memberId,
      contributionPeriodId: transaction.contributionPeriodId,
      voidReason: transaction.voidReason,
      revision: transaction.revision,
    };
  }
}

/**
 * Translates a validated filter set into a Prisma `where` clause.
 *
 * The shape is built from a closed set of keys rather than forwarded from the request, so
 * an unrecognised filter cannot reach the database at all. `businessDate` bounds are
 * inclusive on both ends, matching the documented period boundaries, and the amount range
 * is applied to `amountPaise` so it is exact rather than a float comparison.
 *
 * The free-text `search` covers the reference, the description, and the named member or
 * category, which is exactly what `REQ-SEARCH-002` permits. It deliberately does not search
 * `notes`: `REQ-INCOME-005` forbids an anonymous donation from revealing a contributor
 * through a search result, and an identity written into a private note would otherwise be
 * findable, and so attributable, through the search box.
 */
function toPrismaWhere(filters: TransactionQueryFilters): Prisma.FinancialTransactionWhereInput {
  const where: Prisma.FinancialTransactionWhereInput = {};

  if (filters.transactionType !== undefined) {
    where.transactionType = filters.transactionType;
  }

  if (filters.status !== undefined) {
    where.status = filters.status;
  }

  if (filters.paymentMethod !== undefined) {
    where.paymentMethod = filters.paymentMethod;
  }

  if (filters.incomeType !== undefined) {
    where.incomeType = filters.incomeType;
  }

  if (filters.categoryId !== undefined) {
    where.categoryId = filters.categoryId;
  }

  if (filters.memberId !== undefined) {
    where.memberId = filters.memberId;
  }

  if (filters.referenceId !== undefined) {
    where.referenceId = filters.referenceId;
  }

  if (filters.from !== undefined || filters.to !== undefined) {
    where.businessDate = {
      ...(filters.from === undefined ? {} : { gte: filters.from }),
      ...(filters.to === undefined ? {} : { lte: filters.to }),
    };
  }

  if (filters.minAmountPaise !== undefined || filters.maxAmountPaise !== undefined) {
    where.amountPaise = {
      ...(filters.minAmountPaise === undefined ? {} : { gte: filters.minAmountPaise }),
      ...(filters.maxAmountPaise === undefined ? {} : { lte: filters.maxAmountPaise }),
    };
  }

  if (filters.search !== undefined) {
    where.OR = [
      { referenceId: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
      { member: { is: { name: { contains: filters.search, mode: 'insensitive' } } } },
      { member: { is: { referenceId: { contains: filters.search, mode: 'insensitive' } } } },
      { category: { is: { name: { contains: filters.search, mode: 'insensitive' } } } },
    ];
  }

  return where;
}
