-- Runtime-role grants (least privilege).
--
-- Authority: `docs/05-DATABASE-SPEC.md` ("Application roles have no update or delete
-- permission for audit events") and `docs/07-SECURITY-RULES.md`.
--
-- Why this is a migration and not only a provisioning step: `prisma migrate reset`,
-- `migrate dev`, and a recreated database all drop grants that were issued outside
-- the migration history. A development database could therefore silently lose its
-- runtime privileges while every migration still reported success. Owning the grants
-- in a reviewed migration makes the runtime role correct by construction on every
-- disposable database.
--
-- Scope: this migration grants object privileges only. Role creation, database
-- creation, `CONNECT`, and revoking `public` from `PUBLIC` stay with the platform
-- provisioning (`scripts/local-postgres.mjs`, `docker/postgres/init/001-app-role.sh`),
-- because those are instance-level decisions rather than schema facts.
--
-- Both blocks are no-ops when the runtime role does not exist, so an environment that
-- provisions a differently named role can still apply this migration.

DO $do$
DECLARE
  runtime_role CONSTANT text := 'hyssop_app';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
    RAISE NOTICE 'Runtime role % does not exist here; skipping runtime grants.', runtime_role;
    RETURN;
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', runtime_role);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', runtime_role);

  -- Audit history is append-only for the runtime role. The `audit_event_append_only`
  -- trigger rejects mutation for every other role as a second, independent guard.
  IF to_regclass('public.audit_event') IS NOT NULL THEN
    EXECUTE format('REVOKE UPDATE, DELETE ON TABLE public.audit_event FROM %I', runtime_role);
  END IF;
END
$do$;

-- Keep later migrations working without re-running this grant step: objects created by
-- the migration role afterwards inherit the same runtime privileges. A future migration
-- that creates a new append-only table must re-apply its own `REVOKE`, and
-- `apps/api/test/database/schema-invariants.db-spec.ts` fails if the audit append-only
-- privilege is ever restored.
DO $do$
DECLARE
  runtime_role CONSTANT text := 'hyssop_app';
  migrator_role CONSTANT text := 'hyssop_migrator';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
    RETURN;
  END IF;

  IF current_user <> migrator_role AND NOT pg_has_role(current_user, migrator_role, 'USAGE') THEN
    RAISE NOTICE 'Current role % cannot set default privileges for %; skipping.', current_user, migrator_role;
    RETURN;
  END IF;

  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    migrator_role,
    runtime_role
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
    migrator_role,
    runtime_role
  );
END
$do$;
