import { isValidCoordinate } from './AtmosphericState';

/**
 * AtmosphericProfile — PROFILO ATMOSFERICO verticale in un punto.
 *
 * È un dato MODELLISTICO fornito dal provider (Open-Meteo, livelli di pressione
 * dei modelli numerici), NON un radiosondaggio osservato. Come l'AtmosphericState
 * è reale nel senso di "non generato da METEO LAB", è immutabile e non viene
 * mai modificato dal simulatore.
 *
 * Unità:
 *   pressure .................................... hPa
 *   height (altezza geopotenziale sul livello del mare) ... m
 *   temperature, dewPoint ....................... °C
 *   relativeHumidity ............................ %
 *   windSpeed ................................... km/h
 *   windDirection ............................... ° (provenienza)
 *   cape, cin ................................... J/kg (calcolati dal modello del provider)
 *   freezingLevelHeight, elevation ............. m sul livello del mare
 *
 * Ogni grandezza non disponibile è `null`: nessun valore viene inventato.
 */

/** Livelli di pressione richiesti (hPa), dal basso verso l'alto. */
export const PROFILE_LEVELS = [1000, 925, 850, 700, 500, 300] as const;

export interface PressureLevel {
  readonly pressure: number;
  /** Altezza geopotenziale sul livello del mare (m). */
  readonly height: number | null;
  readonly temperature: number | null;
  readonly relativeHumidity: number | null;
  readonly dewPoint: number | null;
  readonly windSpeed: number | null;
  readonly windDirection: number | null;
  /**
   * false se il livello è sotto il terreno del punto (pressione maggiore di quella al suolo
   * o quota inferiore all'elevazione): il provider lo estrapola, non va usato come aria reale.
   */
  readonly aboveGround: boolean;
}

export interface AtmosphericProfile {
  readonly timestamp: string;
  readonly latitude: number;
  readonly longitude: number;
  /** Elevazione del punto di griglia (m s.l.m.). */
  readonly elevation: number | null;
  readonly surfacePressure: number | null;
  /** Livelli ordinati per pressione decrescente (dal basso verso l'alto). */
  readonly levels: readonly PressureLevel[];
  readonly cape: number | null;
  readonly cin: number | null;
  readonly liftedIndex: number | null;
  /** Zero termico del provider (m s.l.m.). */
  readonly freezingLevelHeight: number | null;
  readonly source: {
    readonly providerId: string;
    readonly providerName: string;
    /** Descrizione del modello o della combinazione di modelli. */
    readonly model: string;
    readonly fetchedAt: string;
  };
}

type LevelField = Exclude<keyof PressureLevel, 'pressure' | 'aboveGround'>;

const LEVEL_RANGES: Record<LevelField, readonly [number, number]> = {
  height: [-1000, 20_000],
  temperature: [-100, 60],
  relativeHumidity: [0, 100],
  dewPoint: [-120, 40],
  windSpeed: [0, 600],
  windDirection: [0, 360],
};

const SCALAR_RANGES = {
  elevation: [-500, 9000],
  surfacePressure: [300, 1100],
  cape: [0, 10_000],
  cin: [-2000, 2000],
  liftedIndex: [-30, 40],
  freezingLevelHeight: [-1000, 10_000],
} as const;

type ScalarField = keyof typeof SCALAR_RANGES;

function sanitize(value: unknown, [min, max]: readonly [number, number]): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value < min || value > max ? null : value;
}

export type PressureLevelInput = { pressure: number } & Partial<Record<LevelField, unknown>>;

export type AtmosphericProfileInput = {
  timestamp: string;
  latitude: number;
  longitude: number;
  levels: readonly PressureLevelInput[];
  source: AtmosphericProfile['source'];
} & Partial<Record<ScalarField, unknown>>;

/** Crea un AtmosphericProfile immutabile; valori mancanti o implausibili diventano null. */
export function createAtmosphericProfile(input: AtmosphericProfileInput): AtmosphericProfile {
  if (!isValidCoordinate(input.latitude, input.longitude)) {
    throw new RangeError(`Coordinate non valide: ${input.latitude}, ${input.longitude}`);
  }
  if (Number.isNaN(Date.parse(input.timestamp))) throw new RangeError(`Timestamp non valido: ${input.timestamp}`);

  const scalars = {} as Record<ScalarField, number | null>;
  for (const key of Object.keys(SCALAR_RANGES) as ScalarField[]) scalars[key] = sanitize(input[key], SCALAR_RANGES[key]);
  // CIN: alcuni modelli la riportano negativa; nel progetto è una grandezza positiva (energia da vincere).
  if (scalars.cin !== null) scalars.cin = Math.abs(scalars.cin);

  const levels = input.levels
    .filter((level) => Number.isFinite(level.pressure) && level.pressure > 0)
    .map((level): PressureLevel => {
      const values = {} as Record<LevelField, number | null>;
      for (const key of Object.keys(LEVEL_RANGES) as LevelField[]) values[key] = sanitize(level[key], LEVEL_RANGES[key]);
      const belowByPressure = scalars.surfacePressure !== null && level.pressure > scalars.surfacePressure;
      const belowByHeight = scalars.elevation !== null && values.height !== null && values.height <= scalars.elevation;
      return Object.freeze({ pressure: level.pressure, ...values, aboveGround: !belowByPressure && !belowByHeight });
    })
    .sort((a, b) => b.pressure - a.pressure);

  return Object.freeze({
    timestamp: new Date(input.timestamp).toISOString(),
    latitude: input.latitude,
    longitude: input.longitude,
    ...scalars,
    levels: Object.freeze(levels),
    source: Object.freeze({ ...input.source }),
  });
}

/** Livelli sopra il terreno con quota e temperatura disponibili. */
export function usableLevels(profile: AtmosphericProfile): PressureLevel[] {
  return profile.levels.filter((level) => level.aboveGround && level.height !== null && level.temperature !== null);
}
