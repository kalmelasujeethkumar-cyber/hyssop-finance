import { ConfigService } from '@nestjs/config';
import { testAppEnvironment } from '../../test/database/support/test-database';
import { LoginRateLimiter } from './login-rate-limiter.service';

function limiterWith(
  overrides: Partial<ReturnType<typeof testAppEnvironment>['auth']> = {},
): LoginRateLimiter {
  return new LoginRateLimiter(
    new ConfigService({
      environment: testAppEnvironment({ auth: { ...testAppEnvironment().auth, ...overrides } }),
    }),
  );
}

describe('LoginRateLimiter', () => {
  it('allows attempts up to the configured maximum and then reports a wait', () => {
    const limiter = limiterWith({ loginRateLimitMaxAttempts: 3, loginRateLimitWindowMinutes: 15 });

    expect(limiter.retryAfterSeconds('one')).toBe(0);
    expect(limiter.retryAfterSeconds('one')).toBe(0);
    expect(limiter.retryAfterSeconds('one')).toBe(0);

    const wait = limiter.retryAfterSeconds('one');
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(15 * 60);
  });

  it('counts attempts, not failures, so a correct password cannot reset the window', () => {
    const limiter = limiterWith({ loginRateLimitMaxAttempts: 2, loginRateLimitWindowMinutes: 15 });

    expect(limiter.retryAfterSeconds('bucket')).toBe(0);
    expect(limiter.retryAfterSeconds('bucket')).toBe(0);
    expect(limiter.retryAfterSeconds('bucket')).toBeGreaterThan(0);
  });

  it('keeps separate buckets per key', () => {
    const limiter = limiterWith({ loginRateLimitMaxAttempts: 1, loginRateLimitWindowMinutes: 15 });

    expect(limiter.retryAfterSeconds('first')).toBe(0);
    expect(limiter.retryAfterSeconds('first')).toBeGreaterThan(0);
    expect(limiter.retryAfterSeconds('second')).toBe(0);
  });

  it('forgets attempts once the window has passed', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const limiter = limiterWith({ loginRateLimitMaxAttempts: 1, loginRateLimitWindowMinutes: 1 });

      expect(limiter.retryAfterSeconds('bucket')).toBe(0);
      expect(limiter.retryAfterSeconds('bucket')).toBeGreaterThan(0);

      jest.setSystemTime(new Date('2026-01-01T00:02:00.000Z'));

      expect(limiter.retryAfterSeconds('bucket')).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('can be reset for a key and entirely', () => {
    const limiter = limiterWith({ loginRateLimitMaxAttempts: 1, loginRateLimitWindowMinutes: 15 });

    expect(limiter.retryAfterSeconds('bucket')).toBe(0);
    expect(limiter.retryAfterSeconds('bucket')).toBeGreaterThan(0);

    limiter.reset('bucket');
    expect(limiter.retryAfterSeconds('bucket')).toBe(0);

    expect(limiter.retryAfterSeconds('other')).toBe(0);
    expect(limiter.retryAfterSeconds('other')).toBeGreaterThan(0);

    limiter.resetAll();
    expect(limiter.retryAfterSeconds('other')).toBe(0);
  });
});
