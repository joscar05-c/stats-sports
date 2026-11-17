-- User accounts (Supabase Auth: Google & Email) bound to PRO subscriptions & Yape/Plin requests

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  avatar_url text,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email_lower
  ON public.profiles (lower(email));

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_select_own'
  ) THEN
    CREATE POLICY "profiles_select_own"
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING ((select auth.uid()) = id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_insert_own'
  ) THEN
    CREATE POLICY "profiles_insert_own"
      ON public.profiles
      FOR INSERT
      TO authenticated
      WITH CHECK ((select auth.uid()) = id AND is_admin = false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update_own'
  ) THEN
    CREATE POLICY "profiles_update_own"
      ON public.profiles
      FOR UPDATE
      TO authenticated
      USING ((select auth.uid()) = id)
      WITH CHECK ((select auth.uid()) = id);
  END IF;
END $$;

-- Prevent regular users from escalating their own is_admin flag
CREATE OR REPLACE FUNCTION public.protect_profile_admin_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    IF coalesce(current_setting('role', true), '') <> 'service_role'
       AND current_user NOT IN ('postgres', 'supabase_admin') THEN
      NEW.is_admin := OLD.is_admin;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_protect_profile_admin_column'
      AND tgrelid = 'public.profiles'::regclass
  ) THEN
    CREATE TRIGGER trg_protect_profile_admin_column
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.protect_profile_admin_column();
  END IF;
END $$;

-- Bind subscriptions & Yape/Plin requests to auth.users(id)
ALTER TABLE public.pro_subscriptions
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pro_subscriptions_user_id
  ON public.pro_subscriptions (user_id);

ALTER TABLE public.yape_plin_requests
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_yape_plin_requests_user_id
  ON public.yape_plin_requests (user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pro_subscriptions' AND policyname = 'pro_subscriptions_select_own'
  ) THEN
    CREATE POLICY "pro_subscriptions_select_own"
      ON public.pro_subscriptions
      FOR SELECT
      TO authenticated
      USING ((select auth.uid()) = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'yape_plin_requests' AND policyname = 'yape_plin_requests_select_own_or_admin'
  ) THEN
    CREATE POLICY "yape_plin_requests_select_own_or_admin"
      ON public.yape_plin_requests
      FOR SELECT
      TO authenticated
      USING (
        (select auth.uid()) = user_id
        OR EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = (select auth.uid()) AND pr.is_admin = true
        )
      );
  END IF;
END $$;

-- Auto-create profile & auto-link any prior subscription by verified email
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(trim(coalesce(NEW.email, '')));
  v_name text := nullif(trim(coalesce(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', '')), '');
  v_avatar text := nullif(trim(coalesce(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture', '')), '');
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (NEW.id, v_email, v_name, v_avatar)
  ON CONFLICT (id)
  DO UPDATE SET
    email = coalesce(nullif(EXCLUDED.email, ''), public.profiles.email),
    full_name = coalesce(EXCLUDED.full_name, public.profiles.full_name),
    avatar_url = coalesce(EXCLUDED.avatar_url, public.profiles.avatar_url),
    updated_at = now();

  IF v_email <> '' THEN
    UPDATE public.pro_subscriptions
    SET user_id = NEW.id, updated_at = now()
    WHERE user_id IS NULL AND lower(email) = v_email;

    UPDATE public.yape_plin_requests
    SET user_id = NEW.id, updated_at = now()
    WHERE user_id IS NULL AND lower(email) = v_email;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_auth_user_created_or_updated'
      AND tgrelid = 'auth.users'::regclass
  ) THEN
    CREATE TRIGGER on_auth_user_created_or_updated
      AFTER INSERT OR UPDATE OF email, raw_user_meta_data ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_new_auth_user();
  END IF;
END $$;

-- Authenticated-only subscription lookup bound strictly to auth.uid()
CREATE OR REPLACE FUNCTION public.get_my_pro_subscription()
RETURNS TABLE (
  email text,
  access_code text,
  provider text,
  amount_usd numeric,
  starts_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT lower(trim(u.email)) INTO v_email
  FROM auth.users u
  WHERE u.id = v_uid;

  IF v_email IS NOT NULL AND v_email <> '' THEN
    UPDATE public.pro_subscriptions ps
    SET user_id = v_uid, updated_at = now()
    WHERE ps.user_id IS NULL
      AND lower(ps.email) = v_email
      AND ps.status = 'active'
      AND ps.expires_at > now()
      AND ps.test_mode = false;
  END IF;

  RETURN QUERY
  SELECT
    ps.email,
    ps.access_code,
    ps.provider,
    ps.amount_usd,
    ps.starts_at,
    ps.expires_at
  FROM public.pro_subscriptions ps
  WHERE ps.status = 'active'
    AND ps.expires_at > now()
    AND ps.test_mode = false
    AND ps.user_id = v_uid
  ORDER BY ps.expires_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_pro_subscription() TO authenticated, service_role;

-- Claim an active CVPRO code strictly for the authenticated user (no anonymous email guessing)
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_lookup, '')));
  v_row public.pro_subscriptions%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR v_code = '' THEN
    RETURN;
  END IF;

  SELECT *
    INTO v_row
  FROM public.pro_subscriptions ps
  WHERE ps.status = 'active'
    AND ps.expires_at > now()
    AND ps.test_mode = false
    AND upper(ps.access_code) = v_code
    AND (ps.user_id IS NULL OR ps.user_id = v_uid)
  ORDER BY ps.expires_at DESC
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN;
  END IF;

  IF v_row.user_id IS NULL THEN
    UPDATE public.pro_subscriptions
    SET user_id = v_uid, updated_at = now()
    WHERE id = v_row.id;
  END IF;

  RETURN QUERY
  SELECT
    v_row.email,
    v_row.access_code,
    v_row.provider,
    v_row.amount_usd,
    v_row.starts_at,
    v_row.expires_at,
    v_row.test_mode;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_pro_access(text) TO authenticated, service_role;

-- Update Yape/Plin submission to require an authenticated user and bind user_id
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
  v_uid uuid := auth.uid();
  v_auth_email text;
  v_email text;
  v_op text := upper(trim(coalesce(p_operation_code, '')));
  v_sender text := nullif(trim(coalesce(p_sender_name, '')), '');
  v_active_code text;
  v_req public.yape_plin_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión con Google o tu correo antes de registrar un pago Yape/Plin.';
  END IF;

  SELECT lower(trim(u.email)) INTO v_auth_email FROM auth.users u WHERE u.id = v_uid;
  v_email := coalesce(nullif(v_auth_email, ''), lower(trim(coalesce(p_email, ''))));

  IF v_email = '' OR position('@' IN v_email) < 2 THEN
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
    AND ps.test_mode = false
    AND (ps.user_id = v_uid OR (ps.user_id IS NULL AND lower(ps.email) = v_email))
    AND (upper(ps.access_code) = v_op OR upper(coalesce(ps.payment_reference, '')) = v_op)
  ORDER BY ps.expires_at DESC
  LIMIT 1;

  IF v_active_code IS NOT NULL THEN
    INSERT INTO public.yape_plin_requests (
      user_id, email, operation_code, sender_name, amount_pen, status, access_code, updated_at
    )
    VALUES (
      v_uid, v_email, v_op, v_sender, 19.00, 'approved', v_active_code, now()
    )
    ON CONFLICT (email, operation_code)
    DO UPDATE SET
      user_id = v_uid,
      sender_name = coalesce(EXCLUDED.sender_name, public.yape_plin_requests.sender_name),
      status = 'approved',
      access_code = v_active_code,
      updated_at = now()
    RETURNING * INTO v_req;

    RETURN QUERY SELECT
      v_req.id, v_req.email, v_req.operation_code, v_req.amount_pen, v_req.status, v_req.access_code,
      'Pase PRO activo vinculado a tu cuenta.'::text;
    RETURN;
  END IF;

  INSERT INTO public.yape_plin_requests (
    user_id, email, operation_code, sender_name, amount_pen, status, updated_at
  )
  VALUES (
    v_uid, v_email, v_op, v_sender, 19.00, 'pending', now()
  )
  ON CONFLICT (email, operation_code)
  DO UPDATE SET
    user_id = v_uid,
    sender_name = coalesce(EXCLUDED.sender_name, public.yape_plin_requests.sender_name),
    updated_at = now()
  RETURNING * INTO v_req;

  RETURN QUERY SELECT
    v_req.id, v_req.email, v_req.operation_code, v_req.amount_pen, v_req.status, v_req.access_code,
    'Operación registrada en tu cuenta (S/ 19.00). Envía tu captura por WhatsApp; apenas sea aprobada tu cuenta subirá a PRO.'::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_yape_plin_request(text, text, text) TO authenticated, service_role;

-- Admin RPCs for 1-click Yape/Plin approval inside AccountModal
CREATE OR REPLACE FUNCTION public.admin_list_yape_requests()
RETURNS TABLE (
  request_id bigint,
  user_id uuid,
  email text,
  operation_code text,
  sender_name text,
  amount_pen numeric,
  status text,
  access_code text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_admin boolean := false;
BEGIN
  SELECT coalesce(pr.is_admin, false) INTO v_is_admin
  FROM public.profiles pr
  WHERE pr.id = auth.uid();

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Acceso restringido a administradores.';
  END IF;

  RETURN QUERY
  SELECT
    yr.id,
    yr.user_id,
    yr.email,
    yr.operation_code,
    yr.sender_name,
    yr.amount_pen,
    yr.status,
    yr.access_code,
    yr.created_at
  FROM public.yape_plin_requests yr
  ORDER BY
    CASE WHEN yr.status = 'pending' THEN 0 ELSE 1 END,
    yr.created_at DESC
  LIMIT 40;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_yape_requests() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_review_yape_request(
  p_request_id bigint,
  p_decision text
)
RETURNS TABLE (
  request_id bigint,
  status text,
  access_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_is_admin boolean := false;
  v_req public.yape_plin_requests%ROWTYPE;
  v_code text;
  v_target_uid uuid;
BEGIN
  SELECT coalesce(pr.is_admin, false) INTO v_is_admin
  FROM public.profiles pr
  WHERE pr.id = auth.uid();

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Acceso restringido a administradores.';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decisión inválida.';
  END IF;

  SELECT * INTO v_req FROM public.yape_plin_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada.';
  END IF;

  IF p_decision = 'rejected' THEN
    UPDATE public.yape_plin_requests
    SET status = 'rejected', updated_at = now()
    WHERE id = v_req.id;

    RETURN QUERY SELECT v_req.id, 'rejected'::text, v_req.access_code;
    RETURN;
  END IF;

  v_target_uid := v_req.user_id;
  IF v_target_uid IS NULL THEN
    SELECT u.id INTO v_target_uid
    FROM auth.users u
    WHERE lower(u.email) = lower(v_req.email)
    LIMIT 1;
  END IF;

  v_code := coalesce(
    nullif(v_req.access_code, ''),
    'CVPRO-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)) || '-' ||
    upper(substr(md5(random()::text || v_req.id::text), 1, 4))
  );

  INSERT INTO public.pro_subscriptions (
    user_id, email, access_code, provider, amount_usd, status, starts_at, expires_at, test_mode, payment_reference, updated_at
  )
  VALUES (
    v_target_uid, lower(v_req.email), v_code, 'yape_plin', 5.00, 'active', now(), now() + interval '30 days', false, v_req.operation_code, now()
  )
  ON CONFLICT (access_code)
  DO UPDATE SET
    user_id = coalesce(EXCLUDED.user_id, public.pro_subscriptions.user_id),
    status = 'active',
    expires_at = greatest(public.pro_subscriptions.expires_at, now() + interval '30 days'),
    updated_at = now();

  UPDATE public.yape_plin_requests
  SET
    user_id = coalesce(v_target_uid, user_id),
    status = 'approved',
    access_code = v_code,
    updated_at = now()
  WHERE id = v_req.id;

  RETURN QUERY SELECT v_req.id, 'approved'::text, v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_review_yape_request(bigint, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
