-- Support Yape/Plin S/ 19 activation requests and CVPRO pass management

ALTER TABLE public.pro_subscriptions
  ADD COLUMN IF NOT EXISTS payment_reference text;

CREATE INDEX IF NOT EXISTS idx_pro_subscriptions_payment_ref
  ON public.pro_subscriptions (payment_reference)
  WHERE payment_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.yape_plin_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  operation_code text NOT NULL,
  sender_name text,
  amount_pen numeric(6, 2) NOT NULL DEFAULT 19.00,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  access_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT yape_plin_requests_email_op_uniq UNIQUE (email, operation_code)
);

CREATE INDEX IF NOT EXISTS idx_yape_plin_requests_status_created
  ON public.yape_plin_requests (status, created_at DESC);

ALTER TABLE public.yape_plin_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'yape_plin_requests'
      AND policyname = 'yape_plin_requests_no_direct_access'
  ) THEN
    CREATE POLICY "yape_plin_requests_no_direct_access"
      ON public.yape_plin_requests
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.submit_yape_plin_request(
  p_email text,
  p_operation_code text,
  p_sender_name text DEFAULT ''
)
RETURNS TABLE (
  request_id bigint,
  email text,
  operation_code text,
  amount_pen numeric,
  status text,
  access_code text,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_op text := upper(trim(coalesce(p_operation_code, '')));
  v_sender text := nullif(trim(coalesce(p_sender_name, '')), '');
  v_active_code text;
  v_req public.yape_plin_requests%ROWTYPE;
BEGIN
  IF v_email = '' OR position('@' IN v_email) < 2 OR length(v_email) < 5 THEN
    RAISE EXCEPTION 'Ingresa un correo electrónico válido.';
  END IF;
  IF length(v_op) < 4 THEN
    RAISE EXCEPTION 'Ingresa un número de operación válido (mínimo 4 caracteres).';
  END IF;

  SELECT ps.access_code
    INTO v_active_code
  FROM public.pro_subscriptions ps
  WHERE ps.status = 'active'
    AND ps.expires_at > now()
    AND (
      lower(ps.email) = v_email
      OR upper(ps.access_code) = v_op
      OR upper(coalesce(ps.payment_reference, '')) = v_op
    )
  ORDER BY ps.expires_at DESC
  LIMIT 1;

  IF v_active_code IS NOT NULL THEN
    INSERT INTO public.yape_plin_requests (
      email, operation_code, sender_name, amount_pen, status, access_code, updated_at
    )
    VALUES (
      v_email, v_op, v_sender, 19.00, 'approved', v_active_code, now()
    )
    ON CONFLICT (email, operation_code)
    DO UPDATE SET
      sender_name = coalesce(EXCLUDED.sender_name, public.yape_plin_requests.sender_name),
      status = 'approved',
      access_code = v_active_code,
      updated_at = now()
    RETURNING * INTO v_req;

    RETURN QUERY SELECT
      v_req.id, v_req.email, v_req.operation_code, v_req.amount_pen, v_req.status, v_req.access_code,
      'Pase PRO activo encontrado y vinculado.'::text;
    RETURN;
  END IF;

  INSERT INTO public.yape_plin_requests (
    email, operation_code, sender_name, amount_pen, status, updated_at
  )
  VALUES (
    v_email, v_op, v_sender, 19.00, 'pending', now()
  )
  ON CONFLICT (email, operation_code)
  DO UPDATE SET
    sender_name = coalesce(EXCLUDED.sender_name, public.yape_plin_requests.sender_name),
    updated_at = now()
  RETURNING * INTO v_req;

  RETURN QUERY SELECT
    v_req.id, v_req.email, v_req.operation_code, v_req.amount_pen, v_req.status, v_req.access_code,
    'Solicitud registrada (S/ 19.00). Envía tu captura por WhatsApp o espera la validación para recibir tu código CVPRO.'::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_yape_plin_request(text, text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
