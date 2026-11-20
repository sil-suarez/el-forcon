import { useState, FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { Header } from './Header';

interface ResetPasswordViewProps {
  onDone: () => void;
}

export function ResetPasswordView({ onDone }: ResetPasswordViewProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        setError('No se ha podido actualizar la contraseña.');
        return;
      }
      setSuccess(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header />
      <main className="auth-wrapper">
        <div className="auth-card">
          <h2 className="auth-title">Nueva contraseña</h2>
          <p className="auth-subtitle">
            Introduce tu nueva contraseña para acceder a El Forcón.
          </p>

          {error && <div className="alert-box alert-error">{error}</div>}

          {success ? (
            <>
              <div className="alert-box alert-success">
                Contraseña actualizada correctamente.
              </div>
              <button type="button" className="btn-primary" onClick={onDone}>
                IR A LOS PARTIDOS
              </button>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-field">
                <label className="form-label" htmlFor="new-pass">
                  Nueva contraseña (mínimo 8 caracteres)
                </label>
                <input
                  id="new-pass"
                  type="password"
                  className="form-input"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="form-field">
                <label className="form-label" htmlFor="confirm-new-pass">
                  Confirmar contraseña
                </label>
                <input
                  id="confirm-new-pass"
                  type="password"
                  className="form-input"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Guardando...' : 'GUARDAR NUEVA CONTRASEÑA'}
              </button>
            </form>
          )}
        </div>
      </main>
    </>
  );
}
