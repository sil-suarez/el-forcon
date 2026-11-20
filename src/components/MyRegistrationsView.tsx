import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { formatFullDateSpanish, getMadridTodayISO } from '../lib/dates';

interface MyRegistrationItem {
  registrationId: string;
  matchDate: string;
  matchNumber: 1 | 2;
  position: number;
  registeredBy: string | null;
  registeredByName: string | null;
}

interface CompanionRegistrationItem {
  registrationId: string;
  matchDate: string;
  matchNumber: 1 | 2;
  position: number;
  companionName: string;
}

interface MyRegistrationsViewProps {
  userId: string;
  onRequestCancel: (
    matchDate: string,
    matchNumber: 1 | 2,
    registrationId?: string,
    targetName?: string
  ) => void;
  refreshTrigger: number;
}

export function MyRegistrationsView({
  userId,
  onRequestCancel,
  refreshTrigger,
}: MyRegistrationsViewProps) {
  const [myItems, setMyItems] = useState<MyRegistrationItem[]>([]);
  const [companionItems, setCompanionItems] = useState<CompanionRegistrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const todayISO = getMadridTodayISO();

      const [ownRes, compRes] = await Promise.all([
        supabase
          .from('daily_queue_view')
          .select(
            'id, match_date, match_number, queue_position, registered_by, registrant_first_name, registrant_last_name'
          )
          .eq('user_id', userId)
          .gte('match_date', todayISO)
          .order('match_date', { ascending: true }),
        supabase
          .from('daily_queue_view')
          .select(
            'id, match_date, match_number, queue_position, user_id, first_name, last_name'
          )
          .eq('registered_by', userId)
          .gte('match_date', todayISO)
          .order('match_date', { ascending: true }),
      ]);

      if (ownRes.error) throw ownRes.error;
      if (compRes.error) throw compRes.error;

      setMyItems(
        (ownRes.data ?? []).map((r) => {
          const regByName = r.registrant_first_name
            ? `${r.registrant_first_name as string} ${(r.registrant_last_name as string) ?? ''}`.trim()
            : null;
          return {
            registrationId: r.id as string,
            matchDate: r.match_date as string,
            matchNumber: r.match_number as 1 | 2,
            position: r.queue_position as number,
            registeredBy: (r.registered_by as string | null) ?? null,
            registeredByName: regByName,
          };
        })
      );

      setCompanionItems(
        (compRes.data ?? [])
          .filter((r) => (r.user_id as string | null) !== userId)
          .map((r) => ({
            registrationId: r.id as string,
            matchDate: r.match_date as string,
            matchNumber: r.match_number as 1 | 2,
            position: r.queue_position as number,
            companionName: `${(r.first_name as string) ?? 'Acompañante'} ${(r.last_name as string) ?? ''}`.trim(),
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
    <>
      <section className="section-card">
        <h2 className="section-heading">Mis próximas inscripciones</h2>

        {loading && <p>Cargando tus partidos...</p>}
        {error && <div className="alert-box alert-error">{error}</div>}

        {!loading && !error && myItems.length === 0 && (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            No estás apuntado a ningún partido próximo. Puedes inscribirte desde la
            pestaña <strong>Partidos de la semana</strong>.
          </p>
        )}

        {!loading && myItems.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {myItems.map((item) => {
              const addedByFriend =
                item.registeredBy &&
                item.registeredBy !== userId &&
                item.registeredByName;

              return (
                <div
                  key={item.registrationId}
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
                    {addedByFriend && (
                      <div
                        style={{
                          fontSize: '0.88rem',
                          color: 'var(--text-secondary)',
                          marginTop: 4,
                        }}
                      >
                        Apuntado por {item.registeredByName}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn-cancel-open"
                    style={{ width: 'auto', minWidth: 200 }}
                    onClick={() =>
                      onRequestCancel(
                        item.matchDate,
                        item.matchNumber,
                        item.registrationId
                      )
                    }
                  >
                    DARME DE BAJA
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {!loading && !error && companionItems.length > 0 && (
        <section className="section-card">
          <h2 className="section-heading">Acompañantes que has apuntado</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {companionItems.map((item) => (
              <div
                key={item.registrationId}
                style={{
                  border: '2px solid #93c5fd',
                  backgroundColor: '#eff6ff',
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
                  <div style={{ fontWeight: 800, color: '#1e3a8a' }}>
                    {item.companionName}
                  </div>
                  <div style={{ fontWeight: 600, marginTop: 4 }}>
                    {formatFullDateSpanish(item.matchDate)} · Partido {item.matchNumber} · 19:00 (Posición {item.position})
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-cancel-open"
                  style={{ width: 'auto', minWidth: 200 }}
                  onClick={() =>
                    onRequestCancel(
                      item.matchDate,
                      item.matchNumber,
                      item.registrationId,
                      item.companionName
                    )
                  }
                >
                  DAR DE BAJA
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
