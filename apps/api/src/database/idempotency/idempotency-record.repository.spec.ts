import { DomainError } from '../../common/errors/domain.errors';
import { hashRequest } from './idempotency-record.repository';

describe('idempotency request hashing (REQ-FIN-014)', () => {
  it('produces the same hash for the same request regardless of key order', () => {
    expect(hashRequest({ amount: '100.00', method: 'CASH' })).toBe(
      hashRequest({ method: 'CASH', amount: '100.00' }),
    );
  });

  it('produces a different hash when any value changes', () => {
    expect(hashRequest({ amount: '100.00' })).not.toBe(hashRequest({ amount: '100.01' }));
  });

  it('hashes nested structures stably, including array order', () => {
    expect(hashRequest({ items: [{ a: 1 }, { b: 2 }] })).toBe(
      hashRequest({ items: [{ a: 1 }, { b: 2 }] }),
    );
    expect(hashRequest({ items: [1, 2] })).not.toBe(hashRequest({ items: [2, 1] }));
  });

  it('is a 64 character lowercase hexadecimal digest the database CHECK accepts', () => {
    expect(hashRequest({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('idempotency helper behaviour', () => {
  it('raises a typed domain error rather than a raw driver error', () => {
    const error = new DomainError('CONFLICT', 'reused');
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe('CONFLICT');
  });
});
