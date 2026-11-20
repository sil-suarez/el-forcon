-- =============================================================================
-- EL FORCÓN - GESTIÓN DE PARTIDOS DE PÁDEL
-- Esquema completo: Tablas, Triggers, RLS, RPCs atómicos, Administración y Realtime
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. TABLAS PRINCIPALES
-- -----------------------------------------------------------------------------

-- Perfiles públicos de jugadores (sin correo electrónico por privacidad)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL CHECK (char_length(trim(first_name)) >= 1),
  last_name TEXT NOT NULL CHECK (char_length(trim(last_name)) >= 1),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Roles de usuario (gestionado exclusivamente desde backend / SQL)
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partidos generados de lunes a viernes (dos partidos diarios a las 19:00)
CREATE TABLE IF NOT EXISTS public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_date DATE NOT NULL,
  match_number SMALLINT NOT NULL CHECK (match_number IN (1, 2)),
  start_time TIME NOT NULL DEFAULT '19:00:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT matches_unique_date_number UNIQUE (match_date, match_number),
  CONSTRAINT matches_weekday_only CHECK (EXTRACT(ISODOW FROM match_date) BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_matches_date ON public.matches(match_date);

-- Inscripciones como cola cronológica única por día
-- Posiciones 1-4 -> Partido 1 | Posiciones 5-8 -> Partido 2
CREATE TABLE IF NOT EXISTS public.registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_date DATE NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  queue_seq BIGINT GENERATED ALWAYS AS IDENTITY,
  CONSTRAINT registrations_unique_user_per_day UNIQUE (match_date, user_id),
  CONSTRAINT registrations_weekday_only CHECK (EXTRACT(ISODOW FROM match_date) BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_registrations_date_order
  ON public.registrations(match_date, registered_at ASC, queue_seq ASC);

CREATE INDEX IF NOT EXISTS idx_registrations_user
  ON public.registrations(user_id, match_date);

-- Registro de auditoría para el panel de administración
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name TEXT,
  target_user_id UUID,
  target_name TEXT,
  match_date DATE,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- Vista de cola diaria con posición y partido calculados por PostgreSQL
CREATE OR REPLACE VIEW public.daily_queue_view
WITH (security_invoker = true) AS
SELECT
  r.id,
  r.match_date,
  r.user_id,
  r.registered_at,
  r.queue_seq,
  p.first_name,
  p.last_name,
  ROW_NUMBER() OVER (
    PARTITION BY r.match_date
    ORDER BY r.registered_at ASC, r.queue_seq ASC
  )::int AS queue_position,
  CASE
    WHEN ROW_NUMBER() OVER (
      PARTITION BY r.match_date
      ORDER BY r.registered_at ASC, r.queue_seq ASC
    ) <= 4 THEN 1
    ELSE 2
  END::smallint AS match_number
FROM public.registrations r
JOIN public.profiles p ON p.id = r.user_id;

-- -----------------------------------------------------------------------------
-- 2. FUNCIONES AUXILIARES Y TRIGGERS
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_madrid_date()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (now() AT TIME ZONE 'Europe/Madrid')::date;
$$;

CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = p_user_id
      AND ur.role = 'admin'
      AND p.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Creación automática de perfil y rol al registrarse en Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first TEXT;
  v_last TEXT;
BEGIN
  v_first := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'first_name'), ''), 'Jugador');
  v_last  := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'last_name'), ''), 'El Forcón');

  INSERT INTO public.profiles (id, first_name, last_name)
  VALUES (NEW.id, v_first, v_last)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'player')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 3. SEGURIDAD: ROW LEVEL SECURITY (RLS)
-- -----------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- PROFILES: los usuarios autenticados solo leen nombre, apellidos y estado (sin email)
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- USER_ROLES: cada usuario solo ve su rol; los admins ven todos; nadie edita desde cliente
DROP POLICY IF EXISTS "user_roles_select_own_or_admin" ON public.user_roles;
CREATE POLICY "user_roles_select_own_or_admin"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- MATCHES: lectura para autenticados; creación solo vía RPC idempotente
DROP POLICY IF EXISTS "matches_select_authenticated" ON public.matches;
CREATE POLICY "matches_select_authenticated"
  ON public.matches FOR SELECT
  TO authenticated
  USING (true);

-- REGISTRATIONS: lectura compartida para autenticados; mutaciones EXCLUSIVAMENTE vía RPC atómico
DROP POLICY IF EXISTS "registrations_select_authenticated" ON public.registrations;
CREATE POLICY "registrations_select_authenticated"
  ON public.registrations FOR SELECT
  TO authenticated
  USING (true);

-- AUDIT_LOGS: solo administradores
DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_select_admin"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- -----------------------------------------------------------------------------
-- 4. GENERACIÓN AUTOMÁTICA E IDEMPOTENTE DE PARTIDOS (LUNES A VIERNES)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_day_matches(p_match_date DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXTRACT(ISODOW FROM p_match_date) BETWEEN 1 AND 5 THEN
    INSERT INTO public.matches (match_date, match_number, start_time)
    VALUES
      (p_match_date, 1, '19:00:00'),
      (p_match_date, 2, '19:00:00')
    ON CONFLICT (match_date, match_number) DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_week_matches(p_any_date DATE DEFAULT public.current_madrid_date())
RETURNS SETOF public.matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_monday DATE;
  v_i INT;
  v_day DATE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticación requerida.';
  END IF;

  v_monday := p_any_date - ((EXTRACT(ISODOW FROM p_any_date)::int) - 1);

  FOR v_i IN 0..4 LOOP
    v_day := v_monday + v_i;
    PERFORM public.ensure_day_matches(v_day);
  END LOOP;

  RETURN QUERY
  SELECT *
  FROM public.matches
  WHERE match_date BETWEEN v_monday AND (v_monday + 4)
  ORDER BY match_date ASC, match_number ASC;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. OPERACIONES ATÓMICAS DE INSCRIPCIÓN Y CANCELACIÓN (COLA CRONOLÓGICA)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_for_match(
  p_match_date DATE,
  p_expected_match_number SMALLINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_user_active BOOLEAN;
  v_user_name TEXT;
  v_today DATE;
  v_count INT;
  v_new_pos INT;
  v_assigned_match SMALLINT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHENTICATED',
      'message', 'Tu sesión ha caducado. Vuelve a iniciar sesión.'
    );
  END IF;

  SELECT is_active, trim(first_name || ' ' || last_name)
    INTO v_user_active, v_user_name
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_user_active IS NULL OR v_user_active = false THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INACTIVE_USER',
      'message', 'Tu cuenta está desactivada. Contacta con el administrador.'
    );
  END IF;

  IF EXTRACT(ISODOW FROM p_match_date) NOT BETWEEN 1 AND 5 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WEEKEND',
      'message', 'Solo se celebran partidos de lunes a viernes.'
    );
  END IF;

  v_today := public.current_madrid_date();
  IF p_match_date < v_today THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'PAST_DATE',
      'message', 'No es posible apuntarse a partidos de fechas pasadas.'
    );
  END IF;

  -- Garantizar que existen los partidos del día
  PERFORM public.ensure_day_matches(p_match_date);

  -- Bloqueo transaccional exclusivo para este día (evita condiciones de carrera)
  PERFORM pg_advisory_xact_lock(hashtext('elforcon_day_' || p_match_date::text));

  -- Comprobar si ya está inscrito ese día
  IF EXISTS (
    SELECT 1 FROM public.registrations
    WHERE match_date = p_match_date AND user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_REGISTERED',
      'message', 'Ya estás inscrito en un partido de este día.'
    );
  END IF;

  -- Contar plazas ocupadas actualmente en el día
  SELECT COUNT(*) INTO v_count
  FROM public.registrations
  WHERE match_date = p_match_date;

  IF v_count >= 8 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'DAY_FULL',
      'message', 'No quedan plazas disponibles.'
    );
  END IF;

  -- Validar prioridad del Partido 1
  IF p_expected_match_number = 2 AND v_count < 4 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'MATCH_2_CLOSED',
      'message', 'El Partido 2 todavía no está abierto.'
    );
  END IF;

  IF p_expected_match_number = 1 AND v_count >= 4 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'MATCH_1_FULL',
      'message', 'El Partido 1 está completo.'
    );
  END IF;

  -- Insertar en la cola cronológica
  INSERT INTO public.registrations (match_date, user_id)
  VALUES (p_match_date, v_user_id);

  v_new_pos := v_count + 1;
  v_assigned_match := CASE WHEN v_new_pos <= 4 THEN 1 ELSE 2 END;

  INSERT INTO public.audit_logs (action, actor_id, actor_name, target_user_id, target_name, match_date, details)
  VALUES (
    'PLAYER_REGISTER',
    v_user_id,
    v_user_name,
    v_user_id,
    v_user_name,
    p_match_date,
    jsonb_build_object('assigned_match', v_assigned_match, 'position', v_new_pos)
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'REGISTERED',
    'message', 'Te has apuntado correctamente al partido.',
    'assigned_match', v_assigned_match,
    'position', v_new_pos
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_registration(p_match_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_user_active BOOLEAN;
  v_user_name TEXT;
  v_today DATE;
  v_deleted_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHENTICATED',
      'message', 'Tu sesión ha caducado. Vuelve a iniciar sesión.'
    );
  END IF;

  SELECT is_active, trim(first_name || ' ' || last_name)
    INTO v_user_active, v_user_name
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_user_active IS NULL OR v_user_active = false THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INACTIVE_USER',
      'message', 'Tu cuenta está desactivada. Contacta con el administrador.'
    );
  END IF;

  v_today := public.current_madrid_date();
  IF p_match_date < v_today THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'PAST_DATE',
      'message', 'No se pueden modificar inscripciones de fechas pasadas.'
    );
  END IF;

  -- Serializar operaciones del día
  PERFORM pg_advisory_xact_lock(hashtext('elforcon_day_' || p_match_date::text));

  DELETE FROM public.registrations
  WHERE match_date = p_match_date AND user_id = v_user_id
  RETURNING id INTO v_deleted_id;

  IF v_deleted_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NOT_REGISTERED',
      'message', 'No estás inscrito en ningún partido de este día.'
    );
  END IF;

  -- Al eliminar la fila, las posiciones de los demás jugadores en la cola
  -- se recalculan automáticamente manteniendo su orden cronológico original.
  INSERT INTO public.audit_logs (action, actor_id, actor_name, target_user_id, target_name, match_date, details)
  VALUES (
    'PLAYER_CANCEL',
    v_user_id,
    v_user_name,
    v_user_id,
    v_user_name,
    p_match_date,
    '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'CANCELLED',
    'message', 'Te has desapuntado correctamente.'
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. FUNCIONES EXCLUSIVAS DE ADMINISTRACIÓN
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_users()
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  is_active BOOLEAN,
  role TEXT,
  email_confirmed BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acceso denegado: permisos de administrador requeridos.';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.first_name,
    p.last_name,
    u.email::text,
    p.is_active,
    COALESCE(ur.role, 'player') AS role,
    (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
    p.created_at
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  ORDER BY p.first_name ASC, p.last_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_add_registration(
  p_match_date DATE,
  p_target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_admin_name TEXT;
  v_target_name TEXT;
  v_target_active BOOLEAN;
  v_count INT;
  v_new_pos INT;
  v_assigned_match SMALLINT;
BEGIN
  v_admin_id := auth.uid();
  IF NOT public.is_admin(v_admin_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Acceso denegado.');
  END IF;

  IF EXTRACT(ISODOW FROM p_match_date) NOT BETWEEN 1 AND 5 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Solo se permiten partidos de lunes a viernes.');
  END IF;

  SELECT trim(first_name || ' ' || last_name) INTO v_admin_name
  FROM public.profiles WHERE id = v_admin_id;

  SELECT is_active, trim(first_name || ' ' || last_name)
    INTO v_target_active, v_target_name
  FROM public.profiles WHERE id = p_target_user_id;

  IF v_target_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Jugador no encontrado.');
  END IF;

  IF v_target_active = false THEN
    RETURN jsonb_build_object('success', false, 'message', 'El jugador tiene la cuenta desactivada.');
  END IF;

  PERFORM public.ensure_day_matches(p_match_date);
  PERFORM pg_advisory_xact_lock(hashtext('elforcon_day_' || p_match_date::text));

  IF EXISTS (
    SELECT 1 FROM public.registrations
    WHERE match_date = p_match_date AND user_id = p_target_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Este jugador ya está inscrito ese día.');
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.registrations
  WHERE match_date = p_match_date;

  IF v_count >= 8 THEN
    RETURN jsonb_build_object('success', false, 'message', 'El día ya tiene el máximo de 8 jugadores.');
  END IF;

  INSERT INTO public.registrations (match_date, user_id)
  VALUES (p_match_date, p_target_user_id);

  v_new_pos := v_count + 1;
  v_assigned_match := CASE WHEN v_new_pos <= 4 THEN 1 ELSE 2 END;

  INSERT INTO public.audit_logs (action, actor_id, actor_name, target_user_id, target_name, match_date, details)
  VALUES (
    'ADMIN_ADD_PLAYER',
    v_admin_id,
    v_admin_name,
    p_target_user_id,
    v_target_name,
    p_match_date,
    jsonb_build_object('assigned_match', v_assigned_match, 'position', v_new_pos)
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', format('Jugador %s añadido al Partido %s.', v_target_name, v_assigned_match)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_registration(
  p_match_date DATE,
  p_target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_admin_name TEXT;
  v_target_name TEXT;
  v_deleted_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT public.is_admin(v_admin_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Acceso denegado.');
  END IF;

  SELECT trim(first_name || ' ' || last_name) INTO v_admin_name
  FROM public.profiles WHERE id = v_admin_id;

  SELECT trim(first_name || ' ' || last_name) INTO v_target_name
  FROM public.profiles WHERE id = p_target_user_id;

  PERFORM pg_advisory_xact_lock(hashtext('elforcon_day_' || p_match_date::text));

  DELETE FROM public.registrations
  WHERE match_date = p_match_date AND user_id = p_target_user_id
  RETURNING id INTO v_deleted_id;

  IF v_deleted_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'La inscripción no existe.');
  END IF;

  INSERT INTO public.audit_logs (action, actor_id, actor_name, target_user_id, target_name, match_date, details)
  VALUES (
    'ADMIN_REMOVE_PLAYER',
    v_admin_id,
    v_admin_name,
    p_target_user_id,
    v_target_name,
    p_match_date,
    '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', format('Se ha eliminado a %s y se ha reorganizado la cola.', COALESCE(v_target_name, 'el jugador'))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_active(
  p_target_user_id UUID,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_admin_name TEXT;
  v_target_name TEXT;
  v_future_day DATE;
BEGIN
  v_admin_id := auth.uid();
  IF NOT public.is_admin(v_admin_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Acceso denegado.');
  END IF;

  IF v_admin_id = p_target_user_id AND p_is_active = false THEN
    RETURN jsonb_build_object('success', false, 'message', 'No puedes desactivar tu propia cuenta de administrador.');
  END IF;

  SELECT trim(first_name || ' ' || last_name) INTO v_admin_name
  FROM public.profiles WHERE id = v_admin_id;

  UPDATE public.profiles
  SET is_active = p_is_active
  WHERE id = p_target_user_id
  RETURNING trim(first_name || ' ' || last_name) INTO v_target_name;

  IF v_target_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Usuario no encontrado.');
  END IF;

  -- Si se desactiva, liberar sus plazas futuras de forma ordenada
  IF p_is_active = false THEN
    FOR v_future_day IN
      SELECT DISTINCT match_date
      FROM public.registrations
      WHERE user_id = p_target_user_id
        AND match_date >= public.current_madrid_date()
    LOOP
      PERFORM pg_advisory_xact_lock(hashtext('elforcon_day_' || v_future_day::text));
      DELETE FROM public.registrations
      WHERE match_date = v_future_day AND user_id = p_target_user_id;
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs (action, actor_id, actor_name, target_user_id, target_name, details)
  VALUES (
    CASE WHEN p_is_active THEN 'ADMIN_ACTIVATE_USER' ELSE 'ADMIN_DEACTIVATE_USER' END,
    v_admin_id,
    v_admin_name,
    p_target_user_id,
    v_target_name,
    jsonb_build_object('is_active', p_is_active)
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', CASE WHEN p_is_active THEN 'Cuenta reactivada correctamente.' ELSE 'Cuenta desactivada y plazas futuras liberadas.' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_admin_id UUID;
  v_admin_name TEXT;
  v_target_name TEXT;
  v_future_day DATE;
BEGIN
  v_admin_id := auth.uid();
  IF NOT public.is_admin(v_admin_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Acceso denegado.');
  END IF;

  IF v_admin_id = p_target_user_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'No puedes eliminar tu propia cuenta.');
  END IF;

  SELECT trim(first_name || ' ' || last_name) INTO v_admin_name
  FROM public.profiles WHERE id = v_admin_id;

  SELECT trim(first_name || ' ' || last_name) INTO v_target_name
  FROM public.profiles WHERE id = p_target_user_id;

  IF v_target_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Usuario no encontrado.');
  END IF;

  -- Bloquear días afectados antes de eliminar en cascada
  FOR v_future_day IN
    SELECT DISTINCT match_date
    FROM public.registrations
    WHERE user_id = p_target_user_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('elforcon_day_' || v_future_day::text));
  END LOOP;

  INSERT INTO public.audit_logs (action, actor_id, actor_name, target_user_id, target_name, details)
  VALUES (
    'ADMIN_DELETE_USER',
    v_admin_id,
    v_admin_name,
    p_target_user_id,
    v_target_name,
    '{}'::jsonb
  );

  DELETE FROM auth.users WHERE id = p_target_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', format('Usuario %s eliminado correctamente.', v_target_name)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_audit_logs(p_limit INT DEFAULT 100)
RETURNS SETOF public.audit_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acceso denegado.';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.audit_logs
  ORDER BY created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 500);
END;
$$;

-- Permisos de ejecución de RPCs
REVOKE ALL ON FUNCTION public.ensure_week_matches(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_for_match(DATE, SMALLINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_registration(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_add_registration(DATE, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_remove_registration(DATE, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_user_active(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_audit_logs(INT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_week_matches(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_for_match(DATE, SMALLINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_registration(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_registration(DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_registration(DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_audit_logs(INT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. CONFIGURACIÓN DE SUPABASE REALTIME
-- -----------------------------------------------------------------------------

ALTER TABLE public.registrations REPLICA IDENTITY FULL;
ALTER TABLE public.matches REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'registrations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.registrations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'matches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END;
$$;
