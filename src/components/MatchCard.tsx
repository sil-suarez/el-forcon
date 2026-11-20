import { QueuePlayer } from '../types/database';

interface MatchCardProps {
  matchNumber: 1 | 2;
  players: QueuePlayer[];
  totalDayRegistered: number;
  currentUserMatch: 1 | 2 | null;
  isPastDay: boolean;
  busyAction: boolean;
  onRegister: (matchNumber: 1 | 2) => void;
  onRequestCancel: (matchNumber: 1 | 2) => void;
}

export function MatchCard({
  matchNumber,
  players,
  totalDayRegistered,
  currentUserMatch,
  isPastDay,
  busyAction,
  onRegister,
  onRequestCancel,
}: MatchCardProps) {
  const isUserInThisMatch = currentUserMatch === matchNumber;
  const isUserInOtherMatch =
    currentUserMatch !== null && currentUserMatch !== matchNumber;

  const isMatch2Closed = matchNumber === 2 && totalDayRegistered < 4;
  const isFull = players.length >= 4;

  let statusLabel = 'Disponible';
  let statusClass = 'status-available';

  if (isUserInThisMatch) {
    statusLabel = 'Mi partido';
    statusClass = 'status-mine';
  } else if (isMatch2Closed) {
    statusLabel = 'Cerrado';
    statusClass = 'status-closed';
  } else if (isFull) {
    statusLabel = 'Completo';
    statusClass = 'status-full';
  }

  const cardClass = [
    'match-card',
    isUserInThisMatch ? 'match-card-mine' : '',
    isMatch2Closed ? 'match-card-closed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const slots = [0, 1, 2, 3];

  return (
    <article className={cardClass}>
      <div>
        <div className="match-card-header">
          <div>
            <h4 className="match-title">PARTIDO {matchNumber} · 19:00</h4>
            <p className="match-count">
              {isMatch2Closed
                ? 'Pendiente de completar el Partido 1'
                : `${players.length} de 4 jugadores`}
            </p>
          </div>
          <span className={`status-badge ${statusClass}`}>{statusLabel}</span>
        </div>

        <div style={{ marginTop: 14 }}>
          {isMatch2Closed ? (
            <p className="closed-explanation">
              Cerrado. Se abrirá automáticamente cuando el Partido 1 esté completo.
            </p>
          ) : (
            <ul className="players-list">
              {slots.map((slotIndex) => {
                const player = players[slotIndex];
                if (player) {
                  return (
                    <li
                      key={player.registrationId}
                      className={`player-slot ${
                        player.isCurrentUser
                          ? 'player-slot-me'
                          : 'player-slot-filled'
                      }`}
                    >
                      <span className="slot-number">{slotIndex + 1}</span>
                      <span>
                        {player.fullName}
                        {player.isCurrentUser ? ' (Tú)' : ''}
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={`empty-${slotIndex}`} className="player-slot player-slot-empty">
                    <span className="slot-number">{slotIndex + 1}</span>
                    <span>Plaza disponible</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="match-actions">
        {isPastDay ? (
          <p className="info-note">Fecha pasada (solo consulta)</p>
        ) : isUserInThisMatch ? (
          <>
            <div className="already-registered-box">YA ESTÁS APUNTADO</div>
            <button
              type="button"
              className="btn-cancel-open"
              disabled={busyAction}
              onClick={() => onRequestCancel(matchNumber)}
            >
              DARME DE BAJA
            </button>
          </>
        ) : isUserInOtherMatch ? (
          <p className="info-note">Ya estás inscrito en el Partido {currentUserMatch}</p>
        ) : isMatch2Closed ? (
          <p className="info-note">El Partido 2 todavía no está abierto</p>
        ) : isFull ? (
          <p className="info-note">Partido completo</p>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={busyAction}
            onClick={() => onRegister(matchNumber)}
          >
            {busyAction ? 'Procesando...' : 'APUNTARME'}
          </button>
        )}
      </div>
    </article>
  );
}
