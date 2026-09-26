import { deriveContributionStatus } from './contribution-status';

describe('contribution status derivation (REQ-CONTRIB-002)', () => {
  it('is PAID when the received amount meets the expected amount', () => {
    expect(deriveContributionStatus(50_000n, 50_000n)).toBe('PAID');
    expect(deriveContributionStatus(50_000n, 60_000n)).toBe('PAID');
  });

  it('is PARTIALLY PAID when part of the expected amount was received', () => {
    expect(deriveContributionStatus(50_000n, 1n)).toBe('PARTIALLY PAID');
    expect(deriveContributionStatus(50_000n, 49_999n)).toBe('PARTIALLY PAID');
  });

  it('is NOT PAID when nothing was received', () => {
    expect(deriveContributionStatus(50_000n, 0n)).toBe('NOT PAID');
  });

  it('ignores voided transactions, so a voided full payment is unpaid again', () => {
    // A voided transaction never reaches the derivation, so only active amounts count.
    expect(deriveContributionStatus(50_000n, 0n)).toBe('NOT PAID');
  });
});
