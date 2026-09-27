import { useId } from 'react';
import {
  PARAMETER_LIMITS,
  type AssumedField,
  type SimulationFrame,
  type SimulationParameters,
  type SimulationState,
} from '../models/SimulationState';
import { SIMULATION_DURATION_MINUTES, TIMELINE_MINUTES, formatOffset } from '../simulation/timeline';
import { formatCoordinates, formatDateTime, formatDirection, formatValue } from './format';
import { MetricGrid, type Metric } from './MetricGrid';

interface SimulationPanelProps {
  readonly simulation: SimulationState;
  readonly frame: SimulationFrame;
  readonly playing: boolean;
  readonly finished: boolean;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onReset: () => void;
  readonly onBackToLive: () => void;
  readonly onSeek: (minute: number) => void;
  readonly onChangeParameter: (key: keyof SimulationParameters, value: number) => void;
  readonly onSave: () => void;
  readonly saveMessage: string | null;
}

const PARAMETER_LABELS: Record<keyof SimulationParameters, string> = {
  temperature: 'Temperatura iniziale',
  relativeHumidity: 'Umidità relativa iniziale',
  windSpeed: 'Velocità del vento',
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

function delta(value: number, initial: number, unit: string, decimals = 1): string {
  const diff = value - initial;
  if (Math.abs(diff) < 10 ** -decimals / 2) return 'invariata rispetto a T+0';
  const sign = diff > 0 ? '+' : '−';
  return `${sign}${formatValue(Math.abs(diff), unit, decimals)} rispetto a T+0`;
}

function frameMetrics(frame: SimulationFrame, initial: SimulationFrame): Metric[] {
  return [
    {
      key: 'temperature',
      label: 'Temperatura',
      value: formatValue(frame.temperature, '°C'),
      detail: `${delta(frame.temperature, initial.temperature, '°C')} · Rugiada ${formatValue(frame.dewPoint, '°C')}`,
    },
    {
      key: 'humidity',
      label: 'Umidità',
      value: formatValue(frame.relativeHumidity, '%', 0),
      detail: frame.saturated ? 'Saturazione: condensazione' : delta(frame.relativeHumidity, initial.relativeHumidity, '%', 0),
    },
    { key: 'pressure', label: 'Pressione', value: formatValue(frame.pressure, 'hPa'), detail: 'Invariata nel modello 0.1' },
    {
      key: 'wind',
      label: 'Vento',
      value: formatValue(frame.windSpeed, 'km/h'),
      detail: `Da ${formatDirection(frame.windDirection)}`,
    },
    { key: 'gust', label: 'Raffiche', value: formatValue(frame.windGust, 'km/h') },
    {
      key: 'precipitation',
      label: 'Precipitazioni',
      value: formatValue(frame.precipitation, 'mm'),
      detail: 'Negli ultimi 15 minuti simulati',
    },
    {
      key: 'cloud',
      label: 'Nuvolosità',
      value: formatValue(frame.cloudCover, '%', 0),
      detail: delta(frame.cloudCover, initial.cloudCover, '%', 0),
    },
  ];
}

export function SimulationPanel(props: SimulationPanelProps) {
  const { simulation, frame, playing, finished } = props;
  const baseId = useId();
  const initial = simulation.timeline[0] ?? frame;
  const progress = (frame.minute / SIMULATION_DURATION_MINUTES) * 100;

  return (
    <section className="panel panel--sim" aria-labelledby={`${baseId}-title`}>
      <div className="sim-banner" role="note">
        <strong>SIMULAZIONE DIDATTICA</strong>
        <span>NON È UNA PREVISIONE METEOROLOGICA</span>
      </div>

      <div className="panel__head">
        <h2 id={`${baseId}-title`} className="panel__title">
          Simulazione · {formatOffset(frame.minute)} min
        </h2>
      </div>

      <p className="panel__meta">
        <span>{formatCoordinates(simulation.origin.latitude, simulation.origin.longitude)}</span>
        <span>
          Condizione iniziale: {ORIGIN_LABELS[simulation.originKind]} del{' '}
          <time dateTime={simulation.origin.timestamp}>{formatDateTime(simulation.origin.timestamp)}</time>
        </span>
      </p>

      {simulation.assumed.length > 0 && (
        <p className="panel__note">
          Dati mancanti nell&apos;osservazione, sostituiti da valori didattici ipotizzati:{' '}
          {simulation.assumed.map((field) => ASSUMED_LABELS[field]).join(', ')}.
        </p>
      )}

      <div className="timeline" role="group" aria-label="Timeline della simulazione, da T+0 a T+90 minuti">
        <div className="timeline__track" aria-hidden="true">
          <div className="timeline__fill" style={{ width: `${progress}%` }} />
        </div>
        <ol className="timeline__steps">
          {TIMELINE_MINUTES.map((minute) => (
            <li key={minute}>
              <button
                type="button"
                className="timeline__step"
                aria-pressed={minute === frame.minute}
                aria-label={`Vai a ${formatOffset(minute)} minuti`}
                onClick={() => props.onSeek(minute)}
              >
                {formatOffset(minute)}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="controls-row" role="group" aria-label="Comandi della simulazione">
        {playing ? (
          <button type="button" className="button" onClick={props.onPause}>
            PAUSA
          </button>
        ) : (
          <button type="button" className="button button--sim" onClick={props.onPlay} disabled={finished}>
            AVVIA
          </button>
        )}
        <button type="button" className="button" onClick={props.onReset}>
          RESET
        </button>
        <button type="button" className="button button--ghost" onClick={props.onBackToLive}>
          TORNA AL LIVE
        </button>
      </div>

      <MetricGrid metrics={frameMetrics(frame, initial)} tag="SIM" />

      <fieldset className="parameters">
        <legend>Condizioni iniziali (T+0)</legend>
        {(Object.keys(PARAMETER_LIMITS) as (keyof SimulationParameters)[]).map((key) => {
          const limits = PARAMETER_LIMITS[key];
          const inputId = `${baseId}-${key}`;
          const value = simulation.parameters[key];
          return (
            <div className="parameter" key={key}>
              <label htmlFor={inputId}>
                {PARAMETER_LABELS[key]}
                <output htmlFor={inputId}>{formatValue(value, limits.unit, key === 'temperature' ? 1 : 0)}</output>
              </label>
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
      </fieldset>

      <details className="sim-table">
        <summary>Tabella completa T+0 … T+90</summary>
        <div className="table-scroll">
          <table>
            <caption>Valori simulati (SIM) per ogni passo della timeline</caption>
            <thead>
              <tr>
                <th scope="col">Tempo</th>
                <th scope="col">Temp. °C</th>
                <th scope="col">Rugiada °C</th>
                <th scope="col">Umidità %</th>
                <th scope="col">Vento km/h</th>
                <th scope="col">Nubi %</th>
                <th scope="col">Prec. mm</th>
              </tr>
            </thead>
            <tbody>
              {simulation.timeline.map((item) => (
                <tr key={item.minute} aria-current={item.minute === frame.minute ? 'step' : undefined}>
                  <th scope="row">{formatOffset(item.minute)}</th>
                  <td>{item.temperature.toFixed(1)}</td>
                  <td>{item.dewPoint.toFixed(1)}</td>
                  <td>{item.relativeHumidity.toFixed(0)}</td>
                  <td>{item.windSpeed.toFixed(1)}</td>
                  <td>{item.cloudCover.toFixed(0)}</td>
                  <td>{item.precipitation.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="sim-rules">
        <summary>Come funziona il modello didattico</summary>
        <ul>
          <li>Di giorno il sole riscalda, di notte la superficie si raffredda; le nubi attenuano entrambi gli effetti.</li>
          <li>Il vento rimescola l&apos;aria e riduce le variazioni di temperatura.</li>
          <li>Il vapore acqueo si conserva: il punto di rugiada resta costante e l&apos;umidità relativa cambia con la temperatura.</li>
          <li>Se la temperatura raggiunge il punto di rugiada il vapore condensa: umidità al 100 % e nubi in aumento.</li>
          <li>Pressione e direzione del vento non cambiano in questa versione.</li>
        </ul>
      </details>

      <div className="controls-row">
        <button type="button" className="button button--ghost" onClick={props.onSave}>
          SALVA SCENARIO
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
