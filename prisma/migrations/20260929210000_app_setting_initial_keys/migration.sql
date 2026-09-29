-- Phase 05 required application settings.
--
-- Authority: `docs/05-DATABASE-SPEC.md` states that "The initial key set is
-- `DEFAULT_MONTHLY_CONTRIBUTION_PAISE`, `ENABLED_PAYMENT_METHODS`, `CURRENCY`, and
-- `BUSINESS_TIMEZONE`" and documents each value's validation. The same document owns
-- `app_setting` as a table, so the initial key set is part of the database's required
-- content rather than optional demo data owned by `docs/13-DEMO-DATA-SPEC.md`.
--
-- Why this is needed: the application reads `DEFAULT_MONTHLY_CONTRIBUTION_PAISE` to
-- derive the expected amount of a member's monthly contribution, and reads
-- `ENABLED_PAYMENT_METHODS` to decide which payment methods a new transaction may use.
-- `IncomeService.defaultMonthlyContributionPaise` deliberately treats a missing row as a
-- server fault rather than falling back to a hard-coded amount, because a silent fallback
-- would let two environments disagree about what a member owes. That decision is only
-- safe if the rows exist in every environment, so they are created here rather than being
-- left to a seed command: an environment that was migrated but not seeded could otherwise
-- record no income at all and report it as a missing record.
--
-- Values are the documented defaults and satisfy the `app_setting_*` check constraints
-- created in the initial migration: ₹500.00 expressed as the positive integer paise
-- count `50000`, all three validated payment methods, the fixed `INR` currency, and the
-- fixed `Asia/Kolkata` business timezone.
--
-- Additive and forward-only: no table, column, or constraint is changed, and no financial
-- record is touched. `ON CONFLICT DO NOTHING` inserts only the keys that are absent, so
-- applying this migration to an environment that was already seeded keeps the values the
-- seed or an Admin configured instead of resetting them. The runtime role needs no new
-- grants: it already has `SELECT` on `app_setting` from the initial migration, and these
-- rows are written by the migration role, not by the application.

-- CreateData --------------------------------------------------------------------

INSERT INTO "app_setting" ("key", "value")
VALUES
    ('DEFAULT_MONTHLY_CONTRIBUTION_PAISE', '50000'),
    ('ENABLED_PAYMENT_METHODS', 'CASH,UPI,BANK_TRANSFER'),
    ('CURRENCY', 'INR'),
    ('BUSINESS_TIMEZONE', 'Asia/Kolkata')
ON CONFLICT ("key") DO NOTHING;
