-- Migration: 0016_protect_pickup_token.sql
-- Description: Revoke table-level SELECT on public.orders from authenticated and anon,
--              and grant column-level SELECT on every column EXCEPT pickup_token to authenticated.
--
-- Security Rationale:
-- has_column_privilege('authenticated', 'public.orders', 'pickup_token', 'select') was true
-- because authenticated had table-level SELECT on public.orders. This migration revokes table-level SELECT
-- and dynamically grants SELECT on all non-token columns of public.orders to authenticated.
-- The service_role retains full table privileges.
--
-- Notice for future migrations:
-- Any new column added to public.orders in future migrations will NOT be automatically readable by authenticated.
-- Future migrations that add columns to public.orders MUST include an explicit:
--   GRANT SELECT (<new_column>) ON public.orders TO authenticated;
--
-- ROLLBACK STATEMENTS:
-- To revert this migration and restore table-level SELECT on public.orders:
--   REVOKE SELECT ON TABLE public.orders FROM authenticated;
--   GRANT SELECT ON TABLE public.orders TO authenticated;
--   GRANT SELECT ON TABLE public.orders TO anon;
--   NOTIFY pgrst, 'reload schema';

-- 1. Revoke table-level SELECT from authenticated and anon
REVOKE SELECT ON TABLE public.orders FROM authenticated, anon;

-- 2. Dynamically grant column-level SELECT on all columns EXCEPT pickup_token to authenticated
DO $$
DECLARE
  v_col text;
  v_cols text[] := '{}';
  v_sql text;
BEGIN
  FOR v_col IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name != 'pickup_token'
    ORDER BY ordinal_position
  LOOP
    v_cols := array_append(v_cols, quote_ident(v_col));
  END LOOP;

  IF array_length(v_cols, 1) > 0 THEN
    v_sql := format(
      'GRANT SELECT (%s) ON TABLE public.orders TO authenticated;',
      array_to_string(v_cols, ', ')
    );
    EXECUTE v_sql;
  END IF;
END $$;

-- 3. Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
