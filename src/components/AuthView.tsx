import { useState, FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { Header } from './Header';

type AuthMode = 'login' | 'register' | 'forgot';

export function AuthView() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const resetMessages = () => {
    setError(null);
    setSuccessMsg(null);
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    resetMessages();
    setLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        if (signInError.message.toLowerCase().includes('email not confirmed')) {
          setError(
            'Debes confirmar tu correo electrónico antes de entrar. Revisa tu bandeja de entrada.'
          );
        } else {
          setError('Correo electrónico o contraseña incorrectos.');
        }
      }
    } catch {
      setError('No se ha podido iniciar sesión. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    resetMessages();

    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();
    const cleanEmail = email.trim();

    if (!cleanFirst || !cleanLast) {
      setError('Introduce tu nombre y apellidos.');
      return;
    }

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            first_name: cleanFirst,
            last_name: cleanLast,
          },
        },
      });

      if (signUpError) {
        if (signUpError.message.toLowerCase().includes('already registered')) {
          setError('Ya existe una cuenta registrada con ese correo electrónico.');
        } else {
          setError('No se pudo completar el registro. Revisa los datos.');
        }
        return;
      }

      if (data.session) {
        setSuccessMsg('Cuenta creada correctamente.');
      } else {
        setSuccessMsg(
          'Registro completado. Hemos enviado un enlace de verificación a tu correo electrónico. Ábrelo para activar tu cuenta.'
        );
        setPassword('');
        setConfirmPassword('');
      }
    } catch {
      setError('No se ha podido crear la cuenta. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault();
    resetMessages();
    setLoading(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: window.location.origin,
        }
      );

      if (resetError) {
        setError('No se ha podido enviar el correo de recuperación.');
        return;
      }

      setSuccessMsg(
        'Si ese correo está registrado, recibirás un enlace para crear una nueva contraseña.'
      );
    } catch {
      setError('Error al solicitar la recuperación de contraseña.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header />
      <main className="auth-wrapper">
        <div className="auth-card">
          {mode === 'login' && (
            <>
              <h2 className="auth-title">Iniciar sesión</h2>
              <p className="auth-subtitle">
                Accede con tu correo y contraseña para consultar y apuntarte a los
                partidos de El Forcón.
              </p>

              {error && <div className="alert-box alert-error">{error}</div>}
              {successMsg && (
                <div className="alert-box alert-success">{successMsg}</div>
              )}

              <form onSubmit={handleLogin}>
                <div className="form-field">
                  <label className="form-label" htmlFor="login-email">
                    Correo electrónico
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    className="form-input"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="login-password">
                    Contraseña
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    className="form-input"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="btn-primary"
                  disabled={loading}
                >
                  {loading ? 'Entrando...' : 'ENTRAR'}
                </button>
              </form>

              <div className="auth-links">
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => {
                    resetMessages();
                    setMode('register');
                  }}
                >
                  ¿No tienes cuenta? Regístrate aquí
                </button>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => {
                    resetMessages();
                    setMode('forgot');
                  }}
                >
                  He olvidado mi contraseña
                </button>
              </div>
            </>
          )}

          {mode === 'register' && (
            <>
              <h2 className="auth-title">Crear cuenta</h2>
              <p className="auth-subtitle">
                Introduce tus datos para aparecer en los listados de los partidos.
              </p>

              {error && <div className="alert-box alert-error">{error}</div>}
              {successMsg && (
                <div className="alert-box alert-success">{successMsg}</div>
              )}

              <form onSubmit={handleRegister}>
                <div className="form-field">
                  <label className="form-label" htmlFor="reg-first">
                    Nombre
                  </label>
                  <input
                    id="reg-first"
                    type="text"
                    className="form-input"
                    required
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="reg-last">
                    Apellidos
                  </label>
                  <input
                    id="reg-last"
                    type="text"
                    className="form-input"
                    required
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="reg-email">
                    Correo electrónico
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    className="form-input"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="reg-pass">
                    Contraseña (mínimo 8 caracteres)
                  </label>
                  <input
                    id="reg-pass"
                    type="password"
                    className="form-input"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="reg-confirm">
                    Confirmar contraseña
                  </label>
                  <input
                    id="reg-confirm"
                    type="password"
                    className="form-input"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="btn-primary"
                  disabled={loading}
                >
                  {loading ? 'Creando cuenta...' : 'CREAR CUENTA'}
                </button>
              </form>

              <div className="auth-links">
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => {
                    resetMessages();
                    setMode('login');
                  }}
                >
                  Ya tengo cuenta · Volver a iniciar sesión
                </button>
              </div>
            </>
          )}

          {mode === 'forgot' && (
            <>
              <h2 className="auth-title">Recuperar contraseña</h2>
              <p className="auth-subtitle">
                Escribe tu correo electrónico y te enviaremos un enlace para
                restablecer tu contraseña.
              </p>

              {error && <div className="alert-box alert-error">{error}</div>}
              {successMsg && (
                <div className="alert-box alert-success">{successMsg}</div>
              )}

              <form onSubmit={handleForgotPassword}>
                <div className="form-field">
                  <label className="form-label" htmlFor="forgot-email">
                    Correo electrónico
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    className="form-input"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="btn-primary"
                  disabled={loading}
                >
                  {loading ? 'Enviando...' : 'ENVIAR ENLACE DE RECUPERACIÓN'}
                </button>
              </form>

              <div className="auth-links">
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => {
                    resetMessages();
                    setMode('login');
                  }}
                >
                  Volver a iniciar sesión
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
