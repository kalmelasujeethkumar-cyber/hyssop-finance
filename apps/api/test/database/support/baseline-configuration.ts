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
 * The same trap has already been sprung once: `app_setting` was left empty by the database
 * suite's reset, and the browser suite answered `App setting was not found.` and could not
 * record a member contribution.
 *
 * This lives in the API's test support rather than in the browser suite because the list of
 * initial categories is owned by the API's category repository, and it is read from there rather
 * than restated, so a later change to `REQ-EXP-001` cannot leave the browser run restoring a
 * different set than the application itself seeds.
 */

import type { Prisma } from '@prisma/client';
import {
  INITIAL_EXPENSE_CATEGORIES,
  normalizeCategoryName,
} from '../../../src/database/categories/expense-category.repository';

/**
 * The subset of the generated client this module needs.
 *
 * It is declared as a `Pick` of the real delegate rather than as a hand-written shape, so the
 * generated client and `PrismaService` are accepted without a cast and a Prisma change that
 * alters these two methods becomes a compile error here rather than a silent mismatch. A caller
 * may equally pass an interactive transaction.
 */
export interface BaselineConfigurationClient {
  readonly expenseCategory: Pick<
    Prisma.ExpenseCategoryDelegate,
    'createMany' | 'updateMany' | 'count'
  >;
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
