import { useEffect, useRef, useState, FormEvent } from 'react';
import { formatFullDateSpanish } from '../lib/dates';
import { isValidPhone } from '../lib/phone';

interface CompanionModalProps {
  isOpen: boolean;
  matchDate: string;
  matchNumber: 1 | 2;
  loading: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    firstName: string;
    lastName: string;
    phone: string;
  }) => Promise<void>;
}

export function CompanionModal({
  isOpen,
  matchDate,
  matchNumber,
  loading,
  onClose,
  onSubmit,
}: CompanionModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFirstName('');
      setLastName('');
      setPhone('');
      setFormError(null);
      window.setTimeout(() => {
        firstInputRef.current?.focus();
      }, 0);
    }
  }, [isOpen, matchDate, matchNumber]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();

    if (!cleanFirst || !cleanLast) {
      setFormError('Introduce el nombre y apellidos de tu acompañante.');
      return;
    }
    if (!isValidPhone(phone)) {
      setFormError('Introduce un número de teléfono válido (al menos 9 dígitos).');
      return;
    }

    await onSubmit({
      firstName: cleanFirst,
      lastName: cleanLast,
      phone: phone.trim(),
    });
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="companion-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onClose();
        }
      }}
    >
      <div className="modal-dialog">
        <h3 id="companion-modal-title" className="modal-title">
          Apuntar a un acompañante
        </h3>

        <p className="modal-text" style={{ fontWeight: 700, color: '#14532d' }}>
          {formatFullDateSpanish(matchDate)} · Partido {matchNumber} (19:00)
        </p>

        <p className="modal-text">
          Introduce sus datos. Si ya tiene cuenta con ese teléfono, el partido
          aparecerá automáticamente en sus inscripciones; si aún no está
          registrado, se le vinculará en cuanto cree su cuenta.
        </p>

        {formError && <div className="alert-box alert-error">{formError}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label" htmlFor="comp-first-name">
              Nombre del acompañante
            </label>
            <input
              ref={firstInputRef}
              id="comp-first-name"
              type="text"
              className="form-input"
              required
              disabled={loading}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="comp-last-name">
              Apellidos del acompañante
            </label>
            <input
              id="comp-last-name"
              type="text"
              className="form-input"
              required
              disabled={loading}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="comp-phone">
              Teléfono móvil
            </label>
            <input
              id="comp-phone"
              type="tel"
              className="form-input"
              required
              disabled={loading}
              placeholder="Ej. 612 345 678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="modal-actions">
            <button
              type="submit"
              className="btn-keep-spot"
              disabled={loading}
            >
              {loading ? 'Apuntando...' : 'CONFIRMAR INSCRIPCIÓN'}
            </button>

            <button
              type="button"
              className="btn-secondary"
              disabled={loading}
              onClick={onClose}
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
