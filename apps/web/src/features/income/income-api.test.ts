import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  ANONYMOUS_DONATION_DESCRIPTION,
  INCOME_TYPES,
  TRANSACTION_DESCRIPTION_MAX_LENGTH,
  TRANSACTION_NOTES_MAX_LENGTH,
} from '@hyssop/contracts';
import { ApiClientError, ApiTransportError } from '../../lib/api-client';
import {
  EMPTY_INCOME_FORM,
  MEMBER_PAYMENT_INCOME_TYPE,
  businessDateToday,
  contributionMonthOf,
  creditedMonthLabel,
  hasIncomeFieldErrors,
  incomeFieldErrorsFrom,
  incomeRequestBody,
  memberPaymentFormValues,
  showsMemberPicker,
  validateIncomeFields,
  type IncomeFormValues,
  type MemberPaymentRef,
} from './income-api';
import {
  CONTRIBUTION_SUMMARY_QUERY_KEY,
  MEMBER_DETAIL_QUERY_KEY,
  MEMBER_LIST_QUERY_KEY,
} from '../members/member-api';
import {
  TRANSACTION_LIST_QUERY_KEY,
  clampTransactionPageSize,
  createIdempotencyKey,
  describeTransactionFailure,
  fieldIssuesByName,
  hasCorrectionErrors,
  invalidateTransactionDependents,
  isTransactionSortFieldValue,
  isTransactionStatusValue,
  transactionListPath,
  validateCorrectionFields,
  validateVoidReason,
  TRANSACTION_LIST_DEFAULTS,
} from '../transactions/transaction-api';

/**
 * The pure rules of the income and shared transaction screens.
 *
 * These are the parts that must agree with `docs/06-API-SPEC.md`, `REQ-INCOME-001` to
 * `REQ-INCOME-006`, and `REQ-FIN-015` to `REQ-FIN-020` before a request is made, so they are
 * tested without a component. Everything that needs the API is covered by the UI tests and by
 * the API's own contract suite.
 */

function form(overrides: Partial<IncomeFormValues> = {}): IncomeFormValues {
  return {
    ...EMPTY_INCOME_FORM,
    amount: '500',
    businessDate: '2026-09-28',
    ...overrides,
  };
}

describe('validateIncomeFields', () => {
  it('accepts a complete valid form', () => {
    expect(
      validateIncomeFields(form({ memberId: '11111111-1111-4111-8111-111111111111' })),
    ).toEqual({});
  });

  it('requires a member for a member contribution', () => {
    // `REQ-INCOME-003`. A contribution with no member cannot be counted against anyone's
    // monthly target, so the form refuses it before the round trip.
    expect(validateIncomeFields(form()).memberId).toBeDefined();
    expect(validateIncomeFields(form({ memberId: '   ' })).memberId).toBeDefined();
  });

  it('lets an offering or a donation name no member', () => {
    for (const incomeType of ['OFFERING', 'DONATION'] as const) {
      expect(validateIncomeFields(form({ incomeType })).memberId).toBeUndefined();
    }
  });

  it('rejects a zero amount and says which rule failed', () => {
    // `REQ-FIN-021` requires an amount greater than zero. A separate message for zero is what
    // stops "greater than zero" from being reported as a formatting problem.
    for (const zero of ['0', '0.0', '0.00']) {
      expect(validateIncomeFields(form({ amount: zero })).amount).toBe(
        'The amount must be greater than zero.',
      );
    }
  });

  it('rejects an amount that is not an exact rupee value', () => {
    for (const amount of ['abc', '-500', '1,000', '5.005', '₹500', '1e3']) {
      expect(validateIncomeFields(form({ amount })).amount).toBeDefined();
    }
  });

  it('accepts one and two decimal places, because paise are exact', () => {
    for (const amount of ['500', '500.5', '500.05', '0.01', '  750.75  ']) {
      expect(validateIncomeFields(form({ amount })).amount).toBeUndefined();
    }
  });

  it('requires a business date in YYYY-MM-DD', () => {
    expect(validateIncomeFields(form({ businessDate: '' })).businessDate).toBeDefined();
    expect(validateIncomeFields(form({ businessDate: '28-09-2026' })).businessDate).toBeDefined();
    expect(validateIncomeFields(form({ businessDate: '2026-09-28' })).businessDate).toBeUndefined();
  });

  it('does not offer the member control for an anonymous donation', () => {
    // `REQ-INCOME-005`. The control is absent rather than disabled, so there is nothing to
    // type a donor into and nothing to submit.
    expect(showsMemberPicker('MEMBER_CONTRIBUTION')).toBe(true);
    expect(showsMemberPicker('OFFERING')).toBe(true);
    expect(showsMemberPicker('DONATION')).toBe(true);
    expect(showsMemberPicker('ANONYMOUS_DONATION')).toBe(false);
  });

  it('does not complain about a stale member or long text left over from another type', () => {
    // Switching a filled form to "Anonymous Donation" leaves values behind in the model. The
    // validation must not then report a member error or a length error for text that will
    // never be sent, or the Admin is told to fix a field the form no longer shows.
    const switched = form({
      incomeType: 'ANONYMOUS_DONATION',
      memberId: '11111111-1111-4111-8111-111111111111',
      description: 'x'.repeat(TRANSACTION_DESCRIPTION_MAX_LENGTH + 10),
      notes: 'y'.repeat(TRANSACTION_NOTES_MAX_LENGTH + 10),
    });

    expect(validateIncomeFields(switched)).toEqual({});
  });

  it('bounds the description and the notes to the shared contract limits', () => {
    expect(
      validateIncomeFields(
        form({ description: 'x'.repeat(TRANSACTION_DESCRIPTION_MAX_LENGTH + 1) }),
      ).description,
    ).toContain(String(TRANSACTION_DESCRIPTION_MAX_LENGTH));
    expect(
      validateIncomeFields(form({ notes: 'y'.repeat(TRANSACTION_NOTES_MAX_LENGTH + 1) })).notes,
    ).toContain(String(TRANSACTION_NOTES_MAX_LENGTH));
  });

  it('offers exactly the four documented income types', () => {
    // `REQ-INCOME-001` is closed, so the browser cannot invent a fifth type the API rejects.
    expect([...INCOME_TYPES]).toEqual([
      'MEMBER_CONTRIBUTION',
      'OFFERING',
      'DONATION',
      'ANONYMOUS_DONATION',
    ]);
  });

  it('reports an unknown income type rather than defaulting to a valid one', () => {
    const invalid = { ...form(), incomeType: 'UNRECOGNISED' } as unknown as IncomeFormValues;

    expect(validateIncomeFields(invalid).incomeType).toBeDefined();
  });
});

describe('incomeRequestBody', () => {
  it('sends exactly the stored fields for a complete contribution', () => {
    // The `contributionPeriod` is not optional for a member contribution. `docs/06-API-SPEC.md`
    // includes it in the create body and the API refuses the write without it, so a body that
    // omits it cannot be recorded at all (`ISSUE-027`).
    expect(
      incomeRequestBody(
        form({
          memberId: '11111111-1111-4111-8111-111111111111',
          description: 'Sunday offering',
          notes: 'Collected at the door',
        }),
      ),
    ).toEqual({
      incomeType: 'MEMBER_CONTRIBUTION',
      amount: '500',
      paymentMethod: 'CASH',
      businessDate: '2026-09-28',
      memberId: '11111111-1111-4111-8111-111111111111',
      contributionPeriod: { year: 2026, month: 9 },
      description: 'Sunday offering',
      notes: 'Collected at the door',
    });
  });

  it('derives the contribution month from the business date', () => {
    // The month is taken from the day the Admin entered rather than asked for separately, so the
    // payment cannot be filed under a month its own business date does not fall in. Each case
    // here is a month boundary, which is exactly where a `Date` conversion would go wrong.
    expect(
      incomeRequestBody(
        form({ memberId: '11111111-1111-4111-8111-111111111111', businessDate: '2026-01-01' }),
      ).contributionPeriod,
    ).toEqual({ year: 2026, month: 1 });
    expect(
      incomeRequestBody(
        form({ memberId: '11111111-1111-4111-8111-111111111111', businessDate: '2026-12-31' }),
      ).contributionPeriod,
    ).toEqual({ year: 2026, month: 12 });
    expect(
      incomeRequestBody(
        form({ memberId: '11111111-1111-4111-8111-111111111111', businessDate: '2027-03-01' }),
      ).contributionPeriod,
    ).toEqual({ year: 2027, month: 3 });
  });

  it('sends no period for a date the validation has already rejected', () => {
    // A malformed or absent date must not be turned into a guessed month. The field error is
    // raised by `validateIncomeFields`, and the API remains the authority on the date itself.
    const body = incomeRequestBody(
      form({ memberId: '11111111-1111-4111-8111-111111111111', businessDate: '28-09-2026' }),
    );

    expect(body.businessDate).toBe('28-09-2026');
    expect(body).not.toHaveProperty('contributionPeriod');
  });

  it('sends a period only for a member contribution', () => {
    // Offering and Donation are rejected by the API if they carry a period, because only a
    // member contribution is measured against a monthly expectation.
    for (const incomeType of ['OFFERING', 'DONATION'] as const) {
      expect(incomeRequestBody(form({ incomeType })).contributionPeriod).toBeUndefined();
      expect(Object.hasOwn(incomeRequestBody(form({ incomeType })), 'contributionPeriod')).toBe(
        false,
      );
    }
  });

  it('omits a blank optional field so the API stores none', () => {
    expect(incomeRequestBody(form({ incomeType: 'OFFERING' }))).toEqual({
      incomeType: 'OFFERING',
      amount: '500',
      paymentMethod: 'CASH',
      businessDate: '2026-09-28',
    });
  });

  it('trims whitespace so a padded value is not stored with the padding', () => {
    const body = incomeRequestBody(
      form({ incomeType: 'OFFERING', amount: '  500  ', businessDate: ' 2026-09-28 ' }),
    );

    expect(body.amount).toBe('500');
    expect(body.businessDate).toBe('2026-09-28');
  });

  describe('an anonymous donation', () => {
    const anonymous = form({
      incomeType: 'ANONYMOUS_DONATION',
      memberId: '11111111-1111-4111-8111-111111111111',
      description: 'From a visitor who asked not to be named',
      notes: 'Asked for anonymity at the door',
    });

    it('never sends a member, a description, or notes', () => {
      // `REQ-INCOME-005` and `REQ-INCOME-006`. A value that is never sent cannot be stored,
      // displayed, searched, exported, or written to a receipt, so the rule does not depend on
      // the server remembering to strip it. The server still clears them; this is the first of
      // two defences, not the only one.
      const body = incomeRequestBody(anonymous);

      expect(Object.keys(body).sort()).toEqual([
        'amount',
        'businessDate',
        'incomeType',
        'paymentMethod',
      ]);
      expect(body).not.toHaveProperty('memberId');
      expect(body).not.toHaveProperty('description');
      expect(body).not.toHaveProperty('notes');
    });

    it('does not send Admin free text as a substitute for the server-owned description', () => {
      // The server assigns `ANONYMOUS_DONATION_DESCRIPTION`, so the browser must not offer a
      // way to override it with something identifying.
      expect(JSON.stringify(incomeRequestBody(anonymous))).not.toContain('visitor');
      expect(JSON.stringify(incomeRequestBody(anonymous))).not.toContain('anonymity');
    });
  });

  it('never sends a reference, because the API allocates it', () => {
    // Offering a reference field would make the Admin believe they can choose it.
    expect(Object.keys(incomeRequestBody(form({ incomeType: 'OFFERING' }))).sort()).not.toContain(
      'referenceId',
    );
  });
});

describe('the transaction list request', () => {
  it('always states paging and sorting so the request carries the full intent', () => {
    expect(
      transactionListPath(TRANSACTION_LIST_DEFAULTS, '/transactions', { type: 'INCOME' }),
    ).toBe('/transactions?page=1&pageSize=20&sort=businessDate&direction=desc&type=INCOME');
  });

  it('adds the income-type narrowing this screen owns', () => {
    const path = transactionListPath(TRANSACTION_LIST_DEFAULTS, '/transactions', {
      type: 'INCOME',
      incomeType: 'MEMBER_CONTRIBUTION',
    });

    expect(path).toContain('type=INCOME');
    expect(path).toContain('incomeType=MEMBER_CONTRIBUTION');
  });

  it('omits an empty narrowing key instead of sending a filter that matches nothing', () => {
    const path = transactionListPath(TRANSACTION_LIST_DEFAULTS, '/transactions', {
      type: 'INCOME',
      incomeType: '',
    });

    expect(path).not.toContain('incomeType=');
  });

  it('sends every non-empty criterion and omits every empty one', () => {
    const path = transactionListPath(
      {
        ...TRANSACTION_LIST_DEFAULTS,
        search: '  HY-INC-000001  ',
        status: 'ACTIVE',
        paymentMethod: 'CASH',
        from: '2026-01-01',
        to: '2026-12-31',
        minAmount: '100',
        maxAmount: '',
      },
      '/transactions',
      { type: 'INCOME' },
    );
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));

    expect(query.get('search')).toBe('HY-INC-000001');
    expect(query.get('status')).toBe('ACTIVE');
    expect(query.get('paymentMethod')).toBe('CASH');
    expect(query.get('from')).toBe('2026-01-01');
    expect(query.get('to')).toBe('2026-12-31');
    expect(query.get('minAmount')).toBe('100');
    expect(query.has('maxAmount')).toBe(false);
    expect(query.getAll('search')).toHaveLength(1);
  });

  it('clamps a requested page size into the range the API accepts', () => {
    expect(clampTransactionPageSize(10)).toBe(10);
    expect(clampTransactionPageSize(100)).toBe(100);
    expect(clampTransactionPageSize(0)).toBe(TRANSACTION_LIST_DEFAULTS.pageSize);
    expect(clampTransactionPageSize(5000)).toBe(100);
    expect(clampTransactionPageSize(Number.NaN)).toBe(TRANSACTION_LIST_DEFAULTS.pageSize);
  });

  it('guards the sort and status vocabulary before sending it', () => {
    expect(isTransactionSortFieldValue('businessDate')).toBe(true);
    expect(isTransactionSortFieldValue('memberName')).toBe(false);
    expect(isTransactionStatusValue('ACTIVE')).toBe(true);
    expect(isTransactionStatusValue('VOIDED')).toBe(true);
    expect(isTransactionStatusValue('DELETED')).toBe(false);
  });
});

describe('idempotency keys', () => {
  it('creates a distinct key each time a new intent begins', () => {
    const keys = new Set([createIdempotencyKey(), createIdempotencyKey(), createIdempotencyKey()]);

    expect(keys.size).toBe(3);
  });

  it('produces a value the API accepts as a header', () => {
    // `docs/06-API-SPEC.md` bounds the header at 255 characters and requires a non-empty value,
    // so a key that is empty, whitespace, or absurdly long would be rejected.
    const key = createIdempotencyKey();

    expect(key.trim()).not.toBe('');
    expect(key.length).toBeLessThanOrEqual(255);
  });
});

describe('contributionMonthOf', () => {
  it('reads the year and month out of a YYYY-MM-DD business date', () => {
    expect(contributionMonthOf('2026-09-28')).toEqual({ year: 2026, month: 9 });
  });

  it('trims a padded date rather than reading it as malformed', () => {
    expect(contributionMonthOf('  2026-09-28  ')).toEqual({ year: 2026, month: 9 });
  });

  it('refuses anything that is not a two-part year and month', () => {
    // Refusing is the honest answer: a wrong month would count a payment against a member-month
    // the payment was never in, and a wrong year against the wrong period entirely.
    for (const value of ['', '   ', '2026', '2026-9-28', '28-09-2026', '2026/09/28', 'today']) {
      expect(contributionMonthOf(value)).toBeUndefined();
    }
  });

  it('refuses a month outside 1 to 12 rather than passing it to the API', () => {
    expect(contributionMonthOf('2026-00-28')).toBeUndefined();
    expect(contributionMonthOf('2026-13-28')).toBeUndefined();
  });
});

describe('validateCorrectionFields', () => {
  it('accepts the stored values it is given', () => {
    expect(
      hasCorrectionErrors(
        validateCorrectionFields({
          amount: '500.00',
          paymentMethod: 'CASH',
          businessDate: '2026-03-08',
          description: '',
          notes: '',
        }),
      ),
    ).toBe(false);
  });

  it('rejects a zero correction amount rather than storing one', () => {
    expect(
      validateCorrectionFields({
        amount: '0.00',
        paymentMethod: 'CASH',
        businessDate: '2026-03-08',
        description: '',
        notes: '',
      }).amount,
    ).toBe('The amount must be greater than zero.');
  });

  it('reports a malformed amount and a malformed date', () => {
    const errors = validateCorrectionFields({
      amount: 'five hundred',
      paymentMethod: 'CASH',
      businessDate: '08-03-2026',
      description: '',
      notes: '',
    });

    expect(errors.amount).toBeDefined();
    expect(errors.businessDate).toBeDefined();
    expect(hasCorrectionErrors(errors)).toBe(true);
  });
});

describe('validateVoidReason', () => {
  it('requires a reason, because a void must be explainable', () => {
    // `REQ-FIN-017`. Without this the Admin could void a contribution and leave no record of
    // why, which is the difference between an auditable correction and a silent change.
    expect(validateVoidReason('')).toBeDefined();
    expect(validateVoidReason('   ')).toBeDefined();
    expect(validateVoidReason('Recorded against the wrong member')).toBeUndefined();
  });
});

describe('describeTransactionFailure', () => {
  it('treats a 409 as a conflict rather than a message to display', () => {
    const failure = describeTransactionFailure(
      new ApiClientError(409, 'CONFLICT', 'Stale revision.', 'req-1'),
    );

    expect(failure.conflict).toBe(true);
    expect(failure.errorMessage).toBeUndefined();
  });

  it('surfaces a validation message and its field issues', () => {
    const failure = describeTransactionFailure(
      new ApiClientError(400, 'VALIDATION_FAILED', 'Invalid.', 'req-2', [
        { field: 'amount', message: 'The amount must be greater than zero.' },
      ]),
    );

    expect(failure.conflict).toBe(false);
    expect(failure.errorMessage).toBe('Invalid.');
    expect(failure.fieldIssues).toEqual({
      amount: 'The amount must be greater than zero.',
    });
  });

  it('shows a transport failure as the client described it', () => {
    // The real client raises this error with a message written for the Admin, so passing that
    // message through is honest; the real client is what guarantees the wording.
    expect(
      describeTransactionFailure(new ApiTransportError('The API could not be reached.'))
        .errorMessage,
    ).toBe('The API could not be reached.');
    expect(
      describeTransactionFailure(new ApiTransportError('The request was cancelled.')).errorMessage,
    ).toBe('The request was cancelled.');
  });

  it('gives a generic message for anything unrecognised, exposing no internals', () => {
    const failure = describeTransactionFailure(new Error('postgres://user:password@db/hyssop'));

    expect(failure.errorMessage).toBe('Something went wrong. Please try again.');
    expect(failure.errorMessage).not.toContain('password');
  });
});

describe('fieldIssuesByName', () => {
  it('keeps the first message for a repeated field', () => {
    const error = new ApiClientError(400, 'VALIDATION_FAILED', 'Invalid.', 'req-3', [
      { field: 'amount', message: 'First problem.' },
      { field: 'amount', message: 'Second problem.' },
    ]);

    expect(fieldIssuesByName(error)).toEqual({ amount: 'First problem.' });
  });

  it('returns nothing when the error carried no field issues', () => {
    expect(
      fieldIssuesByName(new ApiClientError(400, 'VALIDATION_FAILED', 'Invalid.', 'req-4')),
    ).toEqual({});
    expect(fieldIssuesByName(new Error('other'))).toEqual({});
  });
});

describe('the caches a transaction write must invalidate', () => {
  function seededClient(): QueryClient {
    const queryClient = new QueryClient();

    queryClient.setQueryData([...MEMBER_DETAIL_QUERY_KEY, 'member-1'], { name: 'A member' });
    queryClient.setQueryData([...MEMBER_LIST_QUERY_KEY, { search: '' }], []);
    queryClient.setQueryData([...CONTRIBUTION_SUMMARY_QUERY_KEY, 2026, 9], { collectedPaise: '0' });
    queryClient.setQueryData([...TRANSACTION_LIST_QUERY_KEY, '/transactions', {}, {}], []);

    return queryClient;
  }

  function invalidated(queryClient: QueryClient, queryKey: readonly unknown[]): boolean {
    return queryClient.getQueryState(queryKey)?.isInvalidated === true;
  }

  it('marks the member detail stale, so a new contribution cannot read as unpaid', () => {
    // `REQ-CONTRIB-002` and `REQ-CONTRIB-003` derive the received amount and the PAID / PARTIALLY
    // PAID / NOT PAID status on the server from the active member-contribution rows. Recording
    // one therefore changes the member screen, and leaving its cache alone made a month the Admin
    // had just paid in full display as "Not paid" until a full page reload — the browser
    // contradicting the ledger it had just written.
    const queryClient = seededClient();

    expect(invalidated(queryClient, [...MEMBER_DETAIL_QUERY_KEY, 'member-1'])).toBe(false);

    invalidateTransactionDependents(queryClient);

    expect(invalidated(queryClient, [...MEMBER_DETAIL_QUERY_KEY, 'member-1'])).toBe(true);
  });

  it('also marks the ledger and the month summary stale', () => {
    const queryClient = seededClient();

    invalidateTransactionDependents(queryClient);

    expect(invalidated(queryClient, [...TRANSACTION_LIST_QUERY_KEY, '/transactions', {}, {}])).toBe(
      true,
    );
    expect(invalidated(queryClient, [...CONTRIBUTION_SUMMARY_QUERY_KEY, 2026, 9])).toBe(true);
  });

  it('leaves the member list alone, because a transaction cannot change its columns', () => {
    // The list shows the member ID, name, phone, and date added, and a contribution changes none
    // of them. Invalidating it anyway would be a request the product cannot justify.
    const queryClient = seededClient();

    invalidateTransactionDependents(queryClient);

    expect(invalidated(queryClient, [...MEMBER_LIST_QUERY_KEY, { search: '' }])).toBe(false);
  });
});

describe('the values a member payment starts from', () => {
  const member: MemberPaymentRef = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Anitha Kumar',
    referenceId: 'HY-MEM-0001',
    phone: '9000000001',
  };

  it('fixes the income type to a member contribution', () => {
    // `REQ-INCOME-003`. A payment for a member is that income type by definition, so the payment
    // form does not offer Offering, Donation, or Anonymous Donation — a control that let the Admin
    // record something other than the payment they came to record.
    expect(MEMBER_PAYMENT_INCOME_TYPE).toBe('MEMBER_CONTRIBUTION');
    expect(memberPaymentFormValues(member, '2026-09-28').incomeType).toBe(
      MEMBER_PAYMENT_INCOME_TYPE,
    );
  });

  it('seeds the member from the record the server returned', () => {
    // The identifier sent has to be the real UUID. Anything typed, remembered, or invented here
    // would either fail at the API with a 404 or, worse, be recorded against someone else.
    const values = memberPaymentFormValues(member, '2026-09-28');

    expect(values.memberId).toBe(member.id);
    expect(values.businessDate).toBe('2026-09-28');
  });

  it('starts with an empty amount and no free text, so nothing is pre-filled but the date', () => {
    const values = memberPaymentFormValues(member, '2026-09-28');

    expect(values.amount).toBe('');
    expect(values.description).toBe('');
    expect(values.notes).toBe('');
    // The pre-filled date is the form's own default, and the Admin can change it.
    expect(values.paymentMethod).toBe('CASH');
  });

  it('produces a form the shared validator already accepts', () => {
    // The one field still missing is the amount, so nothing else is complained about and the
    // Admin is not told to fix a field that is already correct.
    expect(validateIncomeFields(memberPaymentFormValues(member, '2026-09-28'))).toEqual({
      amount: 'Enter an amount.',
    });
  });
});

describe('creditedMonthLabel', () => {
  it('names the month in full, because it is read inside a sentence', () => {
    // `formatMonthYear` abbreviates for table cells where width matters. This is prose, and the
    // Admin is confirming where a payment is being filed.
    expect(creditedMonthLabel('2026-09-28')).toBe('September 2026');
    expect(creditedMonthLabel('2026-01-01')).toBe('January 2026');
    expect(creditedMonthLabel('2026-12-31')).toBe('December 2026');
  });

  it('agrees with the period the request will carry', () => {
    // Both come from `contributionMonthOf`, so the sentence the Admin reads cannot promise a
    // different month from the one the API records. Every case is a boundary, which is where a
    // second derivation would drift.
    const cases = [
      { businessDate: '2026-01-01', period: { year: 2026, month: 1 }, label: 'January 2026' },
      { businessDate: '2026-06-30', period: { year: 2026, month: 6 }, label: 'June 2026' },
      { businessDate: '2026-09-28', period: { year: 2026, month: 9 }, label: 'September 2026' },
      { businessDate: '2027-03-01', period: { year: 2027, month: 3 }, label: 'March 2027' },
    ];

    for (const { businessDate, period, label } of cases) {
      expect(contributionMonthOf(businessDate)).toEqual(period);
      expect(creditedMonthLabel(businessDate)).toBe(label);
    }
  });

  it('says nothing rather than guessing when the date is unusable', () => {
    // A credited month shown for a date the API will reject is exactly the misleading state the
    // UI rules forbid, so the honest answer is no month at all.
    for (const value of ['', '   ', '2026-13-01', '28-09-2026', 'today']) {
      expect(creditedMonthLabel(value)).toBeUndefined();
    }
  });
});

describe('businessDateToday', () => {
  it('returns an Asia/Kolkata calendar date the API will accept', () => {
    const today = businessDateToday();

    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      validateIncomeFields(form({ memberId: 'a', businessDate: today })).businessDate,
    ).toBeUndefined();
  });

  it('reports the India date, not the machine time zone date', () => {
    // A machine set to UTC would call this instant the 30th; the church's business date is the
    // 1st, because IST is +05:30 and the service it records belongs to has already started there.
    // Without this, a contribution recorded after 18:30 UTC would be filed under the wrong day —
    // and therefore the wrong contribution month at a month boundary.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T20:00:00.000Z'));

    try {
      expect(businessDateToday()).toBe('2026-10-01');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not roll the date backwards, because the offset never becomes negative', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      expect(businessDateToday()).toBe('2026-01-01');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('incomeFieldErrorsFrom', () => {
  it('puts a server message on the input it belongs to', () => {
    // The API refuses a contribution for a member that no longer exists, naming the member field.
    const errors = incomeFieldErrorsFrom(
      new ApiClientError(400, 'VALIDATION_FAILED', 'Invalid.', 'req-5', [
        { field: 'memberId', message: 'That member no longer exists.' },
        { field: 'amount', message: 'The amount must be greater than zero.' },
      ]),
    );

    expect(errors.memberId).toBe('That member no longer exists.');
    expect(errors.amount).toBe('The amount must be greater than zero.');
  });

  it('ignores a field this form does not own rather than attaching it to the wrong input', () => {
    // A message about some other screen's field must not appear next to this form's amount box.
    const errors = incomeFieldErrorsFrom(
      new ApiClientError(400, 'VALIDATION_FAILED', 'Invalid.', 'req-6', [
        { field: 'expectedPaise', message: 'The expected amount must be greater than zero.' },
      ]),
    );

    expect(errors).toEqual({});
  });

  it('returns nothing for an error that carried no field issues', () => {
    expect(incomeFieldErrorsFrom(new Error('other'))).toEqual({});
    expect(
      incomeFieldErrorsFrom(new ApiClientError(500, 'INTERNAL_ERROR', 'Failed.', 'req-7')),
    ).toEqual({});
  });
});

describe('the shared constants the income form depends on', () => {
  it('uses the server-owned anonymous description rather than a local phrase', () => {
    // If the browser and the API ever disagreed about this string, a stored anonymous donation
    // would be searchable by a description the browser never displayed.
    expect(ANONYMOUS_DONATION_DESCRIPTION).toBe('Anonymous Donation');
  });

  it('starts from an empty form whose only problem is the missing amount and date', () => {
    expect(EMPTY_INCOME_FORM).toEqual({
      incomeType: 'MEMBER_CONTRIBUTION',
      amount: '',
      paymentMethod: 'CASH',
      businessDate: '',
      memberId: '',
      description: '',
      notes: '',
    });

    const errors = validateIncomeFields(EMPTY_INCOME_FORM);

    expect(errors.amount).toBe('Enter an amount.');
    expect(errors.businessDate).toBeDefined();
    expect(hasIncomeFieldErrors(errors)).toBe(true);
  });
});
