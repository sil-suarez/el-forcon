interface HeaderProps {
  userName?: string;
  onSignOut?: () => void;
}

export function Header({ userName, onSignOut }: HeaderProps) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <div className="brand-block">
          <div className="brand-logo" aria-hidden="true">
            EF
          </div>
          <div>
            <h1 className="brand-title">EL FORCÓN</h1>
            <p className="brand-subtitle">Partidos de pádel</p>
          </div>
        </div>

        {userName && onSignOut && (
          <div className="user-session-block">
            <span className="user-name-label">{userName}</span>
            <button type="button" className="btn-logout" onClick={onSignOut}>
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
