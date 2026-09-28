import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateCsrfTokenInput {
  readonly tokenHash: string;
  readonly origin: string;
  readonly expiresAt: Date;
}

export interface ConsumeCsrfTokenResult {
  /** False when the token is unknown, already consumed, expired, or from another origin. */
  readonly consumed: boolean;
  readonly reason: 'unknown' | 'consumed' | 'expired' | 'origin_mismatch' | 'ok';
}

/**
 * Pre-authentication CSRF persistence.
 *
 * Authority: `docs/07-SECURITY-RULES.md`: "Before login, the API issues a short-lived
 * CSRF cookie and matching token bound to the trusted origin; login presents the token
 * and the server rotates it after session creation." The row is what makes the token
 * short-lived, origin-bound, and single-use, and only the token's hash is stored.
 */
@Injectable()
export class AuthCsrfTokenRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public async create(input: CreateCsrfTokenInput): Promise<void> {
    await this.prisma.authCsrfToken.create({
      data: { tokenHash: input.tokenHash, origin: input.origin, expiresAt: input.expiresAt },
    });
  }

  /**
   * Marks the token consumed when it is still valid for `origin`. The update is
   * conditional, so two concurrent logins presenting the same token cannot both win:
   * the loser updates zero rows and is rejected.
   */
  public async consume(
    tokenHash: string,
    origin: string,
    now: Date,
  ): Promise<ConsumeCsrfTokenResult> {
    const claimed = await this.prisma.authCsrfToken.updateMany({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: now }, origin },
      data: { consumedAt: now },
    });

    if (claimed.count > 0) {
      return { consumed: true, reason: 'ok' };
    }

    return { consumed: false, reason: await this.classifyFailure(tokenHash, origin, now) };
  }

  public async deleteExpiredBefore(before: Date): Promise<number> {
    const result = await this.prisma.authCsrfToken.deleteMany({
      where: { expiresAt: { lt: before } },
    });

    return result.count;
  }

  /**
   * Explains a failed consume for the audit trail and the logs. It never returns the
   * token, only which condition failed, and the caller must still answer the client
   * with one generic error.
   */
  private async classifyFailure(
    tokenHash: string,
    origin: string,
    now: Date,
  ): Promise<ConsumeCsrfTokenResult['reason']> {
    const row = await this.prisma.authCsrfToken.findUnique({
      where: { tokenHash },
      select: { consumedAt: true, expiresAt: true, origin: true },
    });

    if (row === null) {
      return 'unknown';
    }

    if (row.consumedAt !== null) {
      return 'consumed';
    }

    if (row.expiresAt <= now) {
      return 'expired';
    }

    return row.origin === origin ? 'ok' : 'origin_mismatch';
  }
}
