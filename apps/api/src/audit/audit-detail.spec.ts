import { Prisma } from '@prisma/client';
import { REDACTED_VALUE } from '../common/logging/redaction';
import { flattenSnapshot, isRecordedSnapshot, labelOf } from './audit-detail';

/**
 * Unit coverage for the audit snapshot flattener.
 *
 * Authority: `docs/07-SECURITY-RULES.md` (audit events must not expose secrets or unnecessary
 * personal data) and `docs/01-REQUIREMENTS.md` `REQ-AUDIT-002` (a viewer must be able to see what
 * changed). Over HTTP the projection is exercised end to end in
 * `test/audit-settings-http.e2e-spec.ts`; these cases cover the shapes that are awkward to stage
 * over a route - the Prisma JSON-null sentinel, a pathologically deep snapshot, and an empty
 * structure - because each of those is a way a snapshot could be *mis*read rather than merely
 * unstyled.
 */
describe('audit snapshot flattening', () => {
  describe('isRecordedSnapshot', () => {
    it.each([
      ['a stored object', { value: '50000' }],
      ['a stored empty object', {}],
      ['a stored array', []],
      ['a stored null value inside a snapshot', { value: null }],
      ['a stored zero', { revision: 0 }],
    ])('reports %s as recorded', (_name, value) => {
      expect(isRecordedSnapshot(value)).toBe(true);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      // `Prisma.JsonNull` is the sentinel `audit_event.record` writes for "the writing code had no
      // prior state". Treating it as a recorded value would give every creation an empty "before"
      // panel that claims something was recorded.
      ['Prisma.JsonNull', Prisma.JsonNull],
    ])('reports %s as not recorded', (_name, value) => {
      expect(isRecordedSnapshot(value)).toBe(false);
    });
  });

  describe('flattenSnapshot', () => {
    it('keeps the stored key order rather than sorting it', () => {
      const fields = flattenSnapshot({ second: 'b', first: 'a', third: 'c' });

      expect(fields.map((field) => field.key)).toEqual(['second', 'first', 'third']);
    });

    it('keeps an array index, because an enabled set is ordered', () => {
      const fields = flattenSnapshot({ enabledPaymentMethods: ['CASH', 'UPI'] });

      expect(fields).toEqual([
        {
          key: 'enabledPaymentMethods[0]',
          label: 'Enabled Payment Methods',
          value: 'CASH',
          redacted: false,
        },
        {
          key: 'enabledPaymentMethods[1]',
          label: 'Enabled Payment Methods',
          value: 'UPI',
          redacted: false,
        },
      ]);
    });

    it('states an empty array and an empty object rather than showing nothing', () => {
      // "No methods are enabled" and "this snapshot has no methods key" are different facts, and a
      // silently blank panel would read as the first when it was the second.
      expect(flattenSnapshot({ enabledPaymentMethods: [] })).toEqual([
        {
          key: 'enabledPaymentMethods',
          label: 'Enabled Payment Methods',
          value: '(none)',
          redacted: false,
        },
      ]);
      expect(flattenSnapshot({ contact: {} })).toEqual([
        { key: 'contact', label: 'Contact', value: '(empty)', redacted: false },
      ]);
    });

    it('renders a stored null as a visible null rather than an empty cell', () => {
      expect(flattenSnapshot({ voidReason: null })).toEqual([
        { key: 'voidReason', label: 'Void Reason', value: '—', redacted: false },
      ]);
    });

    it('renders booleans and numbers recognisably', () => {
      expect(flattenSnapshot({ isSystem: false, revision: 2 })).toEqual([
        { key: 'isSystem', label: 'Is System', value: 'false', redacted: false },
        { key: 'revision', label: 'Revision', value: '2', redacted: false },
      ]);
    });

    it('redacts a sensitive key at any depth and keeps the field', () => {
      const fields = flattenSnapshot({
        name: 'Anitha Kumaran',
        auth: { password: 'hunter2', sessionToken: 'abc', role: 'ADMIN' },
      });

      expect(fields).toContainEqual({
        key: 'auth.password',
        label: 'Auth Password',
        value: REDACTED_VALUE,
        redacted: true,
      });
      expect(fields).toContainEqual({
        key: 'auth.sessionToken',
        label: 'Auth Session Token',
        value: REDACTED_VALUE,
        redacted: true,
      });
      // A sibling that is not sensitive is still shown; redaction must not blank a whole object.
      expect(fields).toContainEqual({
        key: 'auth.role',
        label: 'Auth Role',
        value: 'ADMIN',
        redacted: false,
      });
      expect(JSON.stringify(fields)).not.toContain('hunter2');
      expect(JSON.stringify(fields)).not.toContain('abc');
    });

    it('stops at the documented depth and says so', () => {
      let nested: Record<string, unknown> = { value: 'bottom' };

      for (let level = 0; level < 9; level += 1) {
        nested = { child: nested };
      }

      const fields = flattenSnapshot(nested);
      const last = fields[fields.length - 1];

      expect(last?.value).toBe('[TRUNCATED]');
    });

    it('bounds one rendered value so a snapshot cannot become an unbounded response', () => {
      const fields = flattenSnapshot({ notes: 'x'.repeat(2_000) });

      expect(fields[0]?.value).toHaveLength(501);
      expect(fields[0]?.value?.endsWith('…')).toBe(true);
    });

    it('returns no fields for an absent snapshot', () => {
      expect(flattenSnapshot(null)).toEqual([]);
      expect(flattenSnapshot(undefined)).toEqual([]);
      expect(flattenSnapshot(Prisma.JsonNull)).toEqual([]);
    });

    it('renders a top-level array or scalar without inventing a parent field', () => {
      expect(flattenSnapshot(['CASH', 'UPI']).map((field) => field.key)).toEqual(['[0]', '[1]']);
      expect(flattenSnapshot('ACTIVE')).toEqual([
        { key: '', label: 'Value', value: 'ACTIVE', redacted: false },
      ]);
    });
  });

  describe('labelOf', () => {
    it.each([
      ['amountPaise', 'Amount Paise'],
      ['expected_paise', 'Expected Paise'],
      ['member.name', 'Member Name'],
      ['contact.phone_number', 'Contact Phone Number'],
      ['auth.sessionToken', 'Auth Session Token'],
      ['enabledPaymentMethods[2]', 'Enabled Payment Methods'],
      ['isSystem', 'Is System'],
      ['id', 'Id'],
      ['revision', 'Revision'],
      ['', 'Value'],
      ['[0]', 'Value'],
    ])('labels %s as %s', (path, expected) => {
      expect(labelOf(path)).toBe(expected);
    });
  });
});
