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
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE OR REPLACE FUNCTION public.normalize_phone(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_trimmed TEXT;
  v_has_plus BOOLEAN;
  v_digits TEXT;
BEGIN
  IF p_raw IS NULL THEN
    RETURN NULL;
  END IF;
  v_trimmed := trim(p_raw);
  v_has_plus := left(v_trimmed, 1) = '+';
  v_digits := regexp_replace(v_trimmed, '\D', '', 'g');
  IF v_digits = '' THEN
    RETURN '';
  END IF;
  IF left(v_digits, 4) = '0034' AND char_length(v_digits) = 13 THEN
    RETURN substr(v_digits, 5);
  END IF;
  IF (v_has_plus OR left(v_digits, 2) = '34') AND left(v_digits, 2) = '34' AND char_length(v_digits) = 11 THEN
    RETURN substr(v_digits, 3);
  END IF;
  RETURN v_digits;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_unique
  ON public.profiles (public.normalize_phone(phone))
  WHERE phone IS NOT NULL AND public.normalize_phone(phone) <> '';

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
-- Soporta tanto usuarios registrados (user_id) como acompañantes pendientes (guest_*)
CREATE TABLE IF NOT EXISTS public.registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_date DATE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  registered_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  guest_first_name TEXT,
  guest_last_name TEXT,
  guest_phone TEXT,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  queue_seq BIGINT GENERATED ALWAYS AS IDENTITY,
  CONSTRAINT registrations_weekday_only CHECK (EXTRACT(ISODOW FROM match_date) BETWEEN 1 AND 5)
);

ALTER TABLE public.registrations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS registered_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS guest_first_name TEXT;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS guest_last_name TEXT;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS guest_phone TEXT;
ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_unique_user_per_day;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_unique_user_per_day
  ON public.registrations(match_date, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_unique_guest_phone_per_day
  ON public.registrations(match_date, public.normalize_phone(guest_phone))
  WHERE guest_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_registrations_date_order
  ON public.registrations(match_date, registered_at ASC, queue_seq ASC);

CREATE INDEX IF NOT EXISTS idx_registrations_user
  ON public.registrations(user_id, match_date);

CREATE INDEX IF NOT EXISTS idx_registrations_registered_by
  ON public.registrations(registered_by, match_date);

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

-- Vista de cola diaria con posición, partido y datos públicos (sin exponer teléfonos)
CREATE OR REPLACE VIEW public.daily_queue_view
WITH (security_invoker = true) AS
SELECT
  r.id,
  r.match_date,
  r.user_id,
  r.registered_by,
  r.registered_at,
  r.queue_seq,
  COALESCE(p.first_name, r.guest_first_name, 'Jugador') AS first_name,
  COALESCE(p.last_name, r.guest_last_name, '') AS last_name,
  reg_by.first_name AS registrant_first_name,
  reg_by.last_name AS registrant_last_name,
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
LEFT JOIN public.profiles p ON p.id = r.user_id
LEFT JOIN public.profiles reg_by ON reg_by.id = r.registered_by;

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

-- Creación automática de perfil, rol y vinculación de inscripciones previas por teléfono
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first TEXT;
  v_last TEXT;
  v_phone TEXT;
BEGIN
  v_first := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'first_name'), ''), 'Jugador');
  v_last  := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'last_name'), ''), 'El Forcón');
  v_phone := NULLIF(public.normalize_phone(NEW.raw_user_meta_data->>'phone'), '');

  INSERT INTO public.profiles (id, first_name, last_name, phone)
  VALUES (NEW.id, v_first, v_last, v_phone)
  ON CONFLICT (id) DO UPDATE
    SET phone = COALESCE(public.profiles.phone, EXCLUDED.phone);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'player')
  ON CONFLICT (user_id) DO NOTHING;

  -- Vincular automáticamente inscripciones de acompañante hechas con este teléfono
  IF v_phone IS NOT NULL THEN
    UPDATE public.registrations r
    SET
      user_id = NEW.id,
      guest_first_name = NULL,
      guest_last_name = NULL,
      guest_phone = NULL
    WHERE r.user_id IS NULL
      AND r.guest_phone IS NOT NULL
      AND public.normalize_phone(r.guest_phone) = v_phone
      AND NOT EXISTS (
        SELECT 1 FROM public.registrations r2
        WHERE r2.match_date = r.match_date
          AND r2.user_id = NEW.id
      );
  END IF;

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
  INSERT INTO public.registrations (match_date, user_id, registered_by)
  VALUES (p_match_date, v_user_id, v_user_id);

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

CREATE OR REPLACE FUNCTION public.register_companion(
  p_match_date DATE,
  p_first_name TEXT,
  p_last_name TEXT,
  p_phone TEXT,
  p_expected_match_number SMALLINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_active BOOLEAN;
  v_caller_name TEXT;
  v_clean_first TEXT;
  v_clean_last TEXT;
  v_clean_phone TEXT;
  v_today DATE;
  v_count INT;
  v_new_pos INT;
  v_assigned_match SMALLINT;
  v_target_user_id UUID;
  v_target_active BOOLEAN;
  v_target_name TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'message', 'Tu sesión ha caducado. Vuelve a iniciar sesión.');
  END IF;

  SELECT is_active, trim(first_name || ' ' || last_name)
    INTO v_caller_active, v_caller_name
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_caller_active IS NULL OR v_caller_active = false THEN
    RETURN jsonb_build_object('success', false, 'code', 'INACTIVE_USER', 'message', 'Tu cuenta está desactivada. Contacta con el administrador.');
  END IF;

  v_clean_first := trim(COALESCE(p_first_name, ''));
  v_clean_last := trim(COALESCE(p_last_name, ''));
  v_clean_phone := public.normalize_phone(p_phone);

  IF v_clean_first = '' OR v_clean_last = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_NAME', 'message', 'Introduce el nombre y apellidos del acompañante.');
  END IF;

  IF v_clean_phone IS NULL OR char_length(v_clean_phone) < 9 OR char_length(v_clean_phone) > 15 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_PHONE', 'message', 'Introduce un número de teléfono válido (al menos 9 dígitos).');
  END IF;

  IF EXTRACT(ISODOW FROM p_match_date) NOT BETWEEN 1 AND 5 THEN
    RETURN jsonb_build_object('success', false, 'code', 'WEEKEND', 'message', 'Solo se celebran partidos de lunes a viernes.');
  END IF;

  v_today := public.current_madrid_date();
  IF p_match_date < v_today THEN
    RETURN jsonb_build_object('success', false, 'code', 'PAST_DATE', 'message', 'No es posible apuntar a partidos de fechas pasadas.');
  END IF;

  SELECT id, is_active, trim(first_name || ' ' || last_name)
    INTO v_target_user_id, v_target_active, v_target_name
  FROM public.profiles
  WHERE public.normalize_phone(phone) = v_clean_phone
  LIMIT 1;

  IF v_target_user_id = v_caller_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'SELF_AS_COMPANION', 'message', 'Para apuntarte a ti mismo usa el botón APUNTARME.');
  END IF;

  IF v_target_user_id IS NOT NULL AND v_target_active = false THEN
    RETURN jsonb_build_object('success', false, 'code', 'TARGET_INACTIVE', 'message', 'La cuenta asociada a ese teléfono está desactivada.');
  END IF;

  PERFORM public.ensure_day_matches(p_match_date);
  PERFORM pg_advisory_xact_lock(hashtext('elforcon_day_' || p_match_date::text));

  IF v_target_user_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.registrations
      WHERE match_date = p_match_date AND user_id = v_target_user_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'code', 'ALREADY_REGISTERED', 'message', v_target_name || ' ya está inscrito en un partido de este día.');
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.registrations
      WHERE match_date = p_match_date
        AND guest_phone IS NOT NULL
        AND public.normalize_phone(guest_phone) = v_clean_phone
    ) THEN
      RETURN jsonb_build_object('success', false, 'code', 'ALREADY_REGISTERED', 'message', 'Ya existe una inscripción para ese número de teléfono este día.');
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.registrations
  WHERE match_date = p_match_date;

  IF v_count >= 8 THEN
    RETURN jsonb_build_object('success', false, 'code', 'DAY_FULL', 'message', 'No quedan plazas disponibles.');
  END IF;

  IF p_expected_match_number = 2 AND v_count < 4 THEN
    RETURN jsonb_build_object('success', false, 'code', 'MATCH_2_CLOSED', 'message', 'El Partido 2 todavía no está abierto.');
  END IF;

  IF p_expected_match_number = 1 AND v_count >= 4 THEN
    RETURN jsonb_build_object('success', false, 'code', 'MATCH_1_FULL', 'message', 'El Partido 1 está completo.');
  END IF;

  IF v_target_user_id IS NOT NULL THEN
    INSERT INTO public.registrations (match_date, user_id, registered_by)
    VALUES (p_match_date, v_target_user_id, v_caller_id);
  ELSE
    v_target_name := trim(v_clean_first || ' ' || v_clean_last);
    INSERT INTO public.registrations (
      match_date, user_id, registered_by, guest_first_name, guest_last_name, guest_phone
    )
    VALUES (p_match_date, NULL, v_caller_id, v_clean_first, v_clean_last, v_clean_phone);
  END IF;

  v_new_pos := v_count + 1;
  v_assigned_match := CASE WHEN v_new_pos <= 4 THEN 1 ELSE 2 END;

  INSERT INTO public.audit_logs (action, actor_id, actor_name, target_user_id, target_name, match_date, details)
  VALUES (
    'COMPANION_REGISTER',
    v_caller_id,
    v_caller_name,
    v_target_user_id,
    v_target_name,
    p_match_date,
    jsonb_build_object('assigned_match', v_assigned_match, 'position', v_new_pos, 'linked_account', v_target_user_id IS NOT NULL)
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'REGISTERED',
    'message', CASE
      WHEN v_target_user_id IS NOT NULL THEN format('Has apuntado a %s al Partido %s (verá la inscripción en su cuenta).', v_target_name, v_assigned_match)
      ELSE format('Has apuntado a %s al Partido %s.', v_target_name, v_assigned_match)
    END,
    'assigned_match', v_assigned_match,
    'position', v_new_pos
  );
END;
$$;

DROP FUNCTION IF EXISTS public.cancel_registration(DATE);
CREATE OR REPLACE FUNCTION public.cancel_registration(
  p_match_date DATE,
  p_registration_id UUID DEFAULT NULL
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
  v_deleted_id UUID;
  v_target_user_id UUID;
  v_target_name TEXT;
  v_is_self BOOLEAN;
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

  PERFORM pg_advisory_xact_lock(hashtext('elforcon_day_' || p_match_date::text));

  IF p_registration_id IS NOT NULL THEN
    DELETE FROM public.registrations r
    WHERE r.id = p_registration_id
      AND r.match_date = p_match_date
      AND (r.user_id = v_user_id OR r.registered_by = v_user_id)
    RETURNING r.id, r.user_id,
      COALESCE(
        (SELECT trim(p.first_name || ' ' || p.last_name) FROM public.profiles p WHERE p.id = r.user_id),
        trim(COALESCE(r.guest_first_name, '') || ' ' || COALESCE(r.guest_last_name, ''))
      )
    INTO v_deleted_id, v_target_user_id, v_target_name;
  ELSE
    DELETE FROM public.registrations r
    WHERE r.match_date = p_match_date AND r.user_id = v_user_id
    RETURNING r.id, r.user_id, v_user_name
    INTO v_deleted_id, v_target_user_id, v_target_name;
  END IF;

  IF v_deleted_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NOT_REGISTERED',
      'message', 'No se ha encontrado la inscripción o no tienes permiso para cancelarla.'
    );
  END IF;

  v_is_self := (v_target_user_id = v_user_id);

  INSERT INTO public.audit_logs (action, actor_id, actor_name, target_user_id, target_name, match_date, details)
  VALUES (
    CASE WHEN v_is_self THEN 'PLAYER_CANCEL' ELSE 'COMPANION_CANCEL' END,
    v_user_id,
    v_user_name,
    v_target_user_id,
    NULLIF(v_target_name, ''),
    p_match_date,
    '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'CANCELLED',
    'message', CASE
      WHEN v_is_self THEN 'Te has desapuntado correctamente.'
      ELSE format('Has dado de baja a %s correctamente.', COALESCE(NULLIF(v_target_name, ''), 'el acompañante'))
    END
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. FUNCIONES EXCLUSIVAS DE ADMINISTRACIÓN
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_get_users();
CREATE OR REPLACE FUNCTION public.admin_get_users()
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
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
    p.phone,
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

  INSERT INTO public.registrations (match_date, user_id, registered_by)
  VALUES (p_match_date, p_target_user_id, v_admin_id);

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

DROP FUNCTION IF EXISTS public.admin_remove_registration(DATE, UUID);
CREATE OR REPLACE FUNCTION public.admin_remove_registration(
  p_match_date DATE,
  p_target_user_id UUID DEFAULT NULL,
  p_registration_id UUID DEFAULT NULL
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
  v_deleted_user_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT public.is_admin(v_admin_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Acceso denegado.');
  END IF;

  SELECT trim(first_name || ' ' || last_name) INTO v_admin_name
  FROM public.profiles WHERE id = v_admin_id;

  PERFORM pg_advisory_xact_lock(hashtext('elforcon_day_' || p_match_date::text));

  IF p_registration_id IS NOT NULL THEN
    DELETE FROM public.registrations r
    WHERE r.id = p_registration_id AND r.match_date = p_match_date
    RETURNING r.id, r.user_id,
      COALESCE(
        (SELECT trim(p.first_name || ' ' || p.last_name) FROM public.profiles p WHERE p.id = r.user_id),
        trim(COALESCE(r.guest_first_name, '') || ' ' || COALESCE(r.guest_last_name, ''))
      )
    INTO v_deleted_id, v_deleted_user_id, v_target_name;
  ELSE
    SELECT trim(first_name || ' ' || last_name) INTO v_target_name
    FROM public.profiles WHERE id = p_target_user_id;

    DELETE FROM public.registrations r
    WHERE r.match_date = p_match_date AND r.user_id = p_target_user_id
    RETURNING r.id, r.user_id INTO v_deleted_id, v_deleted_user_id;
  END IF;

  IF v_deleted_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'La inscripción no existe.');
  END IF;

  INSERT INTO public.audit_logs (action, actor_id, actor_name, target_user_id, target_name, match_date, details)
  VALUES (
    'ADMIN_REMOVE_PLAYER',
    v_admin_id,
    v_admin_name,
    v_deleted_user_id,
    NULLIF(v_target_name, ''),
    p_match_date,
    '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', format('Se ha eliminado a %s y se ha reorganizado la cola.', COALESCE(NULLIF(v_target_name, ''), 'el jugador'))
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
REVOKE ALL ON FUNCTION public.register_companion(DATE, TEXT, TEXT, TEXT, SMALLINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_registration(DATE, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_add_registration(DATE, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_remove_registration(DATE, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_user_active(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_audit_logs(INT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_week_matches(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_for_match(DATE, SMALLINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_companion(DATE, TEXT, TEXT, TEXT, SMALLINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_registration(DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_registration(DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_registration(DATE, UUID, UUID) TO authenticated;
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
