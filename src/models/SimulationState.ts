import type { ConvectiveOutlook } from '../engine/ConvectiveEngine';
import type { SevereOutlook } from '../engine/SevereWeather';
import type { AtmosphericProfile } from './AtmosphericProfile';
import type { AtmosphericState } from './AtmosphericState';

/**
 * SimulationState — stato GENERATO dal simulatore didattico.
 *
 * Nasce da una copia congelata di un AtmosphericState (condizione iniziale)
 * ed è l'unico stato che l'utente può modificare. Non è una previsione.
 */

/** Grandezze iniziali modificabili dall'utente. */
export interface SimulationParameters {
  /** °C */
  readonly temperature: number;
  /** % */
  readonly relativeHumidity: number;
  /** km/h */
  readonly windSpeed: number;
}

export type AssumedField = keyof SimulationParameters | 'cloudCover';

/** Istantanea dello stato simulato a un minuto della timeline. */
export interface SimulationFrame {
  readonly minute: number;
  /** °C */
  readonly temperature: number;
  /** % */
  readonly relativeHumidity: number;
  /** °C */
  readonly dewPoint: number;
  /** km/h */
  readonly windSpeed: number;
  /** km/h */
  readonly windGust: number;
  /** ° — invariata nel modello */
  readonly windDirection: number | null;
  /** hPa — invariata nel modello */
  readonly pressure: number | null;
  /** % */
  readonly cloudCover: number;
  /** mm nei 15 minuti precedenti */
  readonly precipitation: number;
  /** true se nel passo si è raggiunta la saturazione */
  readonly saturated: boolean;
}

/** 'didactic' = SCENARIO DIDATTICO delle missioni (dati congelati, mai LIVE). */
export type SimulationOrigin = 'live' | 'last-observation' | 'scenario' | 'didactic';

export interface SimulationState {
  readonly kind: 'simulation';
  readonly id: string;
  readonly createdAt: string;
  /** Copia congelata dell'osservazione reale usata come condizione iniziale. */
  readonly origin: AtmosphericState;
  readonly originKind: SimulationOrigin;
  /** Copia del PROFILO ATMOSFERICO (modellistico) del punto; null se non disponibile. */
  readonly profile: AtmosphericProfile | null;
  readonly parameters: SimulationParameters;
  /** Grandezze mancanti nell'osservazione e sostituite da un valore didattico dichiarato. */
  readonly assumed: readonly AssumedField[];
  readonly timeline: readonly SimulationFrame[];
  readonly currentMinute: number;
  /**
   * Esperimento TEMPESTA LAB avviato con i parametri correnti (null = laboratorio in preparazione).
   * Si annulla quando l'utente modifica di nuovo l'atmosfera.
   */
  readonly convection: ConvectiveOutlook | null;
  /** GRANDINE LAB e DOWNBURST LAB per l'esperimento avviato (null in preparazione). */
  readonly severe: SevereOutlook | null;
}

/** Limiti dei controlli utente. */
export const PARAMETER_LIMITS: Record<keyof SimulationParameters, { min: number; max: number; step: number; unit: string }> = {
  temperature: { min: -30, max: 45, step: 0.5, unit: '°C' },
  relativeHumidity: { min: 5, max: 100, step: 1, unit: '%' },
  windSpeed: { min: 0, max: 120, step: 1, unit: 'km/h' },
};
