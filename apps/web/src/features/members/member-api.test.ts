import { describe, expect, it } from 'vitest';
import { phoneFormatMessage } from '@hyssop/contracts';
import { ApiClientError } from '../../lib/api-client';
import {
  EMPTY_MEMBER_FORM,
  MAX_PERIOD_YEAR,
  MEMBER_LIST_DEFAULTS,
  MIN_PERIOD_YEAR,
  clampPageSize,
  clampSearch,
  describeMemberFailure,
  fieldIssuesOf,
  hasFieldErrors,
  memberListPath,
  memberRequestBody,
  parseExpectedAmount,
  parsePeriodYear,
  validateMemberFields,
} from './member-api';

/**
 * The pure rules of the member screens.
 *
 * These are the parts that must agree with `docs/06-API-SPEC.md` and `REQ-MEM-005` before a
 * request is made, so they are tested without a component. Anything that needs the API is
 * covered by the UI tests and the API's own suite.
 */
describe('memberListPath', () => {
  it('always states paging and sorting so the request carries the full intent', () => {
    expect(memberListPath(MEMBER_LIST_DEFAULTS)).toBe(
      '/members?page=1&pageSize=20&sort=name&direction=asc',
    );
  });

  it('includes a trimmed search term', () => {
    expect(memberListPath({ ...MEMBER_LIST_DEFAULTS, search: '  anita  ' })).toBe(
      '/members?page=1&pageSize=20&sort=name&direction=asc&search=anita',
    );
  });

  it('omits a blank or whitespace-only search instead of sending an empty filter', () => {
    expect(memberListPath({ ...MEMBER_LIST_DEFAULTS, search: '   ' })).not.toContain('search=');
  });

  it('encodes a search term that contains URL-significant characters', () => {
    const path = memberListPath({ ...MEMBER_LIST_DEFAULTS, search: 'a&b=c d' });

    // The value must survive as one `search` parameter, not split into extra parameters that
    // the server would reject or ignore.
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));

    expect(query.get('search')).toBe('a&b=c d');
    expect(query.getAll('search')).toHaveLength(1);
  });

  it('carries the requested page, size, sort field, and direction', () => {
    expect(
      memberListPath({ search: '', page: 3, pageSize: 50, sort: 'createdAt', direction: 'desc' }),
    ).toBe('/members?page=3&pageSize=50&sort=createdAt&direction=desc');
  });
});

describe('clampPageSize and clampSearch', () => {
  it('keeps a page size inside the range the API accepts', () => {
    expect(clampPageSize(10)).toBe(10);
    expect(clampPageSize(100)).toBe(100);
    expect(clampPageSize(0)).toBe(MEMBER_LIST_DEFAULTS.pageSize);
    expect(clampPageSize(-5)).toBe(MEMBER_LIST_DEFAULTS.pageSize);
    expect(clampPageSize(5000)).toBe(100);
    expect(clampPageSize(Number.NaN)).toBe(MEMBER_LIST_DEFAULTS.pageSize);
    expect(clampPageSize(12.5)).toBe(MEMBER_LIST_DEFAULTS.pageSize);
  });

  it('bounds a search term to the documented maximum length', () => {
    expect(clampSearch('abc')).toBe('abc');
    expect(clampSearch('x'.repeat(250))).toHaveLength(100);
  });
});

describe('validateMemberFields', () => {
  it('accepts a complete valid form', () => {
    expect(
      validateMemberFields({ name: 'Anitha Kumar', phone: '98765 43210', notes: 'None' }),
    ).toEqual({});
  });

  it('treats the phone and notes as optional', () => {
    expect(
      hasFieldErrors(validateMemberFields({ name: 'Anitha Kumar', phone: '', notes: '' })),
    ).toBe(false);
  });

  it('requires a name that is not only whitespace', () => {
    expect(validateMemberFields({ name: '   ', phone: '', notes: '' }).name).toBeDefined();
  });

  it('rejects a name longer than the documented maximum', () => {
    expect(validateMemberFields({ name: 'x'.repeat(121), phone: '', notes: '' }).name).toContain(
      '120',
    );
  });

  it('rejects notes longer than the documented maximum', () => {
    expect(
      validateMemberFields({ name: 'Anitha', phone: '', notes: 'x'.repeat(2001) }).notes,
    ).toContain('2000');
  });

  describe('phone, using the shared rule rather than a second copy', () => {
    it('accepts what the shared rule accepts', () => {
      // The browser must not disagree with the API about a phone number. If this ever
      // diverges from `phoneFormatMessage`, the UI would reject a number the API would have
      // stored, or the reverse.
      const accepted = [
        '9876543210',
        '98765 43210',
        '98765-43210',
        '(98765) 43210',
        '+91 98765 43210',
      ];

      for (const phone of accepted) {
        expect(validateMemberFields({ name: 'Anitha', phone, notes: '' }).phone).toBeUndefined();
      }
    });

    it('rejects exactly what the shared rule rejects', () => {
      const rejected = ['123456', '1234567890123456', '98765.43210', '98765abc10', '+91'];

      for (const phone of rejected) {
        expect(phoneFormatMessage(phone)).toBeDefined();
        expect(validateMemberFields({ name: 'Anitha', phone, notes: '' }).phone).toBeDefined();
      }
    });

    it('treats a blank phone as absent, not as an error', () => {
      expect(
        validateMemberFields({ name: 'Anitha', phone: '   ', notes: '' }).phone,
      ).toBeUndefined();
    });

    it('does not reimplement the rule with a different digit count', () => {
      // A copy written here could easily say 10 to 12 digits. Asserting the shared rule's
      // own boundaries keeps the requirement (`REQ-MEM-005`: 7 to 15) as the single truth.
      expect(phoneFormatMessage('1234567')).toBeUndefined();
      expect(phoneFormatMessage('123456')).toBeDefined();
      expect(phoneFormatMessage('123456789012345')).toBeUndefined();
      expect(phoneFormatMessage('1234567890123456')).toBeDefined();
    });
  });
});

describe('memberRequestBody', () => {
  it('trims the name and normalizes the phone to national digits', () => {
    expect(
      memberRequestBody({ name: '  Anitha Kumar ', phone: '+91 98765 43210', notes: 'ok' }),
    ).toEqual({ name: 'Anitha Kumar', phone: '9876543210', notes: 'ok' });
  });

  it('omits a blank optional field so the API stores none', () => {
    // Sending `phone: ''` would still be a value the API has to normalize; omitting it is
    // what "no phone number" actually means, and it is also what makes clearing a field work.
    expect(memberRequestBody({ name: 'Anitha', phone: '   ', notes: '  ' })).toEqual({
      name: 'Anitha',
    });
  });

  it('never sends the member ID, because the API allocates it', () => {
    const body = memberRequestBody({ name: 'Anitha', phone: '', notes: '' });

    expect(Object.keys(body).sort()).toEqual(['name']);
  });
});

describe('parseExpectedAmount', () => {
  it('accepts a plain amount and one or two decimal places', () => {
    expect(parseExpectedAmount('500')).toEqual({ kind: 'amount', value: '500' });
    expect(parseExpectedAmount('500.5')).toEqual({ kind: 'amount', value: '500.5' });
    expect(parseExpectedAmount('500.05')).toEqual({ kind: 'amount', value: '500.05' });
    expect(parseExpectedAmount('  500  ')).toEqual({ kind: 'amount', value: '500' });
  });

  it('reports a blank amount as blank, which asks for the configured default', () => {
    // This is the documented behaviour: omitting `expectedPaise` makes the API apply
    // `DEFAULT_MONTHLY_CONTRIBUTION_PAISE` when opening a new period.
    expect(parseExpectedAmount('')).toEqual({ kind: 'blank' });
    expect(parseExpectedAmount('   ')).toEqual({ kind: 'blank' });
  });

  it('explains a rejected amount instead of sending it', () => {
    // The rejected case must never look like an accepted amount. These are the exact
    // assertions that pin the two apart: a valid amount is a `kind: 'amount'` carrying the
    // value, and a rejection is a `kind: 'invalid'` carrying a message, so a form cannot
    // read one as the other.
    for (const rejected of ['5.005', 'abc', '-500', '₹500']) {
      const result = parseExpectedAmount(rejected);

      expect(result.kind).toBe('invalid');
      expect(result).toHaveProperty('message', expect.stringContaining('two decimal places'));
    }
  });

  it('never returns a bare string, so a caller cannot confuse a value with a message', () => {
    // A `string | undefined` return type collapses the accepted-amount and the
    // rejection-message cases into the same runtime type, which let a form treat every
    // valid amount as an error. Asserting the shape keeps that mistake out of reach.
    for (const input of ['500', '', 'abc', '  500  ', '5.005']) {
      expect(typeof parseExpectedAmount(input)).toBe('object');
    }
  });
});

describe('parsePeriodYear', () => {
  it('accepts a four-digit year inside the supported range', () => {
    expect(parsePeriodYear('2026')).toBe(2026);
    expect(parsePeriodYear('2027')).toBe(2027);
    expect(parsePeriodYear(' 1999 ')).toBe(1999);
    expect(parsePeriodYear(String(MIN_PERIOD_YEAR))).toBe(MIN_PERIOD_YEAR);
    expect(parsePeriodYear(String(MAX_PERIOD_YEAR))).toBe(MAX_PERIOD_YEAR);
  });

  it('explains a year it cannot use, including a half-typed one', () => {
    // The year is validated on submit rather than on every keystroke, so the intermediate
    // states a field passes through while being edited have to be reported as problems
    // rather than silently rewritten to the previous value.
    for (const incomplete of ['', ' ', '2', '20', '202', '20266', 'abcd', '20.6']) {
      expect(typeof parsePeriodYear(incomplete)).toBe('string');
    }
  });

  it('rejects a year outside the range the API accepts', () => {
    expect(parsePeriodYear('1969')).toContain('between');
    // A five-digit year never reaches the range check, because it is not a four-digit year
    // in the first place. The upper bound is therefore only reachable if `MAX_PERIOD_YEAR`
    // is ever lowered, and this assertion documents that rather than pretending otherwise.
    expect(parsePeriodYear('10000')).toContain('four-digit year');
  });
});

describe('describeMemberFailure', () => {
  it('treats a 409 as a conflict rather than a message to display', () => {
    const failure = describeMemberFailure(
      new ApiClientError(409, 'CONFLICT', 'Stale revision.', 'req-1'),
    );

    expect(failure.conflict).toBe(true);
    expect(failure.errorMessage).toBeUndefined();
  });

  it('surfaces the API message for a field validation failure', () => {
    const failure = describeMemberFailure(
      new ApiClientError(400, 'VALIDATION_FAILED', 'The name is required.', 'req-2'),
    );

    expect(failure.conflict).toBe(false);
    expect(failure.errorMessage).toBe('The name is required.');
  });

  it('surfaces a not-found message so the screen can say the member is gone', () => {
    const failure = describeMemberFailure(
      new ApiClientError(404, 'NOT_FOUND', 'The requested record was not found.', 'req-3'),
    );

    expect(failure.errorMessage).toBe('The requested record was not found.');
  });

  it('gives a generic message for anything unrecognised, exposing no internals', () => {
    const failure = describeMemberFailure(new Error('connection string postgres://secret'));

    expect(failure.errorMessage).toBe('Something went wrong. Please try again.');
    expect(failure.errorMessage).not.toContain('postgres');
  });
});

describe('fieldIssuesOf', () => {
  it('maps a server field issue onto the matching member field', () => {
    const error = new ApiClientError(400, 'VALIDATION_FAILED', 'Invalid.', 'req-4', [
      { field: 'name', message: 'A member name is required.' },
      { field: 'phone', message: 'The phone number is not valid.' },
    ]);

    expect(fieldIssuesOf(error)).toEqual({
      name: 'A member name is required.',
      phone: 'The phone number is not valid.',
    });
  });

  it('ignores an issue for a field this form does not have', () => {
    // Attaching an unknown field's message to whichever input is first would be a lie about
    // where the problem is, so it is dropped instead.
    const error = new ApiClientError(400, 'VALIDATION_FAILED', 'Invalid.', 'req-5', [
      { field: 'referenceId', message: 'The reference is taken.' },
    ]);

    expect(fieldIssuesOf(error)).toEqual({});
  });

  it('returns nothing when the error carried no field issues', () => {
    expect(
      fieldIssuesOf(new ApiClientError(400, 'VALIDATION_FAILED', 'Invalid.', 'req-6')),
    ).toEqual({});
    expect(fieldIssuesOf(new Error('other'))).toEqual({});
  });
});

describe('the shared phone rule and the empty form', () => {
  it('agrees on the boundary lengths documented in REQ-MEM-005', () => {
    // Guards the shared contract the form depends on: 7 digits is the shortest accepted
    // national number and 15 the longest, and anything outside is rejected.
    expect(phoneFormatMessage('1234567')).toBeUndefined();
    expect(phoneFormatMessage('123456')).toBeDefined();
    expect(phoneFormatMessage('123456789012345')).toBeUndefined();
    expect(phoneFormatMessage('1234567890123456')).toBeDefined();
  });

  it('starts from an empty form whose only problem is the required name', () => {
    expect(EMPTY_MEMBER_FORM).toEqual({ name: '', phone: '', notes: '' });
    expect(validateMemberFields(EMPTY_MEMBER_FORM)).toEqual({
      name: 'A member name is required.',
    });
  });
});
