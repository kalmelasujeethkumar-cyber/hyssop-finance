import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getAppEnvironment } from '../config/environment';

const MINUTE_IN_MS = 60 * 1000;

interface Window {
  readonly attempts: number[];
}

/**
 * Login attempt limiting.
 *
 * Authority: `docs/07-SECURITY-RULES.md` ("Rate-limit login attempts; do not reveal
 * whether an identifier exists") and `docs/06-API-SPEC.md` (`429 RATE_LIMITED`).
 *
 * Scope and trade-off, recorded in `DEC-066`: the window is per API process and in
 * memory, because the demo runs a single API instance and a login attempt must be
 * rejected before any credential lookup, which a database read cannot do cheaply. A
 * multi-instance deployment would move this to a shared store; nothing else about login
 * would change. The limiter counts *attempts*, not failures, so it cannot be used to
 * probe whether a guess was correct.
 */
@Injectable()
export class LoginRateLimiter {
  private readonly windows = new Map<string, Window>();

  public constructor(private readonly config: ConfigService) {}

  /** Seconds the caller must wait, or `0` when the attempt may proceed. */
  public retryAfterSeconds(key: string): number {
    const { maxAttempts, windowMinutes } = this.limits();
    const now = Date.now();
    const windowMs = windowMinutes * MINUTE_IN_MS;
    const attempts = (this.windows.get(key)?.attempts ?? []).filter((at) => now - at < windowMs);

    if (attempts.length >= maxAttempts) {
      const oldest = attempts[0] ?? now;
      return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    }

    attempts.push(now);
    this.windows.set(key, { attempts });
    this.sweep(now, windowMs);

    return 0;
  }

  public reset(key: string): void {
    this.windows.delete(key);
  }

  public resetAll(): void {
    this.windows.clear();
  }

  private limits(): { maxAttempts: number; windowMinutes: number } {
    const auth = getAppEnvironment(this.config).auth;

    return {
      maxAttempts: auth.loginRateLimitMaxAttempts,
      windowMinutes: auth.loginRateLimitWindowMinutes,
    };
  }

  /** Drops windows that can no longer reject anything, so the map cannot grow forever. */
  private sweep(now: number, windowMs: number): void {
    if (this.windows.size <= 512) {
      return;
    }

    for (const [key, window] of this.windows) {
      if (window.attempts.every((at) => now - at >= windowMs)) {
        this.windows.delete(key);
      }
    }
  }
}
