-- Phase 13: Add optional vendor to expense transactions
ALTER TABLE ""financial_transaction""
  ADD COLUMN ""vendor"" TEXT;

-- NOTE: No backfill, no default, no index. Vendor does not participate in monetary aggregates.
