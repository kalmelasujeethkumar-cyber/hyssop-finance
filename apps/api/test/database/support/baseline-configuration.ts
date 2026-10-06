/**
 * Baseline configuration for a test database.
 *
 * The browser acceptance run exercises the whole application against the real API and the real
 * database, so it needs the configuration the product treats as given to be present. Migrations
 * alone do not provide it: the application keys come from the forward migration
 * `20260929210000_app_setting_initial_keys`, and the initial category set fixed by
 * `docs/01-REQUIREMENTS.md` `REQ-EXP-001` is product configuration rather than schema. A database
 * built purely from migrations therefore has an empty category table, and the expense form's
 * picker renders with no options — the run then fails on a correctly working application, with a
 * failure no UI work can fix.
 *
 * The same trap has already been sprung twice: `app_setting` was left empty by the database
 * suite's reset, and the browser suite answered `App setting was not found.` and could not
 * record a member contribution; then the approved reason catalog (`REQ-EXP-005`) was truncated
 * the same way, and the expense form's reason picker rendered with a single "Choose a reason"
 * option. Both times the product was working correctly and the harness had to be made to provide
 * the configuration the product treats as given.
 *
 * This lives in the API's test support rather than in the browser suite because the list of
 * initial categories is owned by the API's category repository and the predefined reason catalog
 * is owned by the seed's `prisma/seed-data.ts`, and both are read from their owner rather than
 * restated, so a later change to `REQ-EXP-001` or `REQ-EXP-005` cannot leave the browser run
 * restoring a different set than the application itself seeds.
 */

import type { Prisma } from '@prisma/client';
import {
  INITIAL_EXPENSE_CATEGORIES,
  normalizeCategoryName,
} from '../../../src/database/categories/expense-category.repository';
import { normalizeReasonName } from '../../../src/database/reasons/expense-reason.repository';
import { PREDEFINED_EXPENSE_REASONS } from '../../../../../prisma/seed-data';

/**
 * The subset of the generated client this module needs.
 *
 * It is declared as a `Pick` of the real delegate rather than as a hand-written shape, so the
 * generated client and `PrismaService` are accepted without a cast and a Prisma change that
 * alters one of these methods becomes a compile error here rather than a silent mismatch. A
 * caller may equally pass an interactive transaction.
 */
export interface BaselineConfigurationClient {
  readonly expenseCategory: Pick<
    Prisma.ExpenseCategoryDelegate,
    'createMany' | 'updateMany' | 'count' | 'findMany'
  >;
  readonly expenseReason: Pick<Prisma.ExpenseReasonDelegate, 'createMany' | 'updateMany' | 'count'>;
}

/**
 * Restores the initial expense category set if it is not already there.
 *
 * `isSystem: true` is what marks these as the documented product set rather than categories an
 * Admin added, which is the distinction the API's category views depend on. Only the initial set
 * is restored: a custom category belongs to the test that created it, and re-adding it would
 * hide a category that was deliberately deactivated. `skipDuplicates` keeps the call idempotent,
 * so running it against a database that is already correct changes nothing.
 *
 * An existing category is also returned to `ACTIVE`, because a category another suite deactivated
 * is legitimate history that must not make the next suite's picker look empty. Nothing is ever
 * renamed or deleted here: the label history belongs to the records that used it.
 */
export async function restoreInitialExpenseCategories(
  client: BaselineConfigurationClient,
): Promise<void> {
  const normalizedNames = INITIAL_EXPENSE_CATEGORIES.map(normalizeCategoryName);

  await client.expenseCategory.createMany({
    data: INITIAL_EXPENSE_CATEGORIES.map((name) => ({
      name,
      normalizedName: normalizeCategoryName(name),
      isSystem: true,
    })),
    skipDuplicates: true,
  });

  // A system category left deactivated by an earlier suite would otherwise make the picker look
  // incomplete for reasons that have nothing to do with this run. Restoring the *status* is safe
  // here in a way that restoring a deleted category would not be: `REQ-EXP-002` deactivates
  // rather than deletes precisely so that the records filed under a category keep its label.
  await client.expenseCategory.updateMany({
    where: { normalizedName: { in: normalizedNames }, status: 'INACTIVE' },
    data: { status: 'ACTIVE' },
  });

  const count = await client.expenseCategory.count({
    where: { normalizedName: { in: normalizedNames } },
  });

  if (count !== INITIAL_EXPENSE_CATEGORIES.length) {
    throw new Error(
      'The initial expense category set could not be restored: expected ' +
        `${INITIAL_EXPENSE_CATEGORIES.length} categories but found ${count}.`,
    );
  }
}

/**
 * Restores the approved predefined reason catalog for the categories that exist.
 *
 * `REQ-EXP-005` is product configuration owned by the seed (`PREDEFINED_EXPENSE_REASONS`), not
 * schema, so a database built purely from migrations has an empty reason table and the expense
 * form's reason picker renders with no options. The catalog is read from its owner rather than
 * copied, exactly as `restoreInitialExpenseCategories` reads the category set from its owner, so
 * the browser run restores the same reasons the application seeds.
 *
 * Reasons are restored only under categories that already exist -- normally the initial set
 * `restoreInitialExpenseCategories` just returned -- and a predefined reason for an absent
 * category (for example `Construction` after a database-suite reset, which never recreates it) is
 * left alone rather than invented. Routinely the run records every reason for every category
 * present.
 *
 * `isSystem: true` marks these as the documented product set rather than reasons an Admin added,
 * which is the distinction the API's reason views depend on. `skipDuplicates` keeps the call
 * idempotent. A reason left inactive by an earlier suite is returned to `ACTIVE`, because that
 * deactivation is legitimate history that must not make the next suite's picker look short.
 * Nothing is ever renamed or deleted here: the label history belongs to the records that used it.
 */
export async function restoreInitialExpenseReasons(
  client: BaselineConfigurationClient,
): Promise<void> {
  const categoryNames = Object.keys(PREDEFINED_EXPENSE_REASONS);

  const categories = await client.expenseCategory.findMany({
    where: { normalizedName: { in: categoryNames.map(normalizeCategoryName) } },
  });

  const categoryByNormalizedName = new Map(
    categories.map((category) => [category.normalizedName, category]),
  );

  const predefined: readonly {
    categoryId: string;
    name: string;
    normalizedName: string;
  }[] = categoryNames.flatMap((categoryName) => {
    const category = categoryByNormalizedName.get(normalizeCategoryName(categoryName));

    if (category === undefined) {
      return [];
    }

    return (PREDEFINED_EXPENSE_REASONS[categoryName] ?? []).map((name) => ({
      categoryId: category.id,
      name,
      normalizedName: normalizeReasonName(name),
    }));
  });

  if (predefined.length === 0) {
    return;
  }

  const reasonCategoryIds = Array.from(new Set(predefined.map((reason) => reason.categoryId)));
  const normalizedReasonNames = Array.from(
    new Set(predefined.map((reason) => reason.normalizedName)),
  );

  await client.expenseReason.createMany({
    data: predefined.map((reason) => ({ ...reason, isSystem: true })),
    skipDuplicates: true,
  });

  await client.expenseReason.updateMany({
    where: {
      categoryId: { in: reasonCategoryIds },
      normalizedName: { in: normalizedReasonNames },
      status: 'INACTIVE',
    },
    data: { status: 'ACTIVE' },
  });

  const activeCount = await client.expenseReason.count({
    where: {
      categoryId: { in: reasonCategoryIds },
      normalizedName: { in: normalizedReasonNames },
      status: 'ACTIVE',
    },
  });

  if (activeCount !== predefined.length) {
    throw new Error(
      'The predefined expense reason catalog could not be restored: expected ' +
        `${predefined.length} active reasons but found ${activeCount}.`,
    );
  }
}
