/**
 * AtmosphericState — stato atmosferico OSSERVATO/REALE in un punto.
 *
 * È il dato LIVE fornito da un WeatherProvider. Non viene mai modificato
 * dal simulatore: il simulatore ne crea una copia separata (SimulationState).
 *
 * Unità (fissate dal provider tramite parametri espliciti):
 *   temperature, apparentTemperature, dewPoint ........ °C
 *   relativeHumidity, cloudCover ....................... %
 *   pressure (livello del mare), surfacePressure ....... hPa
 *   precipitation, rain, showers ....................... mm (intervallo del provider)
 *   windSpeed, windGust ................................ km/h
 *   windDirection ...................................... ° (provenienza, 0 = Nord)
 *   weatherCode ........................................ codice WMO
 *
 * Ogni grandezza non disponibile è `null`: nessun valore viene inventato.
 */
export interface AtmosphericState {
  /** Istante di validità dell'osservazione (ISO 8601, UTC). */
  readonly timestamp: string;
  readonly latitude: number;
  readonly longitude: number;

  readonly temperature: number | null;
  readonly apparentTemperature: number | null;
  readonly relativeHumidity: number | null;
  readonly dewPoint: number | null;

  readonly pressure: number | null;
  readonly surfacePressure: number | null;

  readonly precipitation: number | null;
  readonly rain: number | null;
  readonly showers: number | null;

  readonly cloudCover: number | null;

  readonly windSpeed: number | null;
  readonly windDirection: number | null;
  readonly windGust: number | null;

  readonly weatherCode: number | null;

  /** Metadati di provenienza. */
  readonly source: {
    readonly providerId: string;
    readonly providerName: string;
    /** Istante in cui il dato è stato ricevuto dal dispositivo (ISO 8601, UTC). */
    readonly fetchedAt: string;
  };
}

export type AtmosphericField = Exclude<keyof AtmosphericState, 'timestamp' | 'latitude' | 'longitude' | 'source'>;

export const ATMOSPHERIC_FIELDS: readonly AtmosphericField[] = [
  'temperature',
  'apparentTemperature',
  'relativeHumidity',
  'dewPoint',
  'pressure',
  'surfacePressure',
  'precipitation',
  'rain',
  'showers',
  'cloudCover',
  'windSpeed',
  'windDirection',
  'windGust',
  'weatherCode',
];

/** Intervalli fisicamente plausibili: un valore fuori intervallo è trattato come mancante. */
const VALID_RANGES: Record<AtmosphericField, readonly [number, number]> = {
  temperature: [-95, 65],
  apparentTemperature: [-110, 80],
  relativeHumidity: [0, 100],
  dewPoint: [-100, 40],
  pressure: [850, 1090],
  surfacePressure: [300, 1100],
  precipitation: [0, 500],
  rain: [0, 500],
  showers: [0, 500],
  cloudCover: [0, 100],
  windSpeed: [0, 500],
  windDirection: [0, 360],
  windGust: [0, 600],
  weatherCode: [0, 99],
};

export type AtmosphericInput = {
  timestamp: string;
  latitude: number;
  longitude: number;
  source: AtmosphericState['source'];
} & Partial<Record<AtmosphericField, unknown>>;

/** Restituisce il numero se finito e plausibile per il campo, altrimenti null. */
export function sanitizeValue(field: AtmosphericField, value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const [min, max] = VALID_RANGES[field];
  if (value < min || value > max) return null;
  return value;
}

export function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * Crea un AtmosphericState immutabile. I campi assenti o non validi diventano null.
 * Lancia un errore se timestamp o coordinate non sono validi.
 */
export function createAtmosphericState(input: AtmosphericInput): AtmosphericState {
  if (!isValidCoordinate(input.latitude, input.longitude)) {
    throw new RangeError(`Coordinate non valide: ${input.latitude}, ${input.longitude}`);
  }
  if (Number.isNaN(Date.parse(input.timestamp))) {
    throw new RangeError(`Timestamp non valido: ${input.timestamp}`);
  }
  const values = {} as Record<AtmosphericField, number | null>;
  for (const field of ATMOSPHERIC_FIELDS) {
    values[field] = sanitizeValue(field, input[field]);
  }
  const state: AtmosphericState = {
    timestamp: new Date(input.timestamp).toISOString(),
    latitude: input.latitude,
    longitude: input.longitude,
    ...values,
    source: Object.freeze({ ...input.source }),
  };
  return Object.freeze(state);
}

/** Numero di grandezze effettivamente disponibili (non null). */
export function countAvailableFields(state: AtmosphericState): number {
  return ATMOSPHERIC_FIELDS.filter((field) => state[field] !== null).length;
}
