import { useState, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import {
  addDaysISO,
  getMadridTodayISO,
  getMondayOfWeekISO,
} from './lib/dates';
import { useAuth } from './hooks/useAuth';
import { useWeekMatches } from './hooks/useWeekMatches';
import { RpcActionResponse } from './types/database';
import { Header } from './components/Header';
import { AuthView } from './components/AuthView';
import { ResetPasswordView } from './components/ResetPasswordView';
import { WeekSelector } from './components/WeekSelector';
import { DayBlock } from './components/DayBlock';
import { CancelConfirmModal } from './components/CancelConfirmModal';
import { MyRegistrationsView } from './components/MyRegistrationsView';
import { AdminPanel } from './components/AdminPanel';
import { ToastBanner, ToastMessage } from './components/ToastBanner';

type MainTab = 'week' | 'mine' | 'admin';

interface PendingCancelState {
  matchDate: string;
  matchNumber: 1 | 2;
}

export function App() {
  const {
    user,
    profile,
    role,
    loading: authLoading,
    isPasswordRecovery,
    clearPasswordRecovery,
    signOut,
  } = useAuth();

  const [mondayISO, setMondayISO] = useState<string>(() =>
    getMondayOfWeekISO(getMadridTodayISO())
  );
  const [activeTab, setActiveTab] = useState<MainTab>('week');
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] =
    useState<PendingCancelState | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [myRefreshCounter, setMyRefreshCounter] = useState(0);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 5500);
  }, []);

  const {
    days,
    loading: weekLoading,
    error: weekError,
    reload: reloadWeek,
  } = useWeekMatches(mondayISO, user?.id);

  const handlePrevWeek = () => setMondayISO((prev) => addDaysISO(prev, -7));
  const handleNextWeek = () => setMondayISO((prev) => addDaysISO(prev, 7));
  const handleCurrentWeek = () =>
    setMondayISO(getMondayOfWeekISO(getMadridTodayISO()));

  // Inscripción directa (sin modal adicional) mediante RPC atómico
  const handleRegister = async (matchDate: string, matchNumber: 1 | 2) => {
    if (busyDate) return;
    setBusyDate(matchDate);

    try {
      const { data, error } = await supabase.rpc('register_for_match', {
        p_match_date: matchDate,
        p_expected_match_number: matchNumber,
      });

      if (error) {
        showToast(
          'error',
          'No se ha podido completar la operación. Inténtalo de nuevo.'
        );
        return;
      }

      const result = data as RpcActionResponse;
      if (result.success) {
        showToast('success', 'Te has apuntado correctamente al partido.');
        setMyRefreshCounter((c) => c + 1);
      } else {
        showToast('error', result.message);
      }
      await reloadWeek();
    } catch {
      showToast(
        'error',
        'No se ha podido completar la operación. Inténtalo de nuevo.'
      );
    } finally {
      setBusyDate(null);
    }
  };

  // Paso 1 baja: abrir ventana de confirmación explícita
  const handleRequestCancel = (matchDate: string, matchNumber: 1 | 2) => {
    setPendingCancel({ matchDate, matchNumber });
  };

  // Paso 2 baja: ejecutar RPC atómico solo tras confirmación explícita
  const handleConfirmCancel = async () => {
    if (!pendingCancel || cancelLoading) return;
    setCancelLoading(true);

    try {
      const { data, error } = await supabase.rpc('cancel_registration', {
        p_match_date: pendingCancel.matchDate,
      });

      if (error) {
        showToast(
          'error',
          'No se ha podido completar la operación. Inténtalo de nuevo.'
        );
        return;
      }

      const result = data as RpcActionResponse;
      if (result.success) {
        setPendingCancel(null);
        showToast('success', 'Te has desapuntado correctamente.');
        setMyRefreshCounter((c) => c + 1);
      } else {
        showToast('error', result.message);
      }
      await reloadWeek();
    } catch {
      showToast(
        'error',
        'No se ha podido completar la operación. Inténtalo de nuevo.'
      );
    } finally {
      setCancelLoading(false);
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <>
        <Header />
        <main className="app-container">
          <div className="alert-box alert-error">
            Falta configurar las variables de entorno{' '}
            <code>VITE_SUPABASE_URL</code> y{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>. Consulta el archivo{' '}
            <code>README.md</code>.
          </div>
        </main>
      </>
    );
  }

  if (authLoading) {
    return (
      <>
        <Header />
        <main className="app-container">
          <div className="loading-box">Cargando aplicación...</div>
        </main>
      </>
    );
  }

  if (isPasswordRecovery) {
    return <ResetPasswordView onDone={clearPasswordRecovery} />;
  }

  if (!user) {
    return <AuthView />;
  }

  if (profile && !profile.is_active) {
    return (
      <>
        <Header
          userName={`${profile.first_name} ${profile.last_name}`}
          onSignOut={signOut}
        />
        <main className="app-container">
          <div className="alert-box alert-error">
            Tu cuenta está desactivada actualmente. Contacta con el administrador
            del centro El Forcón.
          </div>
        </main>
      </>
    );
  }

  const fullName = profile
    ? `${profile.first_name} ${profile.last_name}`.trim()
    : user.email ?? 'Jugador';

  return (
    <>
      <Header userName={fullName} onSignOut={signOut} />

      <main className="app-container">
        <ToastBanner toast={toast} onClose={() => setToast(null)} />

        <nav className="main-nav" aria-label="Secciones principales">
          <button
            type="button"
            className={`nav-tab ${activeTab === 'week' ? 'active' : ''}`}
            onClick={() => setActiveTab('week')}
          >
            Partidos de la semana
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'mine' ? 'active' : ''}`}
            onClick={() => setActiveTab('mine')}
          >
            Mis inscripciones
          </button>
          {role === 'admin' && (
            <button
              type="button"
              className={`nav-tab ${activeTab === 'admin' ? 'active' : ''}`}
              onClick={() => setActiveTab('admin')}
            >
              Administración
            </button>
          )}
        </nav>

        {activeTab === 'week' && (
          <>
            <WeekSelector
              mondayISO={mondayISO}
              onPrevWeek={handlePrevWeek}
              onCurrentWeek={handleCurrentWeek}
              onNextWeek={handleNextWeek}
            />

            {weekError && (
              <div className="alert-box alert-error">{weekError}</div>
            )}

            {weekLoading ? (
              <div className="loading-box">Cargando partidos de la semana...</div>
            ) : (
              <div className="days-list">
                {days.map((day) => (
                  <DayBlock
                    key={day.date}
                    day={day}
                    busyDate={busyDate}
                    onRegister={handleRegister}
                    onRequestCancel={handleRequestCancel}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'mine' && (
          <MyRegistrationsView
            userId={user.id}
            onRequestCancel={handleRequestCancel}
            refreshTrigger={myRefreshCounter}
          />
        )}

        {activeTab === 'admin' && role === 'admin' && (
          <AdminPanel
            currentAdminId={user.id}
            mondayISO={mondayISO}
            days={days}
            onPrevWeek={handlePrevWeek}
            onCurrentWeek={handleCurrentWeek}
            onNextWeek={handleNextWeek}
            onNotify={showToast}
            onMatchesChanged={reloadWeek}
          />
        )}
      </main>

      <CancelConfirmModal
        isOpen={pendingCancel !== null}
        matchDate={pendingCancel?.matchDate ?? ''}
        matchNumber={pendingCancel?.matchNumber ?? 1}
        loading={cancelLoading}
        onKeepSpot={() => {
          if (!cancelLoading) setPendingCancel(null);
        }}
        onConfirmCancel={handleConfirmCancel}
      />
    </>
  );
}

export default App;
