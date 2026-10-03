import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  testAppEnvironment,
  testRateLimitEnvironment,
} from '../../../test/database/support/test-database';
import { ApiError } from '../errors/api-error';
import type { RateLimitMark } from './rate-limit.decorator';
import { RateLimitGuard } from './rate-limit.guard';
import { RequestRateLimiter } from './request-rate-limiter.service';

function guardWith(
  mark: RateLimitMark | undefined,
  overrides: Parameters<typeof testRateLimitEnvironment>[0] = {},
): RateLimitGuard {
  const limiter = new RequestRateLimiter(
    new ConfigService({
      environment: testAppEnvironment({ rateLimit: testRateLimitEnvironment(overrides) }),
    }),
  );
  const reflector = { getAllAndOverride: () => mark } as unknown as Reflector;

  return new RateLimitGuard(reflector, limiter);
}

function contextFor(method: string): ExecutionContext {
  const request = { method, ip: '127.0.0.1' } as unknown as Request;

  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard', () => {
  it('limits state-changing methods as mutations by default', () => {
    const guard = guardWith(undefined, { mutation: { maxRequests: 1, windowMinutes: 1 } });
    const context = contextFor('POST');

    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(ApiError);
  });

  it('leaves safe methods unlimited by default', () => {
    const guard = guardWith(undefined, { mutation: { maxRequests: 1, windowMinutes: 1 } });
    const context = contextFor('GET');

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('applies an explicit category to a read route', () => {
    const guard = guardWith('search', { search: { maxRequests: 1, windowMinutes: 1 } });
    const context = contextFor('GET');

    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(ApiError);
  });

  it('opts a route out when it is marked none', () => {
    const guard = guardWith('none', { mutation: { maxRequests: 1, windowMinutes: 1 } });
    const context = contextFor('POST');

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects with the generic 429 envelope and a retry hint', () => {
    const guard = guardWith(undefined, { mutation: { maxRequests: 1, windowMinutes: 1 } });
    const context = contextFor('PATCH');

    guard.canActivate(context);

    try {
      guard.canActivate(context);
      throw new Error('expected the guard to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;

      expect(apiError.code).toBe('RATE_LIMITED');
      expect(apiError.retryAfterSeconds).toBeGreaterThan(0);
      expect(apiError.getResponse()).toMatchObject({
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Please wait and try again.',
      });
    }
  });
});
