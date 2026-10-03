-- Widen `audit_event.entity_reference` so it can hold every value the application records.
--
-- Authority: `docs/05-DATABASE-SPEC.md` "Audit events" describes `entity_reference` as a
-- nullable VARCHAR that names the affected entity by its reference ID, and
-- `docs/phases/PHASE-10-AUDIT-SETTINGS.md` requires the Audit History interface to show the
-- entity reference. The column was created as VARCHAR(32) in `20260926120000_init`, which is
-- wide enough for the human reference IDs (`HY-MEM-0001`, `HY-INC-000001`) but not for a
-- setting key: `app_setting.key` is VARCHAR(64), and `DEFAULT_MONTHLY_CONTRIBUTION_PAISE` is
-- 34 characters. The Settings domain records the changed key as the entity reference, and with
-- a 32-character column that audit event could not be written at all, so a settings change
-- could not be persisted (the audit insert and the settings write share one transaction).
--
-- 64 matches `AppSetting.key`, so every key the application can store can also be referenced in
-- an audit row. The change is additive and forward-only: widening a VARCHAR never truncates or
-- rewrites existing rows, and the column stays nullable. No table, constraint, index, or
-- financial record is touched, and no new grant is required.

ALTER TABLE "audit_event" ALTER COLUMN "entity_reference" TYPE VARCHAR(64);
