import { Injectable } from '@nestjs/common';
import type { CurrentSessionResult, LoginResult } from '@hyssop/contracts';
import { invalidCredentials, rateLimited } from '../common/errors/api-error';
import { AuditEventRepository, AUDIT_ENTITY_TYPES } from '../database/audit/audit-event.repository';
import { AdminUserRepository } from '../database/auth/admin-user.repository';
import { checkPasswordPolicy, normalizeIdentifier } from './credential-policy';
import { LoginRateLimiter } from './login-rate-limiter.service';
import { PasswordService } from './password.service';
import { SessionService, type RequestAuditContext } from './session.service';

export interface LoginInput extends RequestAuditContext {
  readonly identifier: string;
  readonly password: string;
  /** Rate-limit bucket, normally the request's network fingerprint. */
  readonly rateLimitKey: string;
}

/**
 * The sign-in outcome. `sessionToken` is deliberately **not** part of the response
 * contract: it exists only so the controller can set the HTTP-only cookie, and there is
 * no code path that would place it in a response body.
 */
export interface LoginOutcome {
  readonly result: LoginResult;
  readonly sessionToken: string;
}

/**
 * Sign-in orchestration.
 *
 * Authority: `docs/06-API-SPEC.md` (`POST /api/v1/auth/login` "validates identifier and
 * password, verifies Argon2id, creates a session, and returns Admin profile, session
 * expiry, and a rotated CSRF token") and `docs/07-SECURITY-RULES.md` ("Login failures use
 * a generic message. Never log passwords.").
 *
 * Every rejection path is indistinguishable from the outside: an unknown identifier, a
 * wrong password, and an unprovisioned account all return the same `INVALID_CREDENTIALS`
 * and take comparable time, because an unknown identifier still performs a real Argon2id
 * verification. The identifier itself is never written to an audit event or a log.
 */
@Injectable()
export class AuthService {
  public constructor(
    private readonly admins: AdminUserRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly rateLimiter: LoginRateLimiter,
    private readonly audit: AuditEventRepository,
  ) {}

  public async login(input: LoginInput): Promise<LoginOutcome> {
    const retryAfterSeconds = this.rateLimiter.retryAfterSeconds(input.rateLimitKey);

    if (retryAfterSeconds > 0) {
      throw rateLimited(retryAfterSeconds);
    }

    const identifier = normalizeIdentifier(input.identifier);
    const credential = await this.admins.findCredentialByIdentifier(identifier);

    if (credential === null) {
      // Equalize the work: an unknown identifier must cost the same as a wrong password.
      await this.passwords.verifyAgainstDummyHash(input.password);
      await this.recordFailure(null, input);
      throw invalidCredentials();
    }

    const verified = await this.passwords.verify(credential.passwordHash, input.password);

    if (!verified) {
      await this.recordFailure(credential.id, input);
      throw invalidCredentials();
    }

    // A short or over-long password that still verifies can only come from a hash stored
    // before the current policy existed; the demo never creates one, so this is a guard.
    if (checkPasswordPolicy(input.password).length > 0) {
      await this.recordFailure(credential.id, input);
      throw invalidCredentials();
    }

    if (this.passwords.needsRehash(credential.passwordHash)) {
      await this.admins.updatePasswordHash(
        credential.id,
        await this.passwords.hash(input.password),
      );
    }

    const issued = await this.sessions.issue(
      { id: credential.id, identifier: credential.identifier, displayName: credential.displayName },
      { requestId: input.requestId, ipHash: input.ipHash },
    );

    return {
      sessionToken: issued.token,
      result: {
        admin: issued.session.admin,
        session: issued.session.context,
        csrfToken: issued.csrfToken,
      },
    };
  }

  public currentSession(session: {
    readonly admin: CurrentSessionResult['admin'];
    readonly context: CurrentSessionResult['session'];
  }): CurrentSessionResult {
    return { admin: session.admin, session: session.context };
  }

  /**
   * Records `LOGIN_FAILED`. `entity_type` is `session` for every authentication event,
   * including failures, because a rejected attempt concerns a session that was never
   * created. The Admin's UUID is recorded when it is known so repeated failures against
   * one account are visible in the audit trail; the identifier is never recorded.
   */
  private async recordFailure(adminUserId: string | null, input: LoginInput): Promise<void> {
    await this.audit.recordStandalone({
      action: 'LOGIN_FAILED',
      entityType: AUDIT_ENTITY_TYPES.session,
      entityId: null,
      actorAdminId: adminUserId,
      reason: 'invalid_credentials',
      requestId: input.requestId,
      ipHash: input.ipHash,
    });
  }
}
