-- =============================================================================
-- Migration 0016: Add NO_SHOW to order_status enum
-- Target Database: PostgreSQL 15+ (Supabase)
-- 
-- PostgreSQL restriction: A newly added enum value cannot be referenced in 
-- statements within the same transaction. This migration must execute and commit
-- independently before migration 0017 is applied.
-- =============================================================================

ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'NO_SHOW';

NOTIFY pgrst, 'reload schema';
