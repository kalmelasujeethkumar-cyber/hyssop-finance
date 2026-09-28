-- Phase 04 contribution-period audit action.
--
-- Authority: `docs/05-DATABASE-SPEC.md` documents `audit_action` as "an extensible,
-- versioned list of documented action codes", and `docs/phases/PHASE-04-MEMBERS.md`
-- requires that a change affecting contribution derivation be recorded and documented.
--
-- Why this is needed: a member's expected amount for a month decides whether that month
-- is PAID, PARTIALLY PAID, or NOT PAID. Changing it therefore changes a reported financial
-- status, so it belongs in the same append-only history as a member edit. Without this
-- value the only way to record the change would be to reuse `MEMBER_UPDATED`, which would
-- record it against the wrong entity and make the audit trail misleading.
--
-- Additive and forward-only: no table, column, constraint, or row changes, so no
-- existing financial record is touched and the append-only guarantee of `audit_event` is
-- unaffected. The runtime role needs no new grants, because no object is created here.
--
-- PostgreSQL 12+ allows adding an enum value inside a transaction as long as the value is
-- not used in the same transaction. This migration only adds it, and the application
-- starts using it after the migration is applied.

-- CreateEnum ---------------------------------------------------------------------

ALTER TYPE "AuditAction" ADD VALUE 'CONTRIBUTION_PERIOD_SET';
