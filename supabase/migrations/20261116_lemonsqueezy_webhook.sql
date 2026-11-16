-- Harden pro_subscriptions for verified Lemon Squeezy webhook fulfillment (no client-side fake inserts)

ALTER TABLE public.pro_subscriptions
  ADD COLUMN IF NOT EXISTS external_subscription_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS external_order_id text,
  ADD COLUMN IF NOT EXISTS customer_id text,
  ADD COLUMN IF NOT EXISTS variant_id text,
  ADD COLUMN IF NOT EXISTS test_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_pro_subscriptions_external_order
  ON public.pro_subscriptions (external_order_id);

-- Lock down direct client table access via RLS (only service_role webhook writes; RPC reads exact pass)
ALTER POLICY "pro_subscriptions_insert_pass"
  ON public.pro_subscriptions
  WITH CHECK (false);

ALTER POLICY "pro_subscriptions_select_active"
  ON public.pro_subscriptions
  USING (false);

-- Safe RPC for checking a single user's active pass by exact email or access_code
CREATE OR REPLACE FUNCTION public.check_pro_access(p_lookup text)
RETURNS TABLE (
  email text,
  access_code text,
  provider text,
  amount_usd numeric,
  starts_at timestamptz,
  expires_at timestamptz,
  test_mode boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    ps.email,
    ps.access_code,
    ps.provider,
    ps.amount_usd,
    ps.starts_at,
    ps.expires_at,
    ps.test_mode
  FROM public.pro_subscriptions ps
  WHERE ps.status = 'active'
    AND ps.expires_at > now()
    AND (
      lower(ps.email) = lower(trim(p_lookup))
      OR upper(ps.access_code) = upper(trim(p_lookup))
    )
  ORDER BY ps.expires_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.check_pro_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_pro_access(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
