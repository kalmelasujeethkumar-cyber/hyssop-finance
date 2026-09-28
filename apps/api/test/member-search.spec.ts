import type { Prisma } from '@prisma/client';
import { memberSearchWhere } from '../src/database/members/member.repository';

/** Reads the `contains` value out of a `Prisma` string filter, whatever the field type. */
function containsOf(field: unknown): string {
  if (typeof field !== 'object' || field === null) {
    throw new TypeError('expected a Prisma string filter object');
  }

  const value = (field as { contains?: unknown }).contains;

  if (typeof value !== 'string') {
    throw new TypeError('expected the filter to carry a string `contains`');
  }

  return value;
}

/**
 * Member search-filter construction.
 *
 * Authority: `docs/06-API-SPEC.md` — "Search free text is bounded to names, IDs,
 * references, categories, and types" and filters "cannot inject arbitrary query
 * structure". These tests pin the shape of the Prisma `where` argument, because a search
 * that reached the database as SQL pattern text would be an injection surface and a search
 * that escaped a literal `%` would silently fail to find it.
 */

describe('memberSearchWhere', () => {
  it('matches everything when the term is empty', () => {
    for (const term of [undefined, '', '   ']) {
      expect(memberSearchWhere(term)).toEqual({});
    }
  });

  it('searches name, reference, and phone as one bounded OR group', () => {
    const where = memberSearchWhere('anitha');

    expect(where).toEqual({
      OR: [
        { name: { contains: 'anitha', mode: 'insensitive' } },
        { referenceId: { contains: 'anitha', mode: 'insensitive' } },
        { phone: { contains: 'anitha' } },
      ],
    });
  });

  it('trims the term so surrounding whitespace does not change the result', () => {
    expect(memberSearchWhere('  anitha  ')).toEqual(memberSearchWhere('anitha'));
  });

  it('preserves the case the Admin typed while still asking for an insensitive match', () => {
    expect(memberSearchWhere('AnIThA')).toEqual({
      OR: [
        { name: { contains: 'AnIThA', mode: 'insensitive' } },
        { referenceId: { contains: 'AnIThA', mode: 'insensitive' } },
        { phone: { contains: 'AnIThA' } },
      ],
    });
  });

  it.each([
    ['a percent sign', '%'],
    ['an underscore', '_'],
    ['a backslash', '\\'],
    ['a SQL boolean tautology', "' OR '1'='1"],
    ['a UNION attempt', '1; DROP TABLE member; --'],
    ['a script tag', '<script>alert(1)</script>'],
    ['a wildcard glob', '*'],
  ])('passes %s through as a bound value, not as query structure', (_label, term) => {
    const where: Prisma.MemberWhereInput = memberSearchWhere(term);
    const branches = where.OR ?? [];

    // The term appears only inside `contains`, which Prisma binds as a parameter.
    for (const branch of branches) {
      const value = containsOf(branch.name ?? branch.referenceId ?? branch.phone);

      expect(value).toBe(term);
    }

    // The only structural keys present are the three documented searchable fields.
    expect(Object.keys(where)).toEqual(['OR']);
    expect(branches).toHaveLength(3);
  });

  it('does not add a backslash to a percent sign, so a literal percent is findable', () => {
    const where = memberSearchWhere('%');
    const name = containsOf(where.OR?.[0]?.name);

    // Prisma's `contains` is a literal substring match, not a SQL LIKE pattern, so
    // escaping here would make a search for "100%" fail to find "100%".
    expect(name).toBe('%');
  });
});
