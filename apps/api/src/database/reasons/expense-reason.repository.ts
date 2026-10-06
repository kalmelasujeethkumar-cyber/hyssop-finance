import { Injectable } from '@nestjs/common';
import { Prisma, type ExpenseCategory, type ExpenseReason } from '@prisma/client';
import { EXPENSE_REASON_NAME_MAX_LENGTH } from '@hyssop/contracts';
import { conflict, notFound, validationFailed } from '../../common/errors/domain.errors';
import { AuditEventRepository, AUDIT_ENTITY_TYPES } from '../audit/audit-event.repository';
import { PrismaService } from '../prisma/prisma.service';

/** The only two changes `docs/05-DATABASE-SPEC.md` permits: a rename or a deactivation. */
export interface ReasonChanges {
  readonly name?: string;
  readonly status?: 'ACTIVE' | 'INACTIVE';
}

/**
 * Normalizes a reason name for case-insensitive uniqueness *within its category*.
 *
 * Matches the `expense_reason_normalized_name_is_normalized` CHECK constraint exactly as
 * `normalizeCategoryName` matches the category constraint: lower-cased and trimmed, so uniqueness
 * is a database fact rather than only an application convention.
 */
export function normalizeReasonName(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Expense reason persistence.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-EXP-005` and `docs/05-DATABASE-SPEC.md`.
 *
 * Every rule here is a deliberate mirror of `ExpenseCategoryRepository`, because a reason and a
 * category are the same kind of thing to the Admin -- named configuration, deactivated instead of
 * deleted so history keeps its label -- and because writing a second, subtly different lifecycle
 * is exactly how two screens end up disagreeing about what is selectable.
 *
 * The one genuinely new rule is that a reason belongs to a category. It is enforced in three
 * places rather than one, because no single mechanism covers it:
 *
 * - `expense_reason_category_id_fkey` makes the ownership structural;
 * - the `(category_id, normalized_name)` unique index makes the *pair* the identity, which is what
 *   lets the approved predefined set repeat `Other` under every category;
 * - `requireActiveForCategory` rejects a reason/category mismatch before a write, so it is a
 *   documented `400` naming the field rather than the database trigger firing afterwards.
 */
@Injectable()
export class ExpenseReasonRepository {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventRepository,
  ) {}

  /**
   * Every reason of one category, in a stable order.
   *
   * Both statuses are returned. A caller that offers a selection uses {@link findActiveForCategory}
   * instead; this read exists for a history screen or an audit view that must still show a
   * deactivated reason's label.
   */
  public async findForCategory(categoryId: string): Promise<readonly ExpenseReason[]> {
    return this.prisma.expenseReason.findMany({
      where: { categoryId },
      orderBy: { name: 'asc' },
    });
  }

  /** The reasons that may be selected for a new expense under one active category. */
  public async findActiveForCategory(categoryId: string): Promise<readonly ExpenseReason[]> {
    return this.prisma.expenseReason.findMany({
      where: { categoryId, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
  }

  public async findById(id: string): Promise<ExpenseReason> {
    const reason = await this.prisma.expenseReason.findUnique({ where: { id } });

    if (reason === null) {
      throw notFound('Expense reason', id);
    }

    return reason;
  }

  /**
   * Returns the reason only when it may be used for a new expense *under this category*.
   *
   * The category check and the status check are separate, deliberate failures. A reason that
   * belongs to another category is a `400` naming `expenseReasonId`, not a `404`: the row exists,
   * the request is wrong, and telling the Admin the reason does not exist would send them looking
   * in the wrong place.
   */
  public async requireActiveForCategory(id: string, categoryId: string): Promise<ExpenseReason> {
    const reason = await this.findById(id);

    if (reason.categoryId !== categoryId) {
      throw validationFailed('The selected reason does not belong to the selected category.', {
        field: 'expenseReasonId',
      });
    }

    if (reason.status !== 'ACTIVE') {
      throw validationFailed('Only an active reason can be used for a new expense.', {
        field: 'expenseReasonId',
      });
    }

    return reason;
  }

  public async findByNormalizedName(
    categoryId: string,
    name: string,
  ): Promise<ExpenseReason | null> {
    return this.prisma.expenseReason.findUnique({
      where: {
        categoryId_normalizedName: { categoryId, normalizedName: normalizeReasonName(name) },
      },
    });
  }

  public async create(
    categoryId: string,
    name: string,
    actorAdminId: string,
  ): Promise<ExpenseReason> {
    return this.prisma.$transaction((tx) =>
      this.createWithinTransaction(tx, categoryId, name, actorAdminId),
    );
  }

  /**
   * The same create, inside a transaction the caller already opened.
   *
   * Required for the same idempotency reason as `ExpenseCategoryRepository.createWithinTransaction`:
   * the stored response and the reason write must commit together, so a retried request can never
   * report success for a reason that was rolled back. Reusing the caller's transaction is what
   * makes that true.
   */
  public async createWithinTransaction(
    tx: Prisma.TransactionClient,
    categoryId: string,
    name: string,
    actorAdminId: string,
  ): Promise<ExpenseReason> {
    const displayName = name.trim();

    if (displayName === '') {
      throw validationFailed('A reason name is required.', { field: 'name' });
    }

    if (displayName.length > EXPENSE_REASON_NAME_MAX_LENGTH) {
      throw validationFailed(
        `A reason name must be ${EXPENSE_REASON_NAME_MAX_LENGTH} characters or fewer.`,
        { field: 'name' },
      );
    }

    // An inactive category cannot gain a new selectable reason: the reason could never be chosen,
    // so it would be an entry the Admin cannot use. The category row is read inside the caller's
    // transaction so a category deactivated concurrently either wins or loses cleanly.
    const category = await tx.expenseCategory.findUnique({ where: { id: categoryId } });

    if (category === null) {
      throw notFound('Expense category', categoryId);
    }

    if (category.status !== 'ACTIVE') {
      throw validationFailed('A reason can only be added to an active category.', {
        field: 'categoryId',
      });
    }

    const normalizedName = normalizeReasonName(displayName);
    const existing = await tx.expenseReason.findUnique({
      where: { categoryId_normalizedName: { categoryId, normalizedName } },
    });

    if (existing !== null) {
      throw conflict('A reason with this name already exists in this category.', { field: 'name' });
    }

    const reason = await tx.expenseReason.create({
      // `isSystem` is not a parameter: the predefined set is a documented product set that only
      // the seed may mark, exactly as `isSystem` is not a parameter for a category.
      data: { categoryId, name: displayName, normalizedName, isSystem: false },
    });

    await this.audit.record(tx, {
      action: 'REASON_CREATED',
      entityType: AUDIT_ENTITY_TYPES.expenseReason,
      entityId: reason.id,
      entityReference: null,
      actorAdminId,
      after: {
        categoryId: reason.categoryId,
        name: reason.name,
        normalizedName: reason.normalizedName,
        isSystem: false,
      },
    });

    return reason;
  }

  /** Renames a reason or changes its status, keeping every historical expense's label. */
  public async update(
    id: string,
    changes: ReasonChanges,
    actorAdminId: string,
  ): Promise<ExpenseReason> {
    return this.prisma.$transaction((tx) =>
      this.updateWithinTransaction(tx, id, changes, actorAdminId),
    );
  }

  /** The same update, inside a transaction the caller already opened. */
  public async updateWithinTransaction(
    tx: Prisma.TransactionClient,
    id: string,
    changes: ReasonChanges,
    actorAdminId: string,
  ): Promise<ExpenseReason> {
    const current = await tx.expenseReason.findUnique({ where: { id } });

    if (current === null) {
      throw notFound('Expense reason', id);
    }

    const data: {
      name?: string;
      normalizedName?: string;
      status?: 'ACTIVE' | 'INACTIVE';
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    if (changes.name !== undefined) {
      const displayName = changes.name.trim();

      if (displayName === '' || displayName.length > EXPENSE_REASON_NAME_MAX_LENGTH) {
        throw validationFailed(
          `A reason name must be 1 to ${EXPENSE_REASON_NAME_MAX_LENGTH} characters.`,
          { field: 'name' },
        );
      }

      const normalizedName = normalizeReasonName(displayName);
      // Uniqueness is re-checked on rename, not only on create, and *scoped to the category*:
      // renaming a reason to the name another category already uses under its own reason is fine,
      // while renaming it onto a sibling reason in the same category is a documented conflict
      // rather than a raw unique-constraint error reported as a server fault.
      if (normalizedName !== current.normalizedName) {
        const taken = await tx.expenseReason.findUnique({
          where: { categoryId_normalizedName: { categoryId: current.categoryId, normalizedName } },
        });

        if (taken !== null) {
          throw conflict('A reason with this name already exists in this category.', {
            field: 'name',
          });
        }
      }

      data.name = displayName;
      data.normalizedName = normalizedName;
    }

    if (changes.status !== undefined) {
      data.status = changes.status;
    }

    const updated = await tx.expenseReason.update({ where: { id }, data });

    await this.audit.record(tx, {
      action: 'REASON_UPDATED',
      entityType: AUDIT_ENTITY_TYPES.expenseReason,
      entityId: updated.id,
      entityReference: null,
      actorAdminId,
      before: {
        categoryId: current.categoryId,
        name: current.name,
        normalizedName: current.normalizedName,
        status: current.status,
      },
      after: {
        categoryId: updated.categoryId,
        name: updated.name,
        normalizedName: updated.normalizedName,
        status: updated.status,
      },
    });

    return updated;
  }
}

/**
 * Looks up the reason an expense should be filed under, for a seed row.
 *
 * Seed-only, and deliberately `| null` rather than throwing: a seed that has just created the
 * approved predefined reasons must fail loudly through its own reconciliation if one is genuinely
 * missing, rather than this helper inventing a substitute reason that would quietly contradict the
 * documented category/reason pairing.
 */
export async function findSeedReason(
  tx: Prisma.TransactionClient,
  category: ExpenseCategory,
  name: string,
): Promise<ExpenseReason | null> {
  return tx.expenseReason.findUnique({
    where: {
      categoryId_normalizedName: {
        categoryId: category.id,
        normalizedName: normalizeReasonName(name),
      },
    },
  });
}
