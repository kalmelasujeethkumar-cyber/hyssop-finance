import { REDACTED_VALUE, isSensitiveKey, redact } from './redaction';

describe('redact', () => {
  it('replaces sensitive values in a flat record', () => {
    expect(
      redact({
        email: 'member@example.test',
        password: 'plain-text',
        sessionToken: 'abc',
        'set-cookie': 'sid=1',
        authorization: 'Bearer abc',
      }),
    ).toEqual({
      email: 'member@example.test',
      password: REDACTED_VALUE,
      sessionToken: REDACTED_VALUE,
      'set-cookie': REDACTED_VALUE,
      authorization: REDACTED_VALUE,
    });
  });

  it('replaces sensitive values in nested objects and arrays', () => {
    expect(
      redact({
        member: { name: 'A', profile: { apiKey: 'k' } },
        events: [{ csrfToken: 't' }, { safe: 1 }],
      }),
    ).toEqual({
      member: { name: 'A', profile: { apiKey: REDACTED_VALUE } },
      events: [{ csrfToken: REDACTED_VALUE }, { safe: 1 }],
    });
  });

  it('replaces a whole sensitive branch instead of trusting its contents', () => {
    expect(redact({ credentials: { apiKey: 'k' } })).toEqual({
      credentials: REDACTED_VALUE,
    });
  });

  it('keeps primitives, converts dates, and summarizes errors', () => {
    const result = redact({
      count: 2,
      active: true,
      nothing: null,
      at: new Date('2026-01-01T00:00:00.000Z'),
      failure: new Error('boom'),
    }) as Record<string, unknown>;

    expect(result['count']).toBe(2);
    expect(result['active']).toBe(true);
    expect(result['nothing']).toBeNull();
    expect(result['at']).toBe('2026-01-01T00:00:00.000Z');
    expect(result['failure']).toEqual({ name: 'Error', message: 'boom' });
  });

  it('does not recurse forever on circular structures', () => {
    const circular: Record<string, unknown> = { name: 'root' };
    circular['self'] = circular;

    expect(redact(circular)).toEqual({ name: 'root', self: '[CIRCULAR]' });
  });

  it('truncates structures deeper than the supported depth', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 'too deep' } } } } } } };

    expect(JSON.stringify(redact(deep))).toContain('[TRUNCATED]');
  });
});

describe('isSensitiveKey', () => {
  it.each(['password', 'userPassword', 'SECRET', 'api_key', 'X-API-KEY', 'sessionId', 'csrf'])(
    'treats %s as sensitive',
    (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    },
  );

  it.each(['email', 'amountPaise', 'status', 'id'])('treats %s as safe', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});
