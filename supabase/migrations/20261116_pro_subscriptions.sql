-- Monthly $5.00 USD subscription passes for CourtVision PRO (unlocks props >= 68% confidence)

CREATE TABLE IF NOT EXISTS public.pro_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  access_code text NOT NULL UNIQUE,
  provider text NOT NULL DEFAULT 'lemonsqueezy' CHECK (provider IN ('stripe', 'lemonsqueezy', 'mercadopago', 'yape_plin', 'demo')),
  amount_usd numeric(6, 2) NOT NULL DEFAULT 5.00,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pro_subscriptions_email_lower
  ON public.pro_subscriptions (lower(email));

CREATE INDEX IF NOT EXISTS idx_pro_subscriptions_expires_at
  ON public.pro_subscriptions (expires_at DESC);

ALTER TABLE public.pro_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pro_subscriptions_select_active" ON public.pro_subscriptions;
CREATE POLICY "pro_subscriptions_select_active"
  ON public.pro_subscriptions
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "pro_subscriptions_insert_pass" ON public.pro_subscriptions;
CREATE POLICY "pro_subscriptions_insert_pass"
  ON public.pro_subscriptions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (amount_usd = 5.00 AND status = 'active');

GRANT SELECT, INSERT ON public.pro_subscriptions TO anon, authenticated;

ALTER TABLE public.pro_subscriptions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pro_subscriptions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pro_subscriptions;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
