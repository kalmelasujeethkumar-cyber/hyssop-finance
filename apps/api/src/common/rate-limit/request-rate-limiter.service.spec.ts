import { ConfigService } from '@nestjs/config';
import {
  testAppEnvironment,
  testRateLimitEnvironment,
} from '../../../test/database/support/test-database';
import { RequestRateLimiter } from './request-rate-limiter.service';

function limiterWith(overrides: Parameters<typeof testRateLimitEnvironment>[0] = {}) {
  return new RequestRateLimiter(
    new ConfigService({
      environment: testAppEnvironment({ rateLimit: testRateLimitEnvironment(overrides) }),
    }),
  );
}

describe('RequestRateLimiter', () => {
  it('allows requests up to the configured maximum and then reports a wait', () => {
    const limiter = limiterWith({ mutation: { maxRequests: 3, windowMinutes: 1 } });

    expect(limiter.consume('mutation', 'one')).toBe(0);
    expect(limiter.consume('mutation', 'one')).toBe(0);
    expect(limiter.consume('mutation', 'one')).toBe(0);

    const wait = limiter.consume('mutation', 'one');

    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
  });

  it('keeps categories in separate buckets, so search cannot exhaust export', () => {
    const limiter = limiterWith({
      search: { maxRequests: 1, windowMinutes: 1 },
      export: { maxRequests: 1, windowMinutes: 1 },
    });

    expect(limiter.consume('search', 'client')).toBe(0);
    expect(limiter.consume('search', 'client')).toBeGreaterThan(0);
    expect(limiter.consume('export', 'client')).toBe(0);
  });

  it('keeps clients in separate buckets', () => {
    const limiter = limiterWith({ mutation: { maxRequests: 1, windowMinutes: 1 } });

    expect(limiter.consume('mutation', 'first')).toBe(0);
    expect(limiter.consume('mutation', 'first')).toBeGreaterThan(0);
    expect(limiter.consume('mutation', 'second')).toBe(0);
  });

  it('forgets requests once the window has passed', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const limiter = limiterWith({ upload: { maxRequests: 1, windowMinutes: 1 } });

      expect(limiter.consume('upload', 'client')).toBe(0);
      expect(limiter.consume('upload', 'client')).toBeGreaterThan(0);

      jest.setSystemTime(new Date('2026-01-01T00:02:00.000Z'));

      expect(limiter.consume('upload', 'client')).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('can be reset for one bucket and entirely', () => {
    const limiter = limiterWith({ mutation: { maxRequests: 1, windowMinutes: 1 } });

    expect(limiter.consume('mutation', 'client')).toBe(0);
    expect(limiter.consume('mutation', 'client')).toBeGreaterThan(0);

    limiter.reset('mutation', 'client');
    expect(limiter.consume('mutation', 'client')).toBe(0);
    expect(limiter.consume('mutation', 'client')).toBeGreaterThan(0);

    limiter.resetAll();
    expect(limiter.consume('mutation', 'client')).toBe(0);
  });
});
