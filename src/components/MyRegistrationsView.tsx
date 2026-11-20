import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { formatFullDateSpanish, getMadridTodayISO } from '../lib/dates';

interface MyRegistrationItem {
  matchDate: string;
  matchNumber: 1 | 2;
  position: number;
}

interface MyRegistrationsViewProps {
  userId: string;
  onRequestCancel: (matchDate: string, matchNumber: 1 | 2) => void;
  refreshTrigger: number;
}

export function MyRegistrationsView({
  userId,
  onRequestCancel,
  refreshTrigger,
}: MyRegistrationsViewProps) {
  const [items, setItems] = useState<MyRegistrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const todayISO = getMadridTodayISO();
      const { data, error: queryError } = await supabase
        .from('daily_queue_view')
        .select('match_date, match_number, queue_position')
        .eq('user_id', userId)
        .gte('match_date', todayISO)
        .order('match_date', { ascending: true });

      if (queryError) throw queryError;

      setItems(
        (data ?? []).map((r) => ({
          matchDate: r.match_date as string,
          matchNumber: r.match_number as 1 | 2,
          position: r.queue_position as number,
        }))
      );
    } catch (err) {
      console.error(err);
      setError('No se han podido cargar tus inscripciones.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadMine();
  }, [loadMine, refreshTrigger]);

  return (
    <section className="section-card">
      <h2 className="section-heading">Mis próximas inscripciones</h2>

      {loading && <p>Cargando tus partidos...</p>}
      {error && <div className="alert-box alert-error">{error}</div>}

      {!loading && !error && items.length === 0 && (
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>
          No estás apuntado a ningún partido próximo. Puedes inscribirte desde la
          pestaña <strong>Partidos de la semana</strong>.
        </p>
      )}

      {!loading && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((item) => (
            <div
              key={item.matchDate}
              style={{
                border: '2px solid var(--green-dark)',
                backgroundColor: 'var(--green-my-bg)',
                borderRadius: 12,
                padding: 16,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 800, color: 'var(--green-dark)' }}>
                  {formatFullDateSpanish(item.matchDate)}
                </div>
                <div style={{ fontWeight: 600, marginTop: 4 }}>
                  Partido {item.matchNumber} · 19:00 (Posición {item.position} en la cola)
                </div>
              </div>

              <button
                type="button"
                className="btn-cancel-open"
                style={{ width: 'auto', minWidth: 200 }}
                onClick={() => onRequestCancel(item.matchDate, item.matchNumber)}
              >
                DARME DE BAJA
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
