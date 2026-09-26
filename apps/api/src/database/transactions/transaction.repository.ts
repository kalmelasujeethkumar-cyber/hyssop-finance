import { Injectable } from '@nestjs/common';
import type {
  FinancialTransaction,
  IncomeType,
  PaymentMethod,
  Prisma,
  TransactionType,
} from '@prisma/client';
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
 */
export interface CorrectableTransactionFields {
  readonly amountPaise?: bigint;
  readonly paymentMethod?: PaymentMethod;
  readonly businessDate?: Date;
  readonly occurredAt?: Date;
  readonly description?: string | null;
  readonly notes?: string | null;
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
  ): Promise<FinancialTransaction> {
    const data = this.toCreateData(input, context.actorAdminId);

    return this.prisma.$transaction(async (tx) => {
      const referenceId = await this.references.allocate(
        tx,
        referenceScopeForTransactionType(data.transactionType),
      );

      const created = await tx.financialTransaction.create({ data: { ...data, referenceId } });

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
    });
  }

  /**
   * Applies a correction. The `revision` guard rejects a stale edit instead of
   * overwriting someone else's change, and the audit event keeps the previous values.
   */
  public async correct(
    id: string,
    input: CorrectTransactionInput,
    context: TransactionCommandContext,
  ): Promise<FinancialTransaction> {
    const changes = this.toCorrectableData(input);
    const changeCount = Object.keys(changes).length;

    if (changeCount === 0) {
      throw validationFailed('A correction must change at least one field.');
    }

    return this.prisma.$transaction(async (tx) => {
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
    });
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
  ): Promise<FinancialTransaction> {
    const voidReason = reason.trim();

    if (voidReason === '') {
      throw validationFailed('A void reason is required.', { field: 'reason' });
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.financialTransaction.findUnique({ where: { id } });

      if (current === null) {
        throw notFound('Transaction', id);
      }

      if (current.status === 'VOIDED') {
        if (current.voidReason === voidReason) {
          return current;
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
    });
  }

  public async findById(id: string): Promise<FinancialTransaction> {
    const transaction = await this.prisma.financialTransaction.findUnique({ where: { id } });

    if (transaction === null) {
      throw notFound('Transaction', id);
    }

    return transaction;
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

      if (field === 'description' || field === 'notes' || field === 'categoryId') {
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
