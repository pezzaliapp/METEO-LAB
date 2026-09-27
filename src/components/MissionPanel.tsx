import { useId } from 'react';
import type { Hypothesis, MissionDefinition, MissionResult, MissionSession, ParameterKey } from '../game/MissionEngine';
import { HYPOTHESIS_LABELS, OUTCOME_LABELS } from '../game/missions';
import { SCENARIOS } from '../game/scenarios';
import { PARAMETER_LIMITS, type SimulationState } from '../models/SimulationState';
import { AtmosphereControls, DECIMALS, ExperimentPlayer, PARAMETER_LABELS } from './ExperimentParts';
import { formatValue } from './format';

interface MissionPanelProps {
  readonly mission: MissionDefinition;
  readonly session: MissionSession;
  readonly simulation: SimulationState;
  readonly hypothesis: Hypothesis | null;
  /** false in LIVE CHALLENGE quando il fenomeno non è ottenibile con le condizioni del momento. */
  readonly feasible: boolean;
  readonly hint: string | null;
  readonly hintAvailable: boolean;
  readonly playing: boolean;
  readonly finished: boolean;
  readonly onHypothesis: (hypothesis: Hypothesis) => void;
  readonly onChangeParameter: (key: ParameterKey, value: number) => void;
  readonly onRestoreInitial: () => void;
  readonly onStart: () => void;
  readonly onRetry: () => void;
  readonly onHint: () => void;
  readonly onMissionControl: () => void;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onStep: () => void;
  readonly onRestart: () => void;
  readonly onSeek: (minute: number) => void;
}

const CHECK_LABELS = {
  CONFIRMED: 'IPOTESI CONFERMATA',
  PARTIAL: 'IPOTESI CONFERMATA IN PARTE',
  NOT_CONFIRMED: 'IPOTESI NON CONFERMATA',
} as const;

export function MissionPanel(props: MissionPanelProps) {
  const { mission, session, simulation, hypothesis } = props;
  const baseId = useId();
  const running = simulation.convection !== null;
  const result = running ? session.lastResult : null;
  const showResult = result !== null && (!simulation.convection?.develops || props.finished);
  const scenario = SCENARIOS[mission.scenario];

  return (
    <section className="panel panel--sim panel--mission" aria-label={`Missione ${mission.id}`}>
      <div className="sim-banner" role="note">
        <strong>SIMULAZIONE DIDATTICA</strong>
        <span>NON È UNA PREVISIONE METEOROLOGICA</span>
      </div>
      <p className="mission__text">{mission.description}</p>
      <p className="panel__note">
        {session.source === 'scenario'
          ? `SCENARIO DIDATTICO · ${scenario.name}: ${scenario.description} Dati congelati (v${scenario.version}), non attuali.`
          : 'LIVE CHALLENGE · CONDIZIONI METEOROLOGICHE DEL MOMENTO · ESPERIMENTO SIMULATO.'}
      </p>
      {!props.feasible && (
        <p className="alert" role="status">
          Con le condizioni del momento in questo punto, nel modello questa missione non risulta realizzabile con i
          controlli disponibili. Prova lo SCENARIO DIDATTICO o un altro punto.
        </p>
      )}

      <AtmosphereControls
        simulation={simulation}
        baseId={baseId}
        referenceLabel={session.source === 'scenario' ? 'SCENARIO' : 'REALE'}
        allowed={mission.allowedControls}
        frozen={running}
        onChange={props.onChangeParameter}
      >
        {!running && (
          <button type="button" className="button button--small button--ghost" onClick={props.onRestoreInitial}>
            Ripristina valori iniziali
          </button>
        )}
      </AtmosphereControls>

      {!running && (
        <>
          <fieldset className="hypothesis">
            <legend>COSA PENSI CHE SUCCEDERÀ?</legend>
            <div className="hypothesis__options">
              {mission.hypotheses.map((option) => (
                <label key={option} className="hypothesis__option">
                  <input
                    type="radio"
                    name={`${baseId}-hypothesis`}
                    value={option}
                    checked={hypothesis === option}
                    onChange={() => props.onHypothesis(option)}
                  />
                  <span>{HYPOTHESIS_LABELS[option]}</span>
                </label>
              ))}
            </div>
            <p className="panel__note">L’ipotesi non cambia la simulazione: serve a confrontarla con il risultato.</p>
          </fieldset>
          <button type="button" className="button button--start" onClick={props.onStart} disabled={hypothesis === null}>
            AVVIA ESPERIMENTO · TENTATIVO {session.attempts + 1}
          </button>
          {hypothesis === null && <p className="panel__note">Scegli prima un’ipotesi.</p>}
        </>
      )}

      {running && simulation.convection && (
        <>
          {simulation.convection.develops && (
            <ExperimentPlayer
              simulation={simulation}
              outlook={simulation.convection}
              severe={simulation.severe}
              playing={props.playing}
              finished={props.finished}
              onPlay={props.onPlay}
              onPause={props.onPause}
              onStep={props.onStep}
              onRestart={props.onRestart}
              onSeek={props.onSeek}
            />
          )}
          {!showResult && (
            <button type="button" className="button button--ghost button--wide" onClick={() => props.onSeek(90)}>
              VAI AL RISULTATO
            </button>
          )}
          {showResult && result && <MissionResultView {...props} result={result} />}
        </>
      )}
    </section>
  );
}

function MissionResultView(props: MissionPanelProps & { readonly result: MissionResult }) {
  const { result } = props;
  return (
    <div className={`mission-result${result.completed ? ' mission-result--done' : ''}`} aria-live="polite">
      <dl className="mission-result__compare">
        <div>
          <dt>PENSAVI</dt>
          <dd>{HYPOTHESIS_LABELS[result.hypothesis]}</dd>
        </div>
        <div>
          <dt>È SUCCESSO</dt>
          <dd>{OUTCOME_LABELS[result.observedOutcome]}</dd>
        </div>
      </dl>
      <p className="mission-result__check">{CHECK_LABELS[result.hypothesisCheck]}</p>

      {result.changes.length > 0 ? (
        <div className="before-after">
          <p className="before-after__title">PRIMA → DOPO</p>
          <dl>
            {result.changes.map((change) => (
              <div key={change.key}>
                <dt>{PARAMETER_LABELS[change.key]}</dt>
                <dd>
                  {formatValue(change.before, PARAMETER_LIMITS[change.key].unit, DECIMALS[change.key])} →{' '}
                  {formatValue(change.after, PARAMETER_LIMITS[change.key].unit, DECIMALS[change.key])}
                </dd>
              </div>
            ))}
          </dl>
          {result.effects.length > 0 && (
            <>
              <p className="before-after__title">EFFETTO (calcolato dai motori)</p>
              <ul className="effects">
                {result.effects.map((effect) => (
                  <li key={effect.label}>
                    {effect.label} <span aria-label={effect.direction === 'up' ? 'aumenta' : 'diminuisce'}>{effect.direction === 'up' ? '↑' : '↓'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="before-after__cost">
            INTERVENTO {result.changeCost.level}
            <span className="panel__note"> · indice di intervento {result.changeCost.value.toLocaleString('it-IT')} (distanza normalizzata dalle condizioni iniziali, non è un punteggio scientifico)</span>
          </p>
        </div>
      ) : (
        <p className="panel__note">Nessuna modifica: hai osservato l’atmosfera iniziale.</p>
      )}

      <p className="mission-result__why-title">PERCHÉ</p>
      {result.completed ? (
        <div className="aha">
          <p className="aha__status">✓ MISSIONE COMPLETATA</p>
          <p className="aha__headline">{result.headline}</p>
          {result.reasons.map((reason) => (
            <p key={reason} className="lab-sentence">
              {reason}
            </p>
          ))}
        </div>
      ) : (
        <div className="retry">
          {result.reasons.map((reason) => (
            <p key={reason} className="lab-sentence">
              {reason}
            </p>
          ))}
          <p className="retry__status">OSSERVA COSA È CAMBIATO · RIPROVA</p>
          {props.hintAvailable && !props.hint && (
            <button type="button" className="button button--small button--ghost" onClick={props.onHint}>
              INDIZIO
            </button>
          )}
          {props.hint && (
            <p className="hint" role="status">
              <strong>INDIZIO</strong> {props.hint}
            </p>
          )}
        </div>
      )}

      <div className="controls-row">
        <button type="button" className="button button--sim" onClick={props.onRetry}>
          {result.completed ? 'NUOVO ESPERIMENTO' : 'RIPROVA'}
        </button>
        <button type="button" className="button button--ghost" onClick={props.onMissionControl}>
          MISSION CONTROL
        </button>
      </div>
    </div>
  );
}
