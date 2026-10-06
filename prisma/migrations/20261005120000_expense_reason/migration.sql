-- ExpenseReason ---------------------------------------------------------------------------------
--
-- `REQ-EXP-005`: every expense names one reason from its own category. This migration is
-- additive in four ordered steps and is safe to apply to a database that already holds data:
--
--   1. create the enum and the table, with the per-category uniqueness the approved predefined
--      set requires (the same `Other` word legitimately exists under many categories);
--   2. add the nullable column, so no existing row is invalid for one instant;
--   3. backfill each existing expense to the `Other` reason of *its own* category;
--   4. only then tighten `financial_transaction_expense_shape` to require the reason.
--
-- No amount, payment method, business date, status, revision, or reference is read or written by
-- this migration.
--
-- The `financial_transaction_guard_update` trigger requires *every* update to advance `revision`
-- by exactly one, which is correct for an Admin edit and wrong for a schema migration: honouring
-- it here would invent thousands of revision bumps that no Admin performed and that no
-- `TRANSACTION_UPDATED` event explains. The trigger is therefore disabled for the one backfill
-- statement and re-enabled in the same transaction, so the guard is never absent for an
-- application write.
--
-- No `audit_event` row is written. A migration is not an Admin action, and inventing
-- `TRANSACTION_UPDATED` events that no Admin performed would make the audit trail claim something
-- untrue; the reason of each historical expense is already visible on the expense itself.

-- CreateEnum
CREATE TYPE "ExpenseReasonStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- Audit actions ------------------------------------------------------------------------------
--
-- Authority: `docs/05-DATABASE-SPEC.md` documents `audit_event.action` as an extensible,
-- versioned list of documented action codes, and `docs/01-REQUIREMENTS.md` requires a reason
-- rename or status change to be attributable.
--
-- Why this is needed: creating or renaming an expense reason changes what future expenses can say
-- about themselves, so it belongs in the same append-only history as a category change. Reusing
-- `TRANSACTION_UPDATED` would record the change against the wrong entity type and make the trail
-- misleading; a category action would be equally wrong, because the entity is a reason.
--
-- PostgreSQL 12+ allows adding an enum value inside a transaction as long as that value is not
-- used in the same transaction. This migration only adds them, and the application starts writing
-- them after the migration is applied. No `audit_event` row is written here: a migration is not an
-- Admin action.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REASON_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REASON_UPDATED';

-- CreateTable
CREATE TABLE "expense_reason" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "normalized_name" VARCHAR(80) NOT NULL,
    "status" "ExpenseReasonStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_reason_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "expense_reason"
    ADD CONSTRAINT "expense_reason_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expense_reason"
    ADD CONSTRAINT "expense_reason_name_not_blank"
        CHECK (length(btrim("name")) > 0),
    ADD CONSTRAINT "expense_reason_normalized_name_not_blank"
        CHECK (length(btrim("normalized_name")) > 0),
    ADD CONSTRAINT "expense_reason_normalized_name_is_normalized"
        CHECK ("normalized_name" = lower(btrim("normalized_name")));

-- Uniqueness is per category, not global: the approved predefined set repeats `Other`,
-- `Electrical Repair`, `Plumbing Work`, and `Drink[ing] Water` across categories by design.
CREATE UNIQUE INDEX "expense_reason_category_normalized_name_key" ON "expense_reason"("category_id", "normalized_name");

CREATE INDEX "expense_reason_category_status_idx" ON "expense_reason"("category_id", "status");

-- Step 2: the nullable column. Nullable only for the backfill window that follows.
ALTER TABLE "financial_transaction" ADD COLUMN "expense_reason_id" UUID;

ALTER TABLE "financial_transaction"
    ADD CONSTRAINT "financial_transaction_expense_reason_id_fkey" FOREIGN KEY ("expense_reason_id") REFERENCES "expense_reason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "financial_transaction_reason_date_status_idx" ON "financial_transaction"("expense_reason_id", "business_date", "status");

-- Step 3: the backfill.
--
-- The `Other` reason is created per category that needs one, so an expense is always pointed at a
-- reason that belongs to its own category and the per-category constraint is satisfiable. The
-- fallback category name is the same normalized form the application uses, so the row created here
-- is indistinguishable from one the application would have created.
--
-- `ON CONFLICT DO NOTHING` keeps the whole step idempotent: re-running this file against a
-- database that already has the reasons adds nothing rather than failing.
INSERT INTO "expense_reason" ("category_id", "name", "normalized_name", "is_system")
SELECT
    c."id",
    'Other',
    'other',
    true
FROM "expense_category" c
WHERE EXISTS (
    SELECT 1
    FROM "financial_transaction" t
    WHERE t."category_id" = c."id"
      AND t."expense_reason_id" IS NULL
)
ON CONFLICT ("category_id", "normalized_name") DO NOTHING;

-- The trigger guard is suspended for this statement only. `hy_financial_transaction_guard_update`
-- requires every update to advance `revision` by exactly one, which is correct for an Admin edit
-- and wrong for a schema migration that must not invent 1,001 audit revisions. Disabling and
-- re-enabling happen inside this single transaction, so no application write can ever run while
-- the guard is off.
ALTER TABLE "financial_transaction" DISABLE TRIGGER "financial_transaction_guard_update";

UPDATE "financial_transaction" t
SET "expense_reason_id" = r."id"
FROM "expense_reason" r
WHERE r."category_id" = t."category_id"
  AND r."normalized_name" = 'other'
  AND t."transaction_type" = 'EXPENSE'
  AND t."expense_reason_id" IS NULL;

ALTER TABLE "financial_transaction" ENABLE TRIGGER "financial_transaction_guard_update";

-- The verified precondition for the constraint below. It raises rather than silently succeeding,
-- so a database where some expense could not be backfilled stops here instead of being locked
-- into an inconsistent schema.
DO $verify$
DECLARE
    unmapped bigint;
BEGIN
    SELECT count(*) INTO unmapped
    FROM "financial_transaction"
    WHERE "transaction_type" = 'EXPENSE'
      AND "expense_reason_id" IS NULL;

    IF unmapped > 0 THEN
        RAISE EXCEPTION 'HY_EXP_REASON_BACKFILL_INCOMPLETE: % expense row(s) still have no reason', unmapped;
    END IF;
END;
$verify$;

-- Step 4: the integrity rule, applied only after the backfill is proven complete.
--
-- `DROP CONSTRAINT` + `ADD CONSTRAINT` is required rather than `ALTER ... ADD`, because PostgreSQL
-- has no `ALTER CONSTRAINT`. The replacement keeps every clause of the original rule and adds the
-- reason requirement, so a row that satisfied the old shape and lacks a reason becomes invalid
-- rather than silently acceptable.
ALTER TABLE "financial_transaction"
    DROP CONSTRAINT "financial_transaction_expense_shape";

ALTER TABLE "financial_transaction"
    ADD CONSTRAINT "financial_transaction_expense_shape"
        CHECK (
            "transaction_type" <> 'EXPENSE'
            OR (
                "category_id" IS NOT NULL
                AND "expense_reason_id" IS NOT NULL
                AND "income_type" IS NULL
                AND "contribution_period_id" IS NULL
            )
        );

-- The mirror rule on income: a reason is an expense concept, so an income row may never carry one.
-- Without it, nothing stops an income row from acquiring a reason that belongs to some category.
ALTER TABLE "financial_transaction"
    ADD CONSTRAINT "financial_transaction_income_no_reason"
        CHECK ("transaction_type" <> 'INCOME' OR "expense_reason_id" IS NULL);

-- A cross-table rule a row-level CHECK cannot express: the reason must belong to the *same*
-- category the expense was filed under. A row-level constraint can see both foreign keys but not
-- the reason's own `category_id`, so the pairing is enforced by a trigger instead — the same
-- technique the existing contribution-period rule uses.
CREATE OR REPLACE FUNCTION hy_financial_transaction_check_expense_reason()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    reason_category uuid;
BEGIN
    IF NEW."transaction_type" <> 'EXPENSE' OR NEW."expense_reason_id" IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT "category_id" INTO reason_category
    FROM "expense_reason"
    WHERE "id" = NEW."expense_reason_id";

    IF reason_category IS DISTINCT FROM NEW."category_id" THEN
        RAISE EXCEPTION 'HY_EXP_REASON_CATEGORY_MISMATCH' USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER "financial_transaction_check_expense_reason"
    BEFORE INSERT OR UPDATE ON "financial_transaction"
    FOR EACH ROW
    EXECUTE FUNCTION hy_financial_transaction_check_expense_reason();

-- The void guard must treat the reason as a frozen field, exactly as it already freezes the
-- category. Without this, a voided expense's reason could still be rewritten, which would change
-- what a preserved historical record says it was for.
CREATE OR REPLACE FUNCTION hy_financial_transaction_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."reference_id" IS DISTINCT FROM OLD."reference_id"
        OR NEW."transaction_type" IS DISTINCT FROM OLD."transaction_type"
        OR NEW."created_by_admin_id" IS DISTINCT FROM OLD."created_by_admin_id"
        OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'HY_FIN_IMMUTABLE_TRANSACTION_FIELDS' USING ERRCODE = '23514';
    END IF;

    IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
        RAISE EXCEPTION 'HY_FIN_REVISION_MUST_INCREMENT' USING ERRCODE = '23514';
    END IF;

    IF OLD."status" = 'VOIDED'
        AND (
            NEW."status" IS DISTINCT FROM OLD."status"
            OR NEW."voided_at" IS DISTINCT FROM OLD."voided_at"
            OR NEW."voided_by_admin_id" IS DISTINCT FROM OLD."voided_by_admin_id"
            OR NEW."void_reason" IS DISTINCT FROM OLD."void_reason"
            OR NEW."amount_paise" IS DISTINCT FROM OLD."amount_paise"
            OR NEW."payment_method" IS DISTINCT FROM OLD."payment_method"
            OR NEW."business_date" IS DISTINCT FROM OLD."business_date"
            OR NEW."occurred_at" IS DISTINCT FROM OLD."occurred_at"
            OR NEW."description" IS DISTINCT FROM OLD."description"
            OR NEW."notes" IS DISTINCT FROM OLD."notes"
            OR NEW."income_type" IS DISTINCT FROM OLD."income_type"
            OR NEW."category_id" IS DISTINCT FROM OLD."category_id"
            OR NEW."expense_reason_id" IS DISTINCT FROM OLD."expense_reason_id"
            OR NEW."member_id" IS DISTINCT FROM OLD."member_id"
            OR NEW."contribution_period_id" IS DISTINCT FROM OLD."contribution_period_id"
        ) THEN
        RAISE EXCEPTION 'HY_FIN_VOIDED_TRANSACTION_IMMUTABLE' USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;