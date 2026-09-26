/**
 * Self-contained reference formatting for the demo seed.
 *
 * Mirrors `apps/api/src/database/references/reference-formats.ts` because the seed runs
 * without a TypeScript build of the API. `docs/05-DATABASE-SPEC.md` owns the formats:
 * `HY-MEM-` plus four digits, and `HY-INC-`, `HY-EXP-`, `HY-DOC-` plus six digits.
 */

export const REFERENCE_SCOPES = ['MEMBER', 'INCOME', 'EXPENSE', 'DOCUMENT'] as const;

export type ReferenceScope = (typeof REFERENCE_SCOPES)[number];

const FORMATS: Readonly<
  Record<ReferenceScope, { readonly prefix: string; readonly width: number }>
> = {
  MEMBER: { prefix: 'HY-MEM-', width: 4 },
  INCOME: { prefix: 'HY-INC-', width: 6 },
  EXPENSE: { prefix: 'HY-EXP-', width: 6 },
  DOCUMENT: { prefix: 'HY-DOC-', width: 6 },
};

export function formatReference(scope: ReferenceScope, value: bigint): string {
  if (value <= 0n) {
    throw new Error('A reference value must be greater than zero.');
  }

  const { prefix, width } = FORMATS[scope];
  const digits = value.toString();

  if (digits.length > width) {
    throw new Error(`A ${scope} reference cannot be formatted from this sequence value.`);
  }

  return `${prefix}${digits.padStart(width, '0')}`;
}
