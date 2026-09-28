import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdminProfile, SessionContext } from '@hyssop/contracts';
import { getAppEnvironment } from '../config/environment';
import {
  AdminSessionRepository,
  type SessionRevocationReason,
} from '../database/auth/admin-session.repository';
import { generateToken, hashToken } from './token.util';

const HOUR_IN_MS = 60 * 60 * 1000;

export interface RequestAuditContext {
  readonly requestId: string | null;
  readonly ipHash: string | null;
}

export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly admin: AdminProfile;
  readonly csrfTokenHash: string;
  readonly context: SessionContext;
}

export interface IssuedSession {
  /** Plaintext session token. It exists only here and in the HTTP-only cookie. */
  readonly token: string;
  /** Plaintext CSRF secret. The browser may read it; the database stores only its hash. */
  readonly csrfToken: string;
  readonly session: AuthenticatedSession;
}

/**
 * Session lifecycle.
 *
 * Authority: `docs/02-ARCHITECTURE.md` ("opaque, revocable server-side session stored
 * as a hash"), `docs/05-DATABASE-SPEC.md` ("stored only as a SHA-256 hash"), and
 * `docs/07-SECURITY-RULES.md` ("Logout invalidates the session server-side. Expired and
 * revoked sessions are rejected.").
 *
 * Expiry is absolute, not sliding: a session ends `SESSION_TTL_HOURS` after it was
 * issued however active it is, so a stolen token cannot be kept alive by using it.
 * `last_seen_at` is maintained for investigation only and never extends the session.
 */
@Injectable()
export class SessionService {
  public constructor(
    private readonly config: ConfigService,
    private readonly sessions: AdminSessionRepository,
  ) {}

  public now(): Date {
    return new Date();
  }

  public ttlMs(): number {
    return getAppEnvironment(this.config).auth.sessionTtlHours * HOUR_IN_MS;
  }

  /**
   * Creates a session for a verified Admin. Returns the plaintext secrets; persisting
   * them happens here so that the hashes, the row, `last_login_at`, and the
   * `LOGIN_SUCCEEDED` audit event are written together or not at all.
   */
  public async issue(admin: AdminProfile, audit: RequestAuditContext): Promise<IssuedSession> {
    const token = generateToken();
    const csrfToken = generateToken();
    const expiresAt = new Date(this.now().getTime() + this.ttlMs());

    const created = await this.sessions.issue({
      adminUserId: admin.id,
      tokenHash: hashToken(token),
      csrfTokenHash: hashToken(csrfToken),
      ipHash: audit.ipHash,
      expiresAt,
      audit: { requestId: audit.requestId, ipHash: audit.ipHash },
    });

    return {
      token,
      csrfToken,
      session: {
        sessionId: created.id,
        admin,
        csrfTokenHash: hashToken(csrfToken),
        context: { issuedAt: created.createdAt.toISOString(), expiresAt: expiresAt.toISOString() },
      },
    };
  }

  /**
   * Resolves a session token, or `null` when it is absent, unknown, revoked, or expired.
   * A rejected token still performs its lookup, so expiry is enforced by the database
   * read rather than by trusting a cookie timestamp.
   */
  public async authenticate(token: string | undefined): Promise<AuthenticatedSession | null> {
    if (token === undefined || token.length < 20) {
      return null;
    }

    const record = await this.sessions.findByTokenHash(hashToken(token));

    if (record === null || record.revokedAt !== null || record.expiresAt <= this.now()) {
      return null;
    }

    await this.sessions.touch(record.id, this.now());

    return {
      sessionId: record.id,
      admin: {
        id: record.adminUser.id,
        identifier: record.adminUser.identifier,
        displayName: record.adminUser.displayName,
      },
      csrfTokenHash: record.csrfTokenHash,
      context: {
        issuedAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
      },
    };
  }

  /** Rotates the CSRF secret of a live session and returns the new plaintext value. */
  public async rotateCsrfToken(sessionId: string): Promise<string> {
    const csrfToken = generateToken();
    await this.sessions.rotateCsrfTokenHash(sessionId, hashToken(csrfToken));

    return csrfToken;
  }

  /** Server-side invalidation with its `LOGOUT` audit event. Idempotent. */
  public async revoke(
    sessionId: string,
    reason: SessionRevocationReason,
    actorAdminId: string | null,
    audit: RequestAuditContext,
  ): Promise<boolean> {
    return this.sessions.revoke(sessionId, reason, this.now(), {
      actorAdminId,
      requestId: audit.requestId,
      ipHash: audit.ipHash,
    });
  }
}
