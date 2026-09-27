import type { Hypothesis, MissionDefinition, MissionSourceKind } from '../game/MissionEngine';
import { HYPOTHESIS_LABELS } from '../game/missions';
import { SCENARIOS } from '../game/scenarios';

interface MissionHeaderProps {
  readonly mission: MissionDefinition;
  readonly source: MissionSourceKind;
  /** Numero del tentativo in corso o in preparazione. */
  readonly attempt: number;
  readonly hypothesis: Hypothesis | null;
}

/** Sempre visibile sopra la mappa durante una missione: MISSIONE, OBIETTIVO, TENTATIVO, IPOTESI. */
export function MissionHeader({ mission, source, attempt, hypothesis }: MissionHeaderProps) {
  return (
    <section className="mission-header" aria-label="Missione in corso">
      <p className="mission-header__title">
        <span className="mission-header__tag">MISSIONE {mission.id}</span> {mission.title}
      </p>
      <p className="mission-header__objective">
        <strong>OBIETTIVO</strong> {mission.objective}
      </p>
      <p className="mission-header__meta">
        <span>TENTATIVO {attempt}</span>
        <span>IPOTESI: {hypothesis ? HYPOTHESIS_LABELS[hypothesis] : '—'}</span>
        <span className="mission-header__source">
          {source === 'scenario'
            ? `SCENARIO DIDATTICO · ${SCENARIOS[mission.scenario].name}`
            : 'LIVE CHALLENGE · CONDIZIONI METEOROLOGICHE DEL MOMENTO · ESPERIMENTO SIMULATO'}
        </span>
      </p>
      <p className="mission-header__notice">SIMULAZIONE DIDATTICA · NON È UNA PREVISIONE METEOROLOGICA</p>
    </section>
  );
}
