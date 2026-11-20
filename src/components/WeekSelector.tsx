import { formatWeekRangeLabel } from '../lib/dates';

interface WeekSelectorProps {
  mondayISO: string;
  onPrevWeek: () => void;
  onCurrentWeek: () => void;
  onNextWeek: () => void;
}

export function WeekSelector({
  mondayISO,
  onPrevWeek,
  onCurrentWeek,
  onNextWeek,
}: WeekSelectorProps) {
  return (
    <section className="week-selector" aria-label="Selector de semana">
      <h2 className="week-range-text">{formatWeekRangeLabel(mondayISO)}</h2>
      <div className="week-buttons-row">
        <button
          type="button"
          className="btn-week"
          onClick={onPrevWeek}
          aria-label="Semana anterior"
        >
          ← Anterior
        </button>
        <button
          type="button"
          className="btn-week btn-week-current"
          onClick={onCurrentWeek}
        >
          Semana actual
        </button>
        <button
          type="button"
          className="btn-week"
          onClick={onNextWeek}
          aria-label="Semana siguiente"
        >
          Siguiente →
        </button>
      </div>
    </section>
  );
}
