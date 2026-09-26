/**
 * Fictional demo seed.
 *
 * Authority: `docs/13-DEMO-DATA-SPEC.md` (fictional content, several months of
 * coverage, PAID / PARTIALLY PAID / NOT PAID months, every initial category, a
 * correction with audit history, a void with a reason, and idempotent reruns) and
 * `docs/05-DATABASE-SPEC.md` (references come from the allocator, money is exact
 * paise, business dates are Asia/Kolkata, dates and enums are valid).
 *
 * The seed is a developer command, never a user-facing feature. It is idempotent: every
 * record is resolved by a stable natural key, so a rerun updates or skips instead of
 * duplicating. It never drops, truncates, or resets the database.
 *
 * Usage:
 *   npm run db:seed
 *   DEMO_AS_OF_DATE=2026-09-30 npm run db:seed
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import {
  businessDateInMonth,
  businessDateFromInstant,
  formatBusinessDate,
  parseBusinessDate,
  shiftMonth,
  startOfBusinessDay,
  yearMonthOf,
  type YearMonth,
} from './seed-dates.ts';
import {
  CONTRIBUTION_DAY,
  CORRECTION_EXAMPLE_KEY,
  CUSTOM_EXPENSE_CATEGORIES,
  DEFAULT_CONTRIBUTION_PAISE,
  INITIAL_EXPENSE_CATEGORIES,
  PARTIAL_CONTRIBUTION_PAISE,
  SEED_CONTRIBUTION_PATTERN,
  SEED_EXPENSES,
  SEED_MEMBERS,
  SEED_OTHER_INCOME,
  VOID_EXAMPLE_KEY,
  normalizeCategoryName,
} from './seed-data.ts';
import { formatReference, type ReferenceScope } from './seed-references.ts';

const prisma = new PrismaClient();

/** The three seeded months, from oldest to newest. */
const MONTH_OFFSETS: readonly number[] = [-2, -1, 0];

const CORRECTION_DELTA_PAISE = 2_500n;
const VOID_REASON = 'Entered twice by mistake';

interface SeedContext {
  readonly adminUserId: string;
  readonly asOfDate: Date;
}

async function allocateReference(
  tx: Prisma.TransactionClient,
  scope: ReferenceScope,
): Promise<string> {
  const rows = await tx.$queryRaw<readonly { readonly last_value: bigint }[]>`
    INSERT INTO id_sequence (scope, last_value, updated_at)
    VALUES (${scope}, 1, now())
    ON CONFLICT (scope) DO UPDATE
      SET last_value = id_sequence.last_value + 1, updated_at = now()
    RETURNING last_value
  `;

  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Reference allocation returned no value for scope ${scope}.`);
  }

  return formatReference(scope, row.last_value);
}

async function main(): Promise<void> {
  const context: SeedContext = {
    adminUserId: await ensureAdminUser(),
    asOfDate: readAsOfDate(),
  };

  await ensureSettings();
  await ensureCategories();
  const membersByKey = await ensureMembers();
  const periods = await ensureContributionPeriods(membersByKey, yearMonthOf(context.asOfDate));
  const report = await ensureTransactions(context, membersByKey, periods);

  process.stdout.write(
    [
      'Seed complete. All content is fictional demo data.',
      `Business date used: ${formatBusinessDate(context.asOfDate)} (Asia/Kolkata)`,
      `Members: ${membersByKey.size}`,
      `Contribution periods: ${periods.size}`,
      `Transactions created this run: ${report.created}`,
      `Transactions already present and skipped: ${report.skipped}`,
      'Documents are not seeded: document storage belongs to a later phase, and a',
      'metadata row without a stored file would be dishonest state.',
      '',
    ].join('\n'),
  );
}

/**
 * `DEMO_AS_OF_DATE` makes a deterministic run reproducible. Without it, the current
 * Asia/Kolkata date is used, so a live demo always has Today and This Month data.
 */
function readAsOfDate(): Date {
  const configured = process.env['DEMO_AS_OF_DATE']?.trim();

  if (configured === undefined || configured === '') {
    return businessDateFromInstant(new Date());
  }

  return parseBusinessDate(configured);
}

async function ensureAdminUser(): Promise<string> {
  const displayName = 'Demo Admin';
  const existing = await prisma.adminUser.findFirst({ where: { displayName } });

  if (existing !== null) {
    return existing.id;
  }

  const created = await prisma.adminUser.create({ data: { displayName } });
  return created.id;
}

async function ensureSettings(): Promise<void> {
  const values: Readonly<Record<string, string>> = {
    DEFAULT_MONTHLY_CONTRIBUTION_PAISE: DEFAULT_CONTRIBUTION_PAISE.toString(),
    ENABLED_PAYMENT_METHODS: 'CASH,UPI,BANK_TRANSFER',
    CURRENCY: 'INR',
    BUSINESS_TIMEZONE: 'Asia/Kolkata',
  };

  for (const [key, value] of Object.entries(values)) {
    await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}

async function ensureCategories(): Promise<Map<string, string>> {
  const byName = new Map<string, string>();

  for (const name of [...INITIAL_EXPENSE_CATEGORIES, ...CUSTOM_EXPENSE_CATEGORIES]) {
    const normalizedName = normalizeCategoryName(name);
    const category = await prisma.expenseCategory.upsert({
      where: { normalizedName },
      create: { name, normalizedName, isSystem: INITIAL_EXPENSE_CATEGORIES.includes(name) },
      update: { name, status: 'ACTIVE' },
    });

    byName.set(name, category.id);
  }

  return byName;
}

async function ensureMembers(): Promise<Map<string, string>> {
  const idsByKey = new Map<string, string>();

  for (const member of SEED_MEMBERS) {
    const existing = await prisma.member.findFirst({ where: { name: member.name } });
    const id =
      existing?.id ??
      (await prisma.$transaction(async (tx) => {
        const referenceId = await allocateReference(tx, 'MEMBER');
        const created = await tx.member.create({
          data: { referenceId, name: member.name, phone: member.phone, notes: member.notes },
        });
        return created.id;
      }));

    idsByKey.set(member.key, id);
  }

  return idsByKey;
}

/** Creates the expected amount for each member for the three seeded months. */
async function ensureContributionPeriods(
  membersByKey: Map<string, string>,
  asOf: YearMonth,
): Promise<Map<string, string>> {
  const periodIds = new Map<string, string>();

  for (const [key, memberId] of membersByKey) {
    for (const monthOffset of MONTH_OFFSETS) {
      const { year, month } = shiftMonth(asOf.year, asOf.month, monthOffset);
      const period = await prisma.contributionPeriod.upsert({
        where: { memberId_year_month: { memberId, year, month } },
        create: { memberId, year, month, expectedPaise: DEFAULT_CONTRIBUTION_PAISE },
        update: { expectedPaise: DEFAULT_CONTRIBUTION_PAISE },
      });

      periodIds.set(periodKey(key, year, month), period.id);
    }
  }

  return periodIds;
}

function periodKey(memberKey: string, year: number, month: number): string {
  return `${memberKey}:${year}-${String(month).padStart(2, '0')}`;
}

async function ensureTransactions(
  context: SeedContext,
  membersByKey: Map<string, string>,
  periodIds: Map<string, string>,
): Promise<{ readonly created: number; readonly skipped: number }> {
  const categories = new Map(
    (await prisma.expenseCategory.findMany()).map((category) => [category.name, category.id]),
  );
  const asOf = yearMonthOf(context.asOfDate);
  let created = 0;
  let skipped = 0;

  for (const expense of SEED_EXPENSES) {
    const { year, month } = shiftMonth(asOf.year, asOf.month, expense.monthOffset);
    const categoryId = categories.get(expense.categoryName);

    if (categoryId === undefined) {
      throw new Error(`Seed category "${expense.categoryName}" is missing.`);
    }

    const outcome = await createTransactionOnce(context, {
      transactionType: 'EXPENSE',
      amountPaise: expense.amountPaise,
      paymentMethod: expense.paymentMethod,
      businessDate: businessDateInMonth(year, month, expense.day),
      description: expense.description,
      categoryId,
      voidReason:
        expense.key === VOID_EXAMPLE_KEY ||
        (expense.voidedMonthOffsets ?? []).includes(expense.monthOffset)
          ? VOID_REASON
          : null,
      correctedAmountPaise:
        expense.key === CORRECTION_EXAMPLE_KEY
          ? expense.amountPaise + CORRECTION_DELTA_PAISE
          : null,
    });

    created += outcome.created;
    skipped += outcome.skipped;
  }

  for (const income of SEED_OTHER_INCOME) {
    const { year, month } = shiftMonth(asOf.year, asOf.month, income.monthOffset);
    const memberId =
      income.memberKey === undefined ? null : (membersByKey.get(income.memberKey) ?? null);

    const outcome = await createTransactionOnce(context, {
      transactionType: 'INCOME',
      amountPaise: income.amountPaise,
      paymentMethod: income.paymentMethod,
      businessDate: businessDateInMonth(year, month, income.day),
      description: income.description,
      incomeType: income.incomeType,
      memberId,
      voidReason: null,
      correctedAmountPaise: null,
    });

    created += outcome.created;
    skipped += outcome.skipped;
  }

  for (const [key, memberId] of membersByKey) {
    const pattern = SEED_CONTRIBUTION_PATTERN[key] ?? [];

    for (const [index, monthOffset] of MONTH_OFFSETS.entries()) {
      const behavior = pattern[index];

      if (behavior === undefined || behavior === 'NONE') {
        continue;
      }

      const { year, month } = shiftMonth(asOf.year, asOf.month, monthOffset);
      const periodId = periodIds.get(periodKey(key, year, month));

      if (periodId === undefined) {
        throw new Error(`Seed contribution period for ${key} ${year}-${month} is missing.`);
      }

      const amountPaise =
        behavior === 'FULL' ? DEFAULT_CONTRIBUTION_PAISE : PARTIAL_CONTRIBUTION_PAISE;

      const outcome = await createTransactionOnce(context, {
        transactionType: 'INCOME',
        amountPaise,
        paymentMethod: month % 2 === 0 ? 'UPI' : 'CASH',
        businessDate: businessDateInMonth(year, month, CONTRIBUTION_DAY),
        description: 'Member contribution',
        incomeType: 'MEMBER_CONTRIBUTION',
        memberId,
        contributionPeriodId: periodId,
        voidReason: null,
        correctedAmountPaise: null,
      });

      created += outcome.created;
      skipped += outcome.skipped;
    }
  }

  return { created, skipped };
}

interface TransactionSeed {
  readonly transactionType: 'INCOME' | 'EXPENSE';
  readonly amountPaise: bigint;
  readonly paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER';
  readonly businessDate: Date;
  readonly description: string | null;
  readonly incomeType?: 'MEMBER_CONTRIBUTION' | 'OFFERING' | 'DONATION' | 'ANONYMOUS_DONATION';
  readonly memberId?: string | null;
  readonly contributionPeriodId?: string | null;
  readonly categoryId?: string;
  readonly voidReason: string | null;
  readonly correctedAmountPaise: bigint | null;
}

/**
 * Creates one seeded transaction if its natural key is not already present.
 *
 * The natural key is the fictional description plus the business date, type, payment
 * method, and links, which are deterministic from the dataset. Because a correction
 * changes the stored amount, the amount is matched against both the original and the
 * corrected value so a rerun recognises the already-corrected record instead of creating
 * a second one. The reference, the record, its audit events, an optional correction, and
 * an optional void all commit in one transaction, so a failed run never leaves a
 * half-seeded financial record.
 */
async function createTransactionOnce(
  context: SeedContext,
  seed: TransactionSeed,
): Promise<{ readonly created: number; readonly skipped: number }> {
  const amountPaise = [
    seed.amountPaise,
    ...(seed.correctedAmountPaise === null ? [] : [seed.correctedAmountPaise]),
  ];

  const existing = await prisma.financialTransaction.findFirst({
    where: {
      transactionType: seed.transactionType,
      businessDate: seed.businessDate,
      amountPaise: { in: amountPaise },
      description: seed.description,
      memberId: seed.memberId ?? null,
      contributionPeriodId: seed.contributionPeriodId ?? null,
      categoryId: seed.categoryId ?? null,
    },
  });

  if (existing !== null) {
    return { created: 0, skipped: 1 };
  }

  await prisma.$transaction(async (tx) => {
    const referenceId = await allocateReference(
      tx,
      seed.transactionType === 'INCOME' ? 'INCOME' : 'EXPENSE',
    );

    const created = await tx.financialTransaction.create({
      data: {
        referenceId,
        transactionType: seed.transactionType,
        amountPaise: seed.amountPaise,
        paymentMethod: seed.paymentMethod,
        businessDate: seed.businessDate,
        occurredAt: startOfBusinessDay(seed.businessDate),
        description: seed.description,
        incomeType: seed.incomeType ?? null,
        memberId: seed.memberId ?? null,
        contributionPeriodId: seed.contributionPeriodId ?? null,
        categoryId: seed.categoryId ?? null,
        createdByAdminId: context.adminUserId,
      },
    });

    await tx.auditEvent.create({
      data: {
        action: 'TRANSACTION_CREATED',
        entityType: 'financial_transaction',
        entityId: created.id,
        entityReference: created.referenceId,
        actorAdminId: context.adminUserId,
        after: { amountPaise: created.amountPaise.toString(), source: 'seed' },
      },
    });

    if (seed.correctedAmountPaise !== null) {
      const corrected = await tx.financialTransaction.update({
        where: { id: created.id },
        data: {
          amountPaise: seed.correctedAmountPaise,
          revision: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      await tx.auditEvent.create({
        data: {
          action: 'TRANSACTION_UPDATED',
          entityType: 'financial_transaction',
          entityId: corrected.id,
          entityReference: corrected.referenceId,
          actorAdminId: context.adminUserId,
          reason: 'Corrected amount after checking the receipt',
          before: { amountPaise: created.amountPaise.toString() },
          after: { amountPaise: corrected.amountPaise.toString() },
        },
      });
    }

    if (seed.voidReason !== null) {
      const voidedAt = new Date();
      const voided = await tx.financialTransaction.update({
        where: { id: created.id },
        data: {
          status: 'VOIDED',
          voidedAt,
          voidedByAdminId: context.adminUserId,
          voidReason: seed.voidReason,
          revision: { increment: 1 },
          updatedAt: voidedAt,
        },
      });

      await tx.auditEvent.create({
        data: {
          action: 'TRANSACTION_VOIDED',
          entityType: 'financial_transaction',
          entityId: voided.id,
          entityReference: voided.referenceId,
          actorAdminId: context.adminUserId,
          reason: seed.voidReason,
          before: { status: created.status },
          after: { status: voided.status },
        },
      });
    }
  });

  return { created: 1, skipped: 0 };
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
