import { generateToken, hashToken, safeEqualHex, fingerprint } from './token.util';

describe('token utilities', () => {
  it('generates a URL-safe token of at least 256 bits of entropy', () => {
    const token = generateToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes encode to 43 base64url characters.
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('never repeats a generated token', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));

    expect(tokens.size).toBe(200);
  });

  it('hashes a token to a stable lowercase 64-character SHA-256 digest', () => {
    const token = generateToken();
    const hash = hashToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
    expect(hashToken(`${token}x`)).not.toBe(hash);
    expect(hash).not.toContain(token);
  });

  it('compares digests in constant time and rejects anything malformed', () => {
    const hash = hashToken('value');

    expect(safeEqualHex(hash, hashToken('value'))).toBe(true);
    expect(safeEqualHex(hash, hashToken('other'))).toBe(false);
    expect(safeEqualHex(hash, 'short')).toBe(false);
    expect(safeEqualHex(hash, 'z'.repeat(64))).toBe(false);
    expect(safeEqualHex('not-hex-at-all', 'not-hex-at-all')).toBe(false);
  });

  it('fingerprints an address reproducibly without revealing it', () => {
    const first = fingerprint('203.0.113.7');
    const second = fingerprint('203.0.113.7');

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain('203.0.113.7');
    expect(fingerprint('203.0.113.8')).not.toBe(first);
  });
});
