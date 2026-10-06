/**
 * Fictional demo dataset.
 *
 * Authority: `docs/13-DEMO-DATA-SPEC.md`: names, phone numbers, notes, and
 * descriptions are invented; phone values use the reserved 900 000 00xx documentation
 * style so no real person can be represented; coverage must produce PAID, PARTIALLY
 * PAID, and NOT PAID months, every initial expense category, and enough dates to
 * exercise every dashboard period filter.
 *
 * The initial category list is fixed by `docs/01-REQUIREMENTS.md` `REQ-EXP-001`.
 */

/**
 * The documented correction example: an expense whose amount was corrected, leaving a
 * before and after value in the audit trail.
 */
export const CORRECTION_EXAMPLE_KEY = 'expense-bell-repair-correction';

/** The documented void example: a duplicate entry that is voided with a reason. */
export const VOID_EXAMPLE_KEY = 'expense-duplicate';

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

export const CUSTOM_EXPENSE_CATEGORIES: readonly string[] = ['Guest Speaker Honorarium'];

/**
 * The approved predefined expense reasons, per category.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-EXP-005` as approved for this feature. Each category
 * owns its own list, because a reason is meaningless without its category: `Food > Groceries` and
 * `Cleaning > Equipment` are different rows even though the word repeats, and the same holds for
 * `Other`, `Electrical Repair`, `Plumbing Work`, and `Drink[ing] Water`, which appear under several
 * categories *by design*. That repetition is the reason `expense_reason` is unique on the pair
 * `(category_id, normalized_name)` rather than on the name alone.
 *
 * Every category ends with `Other` because the migration's backfill points every pre-existing
 * expense at the `Other` reason of its own category, and at the Admin-created "miscellaneous"
 * escape hatch. A category without an `Other` would have nothing for its historical rows to be
 * assigned to, and the required-reason constraint could not be satisfied for it.
 *
 * The order within each category is the documented presentation order and is stable, so the seed
 * and a fresh database agree on what the reason dropdown looks like.
 *
 * `Construction` is included here even though it is not in `INITIAL_EXPENSE_CATEGORIES`: the
 * approved reason set names it, so a category that owns approved reasons has to exist, otherwise
 * those reasons could never be created and the approved set would be unrepresentable.
 */
export const PREDEFINED_EXPENSE_REASONS: Readonly<Record<string, readonly string[]>> = {
  'Charity / Help': [
    'Medical Help',
    'Education Help',
    'Food Help',
    'Emergency Help',
    'Family Support',
    'Other',
  ],
  'Church Maintenance': [
    'General Maintenance',
    'Cleaning Work',
    'Repair Work',
    'Plumbing Work',
    'Electrical Work',
    'Other',
  ],
  'Church Programs': [
    'Event Expenses',
    'Program Materials',
    'Decorations',
    'Food',
    'Transportation',
    'Other',
  ],
  Cleaning: ['Cleaning Materials', 'Cleaning Service', 'Equipment', 'Other'],
  Decoration: [
    'Flowers',
    'Banners',
    'Stage Decoration',
    'Lighting Decoration',
    'Materials',
    'Other',
  ],
  Electricity: ['Electricity Bill', 'Electrical Repair', 'Electrical Materials', 'Other'],
  Equipment: [
    'New Equipment',
    'Equipment Repair',
    'Equipment Parts',
    'Equipment Maintenance',
    'Other',
  ],
  Food: ['Groceries', 'Snacks', 'Meals', 'Drinking Water', 'Catering', 'Other'],
  'Guest Speaker Honorarium': [
    'Speaker Honorarium',
    'Speaker Travel',
    'Speaker Accommodation',
    'Other',
  ],
  Other: ['General Expense', 'Miscellaneous', 'Other'],
  Repairs: [
    'Building Repair',
    'Furniture Repair',
    'Electrical Repair',
    'Plumbing Repair',
    'Equipment Repair',
    'Other',
  ],
  Transport: ['Local Travel', 'Fuel', 'Vehicle Hire', 'Delivery', 'Guest Transport', 'Other'],
  Water: ['Water Bill', 'Drinking Water', 'Water Tanker', 'Plumbing Work', 'Other'],
  Construction: [
    'Cement',
    'Sand',
    'Bricks',
    'Steel',
    'Electrical Work',
    'Plumbing Work',
    'Painting',
    'Labour',
    'Tiles',
    'Wood Work',
    'Doors & Windows',
    'Other',
  ],
};

/**
 * The categories the seed must exist before the predefined reasons can be attached.
 *
 * `INITIAL_EXPENSE_CATEGORIES`, `CUSTOM_EXPENSE_CATEGORIES`, and every category named by
 * `PREDEFINED_EXPENSE_REASONS` -- deduplicated rather than restated, so a category added to the
 * approved reason set cannot be forgotten here and silently end up with no reasons.
 */
export const ALL_EXPENSE_CATEGORIES: readonly string[] = Array.from(
  new Set([
    ...INITIAL_EXPENSE_CATEGORIES,
    ...CUSTOM_EXPENSE_CATEGORIES,
    ...Object.keys(PREDEFINED_EXPENSE_REASONS),
  ]),
);

export function normalizeCategoryName(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Normalizes a reason name, exactly as the database's `expense_reason_normalized_name_is_normalized`
 * CHECK does and exactly as `normalizeReasonName` in the API does.
 *
 * Repeated here rather than imported from the API so `prisma/seed-data.ts` stays a plain data
 * module with no dependency on the application. The three implementations are the same two
 * operations -- `trim()` then `toLowerCase()` -- and a test asserts they agree, because a
 * divergence would make the seed's lookup miss a reason the database already has.
 */
export function normalizeReasonName(raw: string): string {
  return raw.trim().toLowerCase();
}

export const DEFAULT_CONTRIBUTION_PAISE = 50_000n;

export interface SeedMember {
  readonly key: string;
  readonly name: string;
  readonly phone: string | null;
  readonly notes: string | null;
}

/** Fictional members. `key` is a seed-only stable identifier, not stored in the database. */
export const SEED_MEMBERS: readonly SeedMember[] = [
  { key: 'member-01', name: 'Anitha Kumar', phone: '9000000001', notes: 'Fictional demo member' },
  { key: 'member-02', name: 'Benedict D’Souza', phone: '9000000002', notes: null },
  { key: 'member-03', name: 'Chandralekha Nair', phone: '9000000003', notes: 'Prefers UPI' },
  { key: 'member-04', name: 'Devadas Menon', phone: null, notes: null },
  { key: 'member-05', name: 'Esther Philip', phone: '9000000005', notes: 'Fictional demo member' },
  { key: 'member-06', name: 'George Mathew', phone: '9000000006', notes: null },
  { key: 'member-07', name: 'Hephzibah Raj', phone: '9000000007', notes: 'Fictional demo member' },
  { key: 'member-08', name: 'Isaac Thomas', phone: null, notes: 'Phone not recorded' },
];

/**
 * How each fictional member behaves across the seeded months. The pattern guarantees
 * full, partial, and unpaid months, which is what `REQ-CONTRIB-002` derives.
 */
export const SEED_CONTRIBUTION_PATTERN: Readonly<
  Record<string, readonly ('FULL' | 'PARTIAL' | 'NONE')[]>
> = {
  'member-01': ['FULL', 'FULL', 'FULL'],
  'member-02': ['FULL', 'PARTIAL', 'FULL'],
  'member-03': ['PARTIAL', 'PARTIAL', 'PARTIAL'],
  'member-04': ['NONE', 'NONE', 'NONE'],
  'member-05': ['FULL', 'FULL', 'NONE'],
  'member-06': ['FULL', 'NONE', 'NONE'],
  'member-07': ['PARTIAL', 'FULL', 'FULL'],
  'member-08': ['NONE', 'FULL', 'NONE'],
};

export const PARTIAL_CONTRIBUTION_PAISE = 25_000n;

export interface SeedExpense {
  readonly key: string;
  readonly categoryName: string;
  /**
   * The reason this demo expense was recorded under, from `PREDEFINED_EXPENSE_REASONS`.
   *
   * Every seeded expense names a *meaningful* reason rather than falling back to `Other`. That is a
   * demo-data decision with a purpose: the migration backfill already demonstrates what `Other`
   * looks like on historical rows, so the fresh seed rows are free to show the feature properly --
   * an Admin opening the Expenses screen should see real categories paired with real reasons, and
   * searching for a reason should return something meaningful.
   *
   * The seed fails loudly if a name is not in its category's approved list, rather than silently
   * substituting `Other`. A mismatch means the data and the approved set disagree, which is a bug
   * in this repository, not something to paper over in the database.
   */
  readonly reasonName: string;
  readonly amountPaise: bigint;
  readonly paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER';
  /** Day of the month; clamped to the real month length by the seed. */
  readonly day: number;
  readonly description: string;
  readonly monthOffset: number;
  /** Month offsets that are voided, to prove exclusion from active totals. */
  readonly voidedMonthOffsets?: readonly number[];
}

export const SEED_EXPENSES: readonly SeedExpense[] = [
  {
    key: 'expense-electricity',
    categoryName: 'Electricity',
    reasonName: 'Electricity Bill',
    amountPaise: 84_500n,
    paymentMethod: 'BANK_TRANSFER',
    day: 6,
    description: 'Electricity bill',
    monthOffset: 0,
  },
  {
    key: 'expense-water',
    categoryName: 'Water',
    reasonName: 'Water Bill',
    amountPaise: 12_000n,
    paymentMethod: 'UPI',
    day: 8,
    description: 'Water bill',
    monthOffset: 0,
  },
  {
    key: 'expense-maintenance',
    categoryName: 'Church Maintenance',
    reasonName: 'General Maintenance',
    amountPaise: 150_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 12,
    description: 'Roof maintenance',
    monthOffset: 0,
  },
  {
    key: 'expense-repairs',
    categoryName: 'Repairs',
    reasonName: 'Equipment Repair',
    amountPaise: 32_500n,
    paymentMethod: 'CASH',
    day: 14,
    description: 'Bell repair',
    monthOffset: 0,
  },
  {
    key: 'expense-programs',
    categoryName: 'Church Programs',
    reasonName: 'Program Materials',
    amountPaise: 75_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 18,
    description: 'Youth program supplies',
    monthOffset: 0,
  },
  {
    key: 'expense-food',
    categoryName: 'Food',
    reasonName: 'Meals',
    amountPaise: 28_750n,
    paymentMethod: 'CASH',
    day: 20,
    description: 'Community meal',
    monthOffset: 0,
  },
  {
    key: 'expense-decoration',
    categoryName: 'Decoration',
    reasonName: 'Materials',
    amountPaise: 45_000n,
    paymentMethod: 'UPI',
    day: 22,
    description: 'Festival decoration',
    monthOffset: 0,
  },
  {
    key: 'expense-equipment',
    categoryName: 'Equipment',
    reasonName: 'New Equipment',
    amountPaise: 120_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 24,
    description: 'Sound system upgrade',
    monthOffset: 0,
  },
  {
    key: 'expense-cleaning',
    categoryName: 'Cleaning',
    reasonName: 'Cleaning Materials',
    amountPaise: 9_500n,
    paymentMethod: 'CASH',
    day: 25,
    description: 'Cleaning supplies',
    monthOffset: 0,
  },
  {
    key: 'expense-transport',
    categoryName: 'Transport',
    reasonName: 'Fuel',
    amountPaise: 18_000n,
    paymentMethod: 'CASH',
    day: 26,
    description: 'Vehicle fuel',
    monthOffset: 0,
  },
  {
    key: 'expense-charity',
    categoryName: 'Charity / Help',
    reasonName: 'Family Support',
    amountPaise: 60_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 27,
    description: 'Family assistance',
    monthOffset: 0,
  },
  {
    key: 'expense-other',
    categoryName: 'Other',
    reasonName: 'Miscellaneous',
    amountPaise: 7_200n,
    paymentMethod: 'CASH',
    day: 27,
    description: 'Miscellaneous',
    monthOffset: 0,
  },
  {
    key: 'expense-custom',
    categoryName: 'Guest Speaker Honorarium',
    reasonName: 'Speaker Honorarium',
    amountPaise: 25_000n,
    paymentMethod: 'UPI',
    day: 28,
    description: 'Guest speaker honorarium',
    monthOffset: 0,
  },
  {
    key: 'expense-electricity-prior',
    categoryName: 'Electricity',
    reasonName: 'Electricity Bill',
    amountPaise: 79_900n,
    paymentMethod: 'BANK_TRANSFER',
    day: 6,
    description: 'Electricity bill',
    monthOffset: -1,
  },
  {
    key: 'expense-food-prior',
    categoryName: 'Food',
    reasonName: 'Meals',
    amountPaise: 26_400n,
    paymentMethod: 'CASH',
    day: 19,
    description: 'Community meal',
    monthOffset: -1,
  },
  {
    key: 'expense-maintenance-prior',
    categoryName: 'Church Maintenance',
    reasonName: 'Cleaning Work',
    amountPaise: 45_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 11,
    description: 'Paint and cleaning supplies',
    monthOffset: -1,
  },
  {
    key: 'expense-programs-prior',
    categoryName: 'Church Programs',
    reasonName: 'Program Materials',
    amountPaise: 55_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 15,
    description: 'Sunday school materials',
    monthOffset: -1,
  },
  {
    key: 'expense-duplicate',
    categoryName: 'Other',
    reasonName: 'General Expense',
    amountPaise: 15_000n,
    paymentMethod: 'CASH',
    day: 16,
    description: 'Duplicate entry',
    monthOffset: -1,
    voidedMonthOffsets: [-1],
  },
  {
    key: 'expense-electricity-prior-prior',
    categoryName: 'Electricity',
    reasonName: 'Electricity Bill',
    amountPaise: 75_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 5,
    description: 'Electricity bill',
    monthOffset: -2,
  },
  {
    key: 'expense-maintenance-prior-prior',
    categoryName: 'Church Maintenance',
    reasonName: 'Repair Work',
    amountPaise: 30_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 9,
    description: 'Garden maintenance',
    monthOffset: -2,
  },
  {
    key: 'expense-transport-prior-prior',
    categoryName: 'Transport',
    reasonName: 'Fuel',
    amountPaise: 14_500n,
    paymentMethod: 'CASH',
    day: 21,
    description: 'Vehicle fuel',
    monthOffset: -2,
  },
  {
    key: CORRECTION_EXAMPLE_KEY,
    categoryName: 'Repairs',
    reasonName: 'Equipment Repair',
    amountPaise: 30_000n,
    paymentMethod: 'CASH',
    day: 13,
    description: 'Bell repair corrected amount',
    monthOffset: 0,
  },
];

export interface SeedOtherIncome {
  readonly key: string;
  readonly incomeType: 'OFFERING' | 'DONATION' | 'ANONYMOUS_DONATION';
  readonly amountPaise: bigint;
  readonly paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER';
  readonly day: number;
  readonly description: string | null;
  readonly monthOffset: number;
  /** `key` of a member this income is optionally attributed to. */
  readonly memberKey?: string;
}

export const SEED_OTHER_INCOME: readonly SeedOtherIncome[] = [
  {
    key: 'offering-current-a',
    incomeType: 'OFFERING',
    amountPaise: 96_000n,
    paymentMethod: 'CASH',
    day: 7,
    description: 'Sunday offering',
    monthOffset: 0,
  },
  {
    key: 'offering-current-b',
    incomeType: 'OFFERING',
    amountPaise: 88_500n,
    paymentMethod: 'UPI',
    day: 14,
    description: 'Sunday offering',
    monthOffset: 0,
  },
  {
    key: 'offering-current-c',
    incomeType: 'OFFERING',
    amountPaise: 91_200n,
    paymentMethod: 'CASH',
    day: 21,
    description: 'Sunday offering',
    monthOffset: 0,
  },
  {
    key: 'offering-prior-a',
    incomeType: 'OFFERING',
    amountPaise: 87_000n,
    paymentMethod: 'CASH',
    day: 7,
    description: 'Sunday offering',
    monthOffset: -1,
  },
  {
    key: 'offering-prior-b',
    incomeType: 'OFFERING',
    amountPaise: 84_300n,
    paymentMethod: 'UPI',
    day: 21,
    description: 'Sunday offering',
    monthOffset: -1,
  },
  {
    key: 'offering-prior-prior-a',
    incomeType: 'OFFERING',
    amountPaise: 82_000n,
    paymentMethod: 'CASH',
    day: 7,
    description: 'Sunday offering',
    monthOffset: -2,
  },
  {
    key: 'donation-current',
    incomeType: 'DONATION',
    amountPaise: 50_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 10,
    description: 'Fictional donor thank-you',
    monthOffset: 0,
    memberKey: 'member-02',
  },
  {
    key: 'donation-prior',
    incomeType: 'DONATION',
    amountPaise: 25_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 17,
    description: 'Fictional donor thank-you',
    monthOffset: -1,
    memberKey: 'member-05',
  },
  {
    key: 'anonymous-current',
    incomeType: 'ANONYMOUS_DONATION',
    amountPaise: 20_000n,
    paymentMethod: 'CASH',
    day: 23,
    description: null,
    monthOffset: 0,
  },
  {
    key: 'anonymous-prior',
    incomeType: 'ANONYMOUS_DONATION',
    amountPaise: 15_000n,
    paymentMethod: 'CASH',
    day: 23,
    description: null,
    monthOffset: -1,
  },
];

/** Days of the month used for member contributions. */
export const CONTRIBUTION_DAY = 5;
