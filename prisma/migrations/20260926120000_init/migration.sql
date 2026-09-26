-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "IncomeType" AS ENUM ('MEMBER_CONTRIBUTION', 'OFFERING', 'DONATION', 'ANONYMOUS_DONATION');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('AVAILABLE', 'REMOVED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('TRANSACTION_CREATED', 'TRANSACTION_UPDATED', 'TRANSACTION_VOIDED', 'DOCUMENT_UPLOADED', 'DOCUMENT_REMOVED', 'MEMBER_CREATED', 'MEMBER_UPDATED', 'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'SETTING_UPDATED', 'LOGIN_SUCCEEDED', 'LOGIN_FAILED');

-- CreateTable
CREATE TABLE "admin_user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "display_name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(15),
    "notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_period" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID NOT NULL,
    "year" SMALLINT NOT NULL,
    "month" SMALLINT NOT NULL,
    "expected_paise" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contribution_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_category" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "normalized_name" VARCHAR(80) NOT NULL,
    "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transaction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference_id" VARCHAR(32) NOT NULL,
    "transaction_type" "TransactionType" NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'ACTIVE',
    "business_date" DATE NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "description" TEXT,
    "member_id" UUID,
    "contribution_period_id" UUID,
    "income_type" "IncomeType",
    "category_id" UUID,
    "notes" TEXT,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by_admin_id" UUID,
    "void_reason" TEXT,
    "created_by_admin_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "financial_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference_id" VARCHAR(32) NOT NULL,
    "transaction_id" UUID NOT NULL,
    "storage_key" VARCHAR(255) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "declared_mime_type" VARCHAR(128) NOT NULL,
    "detected_mime_type" VARCHAR(128) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "checksum_sha256" CHAR(64) NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'AVAILABLE',
    "storage_deleted_at" TIMESTAMPTZ(6),
    "uploaded_by_admin_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(6),
    "removed_by_admin_id" UUID,
    "removal_reason" TEXT,

    CONSTRAINT "transaction_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_admin_id" UUID,
    "action" "AuditAction" NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" UUID,
    "entity_reference" VARCHAR(32),
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "request_id" UUID,
    "ip_hash" VARCHAR(128),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_setting" (
    "key" VARCHAR(64) NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "id_sequence" (
    "scope" VARCHAR(32) NOT NULL,
    "last_value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "id_sequence_pkey" PRIMARY KEY ("scope")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_user_id" UUID NOT NULL,
    "endpoint" VARCHAR(255) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_reference_id_key" ON "member"("reference_id");

-- CreateIndex
CREATE INDEX "contribution_period_member_recent_idx" ON "contribution_period"("member_id", "year" DESC, "month" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "contribution_period_member_year_month_key" ON "contribution_period"("member_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "expense_category_normalized_name_key" ON "expense_category"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transaction_reference_id_key" ON "financial_transaction"("reference_id");

-- CreateIndex
CREATE INDEX "financial_transaction_status_business_date_idx" ON "financial_transaction"("status", "business_date");

-- CreateIndex
CREATE INDEX "financial_transaction_type_date_status_idx" ON "financial_transaction"("transaction_type", "business_date", "status");

-- CreateIndex
CREATE INDEX "financial_transaction_method_date_status_idx" ON "financial_transaction"("payment_method", "business_date", "status");

-- CreateIndex
CREATE INDEX "financial_transaction_member_date_status_idx" ON "financial_transaction"("member_id", "business_date", "status");

-- CreateIndex
CREATE INDEX "financial_transaction_category_date_status_idx" ON "financial_transaction"("category_id", "business_date", "status");

-- CreateIndex
CREATE INDEX "financial_transaction_income_date_status_idx" ON "financial_transaction"("income_type", "business_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_document_reference_id_key" ON "transaction_document"("reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_document_storage_key_key" ON "transaction_document"("storage_key");

-- CreateIndex
CREATE INDEX "transaction_document_transaction_status_idx" ON "transaction_document"("transaction_id", "status");

-- CreateIndex
CREATE INDEX "audit_event_occurred_at_idx" ON "audit_event"("occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_event_entity_idx" ON "audit_event"("entity_type", "entity_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "idempotency_record_expires_at_idx" ON "idempotency_record"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_admin_endpoint_key_key" ON "idempotency_record"("admin_user_id", "endpoint", "idempotency_key");

-- AddForeignKey
ALTER TABLE "contribution_period" ADD CONSTRAINT "contribution_period_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transaction" ADD CONSTRAINT "financial_transaction_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transaction" ADD CONSTRAINT "financial_transaction_contribution_period_id_fkey" FOREIGN KEY ("contribution_period_id") REFERENCES "contribution_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transaction" ADD CONSTRAINT "financial_transaction_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transaction" ADD CONSTRAINT "financial_transaction_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transaction" ADD CONSTRAINT "financial_transaction_voided_by_admin_id_fkey" FOREIGN KEY ("voided_by_admin_id") REFERENCES "admin_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_document" ADD CONSTRAINT "transaction_document_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "financial_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_document" ADD CONSTRAINT "transaction_document_uploaded_by_admin_id_fkey" FOREIGN KEY ("uploaded_by_admin_id") REFERENCES "admin_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_document" ADD CONSTRAINT "transaction_document_removed_by_admin_id_fkey" FOREIGN KEY ("removed_by_admin_id") REFERENCES "admin_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_admin_id_fkey" FOREIGN KEY ("actor_admin_id") REFERENCES "admin_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Reviewed constraint layer.
--
-- Prisma cannot express `CHECK` constraints, constraint triggers, expression
-- indexes, or role grants, so the invariants required by `docs/05-DATABASE-SPEC.md`
-- are added here. Every statement is additive and the migration remains applicable
-- to an empty database and reversible only through a forward corrective migration.
-- ---------------------------------------------------------------------------

-- Core data integrity -------------------------------------------------------------

ALTER TABLE "admin_user"
    ADD CONSTRAINT "admin_user_display_name_not_blank"
        CHECK (length(btrim("display_name")) > 0);

ALTER TABLE "member"
    ADD CONSTRAINT "member_name_not_blank"
        CHECK (length(btrim("name")) > 0),
    ADD CONSTRAINT "member_phone_digits"
        CHECK ("phone" IS NULL OR "phone" ~ '^[0-9]{7,15}$'),
    ADD CONSTRAINT "member_revision_positive"
        CHECK ("revision" >= 1);

-- Case-insensitive member search, as required by the database specification.
CREATE INDEX "member_lower_name_idx" ON "member" (lower("name"));

ALTER TABLE "contribution_period"
    ADD CONSTRAINT "contribution_period_expected_positive"
        CHECK ("expected_paise" > 0),
    ADD CONSTRAINT "contribution_period_month_range"
        CHECK ("month" BETWEEN 1 AND 12),
    ADD CONSTRAINT "contribution_period_year_range"
        CHECK ("year" BETWEEN 1970 AND 9999);

ALTER TABLE "expense_category"
    ADD CONSTRAINT "expense_category_name_not_blank"
        CHECK (length(btrim("name")) > 0),
    ADD CONSTRAINT "expense_category_normalized_name_not_blank"
        CHECK (length(btrim("normalized_name")) > 0),
    ADD CONSTRAINT "expense_category_normalized_name_is_normalized"
        CHECK ("normalized_name" = lower(btrim("normalized_name")));

ALTER TABLE "financial_transaction"
    ADD CONSTRAINT "financial_transaction_amount_positive"
        CHECK ("amount_paise" > 0),
    ADD CONSTRAINT "financial_transaction_income_shape"
        CHECK ("transaction_type" <> 'INCOME' OR ("income_type" IS NOT NULL AND "category_id" IS NULL)),
    ADD CONSTRAINT "financial_transaction_expense_shape"
        CHECK ("transaction_type" <> 'EXPENSE' OR ("category_id" IS NOT NULL AND "income_type" IS NULL AND "contribution_period_id" IS NULL)),
    ADD CONSTRAINT "financial_transaction_member_contribution_links"
        CHECK ("income_type" IS DISTINCT FROM 'MEMBER_CONTRIBUTION' OR ("member_id" IS NOT NULL AND "contribution_period_id" IS NOT NULL)),
    ADD CONSTRAINT "financial_transaction_offering_donation_no_period"
        CHECK ("income_type" IS NULL OR "income_type" NOT IN ('OFFERING', 'DONATION') OR "contribution_period_id" IS NULL),
    ADD CONSTRAINT "financial_transaction_anonymous_no_member"
        CHECK ("income_type" IS DISTINCT FROM 'ANONYMOUS_DONATION' OR ("member_id" IS NULL AND "contribution_period_id" IS NULL)),
    ADD CONSTRAINT "financial_transaction_anonymous_neutral_description"
        CHECK ("income_type" IS DISTINCT FROM 'ANONYMOUS_DONATION' OR "description" IS NULL OR btrim("description") = 'Anonymous Donation'),
    ADD CONSTRAINT "financial_transaction_void_metadata"
        CHECK (
            (
                "status" = 'ACTIVE'
                AND "voided_at" IS NULL
                AND "voided_by_admin_id" IS NULL
                AND "void_reason" IS NULL
            )
            OR
            (
                "status" = 'VOIDED'
                AND "voided_at" IS NOT NULL
                AND "voided_by_admin_id" IS NOT NULL
                AND length(coalesce(btrim("void_reason"), '')) > 0
            )
        ),
    ADD CONSTRAINT "financial_transaction_revision_positive"
        CHECK ("revision" >= 1),
    ADD CONSTRAINT "financial_transaction_business_date_bounded"
        CHECK ("business_date" >= DATE '1970-01-01' AND "business_date" <= DATE '9999-12-31');

ALTER TABLE "transaction_document"
    ADD CONSTRAINT "transaction_document_storage_key_not_blank"
        CHECK (length(btrim("storage_key")) > 0),
    ADD CONSTRAINT "transaction_document_original_filename_not_blank"
        CHECK (length(btrim("original_filename")) > 0),
    ADD CONSTRAINT "transaction_document_byte_size_positive"
        CHECK ("byte_size" > 0),
    ADD CONSTRAINT "transaction_document_checksum_format"
        CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "transaction_document_detected_type_allowed"
        CHECK ("detected_mime_type" IN ('image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf')),
    ADD CONSTRAINT "transaction_document_declared_type_allowed"
        CHECK ("declared_mime_type" IN ('image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf')),
    ADD CONSTRAINT "transaction_document_removal_state"
        CHECK (
            (
                "status" = 'AVAILABLE'
                AND "removed_at" IS NULL
                AND "removed_by_admin_id" IS NULL
                AND "removal_reason" IS NULL
                AND "storage_deleted_at" IS NULL
            )
            OR
            (
                "status" = 'REMOVED'
                AND "removed_at" IS NOT NULL
                AND "removed_by_admin_id" IS NOT NULL
                AND length(coalesce(btrim("removal_reason"), '')) > 0
            )
        );

ALTER TABLE "audit_event"
    ADD CONSTRAINT "audit_event_entity_type_not_blank"
        CHECK (length(btrim("entity_type")) > 0),
    ADD CONSTRAINT "audit_event_reason_not_blank"
        CHECK ("reason" IS NULL OR length(btrim("reason")) > 0);

ALTER TABLE "app_setting"
    ADD CONSTRAINT "app_setting_key_known"
        CHECK (
            "key" IN (
                'DEFAULT_MONTHLY_CONTRIBUTION_PAISE',
                'ENABLED_PAYMENT_METHODS',
                'CURRENCY',
                'BUSINESS_TIMEZONE'
            )
        ),
    ADD CONSTRAINT "app_setting_value_not_blank"
        CHECK (length(btrim("value")) > 0),
    ADD CONSTRAINT "app_setting_default_contribution_positive_paise"
        CHECK (
            "key" <> 'DEFAULT_MONTHLY_CONTRIBUTION_PAISE'
            OR ("value" ~ '^[0-9]+$' AND length("value") < 19 AND "value"::numeric > 0)
        ),
    ADD CONSTRAINT "app_setting_currency_fixed"
        CHECK ("key" <> 'CURRENCY' OR "value" = 'INR'),
    ADD CONSTRAINT "app_setting_business_timezone_fixed"
        CHECK ("key" <> 'BUSINESS_TIMEZONE' OR "value" = 'Asia/Kolkata'),
    ADD CONSTRAINT "app_setting_payment_methods_valid"
        CHECK (
            "key" <> 'ENABLED_PAYMENT_METHODS'
            OR "value" IN (
                'CASH',
                'UPI',
                'BANK_TRANSFER',
                'CASH,UPI',
                'CASH,BANK_TRANSFER',
                'UPI,BANK_TRANSFER',
                'CASH,UPI,BANK_TRANSFER'
            )
        );

ALTER TABLE "id_sequence"
    ADD CONSTRAINT "id_sequence_scope_known"
        CHECK ("scope" IN ('MEMBER', 'INCOME', 'EXPENSE', 'DOCUMENT')),
    ADD CONSTRAINT "id_sequence_last_value_non_negative"
        CHECK ("last_value" >= 0);

ALTER TABLE "idempotency_record"
    ADD CONSTRAINT "idempotency_record_key_not_blank"
        CHECK (length(btrim("idempotency_key")) > 0),
    ADD CONSTRAINT "idempotency_record_endpoint_not_blank"
        CHECK (length(btrim("endpoint")) > 0),
    ADD CONSTRAINT "idempotency_record_request_hash_format"
        CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "idempotency_record_response_status_range"
        CHECK ("response_status" BETWEEN 100 AND 599),
    ADD CONSTRAINT "idempotency_record_expiry_after_creation"
        CHECK ("expires_at" > "created_at");

-- Transaction edit and void guard -------------------------------------------------

-- Identity, reference, type, creator, and creation timestamp are immutable; every
-- update must advance the optimistic revision by exactly one; and a voided
-- transaction is a frozen historical record.
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
            OR NEW."member_id" IS DISTINCT FROM OLD."member_id"
            OR NEW."contribution_period_id" IS DISTINCT FROM OLD."contribution_period_id"
        ) THEN
        RAISE EXCEPTION 'HY_FIN_VOIDED_TRANSACTION_IMMUTABLE' USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER "financial_transaction_guard_update"
    BEFORE UPDATE ON "financial_transaction"
    FOR EACH ROW
    EXECUTE FUNCTION hy_financial_transaction_guard_update();

-- Cross-table rule that a row-level CHECK constraint cannot express: a
-- MEMBER_CONTRIBUTION transaction must reference a contribution period that belongs
-- to the same member and matches the transaction business date month and year.
CREATE OR REPLACE FUNCTION hy_financial_transaction_check_contribution_period()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    period_member uuid;
    period_year  smallint;
    period_month smallint;
BEGIN
    IF NEW."income_type" = 'MEMBER_CONTRIBUTION' THEN
        SELECT "member_id", "year", "month"
          INTO period_member, period_year, period_month
          FROM "contribution_period"
         WHERE "id" = NEW."contribution_period_id";

        IF period_member IS NULL THEN
            RAISE EXCEPTION 'HY_FIN_CONTRIBUTION_PERIOD_NOT_FOUND' USING ERRCODE = '23503';
        END IF;

        IF period_member IS DISTINCT FROM NEW."member_id" THEN
            RAISE EXCEPTION 'HY_FIN_CONTRIBUTION_PERIOD_MEMBER_MISMATCH' USING ERRCODE = '23514';
        END IF;

        IF period_year IS DISTINCT FROM EXTRACT(YEAR FROM NEW."business_date")::smallint
            OR period_month IS DISTINCT FROM EXTRACT(MONTH FROM NEW."business_date")::smallint THEN
            RAISE EXCEPTION 'HY_FIN_CONTRIBUTION_PERIOD_DATE_MISMATCH' USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "financial_transaction_contribution_period_link"
    AFTER INSERT OR UPDATE ON "financial_transaction"
    DEFERRABLE INITIALLY IMMEDIATE
    FOR EACH ROW
    EXECUTE FUNCTION hy_financial_transaction_check_contribution_period();

-- Append-only audit history ------------------------------------------------------

CREATE OR REPLACE FUNCTION hy_audit_event_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'HY_AUDIT_EVENT_APPEND_ONLY' USING ERRCODE = '42501';
END;
$function$;

CREATE TRIGGER "audit_event_append_only"
    BEFORE UPDATE OR DELETE ON "audit_event"
    FOR EACH ROW
    EXECUTE FUNCTION hy_audit_event_append_only();

