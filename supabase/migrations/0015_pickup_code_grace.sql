-- ==============================================================================
-- 0015_pickup_code_grace.sql: Limit previous pickup code to 10-second grace
-- ==============================================================================
-- Updates internal_get_pickup_code:
-- 1. NULL-safe offset check: only 0 (current) and -1 (previous) are accepted.
--    Any NULL or offset outside (0, -1) immediately returns NULL.
-- 2. Single epoch read: computes v_epoch once from clock_timestamp() and derives
--    both v_window (v_epoch / 60) and v_second_in_window (v_epoch % 60) from that value.
-- 3. 10-second grace window: offset -1 is valid strictly during seconds 0..9 of the
--    new window. If v_second_in_window >= 10, offset -1 returns NULL.
-- 4. Permissions: revoked from PUBLIC, anon, authenticated, and service_role.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.internal_get_pickup_code(p_order_id uuid, p_window_offset integer DEFAULT 0)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_epoch bigint;
  v_window bigint;
  v_second_in_window integer;
  v_raw_hash bytea;
  v_num bigint;
BEGIN
  -- 1. NULL-safe offset check: only 0 (current) and -1 (previous) are supported
  IF p_window_offset IS NULL OR p_window_offset NOT IN (0, -1) THEN
    RETURN NULL;
  END IF;

  -- 2. Compute v_epoch once and derive BOTH window number and second-in-window
  v_epoch := floor(extract(epoch from clock_timestamp()))::bigint;
  v_window := v_epoch / 60;
  v_second_in_window := (v_epoch % 60)::integer;

  -- 3. 10-second grace window rule for previous window (offset -1)
  -- Previous window code is strictly valid ONLY during the first 10 seconds of the new window (0..9s)
  IF p_window_offset = -1 AND v_second_in_window >= 10 THEN
    RETURN NULL;
  END IF;

  -- 4. Lookup cryptographic secret
  SELECT secret INTO v_secret
  FROM public.order_pickup_secrets
  WHERE order_id = p_order_id;

  IF v_secret IS NULL THEN
    RETURN NULL;
  END IF;

  -- 5. Calculate TOTP code for the target window
  v_raw_hash := public.pickup_hmac(v_secret, 'totp:' || (v_window + p_window_offset)::text);
  v_num := (('x' || substr(encode(v_raw_hash, 'hex'), 1, 8))::bit(32)::bigint) & 2147483647;
  RETURN lpad((v_num % 1000000)::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.internal_get_pickup_code(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
