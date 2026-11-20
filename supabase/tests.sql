-- =============================================================================
-- PRUEBAS DE VERIFICACIÓN BACKEND (ESCENARIOS A, B, C, D, E)
-- Ejecutar en Supabase SQL Editor. Termina en ROLLBACK para no dejar datos de prueba.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_test_date DATE := (date_trunc('week', public.current_madrid_date())::date + 7); -- Próximo lunes
  v_u UUID[];
  v_i INT;
  v_res JSONB;
  v_names TEXT[];
  v_count INT;
BEGIN
  -- Crear 9 usuarios sintéticos en auth.users (dispara handle_new_user)
  FOR v_i IN 1..9 LOOP
    v_u[v_i] := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    VALUES (
      v_u[v_i],
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      format('test_%s_%s@elforcon.local', v_i, v_u[v_i]),
      'x',
      now(),
      jsonb_build_object('first_name', format('Jugador%s', v_i), 'last_name', 'Prueba'),
      now(),
      now()
    );
  END LOOP;

  -- ESCENARIO B: Hay 3 jugadores en Partido 1 -> intento de apuntarse al Partido 2 debe fallar
  FOR v_i IN 1..3 LOOP
    PERFORM set_config('request.jwt.claim.sub', v_u[v_i]::text, true);
    v_res := public.register_for_match(v_test_date, 1::smallint);
    ASSERT (v_res->>'success')::boolean = true, 'Fallo al inscribir jugador ' || v_i;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', v_u[4]::text, true);
  v_res := public.register_for_match(v_test_date, 2::smallint);
  ASSERT (v_res->>'success')::boolean = false AND v_res->>'code' = 'MATCH_2_CLOSED',
    'Escenario B falló: se permitió inscribir al Partido 2 estando cerrado';

  -- ESCENARIO E: Duplicados el mismo día deben bloquearse
  PERFORM set_config('request.jwt.claim.sub', v_u[1]::text, true);
  v_res := public.register_for_match(v_test_date, 1::smallint);
  ASSERT (v_res->>'success')::boolean = false AND v_res->>'code' = 'ALREADY_REGISTERED',
    'Escenario E falló: se permitió doble inscripción en el mismo día';

  -- ESCENARIO A: Completar Partido 1 (jugador 4), abrir Partido 2 (5..8) y rechazar 9
  PERFORM set_config('request.jwt.claim.sub', v_u[4]::text, true);
  v_res := public.register_for_match(v_test_date, 1::smallint);
  ASSERT (v_res->>'assigned_match')::int = 1, 'Jugador 4 debe ir al Partido 1';

  FOR v_i IN 5..8 LOOP
    PERFORM set_config('request.jwt.claim.sub', v_u[v_i]::text, true);
    v_res := public.register_for_match(v_test_date, 2::smallint);
    ASSERT (v_res->>'success')::boolean = true AND (v_res->>'assigned_match')::int = 2,
      'Jugador ' || v_i || ' debe ir al Partido 2';
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', v_u[9]::text, true);
  v_res := public.register_for_match(v_test_date, 2::smallint);
  ASSERT (v_res->>'success')::boolean = false AND v_res->>'code' = 'DAY_FULL',
    'Escenario A falló: se permitió un 9º jugador';

  -- ESCENARIO C: Cancelación en Partido 1 -> ascenso automático desde Partido 2
  PERFORM set_config('request.jwt.claim.sub', v_u[2]::text, true);
  v_res := public.cancel_registration(v_test_date);
  ASSERT (v_res->>'success')::boolean = true, 'Cancelación de jugador 2 falló';

  -- Comprobar que Jugador5 ahora está en posición 4 (Partido 1)
  SELECT array_agg(first_name ORDER BY queue_position)
    INTO v_names
  FROM public.daily_queue_view
  WHERE match_date = v_test_date AND match_number = 1;

  ASSERT v_names = ARRAY['Jugador1', 'Jugador3', 'Jugador4', 'Jugador5'],
    'Escenario C falló: Partido 1 debería ser [1,3,4,5], fue ' || v_names::text;

  -- ESCENARIO D: Cancelar hasta quedar < 4 -> Partido 2 queda cerrado
  FOREACH v_i IN ARRAY ARRAY[1, 3, 4, 6] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_u[v_i]::text, true);
    PERFORM public.cancel_registration(v_test_date);
  END LOOP;

  SELECT COUNT(*) INTO v_count FROM public.registrations WHERE match_date = v_test_date;
  ASSERT v_count = 3, 'Deberían quedar 3 jugadores, quedaron ' || v_count;

  PERFORM set_config('request.jwt.claim.sub', v_u[9]::text, true);
  v_res := public.register_for_match(v_test_date, 2::smallint);
  ASSERT (v_res->>'success')::boolean = false AND v_res->>'code' = 'MATCH_2_CLOSED',
    'Escenario D falló: Partido 2 no se cerró tras bajar de 4 jugadores';

  RAISE NOTICE 'TODAS LAS PRUEBAS SQL PASARON CORRECTAMENTE (Escenarios A, B, C, D y E).';
END;
$$;

ROLLBACK;
