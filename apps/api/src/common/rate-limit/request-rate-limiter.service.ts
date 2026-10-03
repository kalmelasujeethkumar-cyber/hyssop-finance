import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getAppEnvironment, type RateLimitRule } from '../../config/environment';
import type { RateLimitCategory } from './rate-limit.types';

const MINUTE_IN_MS = 60 * 1000;

/**
 * The general request-abuse limiter for uploads, searches, exports, and mutations.
 *
 * Authority: `docs/07-SECURITY-RULES.md` ("Apply safe login, upload, search, export, and mutation
 * limits ... required, not optional"). The login control is separate and pre-credential; this one
 * applies after routing to the categories the document names alongside it.
 *
 * Scope and trade-off, recorded in `DEC-106`: like the login limiter, the window is per API
 * process and in memory. The demo runs a single API instance, and a shared store would be a new
 * piece of infrastructure with no demo benefit. A multi-instance deployment would move this to a
 * shared store without changing any category, threshold, or error.
 *
 * The limiter counts *requests*, so a burst of rejected or malformed requests is still bounded.
 * It never records the client address itself, only a salted fingerprint supplied by the caller.
 */
@Injectable()
export class RequestRateLimiter {
  private readonly windows = new Map<string, number[]>();

  public constructor(private readonly config: ConfigService) {}

  /** Seconds the caller must wait, or `0` when the request may proceed. */
  public consume(category: RateLimitCategory, key: string): number {
    const rule = this.ruleFor(category);
    const now = Date.now();
    const windowMs = rule.windowMinutes * MINUTE_IN_MS;
    const bucket = `${category}:${key}`;
    const timestamps = (this.windows.get(bucket) ?? []).filter((at) => now - at < windowMs);

    if (timestamps.length >= rule.maxRequests) {
      const oldest = timestamps[0] ?? now;

      return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    }

    timestamps.push(now);
    this.windows.set(bucket, timestamps);
    this.sweep(now, windowMs);

    return 0;
  }

  public reset(category: RateLimitCategory, key: string): void {
    this.windows.delete(`${category}:${key}`);
  }

  public resetAll(): void {
    this.windows.clear();
  }

  private ruleFor(category: RateLimitCategory): RateLimitRule {
    return getAppEnvironment(this.config).rateLimit[category];
  }

  /** Drops windows that can no longer reject anything, so the map cannot grow forever. */
  private sweep(now: number, windowMs: number): void {
    if (this.windows.size <= 512) {
      return;
    }

    for (const [bucket, timestamps] of this.windows) {
      if (timestamps.every((at) => now - at >= windowMs)) {
        this.windows.delete(bucket);
      }
    }
  }
}
