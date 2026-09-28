-- Admin authentication: credentials, revocable sessions, and pre-authentication CSRF.
--
-- Authority: `docs/05-DATABASE-SPEC.md` ("Admin accounts, sessions, and CSRF"),
-- `docs/07-SECURITY-RULES.md` (Argon2id, revocable server-side sessions stored as
-- hashes, CSRF on every state-changing request including login), and
-- `docs/02-ARCHITECTURE.md` (opaque server-side session, no browser token storage).
--
-- Additive and forward-only. The existing `admin_user` rows are backfilled with the
-- documented `!`-prefixed unusable-credential sentinel, so an existing fictional demo
-- database keeps its financial actor rows while gaining no usable credential. Only
-- `npm run admin:bootstrap` replaces the sentinel with a real Argon2id hash.
--
-- The backfill also tolerates a database that already holds more than one Admin row, which
-- a test or an interrupted experiment can leave behind: the oldest row takes the
-- documented identifier `admin` and every other row a deterministic, non-secret
-- `admin-legacy-<id prefix>` placeholder. All of them receive the sentinel, so no extra
-- row becomes a usable credential, and the unique constraint can be created either way.
--
-- The runtime role needs no new grants: `20260926140000_runtime_role_grants` set
-- default privileges for the migration role, so tables created here inherit
-- `SELECT, INSERT, UPDATE, DELETE`. These tables are not append-only history, so the
-- runtime role may update a session row to revoke it or rotate its CSRF secret.

-- CreateEnum ---------------------------------------------------------------------

-- `docs/05-DATABASE-SPEC.md` documents the `audit_action` list as extensible; Phase 03
-- adds the logout event required by `REQ-AUTH-005`. PostgreSQL 12+ allows adding a
-- value inside a transaction as long as the value is not used in the same transaction.
ALTER TYPE "AuditAction" ADD VALUE 'LOGOUT';

-- AlterTable ---------------------------------------------------------------------

ALTER TABLE "admin_user"
    ADD COLUMN "identifier" VARCHAR(64),
    ADD COLUMN "password_hash" TEXT,
    ADD COLUMN "last_login_at" TIMESTAMPTZ(6);

-- The demo has one Admin, so the common backfill is deterministic. A database holding
-- more than one row — a leftover test row, for example — must still migrate, so any row
-- after the first gets a distinct deterministic placeholder derived from its own id. The
-- sentinel means "actor row exists, no password provisioned": verification can never
-- succeed against any of them.
WITH "ordered_admin" AS (
    SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS "position"
    FROM "admin_user"
)
UPDATE "admin_user" AS "target"
SET "identifier" = CASE
                       WHEN "ordered_admin"."position" = 1 THEN 'admin'
                       ELSE 'admin-legacy-' || left(replace("target"."id"::text, '-', ''), 12)
                   END,
    "password_hash" = '!unprovisioned'
FROM "ordered_admin"
WHERE "ordered_admin"."id" = "target"."id"
  AND "target"."identifier" IS NULL;

ALTER TABLE "admin_user"
    ALTER COLUMN "identifier" SET NOT NULL,
    ALTER COLUMN "password_hash" SET NOT NULL;

-- CreateTable --------------------------------------------------------------------

CREATE TABLE "admin_session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_token_hash" CHAR(64) NOT NULL,
    "ip_hash" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(32),

    CONSTRAINT "admin_session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_csrf_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" CHAR(64) NOT NULL,
    "origin" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_csrf_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex --------------------------------------------------------------------

CREATE UNIQUE INDEX "admin_user_identifier_key" ON "admin_user"("identifier");

CREATE UNIQUE INDEX "admin_session_token_hash_key" ON "admin_session"("token_hash");

CREATE INDEX "admin_session_admin_user_idx" ON "admin_session"("admin_user_id");

CREATE INDEX "admin_session_expires_at_idx" ON "admin_session"("expires_at");

CREATE UNIQUE INDEX "auth_csrf_token_token_hash_key" ON "auth_csrf_token"("token_hash");

CREATE INDEX "auth_csrf_token_expires_at_idx" ON "auth_csrf_token"("expires_at");

-- AddForeignKey ------------------------------------------------------------------

-- Sessions are ephemeral, not history: removing the Admin removes its sessions. The
-- append-only `audit_event` rows and financial records keep the actor reference and
-- still restrict deleting an Admin who owns transactions.
ALTER TABLE "admin_session"
    ADD CONSTRAINT "admin_session_admin_user_id_fkey"
        FOREIGN KEY ("admin_user_id") REFERENCES "admin_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reviewed constraint layer ------------------------------------------------------

-- Credentials --------------------------------------------------------------------

-- The login identifier is compared case-insensitively, so the stored value must already
-- be lower-cased; a row that stores `Admin` can never match a normalized lookup.
ALTER TABLE "admin_user"
    ADD CONSTRAINT "admin_user_identifier_normalized"
        CHECK ("identifier" = lower("identifier") AND length("identifier") BETWEEN 1 AND 64);

-- An Argon2id PHC string, or the `!`-prefixed unusable-credential sentinel. The length
-- bound keeps a malformed or unbounded value out of the column.
ALTER TABLE "admin_user"
    ADD CONSTRAINT "admin_user_password_hash_shape"
        CHECK (char_length("password_hash") BETWEEN 1 AND 512);

-- Sessions -----------------------------------------------------------------------

ALTER TABLE "admin_session"
    ADD CONSTRAINT "admin_session_token_hash_shape"
        CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "admin_session_csrf_token_hash_shape"
        CHECK ("csrf_token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "admin_session_expiry_after_creation"
        CHECK ("expires_at" > "created_at"),
    ADD CONSTRAINT "admin_session_revocation_is_complete"
        CHECK (("revoked_at" IS NULL) = ("revoked_reason" IS NULL)),
    ADD CONSTRAINT "admin_session_revoked_reason_allowed"
        CHECK ("revoked_reason" IS NULL OR "revoked_reason" IN ('LOGOUT', 'EXPIRED', 'REPLACED'));

-- Pre-authentication CSRF ---------------------------------------------------------

ALTER TABLE "auth_csrf_token"
    ADD CONSTRAINT "auth_csrf_token_hash_shape"
        CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "auth_csrf_token_origin_not_blank"
        CHECK (length(btrim("origin")) > 0),
    ADD CONSTRAINT "auth_csrf_token_expiry_after_creation"
        CHECK ("expires_at" > "created_at");
