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

export function normalizeCategoryName(raw: string): string {
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
    amountPaise: 84_500n,
    paymentMethod: 'BANK_TRANSFER',
    day: 6,
    description: 'Electricity bill',
    monthOffset: 0,
  },
  {
    key: 'expense-water',
    categoryName: 'Water',
    amountPaise: 12_000n,
    paymentMethod: 'UPI',
    day: 8,
    description: 'Water bill',
    monthOffset: 0,
  },
  {
    key: 'expense-maintenance',
    categoryName: 'Church Maintenance',
    amountPaise: 150_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 12,
    description: 'Roof maintenance',
    monthOffset: 0,
  },
  {
    key: 'expense-repairs',
    categoryName: 'Repairs',
    amountPaise: 32_500n,
    paymentMethod: 'CASH',
    day: 14,
    description: 'Bell repair',
    monthOffset: 0,
  },
  {
    key: 'expense-programs',
    categoryName: 'Church Programs',
    amountPaise: 75_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 18,
    description: 'Youth program supplies',
    monthOffset: 0,
  },
  {
    key: 'expense-food',
    categoryName: 'Food',
    amountPaise: 28_750n,
    paymentMethod: 'CASH',
    day: 20,
    description: 'Community meal',
    monthOffset: 0,
  },
  {
    key: 'expense-decoration',
    categoryName: 'Decoration',
    amountPaise: 45_000n,
    paymentMethod: 'UPI',
    day: 22,
    description: 'Festival decoration',
    monthOffset: 0,
  },
  {
    key: 'expense-equipment',
    categoryName: 'Equipment',
    amountPaise: 120_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 24,
    description: 'Sound system upgrade',
    monthOffset: 0,
  },
  {
    key: 'expense-cleaning',
    categoryName: 'Cleaning',
    amountPaise: 9_500n,
    paymentMethod: 'CASH',
    day: 25,
    description: 'Cleaning supplies',
    monthOffset: 0,
  },
  {
    key: 'expense-transport',
    categoryName: 'Transport',
    amountPaise: 18_000n,
    paymentMethod: 'CASH',
    day: 26,
    description: 'Vehicle fuel',
    monthOffset: 0,
  },
  {
    key: 'expense-charity',
    categoryName: 'Charity / Help',
    amountPaise: 60_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 27,
    description: 'Family assistance',
    monthOffset: 0,
  },
  {
    key: 'expense-other',
    categoryName: 'Other',
    amountPaise: 7_200n,
    paymentMethod: 'CASH',
    day: 27,
    description: 'Miscellaneous',
    monthOffset: 0,
  },
  {
    key: 'expense-custom',
    categoryName: 'Guest Speaker Honorarium',
    amountPaise: 25_000n,
    paymentMethod: 'UPI',
    day: 28,
    description: 'Guest speaker honorarium',
    monthOffset: 0,
  },
  {
    key: 'expense-electricity-prior',
    categoryName: 'Electricity',
    amountPaise: 79_900n,
    paymentMethod: 'BANK_TRANSFER',
    day: 6,
    description: 'Electricity bill',
    monthOffset: -1,
  },
  {
    key: 'expense-food-prior',
    categoryName: 'Food',
    amountPaise: 26_400n,
    paymentMethod: 'CASH',
    day: 19,
    description: 'Community meal',
    monthOffset: -1,
  },
  {
    key: 'expense-maintenance-prior',
    categoryName: 'Church Maintenance',
    amountPaise: 45_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 11,
    description: 'Paint and cleaning supplies',
    monthOffset: -1,
  },
  {
    key: 'expense-programs-prior',
    categoryName: 'Church Programs',
    amountPaise: 55_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 15,
    description: 'Sunday school materials',
    monthOffset: -1,
  },
  {
    key: 'expense-duplicate',
    categoryName: 'Other',
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
    amountPaise: 75_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 5,
    description: 'Electricity bill',
    monthOffset: -2,
  },
  {
    key: 'expense-maintenance-prior-prior',
    categoryName: 'Church Maintenance',
    amountPaise: 30_000n,
    paymentMethod: 'BANK_TRANSFER',
    day: 9,
    description: 'Garden maintenance',
    monthOffset: -2,
  },
  {
    key: 'expense-transport-prior-prior',
    categoryName: 'Transport',
    amountPaise: 14_500n,
    paymentMethod: 'CASH',
    day: 21,
    description: 'Vehicle fuel',
    monthOffset: -2,
  },
  {
    key: CORRECTION_EXAMPLE_KEY,
    categoryName: 'Repairs',
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
