-- Phase 13: freeze the vendor of a voided transaction.
--
-- `REQ-EXP-006` adds `vendor` as free text beside `description` and `notes`, and
-- `docs/05-DATABASE-SPEC.md` treats it as an ordinary correctable field while the row is
-- `ACTIVE`. Once a row is `VOIDED` it is preserved evidence of what happened, so its vendor
-- freezes with every other descriptive field.
--
-- The application already refuses to edit a voided row (`409 CONFLICT`), but that check is a
-- read-then-write and the reason this trigger exists is the window between them: a correction
-- that read an `ACTIVE` row, lost the race to a void, and then wrote would otherwise be able to
-- rewrite the vendor of a just-voided expense while `description` and `notes` were refused. The
-- freeze list is the database-side guard for exactly that race, so the new column belongs in it.
--
-- The body is a verbatim copy of the definition applied by `20261005120000_expense_reason`,
-- with one clause added. PostgreSQL has no `ALTER FUNCTION` for a body, so the reviewed pattern
-- in this repository is `CREATE OR REPLACE` of the same signature.

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
            OR NEW."vendor" IS DISTINCT FROM OLD."vendor"
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
