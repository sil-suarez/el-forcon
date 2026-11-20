import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  DaySchedule,
  QueuePlayer,
  RegistrationRow,
} from '../types/database';
import {
  addDaysISO,
  getMadridTodayISO,
  getWeekdaysFromMonday,
} from '../lib/dates';

interface UseWeekMatchesResult {
  days: DaySchedule[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useWeekMatches(
  mondayISO: string,
  currentUserId: string | undefined
): UseWeekMatchesResult {
  const [days, setDays] = useState<DaySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const isInitialLoadRef = useRef(true);

  const loadWeek = useCallback(
    async (silent = false) => {
      if (!currentUserId) return;

      if (!silent) {
        setLoading(true);
      }
      setError(null);

      try {
        const weekdays = getWeekdaysFromMonday(mondayISO);
        const fridayISO = addDaysISO(mondayISO, 4);
        const todayISO = getMadridTodayISO();

        // 1. Garantizar de forma idempotente los 10 partidos (lun-vie)
        const { error: ensureError } = await supabase.rpc('ensure_week_matches', {
          p_any_date: mondayISO,
        });

        if (ensureError) {
          throw ensureError;
        }

        // 2. Obtener todas las inscripciones de la semana ordenadas cronológicamente
        const { data: regData, error: regError } = await supabase
          .from('registrations')
          .select(
            `
            id,
            match_date,
            user_id,
            registered_at,
            queue_seq,
            profiles (
              id,
              first_name,
              last_name
            )
          `
          )
          .gte('match_date', mondayISO)
          .lte('match_date', fridayISO)
          .order('registered_at', { ascending: true })
          .order('queue_seq', { ascending: true });

        if (regError) {
          throw regError;
        }

        const registrations = (regData ?? []) as unknown as RegistrationRow[];

        // Agrupar por día respetando la cola cronológica
        const byDate = new Map<string, RegistrationRow[]>();
        for (const row of registrations) {
          const list = byDate.get(row.match_date) ?? [];
          list.push(row);
          byDate.set(row.match_date, list);
        }

        const schedules: DaySchedule[] = weekdays.map((dateISO) => {
          const dayRows = byDate.get(dateISO) ?? [];
          const queuePlayers: QueuePlayer[] = dayRows.map((row, idx) => {
            const position = idx + 1;
            const matchNumber: 1 | 2 = position <= 4 ? 1 : 2;
            const firstName = row.profiles?.first_name ?? 'Jugador';
            const lastName = row.profiles?.last_name ?? '';
            const fullName = `${firstName} ${lastName}`.trim();

            return {
              registrationId: row.id,
              userId: row.user_id,
              fullName,
              position,
              matchNumber,
              registeredAt: row.registered_at,
              isCurrentUser: row.user_id === currentUserId,
            };
          });

          const match1Players = queuePlayers.filter((p) => p.matchNumber === 1);
          const match2Players = queuePlayers.filter((p) => p.matchNumber === 2);
          const currentUserEntry = queuePlayers.find((p) => p.isCurrentUser);

          return {
            date: dateISO,
            isPast: dateISO < todayISO,
            isToday: dateISO === todayISO,
            totalRegistered: queuePlayers.length,
            match1Players,
            match2Players,
            currentUserMatch: currentUserEntry ? currentUserEntry.matchNumber : null,
          };
        });

        setDays(schedules);
      } catch (err) {
        console.error('Error cargando partidos:', err);
        setError('No se han podido cargar los partidos. Inténtalo de nuevo.');
      } finally {
        setLoading(false);
        isInitialLoadRef.current = false;
      }
    },
    [mondayISO, currentUserId]
  );

  useEffect(() => {
    isInitialLoadRef.current = true;
    void loadWeek(false);
  }, [loadWeek]);

  // Suscripción Realtime limpia (escucha cambios de cualquier jugador al instante)
  useEffect(() => {
    if (!currentUserId) return;

    const scheduleSilentReload = () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        void loadWeek(true);
      }, 120);
    };

    const channel = supabase
      .channel(`week-sync-${mondayISO}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'registrations' },
        scheduleSilentReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        scheduleSilentReload
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        scheduleSilentReload
      )
      .subscribe();

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      void supabase.removeChannel(channel);
    };
  }, [mondayISO, currentUserId, loadWeek]);

  return {
    days,
    loading,
    error,
    reload: () => loadWeek(true),
  };
}
