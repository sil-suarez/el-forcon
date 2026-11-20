import { DaySchedule } from '../types/database';
import { formatDayHeading } from '../lib/dates';
import { MatchCard } from './MatchCard';

interface DayBlockProps {
  day: DaySchedule;
  busyDate: string | null;
  onRegister: (matchDate: string, matchNumber: 1 | 2) => void;
  onRequestCompanion: (matchDate: string, matchNumber: 1 | 2) => void;
  onRequestCancel: (
    matchDate: string,
    matchNumber: 1 | 2,
    registrationId?: string,
    targetName?: string
  ) => void;
}

export function DayBlock({
  day,
  busyDate,
  onRegister,
  onRequestCompanion,
  onRequestCancel,
}: DayBlockProps) {
  const isBusy = busyDate === day.date;

  return (
    <section
      className={`day-block ${day.isPast ? 'day-block-past' : ''}`}
      aria-label={formatDayHeading(day.date)}
    >
      <div className="day-header">
        <h3 className="day-title">{formatDayHeading(day.date)}</h3>
        {day.isToday && <span className="day-badge day-badge-today">HOY</span>}
        {day.isPast && (
          <span className="day-badge day-badge-past">Partido finalizado</span>
        )}
      </div>

      <div className="matches-grid">
        <MatchCard
          matchNumber={1}
          players={day.match1Players}
          totalDayRegistered={day.totalRegistered}
          currentUserMatch={day.currentUserMatch}
          isPastDay={day.isPast}
          busyAction={isBusy}
          onRegister={(num) => onRegister(day.date, num)}
          onRequestCompanion={(num) => onRequestCompanion(day.date, num)}
          onRequestCancel={(num, regId, targetName) =>
            onRequestCancel(day.date, num, regId, targetName)
          }
        />
        <MatchCard
          matchNumber={2}
          players={day.match2Players}
          totalDayRegistered={day.totalRegistered}
          currentUserMatch={day.currentUserMatch}
          isPastDay={day.isPast}
          busyAction={isBusy}
          onRegister={(num) => onRegister(day.date, num)}
          onRequestCompanion={(num) => onRequestCompanion(day.date, num)}
          onRequestCancel={(num, regId, targetName) =>
            onRequestCancel(day.date, num, regId, targetName)
          }
        />
      </div>
    </section>
  );
}
