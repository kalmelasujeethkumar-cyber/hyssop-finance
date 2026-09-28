/**
 * Authentication persistence against real PostgreSQL.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` (auth tables, constraints, hashes only) and
 * `docs/07-SECURITY-RULES.md` (revocable sessions, CSRF on login, security audit).
 * These are `TEST-AUTH-001` scenarios that require a real database because the behavior
 * under test is enforced by PostgreSQL constraints and transactions.
 */

import { UNPROVISIONED_PASSWORD_HASH } from '@hyssop/contracts';
import { PasswordService } from '../../src/auth/password.service';
import { generateToken, hashToken } from '../../src/auth/token.util';
import { ConfigService } from '@nestjs/config';
import { testAppEnvironment, createHarness, type TestHarness } from './support/test-database';

const HOUR = 60 * 60 * 1000;
const PASSWORD = 'a-long-enough-password';

describe('authentication persistence (TEST-AUTH-001)', () => {
  let harness: TestHarness;
  const passwords = new PasswordService(new ConfigService({ environment: testAppEnvironment() }));

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    harness.admin = await harness.reset();
  });

  describe('admin_user credentials', () => {
    it('stores a lower-cased unique identifier and refuses a mixed-case value', async () => {
      await expect(
        harness.runtime.adminUser.create({
          data: { identifier: 'MixedCase', displayName: 'x', passwordHash: '!unprovisioned' },
        }),
      ).rejects.toThrow();

      const second = await harness.runtime.adminUser.create({
        data: { identifier: 'second', displayName: 'Second', passwordHash: '!unprovisioned' },
      });

      await expect(
        harness.runtime.adminUser.create({
          data: { identifier: 'second', displayName: 'Duplicate', passwordHash: '!unprovisioned' },
        }),
      ).rejects.toThrow();

      expect(second.identifier).toBe('second');
    });

    it('never accepts an empty or over-long identifier', async () => {
      await expect(
        harness.runtime.adminUser.create({
          data: { identifier: '', displayName: 'x', passwordHash: '!unprovisioned' },
        }),
      ).rejects.toThrow();

      await expect(
        harness.runtime.adminUser.create({
          data: {
            identifier: 'a'.repeat(65),
            displayName: 'x',
            passwordHash: '!unprovisioned',
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a password hash that is neither Argon2id-shaped nor the sentinel', async () => {
      await expect(
        harness.runtime.adminUser.create({
          data: { identifier: 'bad-hash', displayName: 'x', passwordHash: '' },
        }),
      ).rejects.toThrow();

      await expect(
        harness.runtime.adminUser.create({
          data: {
            identifier: 'long-hash',
            displayName: 'x',
            passwordHash: 'a'.repeat(513),
          },
        }),
      ).rejects.toThrow();
    });

    it('accepts the documented sentinel and a real Argon2id hash', async () => {
      const sentinel = await harness.runtime.adminUser.create({
        data: {
          identifier: 'sentinel',
          displayName: 'x',
          passwordHash: UNPROVISIONED_PASSWORD_HASH,
        },
      });
      const real = await harness.runtime.adminUser.create({
        data: {
          identifier: 'real',
          displayName: 'x',
          passwordHash: await passwords.hash(PASSWORD),
        },
      });

      expect(sentinel.passwordHash).toBe(UNPROVISIONED_PASSWORD_HASH);
      expect(real.passwordHash.startsWith('$argon2id$')).toBe(true);
    });

    it('finds the credential by its normalized identifier', async () => {
      await harness.admins.provisionCredential({
        identifier: 'admin',
        displayName: 'Demo Admin',
        passwordHash: await passwords.hash(PASSWORD),
      });

      const found = await harness.admins.findCredentialByIdentifier('admin');

      expect(found?.identifier).toBe('admin');
      expect(found?.passwordHash.startsWith('$argon2id$')).toBe(true);
      await expect(harness.admins.findCredentialByIdentifier('nobody')).resolves.toBeNull();
    });
  });

  describe('admin_session', () => {
    it('stores only the hash of a session token and never the token itself', async () => {
      const token = generateToken();
      const csrfToken = generateToken();
      const expiresAt = new Date(Date.now() + HOUR);

      const created = await harness.sessions.issue({
        adminUserId: harness.admin.id,
        tokenHash: hashToken(token),
        csrfTokenHash: hashToken(csrfToken),
        ipHash: 'fingerprint',
        expiresAt,
        audit: { requestId: null, ipHash: 'fingerprint' },
      });

      const rows = await harness.runtime.$queryRawUnsafe<
        readonly { readonly token_hash: string; readonly csrf_token_hash: string }[]
      >('SELECT token_hash, csrf_token_hash FROM admin_session WHERE id = $1::uuid', created.id);

      expect(rows[0]?.token_hash).toBe(hashToken(token));
      expect(rows[0]?.csrf_token_hash).toBe(hashToken(csrfToken));
      expect(JSON.stringify(rows)).not.toContain(token);
      expect(JSON.stringify(rows)).not.toContain(csrfToken);
    });

    it('records a successful sign-in and stamps last_login_at in the same transaction', async () => {
      const session = await harness.sessions.issue({
        adminUserId: harness.admin.id,
        tokenHash: hashToken(generateToken()),
        csrfTokenHash: hashToken(generateToken()),
        ipHash: null,
        expiresAt: new Date(Date.now() + HOUR),
        audit: { requestId: null, ipHash: null },
      });

      const admin = await harness.runtime.adminUser.findUniqueOrThrow({
        where: { id: harness.admin.id },
      });
      const events = await harness.runtime.auditEvent.findMany({
        where: { action: 'LOGIN_SUCCEEDED' },
      });

      expect(admin.lastLoginAt).not.toBeNull();
      expect(events).toHaveLength(1);
      expect(events[0]?.entityId).toBe(session.id);
      expect(events[0]?.actorAdminId).toBe(harness.admin.id);
    });

    it('refuses a duplicate token hash and a non-positive lifetime', async () => {
      const tokenHash = hashToken(generateToken());
      const base = {
        adminUserId: harness.admin.id,
        tokenHash,
        csrfTokenHash: hashToken(generateToken()),
        ipHash: null,
        audit: { requestId: null, ipHash: null },
      };

      await harness.sessions.issue({ ...base, expiresAt: new Date(Date.now() + HOUR) });

      await expect(
        harness.sessions.issue({ ...base, expiresAt: new Date(Date.now() + HOUR) }),
      ).rejects.toThrow();

      await expect(
        harness.sessions.issue({
          ...base,
          tokenHash: hashToken(generateToken()),
          expiresAt: new Date(Date.now() - HOUR),
        }),
      ).rejects.toThrow();
    });

    it('rejects a token hash that is not a lowercase SHA-256 digest', async () => {
      await expect(
        harness.runtime.adminSession.create({
          data: {
            adminUserId: harness.admin.id,
            tokenHash: 'plain-text-token',
            csrfTokenHash: hashToken(generateToken()),
            expiresAt: new Date(Date.now() + HOUR),
          },
        }),
      ).rejects.toThrow();
    });

    it('revokes server-side, refuses a partial revocation, and audits exactly one logout', async () => {
      const created = await harness.sessions.issue({
        adminUserId: harness.admin.id,
        tokenHash: hashToken(generateToken()),
        csrfTokenHash: hashToken(generateToken()),
        ipHash: null,
        expiresAt: new Date(Date.now() + HOUR),
        audit: { requestId: null, ipHash: null },
      });

      const first = await harness.sessions.revoke(created.id, 'LOGOUT', new Date(), {
        actorAdminId: harness.admin.id,
        requestId: null,
        ipHash: null,
      });
      const second = await harness.sessions.revoke(created.id, 'LOGOUT', new Date(), {
        actorAdminId: harness.admin.id,
        requestId: null,
        ipHash: null,
      });

      const row = await harness.runtime.adminSession.findUniqueOrThrow({
        where: { id: created.id },
      });
      const events = await harness.runtime.auditEvent.findMany({ where: { action: 'LOGOUT' } });

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(row.revokedAt).not.toBeNull();
      expect(row.revokedReason).toBe('LOGOUT');
      expect(events).toHaveLength(1);
      expect(events[0]?.entityId).toBe(created.id);
    });

    it('rejects an undocumented revocation reason', async () => {
      const created = await harness.sessions.issue({
        adminUserId: harness.admin.id,
        tokenHash: hashToken(generateToken()),
        csrfTokenHash: hashToken(generateToken()),
        ipHash: null,
        expiresAt: new Date(Date.now() + HOUR),
        audit: { requestId: null, ipHash: null },
      });

      await expect(
        harness.runtime.adminSession.update({
          where: { id: created.id },
          data: { revokedAt: new Date(), revokedReason: 'HACKED' },
        }),
      ).rejects.toThrow();
    });

    it("cascades an Admin's sessions, but refuses to delete an Admin with audit history", async () => {
      const sessionOnly = await harness.runtime.adminUser.create({
        data: {
          identifier: 'ephemeral',
          displayName: 'x',
          passwordHash: UNPROVISIONED_PASSWORD_HASH,
        },
      });
      // Inserted directly so this Admin has a session but no audit history; `issue` would
      // always attach a `LOGIN_SUCCEEDED` event.
      await harness.runtime.adminSession.create({
        data: {
          adminUserId: sessionOnly.id,
          tokenHash: hashToken(generateToken()),
          csrfTokenHash: hashToken(generateToken()),
          expiresAt: new Date(Date.now() + HOUR),
        },
      });

      await harness.migration.adminUser.delete({ where: { id: sessionOnly.id } });

      await expect(
        harness.runtime.adminSession.count({ where: { adminUserId: sessionOnly.id } }),
      ).resolves.toBe(0);

      // The audit reference is the actor, so the permanent trail outlives the account:
      // an Admin that owns audit history cannot be deleted at all.
      await harness.sessions.issue({
        adminUserId: harness.admin.id,
        tokenHash: hashToken(generateToken()),
        csrfTokenHash: hashToken(generateToken()),
        ipHash: null,
        expiresAt: new Date(Date.now() + HOUR),
        audit: { requestId: null, ipHash: null },
      });

      await expect(
        harness.migration.adminUser.delete({ where: { id: harness.admin.id } }),
      ).rejects.toThrow();
      await expect(
        harness.runtime.auditEvent.count({ where: { action: 'LOGIN_SUCCEEDED' } }),
      ).resolves.toBe(1);
    });

    it('revokes every live session when the credential is replaced', async () => {
      const first = await harness.sessions.issue({
        adminUserId: harness.admin.id,
        tokenHash: hashToken(generateToken()),
        csrfTokenHash: hashToken(generateToken()),
        ipHash: null,
        expiresAt: new Date(Date.now() + HOUR),
        audit: { requestId: null, ipHash: null },
      });
      const second = await harness.sessions.issue({
        adminUserId: harness.admin.id,
        tokenHash: hashToken(generateToken()),
        csrfTokenHash: hashToken(generateToken()),
        ipHash: null,
        expiresAt: new Date(Date.now() + HOUR),
        audit: { requestId: null, ipHash: null },
      });

      const revoked = await harness.sessions.revokeAllLiveForAdmin(harness.admin.id, new Date());

      expect(revoked).toBe(2);
      await expect(harness.sessions.countLiveForAdmin(harness.admin.id, new Date())).resolves.toBe(
        0,
      );
      const rows = await harness.runtime.adminSession.findMany({
        where: { id: { in: [first.id, second.id] } },
      });
      expect(rows.every((row) => row.revokedReason === 'REPLACED')).toBe(true);
    });

    it('resolves a session by its token hash together with the Admin identity', async () => {
      const token = generateToken();
      const created = await harness.sessions.issue({
        adminUserId: harness.admin.id,
        tokenHash: hashToken(token),
        csrfTokenHash: hashToken('first-csrf-token'),
        ipHash: null,
        expiresAt: new Date(Date.now() + HOUR),
        audit: { requestId: null, ipHash: null },
      });

      const found = await harness.sessions.findByTokenHash(hashToken(token));

      expect(found?.id).toBe(created.id);
      expect(found?.adminUser.identifier).toBe(harness.admin.identifier);
      expect(found?.csrfTokenHash).toBe(hashToken('first-csrf-token'));
      await expect(harness.sessions.findByTokenHash(hashToken('unknown'))).resolves.toBeNull();
    });

    it('rotates the CSRF secret so the previous value stops matching', async () => {
      const token = generateToken();
      await harness.sessions.issue({
        adminUserId: harness.admin.id,
        tokenHash: hashToken(token),
        csrfTokenHash: hashToken('first-csrf-token'),
        ipHash: null,
        expiresAt: new Date(Date.now() + HOUR),
        audit: { requestId: null, ipHash: null },
      });

      await harness.runtime.adminSession.updateMany({
        where: { tokenHash: hashToken(token) },
        data: { csrfTokenHash: hashToken('second-csrf-token') },
      });

      const found = await harness.sessions.findByTokenHash(hashToken(token));
      expect(found?.csrfTokenHash).toBe(hashToken('second-csrf-token'));
    });

    it('counts only live, unexpired sessions', async () => {
      await harness.sessions.issue({
        adminUserId: harness.admin.id,
        tokenHash: hashToken(generateToken()),
        csrfTokenHash: hashToken(generateToken()),
        ipHash: null,
        expiresAt: new Date(Date.now() + HOUR),
        audit: { requestId: null, ipHash: null },
      });
      const expired = await harness.sessions.issue({
        adminUserId: harness.admin.id,
        tokenHash: hashToken(generateToken()),
        csrfTokenHash: hashToken(generateToken()),
        ipHash: null,
        expiresAt: new Date(Date.now() + 1000),
        audit: { requestId: null, ipHash: null },
      });

      await harness.sessions.revoke(expired.id, 'LOGOUT', new Date(), {
        actorAdminId: harness.admin.id,
        requestId: null,
        ipHash: null,
      });

      await expect(harness.sessions.countLiveForAdmin(harness.admin.id, new Date())).resolves.toBe(
        1,
      );
    });
  });

  describe('auth_csrf_token', () => {
    it('consumes a token exactly once', async () => {
      const tokenHash = hashToken(generateToken());
      await harness.csrfTokens.create({
        tokenHash,
        origin: 'http://localhost:5173',
        expiresAt: new Date(Date.now() + HOUR),
      });

      const first = await harness.csrfTokens.consume(
        tokenHash,
        'http://localhost:5173',
        new Date(),
      );
      const replay = await harness.csrfTokens.consume(
        tokenHash,
        'http://localhost:5173',
        new Date(),
      );

      expect(first).toEqual({ consumed: true, reason: 'ok' });
      expect(replay).toEqual({ consumed: false, reason: 'consumed' });
    });

    it('refuses a token presented from another origin', async () => {
      const tokenHash = hashToken(generateToken());
      await harness.csrfTokens.create({
        tokenHash,
        origin: 'http://localhost:5173',
        expiresAt: new Date(Date.now() + HOUR),
      });

      const result = await harness.csrfTokens.consume(
        tokenHash,
        'https://evil.example',
        new Date(),
      );

      expect(result).toEqual({ consumed: false, reason: 'origin_mismatch' });
    });

    it('refuses an expired token and leaves it unconsumed', async () => {
      const tokenHash = hashToken(generateToken());
      await harness.csrfTokens.create({
        tokenHash,
        origin: 'http://localhost:5173',
        expiresAt: new Date(Date.now() + 1000),
      });

      const later = new Date(Date.now() + HOUR);
      const result = await harness.csrfTokens.consume(tokenHash, 'http://localhost:5173', later);

      expect(result).toEqual({ consumed: false, reason: 'expired' });
    });

    it('reports an unknown token without revealing anything about it', async () => {
      const result = await harness.csrfTokens.consume(
        hashToken(generateToken()),
        'http://localhost:5173',
        new Date(),
      );

      expect(result).toEqual({ consumed: false, reason: 'unknown' });
    });

    it('lets only one of two concurrent claims win', async () => {
      const tokenHash = hashToken(generateToken());
      await harness.csrfTokens.create({
        tokenHash,
        origin: 'http://localhost:5173',
        expiresAt: new Date(Date.now() + HOUR),
      });

      const results = await Promise.all([
        harness.csrfTokens.consume(tokenHash, 'http://localhost:5173', new Date()),
        harness.csrfTokens.consume(tokenHash, 'http://localhost:5173', new Date()),
      ]);

      expect(results.filter((result) => result.consumed)).toHaveLength(1);
    });

    it('refuses a malformed token hash, a blank origin, and a non-positive lifetime', async () => {
      const csrfTokenHash = hashToken(generateToken());

      await expect(
        harness.runtime.authCsrfToken.create({
          data: {
            tokenHash: 'plain',
            origin: 'http://localhost:5173',
            expiresAt: new Date(Date.now() + HOUR),
          },
        }),
      ).rejects.toThrow();

      await expect(
        harness.runtime.authCsrfToken.create({
          data: { tokenHash: csrfTokenHash, origin: '   ', expiresAt: new Date(Date.now() + HOUR) },
        }),
      ).rejects.toThrow();

      await expect(
        harness.runtime.authCsrfToken.create({
          data: {
            tokenHash: hashToken(generateToken()),
            origin: 'http://localhost:5173',
            expiresAt: new Date(Date.now() - HOUR),
          },
        }),
      ).rejects.toThrow();
    });

    it('removes only rows that expired before the cut-off', async () => {
      // A row cannot be inserted already expired, because the table rejects a non-positive
      // lifetime, so the short-lived row is made stale with a future cut-off instead.
      const now = Date.now();
      await harness.csrfTokens.create({
        tokenHash: hashToken(generateToken()),
        origin: 'http://localhost:5173',
        expiresAt: new Date(now + 1000),
      });
      await harness.csrfTokens.create({
        tokenHash: hashToken(generateToken()),
        origin: 'http://localhost:5173',
        expiresAt: new Date(now + HOUR),
      });

      await expect(harness.csrfTokens.deleteExpiredBefore(new Date(now + 2000))).resolves.toBe(1);
      await expect(harness.runtime.authCsrfToken.count()).resolves.toBe(1);
    });
  });

  describe('security audit', () => {
    it('records a failed attempt without the identifier or any password material', async () => {
      const secretish = 'Wrong-guess-value-1234';
      await harness.audit.recordStandalone({
        action: 'LOGIN_FAILED',
        entityType: 'session',
        entityId: null,
        actorAdminId: null,
        reason: 'invalid_credentials',
        requestId: null,
        ipHash: 'fingerprint',
      });

      const events = await harness.runtime.auditEvent.findMany({
        where: { action: 'LOGIN_FAILED' },
      });

      expect(events).toHaveLength(1);
      expect(events[0]?.entityType).toBe('session');
      expect(JSON.stringify(events)).not.toContain(harness.admin.identifier);
      expect(JSON.stringify(events)).not.toContain(secretish);
    });

    it('refuses to mutate or delete an audit event', async () => {
      const event = await harness.audit.recordStandalone({
        action: 'LOGIN_FAILED',
        entityType: 'session',
        entityId: null,
        reason: 'invalid_credentials',
      });

      await expect(
        harness.migration.auditEvent.update({
          where: { id: event.id },
          data: { reason: 'rewritten' },
        }),
      ).rejects.toThrow();
      await expect(
        harness.migration.auditEvent.delete({ where: { id: event.id } }),
      ).rejects.toThrow();
    });
  });
});
