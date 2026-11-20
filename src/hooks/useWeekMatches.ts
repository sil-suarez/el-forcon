import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { DaySchedule, QueuePlayer } from '../types/database';
import {
  addDaysISO,
  getMadridTodayISO,
  getWeekdaysFromMonday,
} from '../lib/dates';

interface DailyQueueRow {
  id: string;
  match_date: string;
  user_id: string | null;
  registered_by: string | null;
  registered_at: string;
  queue_seq: number;
  first_name: string;
  last_name: string;
  registrant_first_name: string | null;
  registrant_last_name: string | null;
  queue_position: number;
  match_number: 1 | 2;
}

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

        // 2. Obtener todas las inscripciones de la semana desde la vista ordenada
        const { data: queueData, error: queueError } = await supabase
          .from('daily_queue_view')
          .select(
            'id, match_date, user_id, registered_by, registered_at, queue_seq, first_name, last_name, registrant_first_name, registrant_last_name, queue_position, match_number'
          )
          .gte('match_date', mondayISO)
          .lte('match_date', fridayISO)
          .order('match_date', { ascending: true })
          .order('queue_position', { ascending: true });

        if (queueError) {
          throw queueError;
        }

        const rows = (queueData ?? []) as DailyQueueRow[];

        // Agrupar por día respetando la cola cronológica
        const byDate = new Map<string, DailyQueueRow[]>();
        for (const row of rows) {
          const list = byDate.get(row.match_date) ?? [];
          list.push(row);
          byDate.set(row.match_date, list);
        }

        const schedules: DaySchedule[] = weekdays.map((dateISO) => {
          const dayRows = byDate.get(dateISO) ?? [];
          const queuePlayers: QueuePlayer[] = dayRows.map((row, idx) => {
            const position = row.queue_position ?? idx + 1;
            const matchNumber: 1 | 2 = position <= 4 ? 1 : 2;
            const fullName = `${row.first_name ?? 'Jugador'} ${row.last_name ?? ''}`.trim();
            const registeredByName = row.registrant_first_name
              ? `${row.registrant_first_name} ${row.registrant_last_name ?? ''}`.trim()
              : null;
            const isCurrentUser = row.user_id === currentUserId;
            const isCompanionByMe =
              !isCurrentUser && row.registered_by === currentUserId;

            return {
              registrationId: row.id,
              userId: row.user_id,
              registeredBy: row.registered_by,
              registeredByName,
              fullName,
              position,
              matchNumber,
              registeredAt: row.registered_at,
              isCurrentUser,
              isCompanionByMe,
              isGuestAccount: row.user_id === null,
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
