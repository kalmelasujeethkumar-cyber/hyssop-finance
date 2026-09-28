import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** The Admin columns authentication needs, and nothing else. */
export interface AdminCredentialRecord {
  readonly id: string;
  readonly identifier: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly lastLoginAt: Date | null;
}

export interface AdminProfileRecord {
  readonly id: string;
  readonly identifier: string;
  readonly displayName: string;
}

const CREDENTIAL_SELECT = {
  id: true,
  identifier: true,
  displayName: true,
  passwordHash: true,
  lastLoginAt: true,
} as const;

/**
 * Credential lookup for the single Admin account.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` ("`admin_user` … `identifier` … `password_hash`")
 * and `docs/02-ARCHITECTURE.md` (all data access lives in the repository layer). The
 * password hash is read only for Argon2id verification and is never returned by a
 * profile query, so a controller cannot serialize it by accident.
 */
@Injectable()
export class AdminUserRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public async findCredentialByIdentifier(
    identifier: string,
  ): Promise<AdminCredentialRecord | null> {
    const row = await this.prisma.adminUser.findUnique({
      where: { identifier },
      select: CREDENTIAL_SELECT,
    });

    return row;
  }

  public async findProfileById(id: string): Promise<AdminProfileRecord | null> {
    const row = await this.prisma.adminUser.findUnique({
      where: { id },
      select: { id: true, identifier: true, displayName: true },
    });

    return row;
  }

  /** Upserts the single Admin credential. Used only by the bootstrap command. */
  public async provisionCredential(input: {
    readonly identifier: string;
    readonly displayName: string;
    readonly passwordHash: string;
  }): Promise<AdminProfileRecord> {
    return this.prisma.adminUser.upsert({
      where: { identifier: input.identifier },
      create: {
        identifier: input.identifier,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
      },
      update: { displayName: input.displayName, passwordHash: input.passwordHash },
      select: { id: true, identifier: true, displayName: true },
    });
  }

  /**
   * Replaces the stored hash with one computed at the current cost. Used by the Argon2
   * upgrade path after a successful sign-in; never called with a raw password.
   */
  public async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.prisma.adminUser.update({ where: { id }, data: { passwordHash } });
  }

  /** Records a successful sign-in time. Never called on a failed attempt. */
  public async recordLogin(id: string, at: Date): Promise<void> {
    await this.prisma.adminUser.update({ where: { id }, data: { lastLoginAt: at } });
  }
}
