import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  AdminUserRow,
  AuditLogRow,
  DaySchedule,
  RpcActionResponse,
} from '../types/database';
import {
  formatFullDateSpanish,
  formatMadridTimestamp,
} from '../lib/dates';
import { formatPhoneDisplay } from '../lib/phone';
import { WeekSelector } from './WeekSelector';

interface AdminPanelProps {
  currentAdminId: string;
  mondayISO: string;
  days: DaySchedule[];
  onPrevWeek: () => void;
  onCurrentWeek: () => void;
  onNextWeek: () => void;
  onNotify: (type: 'success' | 'error', text: string) => void;
  onMatchesChanged: () => Promise<void>;
}

type AdminTab = 'matches' | 'users' | 'logs';

export function AdminPanel({
  currentAdminId,
  mondayISO,
  days,
  onPrevWeek,
  onCurrentWeek,
  onNextWeek,
  onNotify,
  onMatchesChanged,
}: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>('matches');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedUserByDate, setSelectedUserByDate] = useState<
    Record<string, string>
  >({});

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_users');
      if (error) throw error;
      setUsers((data ?? []) as AdminUserRow[]);
    } catch (err) {
      console.error(err);
      onNotify('error', 'No se pudo cargar la lista de usuarios.');
    } finally {
      setLoadingUsers(false);
    }
  }, [onNotify]);

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_audit_logs', {
        p_limit: 100,
      });
      if (error) throw error;
      setLogs((data ?? []) as AuditLogRow[]);
    } catch (err) {
      console.error(err);
      onNotify('error', 'No se pudo cargar el registro de cambios.');
    } finally {
      setLoadingLogs(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (tab === 'logs') {
      void loadLogs();
    }
  }, [tab, loadLogs]);

  const handleAddPlayer = async (matchDate: string) => {
    const targetUserId = selectedUserByDate[matchDate];
    if (!targetUserId) {
      onNotify('error', 'Selecciona primero un jugador de la lista.');
      return;
    }

    setBusyKey(`add-${matchDate}`);
    try {
      const { data, error } = await supabase.rpc('admin_add_registration', {
        p_match_date: matchDate,
        p_target_user_id: targetUserId,
      });
      if (error) throw error;
      const res = data as RpcActionResponse;
      onNotify(res.success ? 'success' : 'error', res.message);
      if (res.success) {
        setSelectedUserByDate((prev) => ({ ...prev, [matchDate]: '' }));
        await onMatchesChanged();
      }
    } catch {
      onNotify('error', 'No se pudo añadir al jugador.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemovePlayer = async (
    matchDate: string,
    registrationId: string,
    userId: string | null
  ) => {
    setBusyKey(`rem-${matchDate}-${registrationId}`);
    try {
      const { data, error } = await supabase.rpc('admin_remove_registration', {
        p_match_date: matchDate,
        p_target_user_id: userId,
        p_registration_id: registrationId,
      });
      if (error) throw error;
      const res = data as RpcActionResponse;
      onNotify(res.success ? 'success' : 'error', res.message);
      if (res.success) {
        await onMatchesChanged();
      }
    } catch {
      onNotify('error', 'No se pudo eliminar la inscripción.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleActive = async (user: AdminUserRow) => {
    setBusyKey(`toggle-${user.id}`);
    try {
      const { data, error } = await supabase.rpc('admin_set_user_active', {
        p_target_user_id: user.id,
        p_is_active: !user.is_active,
      });
      if (error) throw error;
      const res = data as RpcActionResponse;
      onNotify(res.success ? 'success' : 'error', res.message);
      if (res.success) {
        await Promise.all([loadUsers(), onMatchesChanged()]);
      }
    } catch {
      onNotify('error', 'No se pudo actualizar el estado del usuario.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteUser = async (user: AdminUserRow) => {
    const confirmed = window.confirm(
      `¿Eliminar definitivamente a ${user.first_name} ${user.last_name}? Se borrarán también sus inscripciones.`
    );
    if (!confirmed) return;

    setBusyKey(`del-${user.id}`);
    try {
      const { data, error } = await supabase.rpc('admin_delete_user', {
        p_target_user_id: user.id,
      });
      if (error) throw error;
      const res = data as RpcActionResponse;
      onNotify(res.success ? 'success' : 'error', res.message);
      if (res.success) {
        await Promise.all([loadUsers(), onMatchesChanged()]);
      }
    } catch {
      onNotify('error', 'No se pudo eliminar la cuenta.');
    } finally {
      setBusyKey(null);
    }
  };

  const activeUsers = users.filter((u) => u.is_active);

  return (
    <div>
      <section className="section-card">
        <h2 className="section-heading">Panel de administración</h2>
        <div className="main-nav" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className={`nav-tab ${tab === 'matches' ? 'active' : ''}`}
            onClick={() => setTab('matches')}
          >
            Partidos e inscripciones
          </button>
          <button
            type="button"
            className={`nav-tab ${tab === 'users' ? 'active' : ''}`}
            onClick={() => setTab('users')}
          >
            Usuarios ({users.length})
          </button>
          <button
            type="button"
            className={`nav-tab ${tab === 'logs' ? 'active' : ''}`}
            onClick={() => setTab('logs')}
          >
            Historial de cambios
          </button>
        </div>
      </section>

      {tab === 'matches' && (
        <>
          <WeekSelector
            mondayISO={mondayISO}
            onPrevWeek={onPrevWeek}
            onCurrentWeek={onCurrentWeek}
            onNextWeek={onNextWeek}
          />

          <div className="days-list">
            {days.map((day) => {
              const allPlayers = [...day.match1Players, ...day.match2Players];
              const registeredIds = new Set(
                allPlayers.map((p) => p.userId).filter((id): id is string => Boolean(id))
              );
              const availableToAdd = activeUsers.filter(
                (u) => !registeredIds.has(u.id)
              );

              return (
                <section key={day.date} className="section-card">
                  <h3 className="section-heading">
                    {formatFullDateSpanish(day.date)} · {day.totalRegistered}/8
                    jugadores
                  </h3>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 10,
                      marginBottom: 16,
                    }}
                  >
                    <select
                      className="form-input"
                      style={{ flex: '1 1 240px' }}
                      value={selectedUserByDate[day.date] ?? ''}
                      onChange={(e) =>
                        setSelectedUserByDate((prev) => ({
                          ...prev,
                          [day.date]: e.target.value,
                        }))
                      }
                      aria-label={`Seleccionar jugador para ${day.date}`}
                    >
                      <option value="">
                        -- Seleccionar jugador para añadir --
                      </option>
                      {availableToAdd.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.first_name} {u.last_name}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className="btn-primary"
                      style={{ width: 'auto', minWidth: 200 }}
                      disabled={
                        day.totalRegistered >= 8 ||
                        busyKey === `add-${day.date}`
                      }
                      onClick={() => handleAddPlayer(day.date)}
                    >
                      {busyKey === `add-${day.date}`
                        ? 'Añadiendo...'
                        : 'Añadir a la cola'}
                    </button>
                  </div>

                  {allPlayers.length === 0 ? (
                    <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                      No hay inscripciones este día.
                    </p>
                  ) : (
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Posición</th>
                            <th>Partido</th>
                            <th>Jugador</th>
                            <th>Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allPlayers.map((player) => (
                            <tr key={player.registrationId}>
                              <td>{player.position}</td>
                              <td>Partido {player.matchNumber}</td>
                              <td>
                                {player.fullName}
                                {player.registeredByName &&
                                player.registeredBy !== player.userId
                                  ? ` (por ${player.registeredByName})`
                                  : ''}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn-small btn-small-danger"
                                  disabled={
                                    busyKey ===
                                    `rem-${day.date}-${player.registrationId}`
                                  }
                                  onClick={() =>
                                    handleRemovePlayer(
                                      day.date,
                                      player.registrationId,
                                      player.userId
                                    )
                                  }
                                >
                                  Quitar
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {tab === 'users' && (
        <section className="section-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h3 className="section-heading" style={{ margin: 0 }}>
              Usuarios registrados
            </h3>
            <button type="button" className="btn-small" onClick={loadUsers}>
              Actualizar
            </button>
          </div>

          {loadingUsers ? (
            <p>Cargando usuarios...</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Nombre y apellidos</th>
                    <th>Teléfono</th>
                    <th>Correo</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = u.id === currentAdminId;
                    return (
                      <tr key={u.id}>
                        <td>
                          {u.first_name} {u.last_name}
                        </td>
                        <td>{formatPhoneDisplay(u.phone)}</td>
                        <td>{u.email}</td>
                        <td>{u.role === 'admin' ? 'Administrador' : 'Jugador'}</td>
                        <td>
                          {!u.email_confirmed
                            ? 'Correo sin verificar'
                            : u.is_active
                            ? 'Activa'
                            : 'Desactivada'}
                        </td>
                        <td>
                          {isSelf ? (
                            <span>Tu cuenta</span>
                          ) : (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn-small"
                                disabled={busyKey === `toggle-${u.id}`}
                                onClick={() => handleToggleActive(u)}
                              >
                                {u.is_active ? 'Desactivar' : 'Reactivar'}
                              </button>
                              <button
                                type="button"
                                className="btn-small btn-small-danger"
                                disabled={busyKey === `del-${u.id}`}
                                onClick={() => handleDeleteUser(u)}
                              >
                                Eliminar
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'logs' && (
        <section className="section-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h3 className="section-heading" style={{ margin: 0 }}>
              Últimos cambios realizados
            </h3>
            <button type="button" className="btn-small" onClick={loadLogs}>
              Actualizar
            </button>
          </div>

          {loadingLogs ? (
            <p>Cargando historial...</p>
          ) : logs.length === 0 ? (
            <p>No hay movimientos registrados todavía.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Fecha/Hora</th>
                    <th>Acción</th>
                    <th>Realizado por</th>
                    <th>Jugador</th>
                    <th>Día partido</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatMadridTimestamp(log.created_at)}</td>
                      <td>{log.action}</td>
                      <td>{log.actor_name ?? '-'}</td>
                      <td>{log.target_name ?? '-'}</td>
                      <td>{log.match_date ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
