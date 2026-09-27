import { StatusBadge, type AppStatus } from './StatusBadge';

export function Header({ status }: { readonly status: AppStatus }) {
  return (
    <header className="header">
      <div className="header__brand">
        <h1 className="header__title">METEO LAB</h1>
        <p className="header__subtitle">Osserva. Interpreta. Simula.</p>
      </div>
      <StatusBadge status={status} />
    </header>
  );
}
