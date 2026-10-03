import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { requestFingerprint } from '../../auth/request-context.util';
import { rateLimited } from '../errors/api-error';
import { RATE_LIMIT_CATEGORY, type RateLimitMark } from './rate-limit.decorator';
import type { RateLimitCategory } from './rate-limit.types';
import { RequestRateLimiter } from './request-rate-limiter.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Enforces the general request-abuse ceilings of `docs/07-SECURITY-RULES.md`.
 *
 * Registered after `SessionGuard`, so an unauthenticated request is still answered `401` rather
 * than `429`. A handler's `@RateLimit(...)` mark wins; otherwise every state-changing method is
 * limited as `mutation` and every read is left alone. The rejected response is the shared generic
 * `429 RATE_LIMITED` envelope with a `Retry-After` header, built by `rateLimited` so it cannot
 * echo why the caller was limited or what the ceiling is.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RequestRateLimiter,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const mark = this.reflector.getAllAndOverride<RateLimitMark | undefined>(RATE_LIMIT_CATEGORY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (mark === 'none') {
      return true;
    }

    const category: RateLimitCategory | undefined =
      mark ?? (SAFE_METHODS.has(request.method) ? undefined : 'mutation');

    if (category === undefined) {
      return true;
    }

    const retryAfterSeconds = this.limiter.consume(category, requestFingerprint(request));

    if (retryAfterSeconds > 0) {
      throw rateLimited(retryAfterSeconds);
    }

    return true;
  }
}
