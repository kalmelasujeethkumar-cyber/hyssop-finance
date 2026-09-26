/**
 * Human-readable reference formats.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` (`HY-MEM-` plus four digits, `HY-INC-`,
 * `HY-EXP-`, and `HY-DOC-` plus six digits) and the `id_sequence_scope_known` CHECK
 * constraint that limits the allocator to exactly these four scopes.
 */

export const REFERENCE_SCOPES = ['MEMBER', 'INCOME', 'EXPENSE', 'DOCUMENT'] as const;

export type ReferenceScope = (typeof REFERENCE_SCOPES)[number];

export interface ReferenceFormat {
  readonly prefix: string;
  readonly width: number;
}

export const REFERENCE_FORMATS: Readonly<Record<ReferenceScope, ReferenceFormat>> = {
  MEMBER: { prefix: 'HY-MEM-', width: 4 },
  INCOME: { prefix: 'HY-INC-', width: 6 },
  EXPENSE: { prefix: 'HY-EXP-', width: 6 },
  DOCUMENT: { prefix: 'HY-DOC-', width: 6 },
};

export const MAX_REFERENCE_VALUE = 10_000_000_000_000n;

export function isReferenceScope(value: string): value is ReferenceScope {
  return (REFERENCE_SCOPES as readonly string[]).includes(value);
}

export function referenceScopeForTransactionType(
  transactionType: 'INCOME' | 'EXPENSE',
): ReferenceScope {
  return transactionType === 'INCOME' ? 'INCOME' : 'EXPENSE';
}

/**
 * Formats an allocated sequence value. Values wider than the documented width are
 * rejected instead of silently widening the reference, because the column is
 * `VARCHAR(32)` and an unexpected value usually means the allocator was bypassed.
 */
export function formatReference(scope: ReferenceScope, value: bigint): string {
  if (value <= 0n) {
    throw new RangeError('A reference value must be greater than zero.');
  }

  if (value > MAX_REFERENCE_VALUE) {
    throw new RangeError('A reference value is too large to format.');
  }

  const { prefix, width } = REFERENCE_FORMATS[scope];
  const digits = value.toString();

  if (digits.length > width) {
    throw new RangeError(`A ${scope} reference cannot be formatted from this sequence value.`);
  }

  return `${prefix}${digits.padStart(width, '0')}`;
}
