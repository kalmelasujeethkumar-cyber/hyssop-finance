import { Injectable } from '@nestjs/common';
import {
  AuditEventRepository,
  AUDIT_ENTITY_TYPES,
  type RecordAuditEventInput,
} from '../audit/audit-event.repository';
import { PrismaService } from '../prisma/prisma.service';

export const SESSION_REVOCATION_REASONS = ['LOGOUT', 'EXPIRED', 'REPLACED'] as const;

export type SessionRevocationReason = (typeof SESSION_REVOCATION_REASONS)[number];

export interface IssueSessionInput {
  readonly adminUserId: string;
  readonly tokenHash: string;
  readonly csrfTokenHash: string;
  readonly ipHash: string | null;
  readonly expiresAt: Date;
  readonly audit: Omit<RecordAuditEventInput, 'action' | 'entityType' | 'actorAdminId'>;
}

export interface SessionRecord {
  readonly id: string;
  readonly adminUserId: string;
  readonly csrfTokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedReason: string | null;
  readonly adminUser: {
    readonly id: string;
    readonly identifier: string;
    readonly displayName: string;
  };
}

const SESSION_SELECT = {
  id: true,
  adminUserId: true,
  csrfTokenHash: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  revokedReason: true,
  adminUser: { select: { id: true, identifier: true, displayName: true } },
} as const;

/**
 * Session persistence.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` ("The opaque session token … is stored only as a
 * SHA-256 hash") and `docs/07-SECURITY-RULES.md` ("Logout invalidates the session
 * server-side. Expired and revoked sessions are rejected."). This repository only ever
 * receives hashes: it has no method that could store or return a usable token.
 *
 * Issuing a session, stamping `last_login_at`, and recording `LOGIN_SUCCEEDED` share one
 * transaction, so a successful sign-in can never exist without its audit event.
 */
@Injectable()
export class AdminSessionRepository {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventRepository,
  ) {}

  public async issue(
    input: IssueSessionInput,
  ): Promise<{ readonly id: string; readonly createdAt: Date }> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.adminSession.create({
        data: {
          adminUserId: input.adminUserId,
          tokenHash: input.tokenHash,
          csrfTokenHash: input.csrfTokenHash,
          ipHash: input.ipHash,
          expiresAt: input.expiresAt,
        },
        select: { id: true, createdAt: true },
      });

      await tx.adminUser.update({
        where: { id: input.adminUserId },
        data: { lastLoginAt: session.createdAt },
      });

      await this.audit.record(tx, {
        action: 'LOGIN_SUCCEEDED',
        entityType: AUDIT_ENTITY_TYPES.session,
        entityId: session.id,
        actorAdminId: input.adminUserId,
        requestId: input.audit.requestId ?? null,
        ipHash: input.audit.ipHash ?? null,
      });

      return session;
    });
  }

  /** Looks a session up by token hash, with the Admin identity it belongs to. */
  public async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.prisma.adminSession.findUnique({ where: { tokenHash }, select: SESSION_SELECT });
  }

  public async touch(id: string, at: Date): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { id, revokedAt: null },
      data: { lastSeenAt: at },
    });
  }

  /** Rotates the stored CSRF secret hash of a live session. */
  public async rotateCsrfTokenHash(id: string, csrfTokenHash: string): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { id, revokedAt: null },
      data: { csrfTokenHash },
    });
  }

  /**
   * Server-side invalidation with its `LOGOUT` audit event in one transaction.
   * Idempotent: a second logout revokes nothing and records nothing, so the append-only
   * trail keeps exactly one logout event per real sign-out.
   */
  public async revoke(
    id: string,
    reason: SessionRevocationReason,
    at: Date,
    audit: Omit<RecordAuditEventInput, 'action' | 'entityType' | 'entityId' | 'reason'>,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.adminSession.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: at, revokedReason: reason },
      });

      if (result.count === 0) {
        return false;
      }

      await this.audit.record(tx, {
        action: 'LOGOUT',
        entityType: AUDIT_ENTITY_TYPES.session,
        entityId: id,
        reason,
        requestId: audit.requestId ?? null,
        ipHash: audit.ipHash ?? null,
        actorAdminId: audit.actorAdminId ?? null,
      });

      return true;
    });
  }

  /** Revokes every live session of the Admin, as the bootstrap requires. */
  public async revokeAllLiveForAdmin(adminUserId: string, at: Date): Promise<number> {
    const result = await this.prisma.adminSession.updateMany({
      where: { adminUserId, revokedAt: null },
      data: { revokedAt: at, revokedReason: 'REPLACED' },
    });

    return result.count;
  }

  public async countLiveForAdmin(adminUserId: string, at: Date): Promise<number> {
    return this.prisma.adminSession.count({
      where: { adminUserId, revokedAt: null, expiresAt: { gt: at } },
    });
  }

  /** Maintenance only: removes rows that expired or were revoked before `before`. */
  public async deleteExpiredBefore(before: Date): Promise<number> {
    const result = await this.prisma.adminSession.deleteMany({
      where: { OR: [{ expiresAt: { lt: before } }, { revokedAt: { lt: before } }] },
    });

    return result.count;
  }
}
