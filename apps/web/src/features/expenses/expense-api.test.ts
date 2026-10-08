import { describe, expect, it } from 'vitest';
import {
  EXPENSE_CATEGORY_NAME_MAX_LENGTH,
  EXPENSE_REASON_NAME_MAX_LENGTH,
  RECEIPT_MISSING_LABEL,
  TRANSACTION_DESCRIPTION_MAX_LENGTH,
  TRANSACTION_NOTES_MAX_LENGTH,
  VENDOR_MAX_LENGTH,
  type ExpenseCategoryView,
  type TransactionSummary,
} from '@hyssop/contracts';
import {
  ACTIVE_EXPENSE_CATEGORIES,
  ACTIVE_EXPENSE_REASONS,
  EXPENSE_ONE,
} from '../../test/stub-client';
import {
  EMPTY_EXPENSE_FORM,
  expenseCategoryLabel,
  expenseReasonLabel,
  expenseRequestBody,
  findExpenseCategory,
  findExpenseReason,
  hasExpenseFieldErrors,
  isExpenseSummary,
  validateCategoryName,
  validateExpenseFields,
  validateReasonName,
  type ExpenseFormValues,
} from './expense-api';
import {
  correctionRequestBody,
  hasCorrectionErrors,
  validateCorrectionFields,
} from '../transactions/transaction-api';

/**
 * The pure rules of the expense screens.
 *
 * These must agree with `docs/06-API-SPEC.md`, `REQ-EXP-001` to `REQ-EXP-004`, and `REQ-DOC-003`
 * before a request is made, so they are tested without a component. Everything that needs the API
 * is covered by the UI tests and by the API's own contract suite.
 *
 * The money rules are asserted here as exact strings rather than numbers, because a test written
 * as `expect(body.amount).toBe(1.1)` would pass with a float while the application requires exact
 * paise; asserting the string is what makes `1.10` and `1.1` distinguishable.
 */

const CATEGORY_ID = ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '';
/** The reason that belongs to `CATEGORY_ID`, so a default form is internally consistent. */
const REASON_ID =
  ACTIVE_EXPENSE_REASONS.find((reason) => reason.categoryId === CATEGORY_ID)?.id ?? '';

function form(overrides: Partial<ExpenseFormValues> = {}): ExpenseFormValues {
  return {
    ...EMPTY_EXPENSE_FORM,
    categoryId: CATEGORY_ID,
    expenseReasonId: REASON_ID,
    amount: '500',
    businessDate: '2026-09-28',
    ...overrides,
  };
}

describe('validateExpenseFields', () => {
  it('accepts a complete valid form', () => {
    expect(validateExpenseFields(form())).toEqual({});
  });

  it('requires a category, because an expense cannot exist without one', () => {
    // `REQ-EXP-004`. A category-less expense is not a lesser expense; it is not representable.
    const errors = validateExpenseFields(form({ categoryId: '' }));

    expect(errors.categoryId).toBe('Choose a category.');
    expect(hasExpenseFieldErrors(errors)).toBe(true);
  });

  it('treats a whitespace-only category as missing', () => {
    expect(validateExpenseFields(form({ categoryId: '   ' })).categoryId).toBeDefined();
  });

  it('requires an amount', () => {
    expect(validateExpenseFields(form({ amount: '' })).amount).toBe('Enter an amount.');
    expect(validateExpenseFields(form({ amount: '   ' })).amount).toBe('Enter an amount.');
  });

  it('rejects a zero amount, naming the rule rather than saying only "invalid"', () => {
    for (const zero of ['0', '0.0', '0.00']) {
      expect(validateExpenseFields(form({ amount: zero })).amount).toBe(
        'The amount must be greater than zero.',
      );
    }
  });

  it('rejects a negative amount instead of sending it for the server to refuse', () => {
    // `-100` fails the shape rule, which is the correct local message: a negative expense is not
    // a smaller expense.
    expect(validateExpenseFields(form({ amount: '-100' })).amount).toBeDefined();
  });

  it('rejects an ambiguous amount rather than letting the browser round it', () => {
    // `1.005` is the case that matters. A browser that parsed it as a number would produce
    // 1.005 -> 1 or 1.01 depending on the path, and the ledger would not be reproducible.
    expect(validateExpenseFields(form({ amount: '1.005' })).amount).toBeDefined();
    expect(validateExpenseFields(form({ amount: '1.5.5' })).amount).toBeDefined();
    expect(validateExpenseFields(form({ amount: 'abc' })).amount).toBeDefined();
  });

  it('accepts a whole number and one or two decimal places', () => {
    for (const amount of ['1', '500', '500.5', '500.50', '1234567.89']) {
      expect(validateExpenseFields(form({ amount })).amount).toBeUndefined();
    }
  });

  it('requires a known payment method and a business date of the documented shape', () => {
    expect(
      validateExpenseFields(form({ paymentMethod: 'CHEQUE' as ExpenseFormValues['paymentMethod'] }))
        .paymentMethod,
    ).toBe('Choose a payment method.');
    expect(validateExpenseFields(form({ businessDate: '28-09-2026' })).businessDate).toBeDefined();
    expect(validateExpenseFields(form({ businessDate: '2026-9-8' })).businessDate).toBeDefined();
    expect(validateExpenseFields(form({ businessDate: '' })).businessDate).toBeDefined();
  });

  it('bounds the description and notes at the documented lengths', () => {
    expect(
      validateExpenseFields(
        form({ description: 'x'.repeat(TRANSACTION_DESCRIPTION_MAX_LENGTH + 1) }),
      ).description,
    ).toBeDefined();
    expect(
      validateExpenseFields(form({ notes: 'x'.repeat(TRANSACTION_NOTES_MAX_LENGTH + 1) })).notes,
    ).toBeDefined();
    // Exactly at the limit is allowed, so the browser does not reject a value the API accepts.
    expect(
      validateExpenseFields(
        form({
          description: 'x'.repeat(TRANSACTION_DESCRIPTION_MAX_LENGTH),
          notes: 'x'.repeat(TRANSACTION_NOTES_MAX_LENGTH),
        }),
      ),
    ).toEqual({});
  });

  it('bounds the optional vendor at the documented length and never requires it', () => {
    // `REQ-EXP-007`: the vendor is optional, so a blank one is valid, but a value longer than the
    // shared limit is refused before the request. Both edges are asserted against the constant.
    expect(validateExpenseFields(form({ vendor: '' })).vendor).toBeUndefined();
    expect(validateExpenseFields(form({ vendor: '   ' })).vendor).toBeUndefined();
    expect(
      validateExpenseFields(form({ vendor: 'x'.repeat(VENDOR_MAX_LENGTH) })).vendor,
    ).toBeUndefined();
    expect(validateExpenseFields(form({ vendor: 'x'.repeat(VENDOR_MAX_LENGTH + 1) })).vendor).toBe(
      `Vendor must be ${VENDOR_MAX_LENGTH} characters or fewer.`,
    );
  });

  it('requires a reason, because a category alone does not say what the money was spent on', () => {
    // `REQ-EXP-005`. The reason is not optional detail: "Electricity" does not distinguish a
    // monthly bill from a rewiring job, and the whole point of the set is that the ledger answers
    // "what did we spend on fuel" without someone reading descriptions.
    const errors = validateExpenseFields(form({ expenseReasonId: '' }));

    expect(errors.expenseReasonId).toBe('Choose a reason.');
    expect(hasExpenseFieldErrors(errors)).toBe(true);
  });

  it('treats a whitespace-only reason as missing', () => {
    expect(validateExpenseFields(form({ expenseReasonId: '   ' })).expenseReasonId).toBeDefined();
  });
});

describe('validateReasonName', () => {
  it('accepts a real reason name', () => {
    expect(validateReasonName('Diesel Generator')).toBeUndefined();
  });

  it('requires a name', () => {
    expect(validateReasonName('')).toBe('Enter a reason name.');
    expect(validateReasonName('   ')).toBe('Enter a reason name.');
  });

  it('bounds the name at the documented length', () => {
    // Asserted against the shared constant rather than a copied number, so a change to the
    // contract cannot leave this test passing against a length the API now refuses.
    expect(validateReasonName('x'.repeat(EXPENSE_REASON_NAME_MAX_LENGTH))).toBeUndefined();
    expect(validateReasonName('x'.repeat(EXPENSE_REASON_NAME_MAX_LENGTH + 1))).toBe(
      `Name must be ${EXPENSE_REASON_NAME_MAX_LENGTH} characters or fewer.`,
    );
  });
});

describe('expenseRequestBody', () => {
  it('sends the category, reason, amount, method, and business date', () => {
    expect(expenseRequestBody(form())).toEqual({
      categoryId: CATEGORY_ID,
      expenseReasonId: REASON_ID,
      amount: '500',
      paymentMethod: 'CASH',
      businessDate: '2026-09-28',
    });
  });

  it('preserves the amount as the exact decimal string the Admin typed', () => {
    // Not `1.1`: `Number('1.10')` is the float 1.1, and the difference between 110 and
    // 110.00000000000001 paise is exactly what the requirements forbid. A test that compared a
    // number here would not notice that.
    expect(expenseRequestBody(form({ amount: '1.10' })).amount).toBe('1.10');
    expect(typeof expenseRequestBody(form({ amount: '0.07' })).amount).toBe('string');
    expect(expenseRequestBody(form({ amount: '0.07' })).amount).toBe('0.07');
  });

  it('trims whitespace and omits blank optional text', () => {
    expect(
      expenseRequestBody(
        form({
          categoryId: ` ${CATEGORY_ID} `,
          expenseReasonId: ` ${REASON_ID} `,
          description: '  ',
          notes: '   ',
        }),
      ),
    ).toEqual({
      categoryId: CATEGORY_ID,
      expenseReasonId: REASON_ID,
      amount: '500',
      paymentMethod: 'CASH',
      businessDate: '2026-09-28',
    });
  });

  it('sends the description and notes when they carry content', () => {
    expect(
      expenseRequestBody(form({ description: '  September bill ', notes: ' Paid by transfer ' })),
    ).toEqual({
      categoryId: CATEGORY_ID,
      expenseReasonId: REASON_ID,
      amount: '500',
      paymentMethod: 'CASH',
      businessDate: '2026-09-28',
      description: 'September bill',
      notes: 'Paid by transfer',
    });
  });

  it('omits a blank vendor and sends a trimmed one when present', () => {
    // `REQ-EXP-007`: an absent vendor must not become an empty string, which is a different fact
    // from "not recorded". A present one is trimmed, matching the API's own normalisation.
    expect(expenseRequestBody(form({ vendor: '   ' }))).not.toHaveProperty('vendor');
    expect(expenseRequestBody(form({ vendor: '  KSEB ' })).vendor).toBe('KSEB');
  });

  it('never sends a member, an income type, or a contribution period', () => {
    // An expense belongs to the church, not to a member. A key that is never sent cannot be
    // stored, so this is stronger than relying on the server to strip it.
    const body = expenseRequestBody(form()) as Record<string, unknown>;

    expect(body).not.toHaveProperty('memberId');
    expect(body).not.toHaveProperty('incomeType');
    expect(body).not.toHaveProperty('contributionPeriod');
  });
});

describe('the category helpers', () => {
  it('finds a category by id', () => {
    expect(findExpenseCategory(ACTIVE_EXPENSE_CATEGORIES, CATEGORY_ID)?.name).toBe('Electricity');
    expect(findExpenseCategory(ACTIVE_EXPENSE_CATEGORIES, undefined)).toBeUndefined();
    expect(findExpenseCategory(ACTIVE_EXPENSE_CATEGORIES, 'no-such-id')).toBeUndefined();
  });

  it('labels an active category with its plain name', () => {
    expect(
      expenseCategoryLabel(ACTIVE_EXPENSE_CATEGORIES, {
        id: CATEGORY_ID,
        name: 'Electricity',
        status: 'ACTIVE',
      }),
    ).toBe('Electricity');
  });

  it('keeps the name and explains the deactivated state on a historical expense', () => {
    // `docs/05-DATABASE-SPEC.md` preserves inactive categories on historical transactions. A
    // blank cell would read as missing data and a bare name would hide the fact that the
    // category can no longer be chosen.
    const label = expenseCategoryLabel([], {
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Retired category',
      status: 'INACTIVE',
    });

    expect(label).toBe('Retired category (inactive)');
    expect(label).toContain('Retired category');
  });

  it('names the retained category rather than substituting an active one', () => {
    // The category list is active-only, so the historical id is not in it. The label still comes
    // from the transaction, which is the only honest source for what the expense was filed under.
    const label = expenseCategoryLabel(ACTIVE_EXPENSE_CATEGORIES, {
      id: 'retired',
      name: 'Retired category',
      status: 'INACTIVE',
    });

    expect(label).not.toContain('Electricity');
    expect(label).not.toContain('Repairs');
  });

  it('requires a category name and bounds it at the documented length', () => {
    expect(validateCategoryName('')).toBe('Enter a category name.');
    expect(validateCategoryName('   ')).toBe('Enter a category name.');
    expect(validateCategoryName('x'.repeat(EXPENSE_CATEGORY_NAME_MAX_LENGTH + 1))).toBe(
      `Name must be ${EXPENSE_CATEGORY_NAME_MAX_LENGTH} characters or fewer.`,
    );
    expect(validateCategoryName('Books')).toBeUndefined();
    expect(validateCategoryName('x'.repeat(EXPENSE_CATEGORY_NAME_MAX_LENGTH))).toBeUndefined();
  });
});

describe('the reason helpers', () => {
  it('finds a reason by id within its own category', () => {
    // The lookup takes the pair, not the id alone. A reason id is globally unique today, but a
    // picker seeded from one category's list must not be able to resolve a reason from another.
    expect(findExpenseReason(ACTIVE_EXPENSE_REASONS, CATEGORY_ID, REASON_ID)?.name).toBe(
      'Electricity Bill',
    );
    expect(findExpenseReason(ACTIVE_EXPENSE_REASONS, CATEGORY_ID, undefined)).toBeUndefined();
    expect(findExpenseReason(ACTIVE_EXPENSE_REASONS, CATEGORY_ID, 'no-such-id')).toBeUndefined();

    const otherCategory = ACTIVE_EXPENSE_CATEGORIES[1]?.id ?? '';

    expect(findExpenseReason(ACTIVE_EXPENSE_REASONS, otherCategory, REASON_ID)).toBeUndefined();
  });

  it('labels an active reason with its plain name', () => {
    expect(
      expenseReasonLabel(ACTIVE_EXPENSE_REASONS, {
        id: REASON_ID,
        categoryId: CATEGORY_ID,
        name: 'Electricity Bill',
        status: 'ACTIVE',
      }),
    ).toBe('Electricity Bill');
  });

  it('keeps the name and explains the deactivated state on a historical expense', () => {
    // The reason list is active-only, so a retired reason is not in it. The expense still has to
    // show what the money was spent on, and that the reason can no longer be chosen.
    const label = expenseReasonLabel([], {
      id: '77777777-7777-4777-8777-777777777777',
      categoryId: CATEGORY_ID,
      name: 'Repair Work',
      status: 'INACTIVE',
    });

    expect(label).toBe('Repair Work (inactive)');
  });

  it('never substitutes a reason the expense did not use', () => {
    // A retired reason must not be quietly replaced by whatever is active now. That would let the
    // ledger claim a year-old expense was for something it was not.
    const label = expenseReasonLabel(ACTIVE_EXPENSE_REASONS, {
      id: 'retired',
      categoryId: CATEGORY_ID,
      name: 'Repair Work',
      status: 'INACTIVE',
    });

    expect(label).toBe('Repair Work (inactive)');
    expect(label).not.toContain('Electricity Bill');
  });
});

describe('isExpenseSummary', () => {
  const incomeRow: TransactionSummary = {
    ...EXPENSE_ONE,
    type: 'INCOME',
    category: null,
    hasReceipt: undefined as unknown as boolean,
  } as unknown as TransactionSummary;

  it('accepts an expense with a category and a derived receipt state', () => {
    expect(isExpenseSummary(EXPENSE_ONE)).toBe(true);
  });

  it('rejects an income row, even one that arrived on an expense route', () => {
    expect(isExpenseSummary(incomeRow)).toBe(false);
  });

  it('rejects an expense with no category, rather than rendering it as normal', () => {
    // `REQ-EXP-004` is not representable, so such a payload is a contract violation. Showing it
    // anyway would mean guessing a category, which is the one thing the screen must not do.
    expect(isExpenseSummary({ ...EXPENSE_ONE, category: null })).toBe(false);
  });

  it('rejects an expense with no receipt state, rather than assuming one', () => {
    // `REQ-DOC-003` requires the screen to say Receipt Missing. A payload that cannot answer the
    // question must not be answered by a guess in either direction.
    const withoutFlag = { ...EXPENSE_ONE } as Record<string, unknown>;

    delete withoutFlag.hasReceipt;
    expect(isExpenseSummary(withoutFlag as unknown as TransactionSummary)).toBe(false);
  });
});

describe('the shared correction form for an expense', () => {
  const base = {
    amount: '500',
    paymentMethod: 'CASH' as const,
    businessDate: '2026-09-28',
    description: '',
    notes: '',
  };

  it('sends the category when one is supplied, so an expense can move', () => {
    expect(correctionRequestBody({ ...base, categoryId: CATEGORY_ID }).categoryId).toBe(
      CATEGORY_ID,
    );
  });

  it('omits the category entirely when none is supplied, so income is unaffected', () => {
    // An income correction must never carry a category key: the database forbids a category on an
    // income row, and the API refuses the field there.
    const body = correctionRequestBody(base) as Record<string, unknown>;

    expect(body).not.toHaveProperty('categoryId');
  });

  it('omits a blank category rather than sending null, which would strip it', () => {
    // `REQ-EXP-004` requires exactly one category, so `null` is not a legal value to send.
    const body = correctionRequestBody({ ...base, categoryId: '   ' }) as Record<string, unknown>;

    expect(body).not.toHaveProperty('categoryId');
  });

  it('reports a malformed category against the field', () => {
    const errors = validateCorrectionFields({ ...base, categoryId: 'not-a-uuid' });

    expect(errors.categoryId).toBe('Choose a category.');
    expect(hasCorrectionErrors(errors)).toBe(true);
  });

  it('accepts a well-formed category and no category at all', () => {
    expect(validateCorrectionFields({ ...base, categoryId: CATEGORY_ID })).toEqual({});
    expect(validateCorrectionFields(base)).toEqual({});
  });
});

describe('RECEIPT_MISSING_LABEL', () => {
  it('is the exact wording REQ-DOC-003 requires', () => {
    // The requirement is that the interface clearly show **Receipt Missing**. Both words, that
    // capitalisation: "receipt missing" or "No receipt" is a different, weaker statement.
    expect(RECEIPT_MISSING_LABEL).toBe('Receipt Missing');
  });
});

describe('the category list is the active set', () => {
  it('contains no inactive category in the default fixture', () => {
    // The API documents `GET /expenses/categories` as the active categories, so a deactivated one
    // must not be offered for a new entry. The historical fixture proves the other half: the
    // inactive status travels on the transaction instead.
    const active: readonly ExpenseCategoryView[] = ACTIVE_EXPENSE_CATEGORIES;

    expect(active.length).toBeGreaterThan(0);
    expect(active.every((category) => category.status === 'ACTIVE')).toBe(true);
  });
});
