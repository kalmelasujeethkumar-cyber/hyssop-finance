/**
 * Contribution status derivation.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-CONTRIB-002` (a contribution period is
 * `PAID`, `PARTIALLY PAID`, or `NOT PAID`) and `docs/02-ARCHITECTURE.md` (the
 * canonical calculation layer derives received and remaining amounts from active
 * `MEMBER_CONTRIBUTION` transactions instead of storing a permanent amount).
 */

export const CONTRIBUTION_STATUSES = ['PAID', 'PARTIALLY PAID', 'NOT PAID'] as const;

export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

export function deriveContributionStatus(
  expectedPaise: bigint,
  receivedPaise: bigint,
): ContributionStatus {
  if (receivedPaise >= expectedPaise) {
    return 'PAID';
  }

  return receivedPaise > 0n ? 'PARTIALLY PAID' : 'NOT PAID';
}
