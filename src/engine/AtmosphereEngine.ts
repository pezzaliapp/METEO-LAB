import type { AtmosphericState } from '../models/AtmosphericState';
import {
  PARAMETER_LIMITS,
  type AssumedField,
  type SimulationFrame,
  type SimulationOrigin,
  type SimulationParameters,
  type SimulationState,
} from '../models/SimulationState';
import { SIMULATION_STEP_MINUTES, TIMELINE_MINUTES, isTimelineMinute, nextMinute } from '../simulation/timeline';
import { clamp, dewPointFrom, relativeHumidityFrom, round, solarFactor } from './physics';

/**
 * AtmosphereEngine — motore del simulatore DIDATTICO di METEO LAB.
 *
 * NON è un modello meteorologico numerico e NON produce previsioni.
 * Applica poche regole fisiche qualitative, dichiarate e leggibili,
 * per mostrare come interagiscono temperatura, umidità, vento e nubi:
 *
 *  1. Bilancio radiativo: di giorno il sole riscalda, di notte la superficie
 *     si raffredda; la copertura nuvolosa attenua entrambi gli effetti.
 *  2. Rimescolamento: il vento distribuisce il calore su uno strato più spesso
 *     e riduce la variazione di temperatura.
 *  3. Conservazione del vapore: senza apporti o perdite il punto di rugiada
 *     resta costante; l'umidità relativa cambia solo perché cambia la temperatura.
 *  4. Saturazione: se la temperatura scende al punto di rugiada il vapore
 *     condensa, il calore latente liberato attenua il raffreddamento e l'umidità
 *     relativa resta al 100 %.
 *  5. Nubi: umidità alta favorisce la formazione di nubi, aria secca le dissolve.
 *     Con saturazione e cielo coperto compare una debole precipitazione.
 *  6. Pressione e direzione del vento restano invariate nel modello 0.1.
 *
 * Il motore non modifica mai l'AtmosphericState ricevuto: ne conserva una copia
 * congelata e lavora esclusivamente su SimulationState.
 */

/** Valori didattici usati SOLO se il dato osservato manca; sono sempre dichiarati come "ipotizzati". */
export const DIDACTIC_DEFAULTS = {
  temperature: 15,
  relativeHumidity: 60,
  windSpeed: 10,
  cloudCover: 50,
} as const;

const DEFAULT_GUST_FACTOR = 1.5;

/** Costanti del modello per un passo di 15 minuti. */
const MODEL = {
  /** Riscaldamento massimo per insolazione piena e cielo sereno (°C / 15 min). */
  solarHeating: 0.6,
  /** Raffreddamento radiativo notturno con cielo sereno (°C / 15 min). */
  radiativeCooling: 0.25,
  /** Frazione dell'effetto radiativo schermata da cielo completamente coperto. */
  cloudShielding: 0.75,
  /** Velocità del vento (km/h) che dimezza la variazione termica. */
  mixingWind: 25,
  /** Frazione del raffreddamento compensata dal calore latente in saturazione. */
  latentHeatRecovery: 0.5,
  /** Soglie di umidità per formazione/dissipazione delle nubi (%). */
  cloudFormationRh: 85,
  cloudDissipationRh: 60,
  /** Precipitazione didattica in saturazione con cielo coperto (mm / 15 min). */
  drizzle: 0.2,
  /** Aumento massimo del vento per turbolenza termica diurna. */
  thermalWindBoost: 0.15,
} as const;

export interface EngineContext {
  readonly start: Date;
  readonly longitude: number;
  readonly baseWind: number;
  readonly gustFactor: number;
  readonly windDirection: number | null;
  readonly pressure: number | null;
}

interface CreateOptions {
  readonly originKind?: SimulationOrigin;
  readonly id?: string;
  readonly now?: Date;
}

export class AtmosphereEngine {
  /**
   * Crea un nuovo SimulationState copiando l'AtmosphericState (LIVE → SIM).
   * L'osservazione originale non viene toccata.
   */
  createSimulation(observation: AtmosphericState, options: CreateOptions = {}): SimulationState {
    const origin = copyObservation(observation);
    const assumed: AssumedField[] = [];

    const pick = (field: keyof typeof DIDACTIC_DEFAULTS): number => {
      const value = origin[field];
      if (value === null) {
        assumed.push(field);
        return DIDACTIC_DEFAULTS[field];
      }
      return value;
    };

    const parameters = normalizeParameters({
      temperature: pick('temperature'),
      relativeHumidity: pick('relativeHumidity'),
      windSpeed: pick('windSpeed'),
    });
    const initialCloudCover = pick('cloudCover');

    const draft: SimulationState = {
      kind: 'simulation',
      id: options.id ?? createId(),
      createdAt: (options.now ?? new Date()).toISOString(),
      origin,
      originKind: options.originKind ?? 'live',
      parameters,
      assumed: Object.freeze(assumed),
      timeline: [],
      currentMinute: 0,
    };
    return freezeState({ ...draft, timeline: this.computeTimeline(origin, parameters, initialCloudCover) });
  }

  /** Aggiorna le condizioni iniziali modificate dall'utente e ricalcola la timeline. */
  withParameters(simulation: SimulationState, changes: Partial<SimulationParameters>): SimulationState {
    const parameters = normalizeParameters({ ...simulation.parameters, ...changes });
    const initialCloudCover = simulation.timeline[0]?.cloudCover ?? DIDACTIC_DEFAULTS.cloudCover;
    return freezeState({
      ...simulation,
      parameters,
      timeline: this.computeTimeline(simulation.origin, parameters, initialCloudCover),
    });
  }

  /** Torna a T+0 con le condizioni iniziali dell'osservazione originale. */
  reset(simulation: SimulationState): SimulationState {
    const fresh = this.createSimulation(simulation.origin, {
      originKind: simulation.originKind,
      id: simulation.id,
      now: new Date(simulation.createdAt),
    });
    return fresh;
  }

  /** Posiziona la simulazione su un minuto della timeline. */
  seek(simulation: SimulationState, minute: number): SimulationState {
    if (!isTimelineMinute(minute)) {
      throw new RangeError(`Minuto non presente nella timeline: ${minute}`);
    }
    return freezeState({ ...simulation, currentMinute: minute });
  }

  /** Avanza di un passo (15 minuti). A fine timeline restituisce lo stato invariato. */
  advance(simulation: SimulationState): SimulationState {
    const next = nextMinute(simulation.currentMinute);
    return next === null ? simulation : this.seek(simulation, next);
  }

  currentFrame(simulation: SimulationState): SimulationFrame {
    const frame = simulation.timeline.find((item) => item.minute === simulation.currentMinute);
    if (!frame) throw new Error('Timeline incoerente');
    return frame;
  }

  isFinished(simulation: SimulationState): boolean {
    return nextMinute(simulation.currentMinute) === null;
  }

  /** Calcola l'intera timeline T+0 … T+90 (funzione pura e deterministica). */
  computeTimeline(
    origin: AtmosphericState,
    parameters: SimulationParameters,
    initialCloudCover: number,
  ): readonly SimulationFrame[] {
    const context: EngineContext = {
      start: new Date(origin.timestamp),
      longitude: origin.longitude,
      baseWind: parameters.windSpeed,
      gustFactor: gustFactorOf(origin),
      windDirection: origin.windDirection,
      pressure: origin.pressure,
    };

    const first: SimulationFrame = {
      minute: 0,
      temperature: parameters.temperature,
      relativeHumidity: parameters.relativeHumidity,
      dewPoint: dewPointFrom(parameters.temperature, parameters.relativeHumidity),
      windSpeed: parameters.windSpeed,
      windGust: parameters.windSpeed * context.gustFactor,
      windDirection: context.windDirection,
      pressure: context.pressure,
      cloudCover: clamp(initialCloudCover, 0, 100),
      precipitation: 0,
      saturated: parameters.relativeHumidity >= 100,
    };

    const frames: SimulationFrame[] = [first];
    let previous = first;
    for (const minute of TIMELINE_MINUTES.slice(1)) {
      previous = stepFrame(previous, minute, context);
      frames.push(previous);
    }
    return Object.freeze(frames.map(roundFrame));
  }
}

/** Un passo di 15 minuti del modello didattico. */
export function stepFrame(previous: SimulationFrame, minute: number, context: EngineContext): SimulationFrame {
  const midStep = new Date(context.start.getTime() + (minute - SIMULATION_STEP_MINUTES / 2) * 60_000);
  const sun = solarFactor(midStep, context.longitude);
  const cloudFraction = previous.cloudCover / 100;
  const transparency = 1 - MODEL.cloudShielding * cloudFraction;

  // 1–2. Bilancio radiativo attenuato dal rimescolamento del vento.
  const radiative = MODEL.solarHeating * sun * transparency - MODEL.radiativeCooling * (1 - sun) * transparency;
  const mixing = 1 / (1 + previous.windSpeed / MODEL.mixingWind);
  let temperature = previous.temperature + radiative * mixing;

  // 3–4. Vapore conservato; condensazione se si raggiunge il punto di rugiada.
  let dewPoint = previous.dewPoint;
  let saturated = false;
  if (temperature <= dewPoint) {
    temperature += (dewPoint - temperature) * MODEL.latentHeatRecovery;
    dewPoint = temperature;
    saturated = true;
  }
  const relativeHumidity = saturated ? 100 : relativeHumidityFrom(temperature, dewPoint);

  // 5. Nubi e precipitazione debole.
  let cloudCover = previous.cloudCover;
  if (relativeHumidity >= MODEL.cloudFormationRh) {
    cloudCover += (relativeHumidity - MODEL.cloudFormationRh) * 1.5;
  } else if (relativeHumidity < MODEL.cloudDissipationRh) {
    cloudCover -= (MODEL.cloudDissipationRh - relativeHumidity) * 0.5;
  }
  cloudCover = clamp(cloudCover, 0, 100);
  const precipitation = saturated && cloudCover >= 80 ? MODEL.drizzle : 0;

  // Vento: turbolenza termica diurna modesta attorno al valore iniziale.
  const windSpeed = context.baseWind * (1 + MODEL.thermalWindBoost * sun * transparency);

  return {
    minute,
    temperature,
    relativeHumidity,
    dewPoint,
    windSpeed,
    windGust: windSpeed * context.gustFactor,
    windDirection: context.windDirection,
    pressure: context.pressure,
    cloudCover,
    precipitation,
    saturated,
  };
}

function gustFactorOf(origin: AtmosphericState): number {
  const { windSpeed, windGust } = origin;
  if (windSpeed === null || windGust === null || windSpeed < 1) return DEFAULT_GUST_FACTOR;
  return clamp(windGust / windSpeed, 1, 3);
}

function normalizeParameters(parameters: SimulationParameters): SimulationParameters {
  const limit = (key: keyof SimulationParameters) =>
    clamp(parameters[key], PARAMETER_LIMITS[key].min, PARAMETER_LIMITS[key].max);
  return Object.freeze({
    temperature: limit('temperature'),
    relativeHumidity: limit('relativeHumidity'),
    windSpeed: limit('windSpeed'),
  });
}

function roundFrame(frame: SimulationFrame): SimulationFrame {
  return Object.freeze({
    ...frame,
    temperature: round(frame.temperature),
    relativeHumidity: round(frame.relativeHumidity, 0),
    dewPoint: round(frame.dewPoint),
    windSpeed: round(frame.windSpeed),
    windGust: round(frame.windGust),
    cloudCover: round(frame.cloudCover, 0),
    precipitation: round(frame.precipitation, 1),
  });
}

function copyObservation(observation: AtmosphericState): AtmosphericState {
  return Object.freeze({ ...observation, source: Object.freeze({ ...observation.source }) });
}

function freezeState(state: SimulationState): SimulationState {
  return Object.freeze(state);
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
