import { useEffect, useRef } from 'react';
import { formatFullDateSpanish } from '../lib/dates';

interface CancelConfirmModalProps {
  isOpen: boolean;
  matchDate: string;
  matchNumber: 1 | 2;
  loading: boolean;
  onKeepSpot: () => void;
  onConfirmCancel: () => void;
}

export function CancelConfirmModal({
  isOpen,
  matchDate,
  matchNumber,
  loading,
  onKeepSpot,
  onConfirmCancel,
}: CancelConfirmModalProps) {
  const keepButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      keepButtonRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onKeepSpot();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onKeepSpot]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onKeepSpot();
        }
      }}
    >
      <div className="modal-dialog">
        <h3 id="cancel-modal-title" className="modal-title">
          ¿Seguro que quieres desapuntarte?
        </h3>

        <p className="modal-text" style={{ fontWeight: 700, color: '#14532d' }}>
          {formatFullDateSpanish(matchDate)} · Partido {matchNumber} (19:00)
        </p>

        {matchNumber === 1 ? (
          <>
            <p className="modal-text">
              Si cancelas tu inscripción, otra persona podrá ocupar tu plaza y
              avanzar al Partido 1.
            </p>
            <p className="modal-text">
              Si después quieres volver a apuntarte, perderás tu posición actual
              en la cola y podrías acabar en el Partido 2 o quedarte sin plaza si
              los partidos se completan.
            </p>
          </>
        ) : (
          <p className="modal-text">
            Si cancelas tu inscripción, liberarás tu plaza del Partido 2. Si
            después quieres volver a apuntarte, tendrás que hacerlo de nuevo y
            ocuparás la última posición disponible.
          </p>
        )}

        <div className="modal-actions">
          <button
            ref={keepButtonRef}
            type="button"
            className="btn-keep-spot"
            disabled={loading}
            onClick={onKeepSpot}
          >
            NO, MANTENER MI PLAZA
          </button>

          <button
            type="button"
            className="btn-confirm-cancel"
            disabled={loading}
            onClick={onConfirmCancel}
          >
            {loading ? 'Procesando baja...' : 'SÍ, DESAPUNTARME'}
          </button>
        </div>
      </div>
    </div>
  );
}
