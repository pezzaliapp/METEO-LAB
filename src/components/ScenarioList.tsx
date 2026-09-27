import type { SavedScenario } from '../storage/localStore';
import { formatDateTime } from './format';

interface ScenarioListProps {
  readonly scenarios: readonly SavedScenario[];
  readonly onOpen: (scenario: SavedScenario) => void;
  readonly onDelete: (scenario: SavedScenario) => void;
}

export function ScenarioList({ scenarios, onOpen, onDelete }: ScenarioListProps) {
  if (scenarios.length === 0) return null;
  return (
    <section className="panel panel--scenarios" aria-labelledby="scenarios-title">
      <h2 id="scenarios-title" className="panel__title">
        Scenari salvati
      </h2>
      <p className="panel__note">Conservati solo su questo dispositivo, disponibili anche offline.</p>
      <ul className="scenarios">
        {scenarios.map((scenario) => (
          <li key={scenario.id} className="scenario">
            <span className="scenario__name">{scenario.name}</span>
            <time className="scenario__time" dateTime={scenario.savedAt}>
              {formatDateTime(scenario.savedAt)}
            </time>
            <span className="scenario__actions">
              <button
                type="button"
                className="button button--small"
                onClick={() => onOpen(scenario)}
                aria-label={`Apri simulazione: ${scenario.name}`}
              >
                Apri in SIM
              </button>
              <button
                type="button"
                className="button button--small button--ghost"
                onClick={() => onDelete(scenario)}
                aria-label={`Elimina scenario: ${scenario.name}`}
              >
                Elimina
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
