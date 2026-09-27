import { StatusBadge, type AppStatus } from './StatusBadge';

export type AppMode = 'explore' | 'missions';

interface HeaderProps {
  readonly status: AppStatus;
  readonly mode: AppMode;
  readonly onMode: (mode: AppMode) => void;
}

export function Header({ status, mode, onMode }: HeaderProps) {
  return (
    <header className="header">
      <div className="header__brand">
        <h1 className="header__title">METEO LAB</h1>
        <p className="header__subtitle">Osserva. Interpreta. Simula.</p>
      </div>
      <nav className="modes" aria-label="Modalità">
        <button type="button" className="modes__tab" aria-pressed={mode === 'explore'} onClick={() => onMode('explore')}>
          ESPLORA
        </button>
        <button type="button" className="modes__tab" aria-pressed={mode === 'missions'} onClick={() => onMode('missions')}>
          MISSIONI
        </button>
      </nav>
      <StatusBadge status={status} />
    </header>
  );
}
