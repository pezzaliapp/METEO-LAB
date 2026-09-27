import type { ReactNode } from 'react';
import type { ConvectiveOutlook } from '../engine/ConvectiveEngine';
import type { SevereOutlook } from '../engine/SevereWeather';
import { PARAMETER_LIMITS, type SimulationParameters, type SimulationState } from '../models/SimulationState';
import { DOWNBURST_STAGE_LABELS, HAIL_STAGE_LABELS, downburstSentence, hailSentence } from '../simulation/severeNarrative';
import { STAGE_LABELS, phaseSentence, type ParameterChanges } from '../simulation/tempestaNarrative';
import { SIMULATION_DURATION_MINUTES, TIMELINE_MINUTES, formatOffset } from '../simulation/timeline';
import { CellSectionView } from './CellSectionView';
import { formatDirection, formatValue } from './format';

/** Parti dell'esperimento condivise da TEMPESTA LAB (ESPLORA) e MISSIONI. */

export type ParameterKey = keyof SimulationParameters;

export const PARAMETER_LABELS: Record<ParameterKey, string> = {
  temperature: 'Temperatura',
  relativeHumidity: 'Umidità',
  windSpeed: 'Vento',
};

export const DECIMALS: Record<ParameterKey, number> = { temperature: 1, relativeHumidity: 0, windSpeed: 0 };

export const PARAMETER_KEYS = Object.keys(PARAMETER_LIMITS) as ParameterKey[];

export function realValue(simulation: SimulationState, key: ParameterKey): number | null {
  return simulation.origin[key];
}

export function parameterChanges(simulation: SimulationState): ParameterChanges {
  const diff = (key: ParameterKey) => {
    const real = realValue(simulation, key);
    return real === null ? 0 : simulation.parameters[key] - real;
  };
  return { temperature: diff('temperature'), relativeHumidity: diff('relativeHumidity'), windSpeed: diff('windSpeed') };
}

export function formatDelta(value: number, unit: string, decimals: number): string {
  if (Math.abs(value) < 10 ** -decimals / 2) return `0 ${unit}`;
  return `${value > 0 ? '+' : '−'}${formatValue(Math.abs(value), unit, decimals)}`;
}

interface AtmosphereControlsProps {
  readonly simulation: SimulationState;
  readonly baseId: string;
  /** Etichetta del valore di partenza: REALE (osservazione) o SCENARIO (scenario didattico). */
  readonly referenceLabel: 'REALE' | 'SCENARIO';
  readonly onChange: (key: ParameterKey, value: number) => void;
  /** Controlli modificabili (gli altri sono bloccati). Default: tutti. */
  readonly allowed?: readonly ParameterKey[];
  /** true durante l'esperimento: controlli congelati. */
  readonly frozen?: boolean;
  readonly children?: ReactNode;
}

export function AtmosphereControls(props: AtmosphereControlsProps) {
  const { simulation, baseId, referenceLabel, allowed = PARAMETER_KEYS, frozen = false } = props;
  return (
    <fieldset className="parameters" disabled={frozen}>
      <legend>Atmosfera al suolo{frozen ? ' · controlli congelati durante l’esperimento' : ''}</legend>
      {PARAMETER_KEYS.map((key) => {
        const limits = PARAMETER_LIMITS[key];
        const inputId = `${baseId}-${key}`;
        const value = simulation.parameters[key];
        const real = realValue(simulation, key);
        const decimals = DECIMALS[key];
        const locked = !allowed.includes(key);
        return (
          <div className={`parameter${locked ? ' parameter--locked' : ''}`} key={key}>
            <label htmlFor={inputId} className="parameter__name">
              {PARAMETER_LABELS[key]}
              {locked && <span className="parameter__hint">bloccato in questa missione</span>}
              {!locked && key === 'windSpeed' && (
                <span className="parameter__hint">da {formatDirection(simulation.origin.windDirection)}</span>
              )}
            </label>
            <dl className="compare">
              <div>
                <dt>{referenceLabel}</dt>
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
              disabled={locked || frozen}
              onChange={(event) => props.onChange(key, Number(event.target.value))}
            />
          </div>
        );
      })}
      {props.children}
    </fieldset>
  );
}

interface ExperimentPlayerProps {
  readonly simulation: SimulationState;
  readonly outlook: ConvectiveOutlook;
  readonly severe: SevereOutlook | null;
  readonly playing: boolean;
  readonly finished: boolean;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onStep: () => void;
  readonly onRestart: () => void;
  readonly onSeek: (minute: number) => void;
}

/** Fase corrente, sezione verticale, timeline T+0…T+90 e comandi dell'esperimento. */
export function ExperimentPlayer(props: ExperimentPlayerProps) {
  const { simulation, outlook, severe, playing, finished } = props;
  const minute = simulation.currentMinute;
  const frame = outlook.frames.find((item) => item.minute === minute);
  if (!frame) return null;
  const progress = (minute / SIMULATION_DURATION_MINUTES) * 100;
  return (
    <>
      <div className="stage-line" aria-live="polite">
        <span className="stage-line__time">{formatOffset(minute)}</span>
        <span className="stage-line__stage">{STAGE_LABELS[frame.stage]}</span>
      </div>
      <p className="lab-sentence">{phaseSentence(outlook, minute, parameterChanges(simulation))}</p>
      {severe && <SevereNow severe={severe} minute={minute} />}
      {severe && <CellSectionView convection={outlook} severe={severe} minute={minute} />}

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
  );
}

/** Stadio corrente di grandine e downburst (solo se il fenomeno è attivo). */
export function SevereNow({ severe, minute }: { readonly severe: SevereOutlook; readonly minute: number }) {
  const hail = severe.hail.frames.find((frame) => frame.minute === minute)?.stage ?? 'NONE';
  const burst = severe.downburst.frames.find((frame) => frame.minute === minute)?.stage ?? 'NONE';
  const hailText = hailSentence(hail);
  const burstText = downburstSentence(burst);
  if (!hailText && !burstText) return null;
  return (
    <div className="severe-now" aria-live="polite">
      {hailText && (
        <p className="severe-now__item severe-now__item--hail">
          <strong>● GRANDINE · {HAIL_STAGE_LABELS[hail]}</strong> {hailText}
        </p>
      )}
      {burstText && (
        <p className="severe-now__item severe-now__item--burst">
          <strong>↓ DOWNBURST · {DOWNBURST_STAGE_LABELS[burst]}</strong> {burstText}
        </p>
      )}
    </div>
  );
}
