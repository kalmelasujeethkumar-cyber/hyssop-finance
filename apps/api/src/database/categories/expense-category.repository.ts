import { Injectable } from '@nestjs/common';
import type { ExpenseCategory } from '@prisma/client';
import { conflict, notFound, validationFailed } from '../../common/errors/domain.errors';
import { AuditEventRepository, AUDIT_ENTITY_TYPES } from '../audit/audit-event.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The initial category set, fixed by `docs/01-REQUIREMENTS.md` `REQ-EXP-001`.
 *
 * Order is the documented presentation order and is stable for the seed.
 */
export const INITIAL_EXPENSE_CATEGORIES: readonly string[] = [
  'Electricity',
  'Water',
  'Church Maintenance',
  'Repairs',
  'Church Programs',
  'Food',
  'Decoration',
  'Equipment',
  'Cleaning',
  'Transport',
  'Charity / Help',
  'Other',
];

/**
 * Normalizes a category name for case-insensitive uniqueness.
 *
 * Matches the `expense_category_normalized_name_is_normalized` CHECK constraint:
 * lower-cased and trimmed, so uniqueness is enforced by the database, not only here.
 */
export function normalizeCategoryName(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Expense category persistence.
 *
 * Authority: `docs/05-DATABASE-SPEC.md`: the initial set is seeded with
 * `is_system = true`, custom categories are Admin-created with `is_system = false`,
 * names are unique case-insensitively, a category is renamed or deactivated instead of
 * deleted so history keeps its label, and new expenses may reference only an `ACTIVE`
 * category.
 */
@Injectable()
export class ExpenseCategoryRepository {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventRepository,
  ) {}

  public async findAll(): Promise<readonly ExpenseCategory[]> {
    return this.prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } });
  }

  public async findActive(): Promise<readonly ExpenseCategory[]> {
    return this.prisma.expenseCategory.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
  }

  public async findById(id: string): Promise<ExpenseCategory> {
    const category = await this.prisma.expenseCategory.findUnique({ where: { id } });

    if (category === null) {
      throw notFound('Expense category', id);
    }

    return category;
  }

  /** Returns the category only when it may be used for a new expense. */
  public async requireActive(id: string): Promise<ExpenseCategory> {
    const category = await this.findById(id);

    if (category.status !== 'ACTIVE') {
      throw validationFailed('Only an active category can be used for a new expense.', {
        field: 'categoryId',
      });
    }

    return category;
  }

  public async findByNormalizedName(name: string): Promise<ExpenseCategory | null> {
    return this.prisma.expenseCategory.findUnique({
      where: { normalizedName: normalizeCategoryName(name) },
    });
  }

  public async create(name: string, actorAdminId: string): Promise<ExpenseCategory> {
    const displayName = name.trim();

    if (displayName === '') {
      throw validationFailed('A category name is required.', { field: 'name' });
    }

    if (displayName.length > 80) {
      throw validationFailed('A category name must be 80 characters or fewer.', { field: 'name' });
    }

    const normalizedName = normalizeCategoryName(displayName);
    const existing = await this.prisma.expenseCategory.findUnique({ where: { normalizedName } });

    if (existing !== null) {
      throw conflict('A category with this name already exists.', { field: 'name' });
    }

    return this.prisma.$transaction(async (tx) => {
      const category = await tx.expenseCategory.create({
        data: { name: displayName, normalizedName, isSystem: false },
      });

      await this.audit.record(tx, {
        action: 'CATEGORY_CREATED',
        entityType: AUDIT_ENTITY_TYPES.expenseCategory,
        entityId: category.id,
        entityReference: null,
        actorAdminId,
        after: { name: category.name, normalizedName: category.normalizedName, isSystem: false },
      });

      return category;
    });
  }

  /** Renames a category or changes its status, keeping every historical transaction. */
  public async update(
    id: string,
    changes: { readonly name?: string; readonly status?: 'ACTIVE' | 'INACTIVE' },
    actorAdminId: string,
  ): Promise<ExpenseCategory> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.expenseCategory.findUnique({ where: { id } });

      if (current === null) {
        throw notFound('Expense category', id);
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

        if (displayName === '' || displayName.length > 80) {
          throw validationFailed('A category name must be 1 to 80 characters.', { field: 'name' });
        }

        data.name = displayName;
        data.normalizedName = normalizeCategoryName(displayName);
      }

      if (changes.status !== undefined) {
        data.status = changes.status;
      }

      const updated = await tx.expenseCategory.update({ where: { id }, data });

      await this.audit.record(tx, {
        action: 'CATEGORY_UPDATED',
        entityType: AUDIT_ENTITY_TYPES.expenseCategory,
        entityId: updated.id,
        entityReference: null,
        actorAdminId,
        before: {
          name: current.name,
          normalizedName: current.normalizedName,
          status: current.status,
        },
        after: {
          name: updated.name,
          normalizedName: updated.normalizedName,
          status: updated.status,
        },
      });

      return updated;
    });
  }
}
