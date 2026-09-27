import { useId } from 'react';
import type { ConvectiveOutlook } from '../engine/ConvectiveEngine';
import {
  PARAMETER_LIMITS,
  type AssumedField,
  type SimulationParameters,
  type SimulationState,
} from '../models/SimulationState';
import { SIMULATION_DURATION_MINUTES, TIMELINE_MINUTES, formatOffset } from '../simulation/timeline';
import {
  STAGE_LABELS,
  outcomeTitle,
  phaseSentence,
  summarize,
  type ParameterChanges,
} from '../simulation/tempestaNarrative';
import { formatCoordinates, formatDateTime, formatDirection, formatValue } from './format';

interface TempestaLabPanelProps {
  readonly simulation: SimulationState;
  readonly playing: boolean;
  readonly finished: boolean;
  readonly onChangeParameter: (key: keyof SimulationParameters, value: number) => void;
  readonly onRestoreReal: () => void;
  readonly onStart: () => void;
  readonly onModify: () => void;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onStep: () => void;
  readonly onRestart: () => void;
  readonly onSeek: (minute: number) => void;
  readonly onBackToLive: () => void;
  readonly onSave: () => void;
  readonly saveMessage: string | null;
}

const PARAMETER_LABELS: Record<keyof SimulationParameters, string> = {
  temperature: 'Temperatura',
  relativeHumidity: 'Umidità',
  windSpeed: 'Vento',
};

const ASSUMED_LABELS: Record<AssumedField, string> = {
  temperature: 'temperatura',
  relativeHumidity: 'umidità',
  windSpeed: 'vento',
  cloudCover: 'nuvolosità',
};

const ORIGIN_LABELS: Record<SimulationState['originKind'], string> = {
  live: 'osservazione LIVE',
  'last-observation': 'ultima osservazione memorizzata',
  scenario: 'scenario salvato',
};

const DECIMALS: Record<keyof SimulationParameters, number> = { temperature: 1, relativeHumidity: 0, windSpeed: 0 };

function realValue(simulation: SimulationState, key: keyof SimulationParameters): number | null {
  return simulation.origin[key];
}

export function parameterChanges(simulation: SimulationState): ParameterChanges {
  const diff = (key: keyof SimulationParameters) => {
    const real = realValue(simulation, key);
    return real === null ? 0 : simulation.parameters[key] - real;
  };
  return { temperature: diff('temperature'), relativeHumidity: diff('relativeHumidity'), windSpeed: diff('windSpeed') };
}

function formatDelta(value: number, unit: string, decimals: number): string {
  if (Math.abs(value) < 10 ** -decimals / 2) return `0 ${unit}`;
  return `${value > 0 ? '+' : '−'}${formatValue(Math.abs(value), unit, decimals)}`;
}

export function TempestaLabPanel(props: TempestaLabPanelProps) {
  const { simulation } = props;
  const baseId = useId();
  const outlook = simulation.convection;

  return (
    <section className="panel panel--sim" aria-labelledby={`${baseId}-title`}>
      <div className="sim-banner" role="note">
        <strong>SIMULAZIONE DIDATTICA</strong>
        <span>NON È UNA PREVISIONE METEOROLOGICA</span>
      </div>

      <div className="panel__head">
        <h2 id={`${baseId}-title`} className="panel__title lab-title">
          TEMPESTA LAB
        </h2>
      </div>
      <p className="panel__meta">
        <span>{formatCoordinates(simulation.origin.latitude, simulation.origin.longitude)}</span>
        <span>
          Partenza: {ORIGIN_LABELS[simulation.originKind]} del{' '}
          <time dateTime={simulation.origin.timestamp}>{formatDateTime(simulation.origin.timestamp)}</time>
        </span>
      </p>

      {!outlook ? <LabSetup {...props} baseId={baseId} /> : <Experiment {...props} outlook={outlook} />}

      <details className="sim-table">
        <summary>Dati di superficie simulati T+0 … T+90</summary>
        <div className="table-scroll">
          <table>
            <caption>Valori simulati (SIM) al suolo per ogni passo della timeline</caption>
            <thead>
              <tr>
                <th scope="col">Tempo</th>
                <th scope="col">Temp. °C</th>
                <th scope="col">Rugiada °C</th>
                <th scope="col">Umidità %</th>
                <th scope="col">Vento km/h</th>
                <th scope="col">Nubi %</th>
              </tr>
            </thead>
            <tbody>
              {simulation.timeline.map((item) => (
                <tr key={item.minute} aria-current={item.minute === simulation.currentMinute ? 'step' : undefined}>
                  <th scope="row">{formatOffset(item.minute)}</th>
                  <td>{item.temperature.toFixed(1)}</td>
                  <td>{item.dewPoint.toFixed(1)}</td>
                  <td>{item.relativeHumidity.toFixed(0)}</td>
                  <td>{item.windSpeed.toFixed(1)}</td>
                  <td>{item.cloudCover.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="sim-rules">
        <summary>Come funziona il modello didattico</summary>
        <ul>
          <li>
            L’aria vicino al suolo, con temperatura e umidità scelte da te, viene sollevata: si raffredda finché il
            vapore condensa (base delle nubi), poi continua a salire più lentamente.
          </li>
          <li>
            L’aria in quota non è misurata: si usa un profilo ipotizzato (atmosfera standard, −6,5 °C/km) che parte
            dalla temperatura reale al suolo.
          </li>
          <li>
            Se l’aria sollevata resta più calda dell’ambiente accumula energia (una «CAPE didattica», non la CAPE
            reale): più energia significa corrente ascendente più forte e nucleo radar più intenso.
          </li>
          <li>
            Il vento sposta la cella e, se è moderato, ne organizza di nuove; se è troppo forte rispetto
            all’energia disponibile la disperde.
          </li>
          <li>Il radar è disegnato dal modello: nessuna immagine radar reale viene usata.</li>
        </ul>
      </details>

      <div className="controls-row">
        <button type="button" className="button button--ghost" onClick={props.onSave}>
          SALVA SCENARIO
        </button>
        <button type="button" className="button button--ghost" onClick={props.onBackToLive}>
          TORNA AL LIVE
        </button>
        {props.saveMessage && (
          <p className="panel__note" role="status">
            {props.saveMessage}
          </p>
        )}
      </div>
    </section>
  );
}

function LabSetup(props: TempestaLabPanelProps & { readonly baseId: string }) {
  const { simulation, baseId } = props;
  return (
    <>
      <div className="mission">
        <p className="mission__tag">MISSIONE 01 · TEMPESTA</p>
        <p className="mission__text">
          Modifica l’atmosfera.
          <br />
          Riesci a creare le condizioni per lo sviluppo di un temporale?
        </p>
      </div>

      {simulation.assumed.length > 0 && (
        <p className="panel__note">
          Dati mancanti nell&apos;osservazione, sostituiti da valori didattici ipotizzati:{' '}
          {simulation.assumed.map((field) => ASSUMED_LABELS[field]).join(', ')}.
        </p>
      )}

      <fieldset className="parameters">
        <legend>Atmosfera al suolo</legend>
        {(Object.keys(PARAMETER_LIMITS) as (keyof SimulationParameters)[]).map((key) => {
          const limits = PARAMETER_LIMITS[key];
          const inputId = `${baseId}-${key}`;
          const value = simulation.parameters[key];
          const real = realValue(simulation, key);
          const decimals = DECIMALS[key];
          return (
            <div className="parameter" key={key}>
              <label htmlFor={inputId} className="parameter__name">
                {PARAMETER_LABELS[key]}
                {key === 'windSpeed' && (
                  <span className="parameter__hint">da {formatDirection(simulation.origin.windDirection)}</span>
                )}
              </label>
              <dl className="compare">
                <div>
                  <dt>REALE</dt>
                  <dd className="compare__real">{formatValue(real, limits.unit, decimals)}</dd>
                </div>
                <div>
                  <dt>SIM</dt>
                  <dd className="compare__sim">
                    <output htmlFor={inputId}>{formatValue(value, limits.unit, decimals)}</output>
                  </dd>
                </div>
                <div>
                  <dt>Δ</dt>
                  <dd>{real === null ? '—' : formatDelta(value - real, limits.unit, decimals)}</dd>
                </div>
              </dl>
              <input
                id={inputId}
                type="range"
                min={limits.min}
                max={limits.max}
                step={limits.step}
                value={value}
                onChange={(event) => props.onChangeParameter(key, Number(event.target.value))}
              />
            </div>
          );
        })}
        <button type="button" className="button button--small button--ghost" onClick={props.onRestoreReal}>
          Ripristina valori reali
        </button>
      </fieldset>

      <button type="button" className="button button--start" onClick={props.onStart}>
        AVVIA ESPERIMENTO
      </button>
    </>
  );
}

function Experiment(props: TempestaLabPanelProps & { readonly outlook: ConvectiveOutlook }) {
  const { simulation, outlook, playing, finished } = props;
  const changes = parameterChanges(simulation);
  const minute = simulation.currentMinute;
  const frame = outlook.frames.find((item) => item.minute === minute);
  const progress = (minute / SIMULATION_DURATION_MINUTES) * 100;
  const summary = summarize(outlook, simulation.parameters, changes);
  const developed = outlook.develops;

  return (
    <>
      <p className={`outcome ${developed ? 'outcome--storm' : 'outcome--none'}`} role="status">
        {outcomeTitle(outlook)}
      </p>

      {!developed && <p className="lab-sentence">{summary.explanation}</p>}

      {developed && frame && (
        <>
          <div className="stage-line" aria-live="polite">
            <span className="stage-line__time">{formatOffset(minute)}</span>
            <span className="stage-line__stage">{STAGE_LABELS[frame.stage]}</span>
          </div>
          <p className="lab-sentence">{phaseSentence(outlook, minute, changes)}</p>

          <div className="timeline" role="group" aria-label="Timeline dell'esperimento, da T+0 a T+90 minuti">
            <div className="timeline__track" aria-hidden="true">
              <div className="timeline__fill" style={{ width: `${progress}%` }} />
            </div>
            <ol className="timeline__steps">
              {TIMELINE_MINUTES.map((step) => {
                const stage = outlook.frames.find((item) => item.minute === step)?.stage ?? 'NONE';
                return (
                  <li key={step}>
                    <button
                      type="button"
                      className={`timeline__step timeline__step--${stage.toLowerCase()}`}
                      aria-pressed={step === minute}
                      aria-label={`Vai a ${formatOffset(step)} minuti: ${STAGE_LABELS[stage]}`}
                      onClick={() => props.onSeek(step)}
                    >
                      {formatOffset(step)}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="controls-row" role="group" aria-label="Comandi dell'esperimento">
            {playing ? (
              <button type="button" className="button" onClick={props.onPause}>
                PAUSA
              </button>
            ) : (
              <button type="button" className="button button--sim" onClick={props.onPlay} disabled={finished}>
                PLAY
              </button>
            )}
            <button type="button" className="button" onClick={props.onStep} disabled={finished}>
              STEP ▸
            </button>
            <button type="button" className="button" onClick={props.onRestart}>
              RESET
            </button>
          </div>

          <dl className="cell-stats">
            <div>
              <dt>Riflettività</dt>
              <dd>{frame.reflectivity > 0 ? `${frame.reflectivity.toFixed(0)} dBZ` : '—'}</dd>
            </div>
            <div>
              <dt>Pioggia</dt>
              <dd>{frame.precipitationIntensity > 0 ? formatValue(frame.precipitationIntensity, 'mm/h', 0) : '—'}</dd>
            </div>
            <div>
              <dt>Raggio</dt>
              <dd>{frame.radius > 0 ? formatValue(frame.radius, 'km', 0) : '—'}</dd>
            </div>
            <div>
              <dt>Moto</dt>
              <dd>
                {outlook.cellSpeed < 1 ? 'ferma' : `${formatValue(outlook.cellSpeed, 'km/h', 0)} → ${formatDirection(outlook.cellDirection)}`}
              </dd>
            </div>
          </dl>
        </>
      )}

      {(!developed || finished) && (
        <div className="result">
          <p className="result__title">ESPERIMENTO COMPLETATO</p>
          <dl className="result__list">
            <div>
              <dt>Condizioni reali</dt>
              <dd>
                {formatValue(simulation.origin.temperature, '°C')} · {formatValue(simulation.origin.relativeHumidity, '%', 0)} ·{' '}
                {formatValue(simulation.origin.windSpeed, 'km/h', 0)}
              </dd>
            </div>
            <div>
              <dt>Modifiche</dt>
              <dd>
                {formatDelta(changes.temperature, '°C', 1)} · {formatDelta(changes.relativeHumidity, '%', 0)} ·{' '}
                {formatDelta(changes.windSpeed, 'km/h', 0)}
              </dd>
            </div>
            {developed && (
              <>
                <div>
                  <dt>Intensità massima</dt>
                  <dd>
                    {summary.peakReflectivity.toFixed(0)} dBZ ({summary.peakBandLabel}) ·{' '}
                    {formatValue(summary.peakRainRate, 'mm/h', 0)}
                  </dd>
                </div>
                <div>
                  <dt>Durata della cella</dt>
                  <dd>
                    {summary.stillActive ? `almeno ${summary.durationMinutes} min (ancora attiva a T+90)` : `${summary.durationMinutes} min`}
                  </dd>
                </div>
                <div>
                  <dt>Spostamento</dt>
                  <dd>
                    {summary.displacementKm < 0.5
                      ? 'quasi nullo'
                      : `${formatValue(summary.displacementKm, 'km', 0)} verso ${summary.displacementDirection}`}
                  </dd>
                </div>
              </>
            )}
          </dl>
          {developed && <p className="lab-sentence">{summary.explanation}</p>}
        </div>
      )}

      <button type="button" className="button button--sim button--wide" onClick={props.onModify}>
        {developed ? 'MODIFICA L’ATMOSFERA' : 'MODIFICA L’ATMOSFERA E RIPROVA'}
      </button>
    </>
  );
}
