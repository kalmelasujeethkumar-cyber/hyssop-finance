import { Module } from '@nestjs/common';
import { RequestRateLimiter } from './request-rate-limiter.service';

/**
 * Provides the general request-abuse limiter.
 *
 * The limiter is exported so `AppModule` can inject it into the globally registered
 * `RateLimitGuard`, which is bound there next to `SessionGuard` so the guard order is explicit.
 */
@Module({
  providers: [RequestRateLimiter],
  exports: [RequestRateLimiter],
})
export class RateLimitModule {}
