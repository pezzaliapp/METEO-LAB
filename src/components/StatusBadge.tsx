export type AppStatus = 'live' | 'sim' | 'offline' | 'last';

const LABELS: Record<AppStatus, { text: string; description: string }> = {
  live: { text: 'LIVE', description: 'Modalità LIVE: dati osservati reali' },
  sim: { text: 'SIM', description: 'Modalità SIM: dati generati dal simulatore didattico' },
  offline: { text: 'OFFLINE', description: 'Dispositivo offline: nessun dato reale aggiornato' },
  last: { text: 'ULTIMA OSSERVAZIONE', description: 'Dato non aggiornato: ultima osservazione memorizzata' },
};

/** Indicatore di stato: testo + forma + colore (mai solo colore). */
export function StatusBadge({ status }: { readonly status: AppStatus }) {
  const label = LABELS[status];
  return (
    <p className={`status status--${status}`} role="status" aria-live="polite" aria-label={label.description}>
      <span className="status__dot" aria-hidden="true">
        ●
      </span>
      <span className="status__text">{label.text}</span>
    </p>
  );
}
