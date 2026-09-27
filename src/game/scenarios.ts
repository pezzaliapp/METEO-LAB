import { createAtmosphericProfile, type AtmosphericProfile } from '../models/AtmosphericProfile';
import { createAtmosphericState, type AtmosphericState } from '../models/AtmosphericState';
import { SCENARIO_SOURCES, type ScenarioSource } from './scenarioData';

/**
 * SCENARI DIDATTICI delle MISSIONI.
 *
 * Ogni scenario è deterministico e versionato: stessa versione → stessi dati → stessi risultati,
 * qualunque sia il meteo del giorno. I dati derivano da profili reali Open-Meteo congelati
 * (scenarioData.ts); in alcuni scenari la condizione al suolo è impostata didatticamente per
 * partire da un fenomeno già presente. Non sono dati attuali e l'interfaccia li etichetta
 * SEMPRE come «SCENARIO DIDATTICO», mai come LIVE.
 */

export const SCENARIO_LABEL = 'SCENARIO DIDATTICO';
export const SCENARIO_PROVIDER_ID = 'scenario-didattico';

export type ScenarioId = 'pianura' | 'pianura-grandine' | 'altopiano' | 'meseta' | 'meseta-downburst';

export interface Scenario {
  readonly id: ScenarioId;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly label: typeof SCENARIO_LABEL;
  /** Condizione al suolo iniziale dello scenario (non è un'osservazione attuale). */
  readonly observation: AtmosphericState;
  readonly profile: AtmosphericProfile;
}

interface SurfaceOverride {
  readonly temperature?: number;
  readonly relativeHumidity?: number;
  readonly windSpeed?: number;
}

function build(
  id: ScenarioId,
  name: string,
  description: string,
  source: ScenarioSource,
  sourceName: string,
  override: SurfaceOverride = {},
): Scenario {
  const surface = { ...source.surface, ...override };
  const provenance = `${SCENARIO_LABEL} v1 · derivato da un profilo Open-Meteo (${sourceName}, ${source.validAt.slice(0, 10)}), congelato`;
  const observation = createAtmosphericState({
    timestamp: source.validAt,
    latitude: source.latitude,
    longitude: source.longitude,
    temperature: surface.temperature,
    apparentTemperature: override.temperature === undefined ? surface.apparentTemperature : null,
    relativeHumidity: surface.relativeHumidity,
    // Il punto di rugiada segue l'umidità impostata: se lo scenario la modifica, lo ricalcola il motore.
    dewPoint: override.relativeHumidity === undefined && override.temperature === undefined ? surface.dewPoint : null,
    pressure: surface.pressure,
    surfacePressure: surface.surfacePressure,
    precipitation: 0,
    rain: 0,
    showers: 0,
    cloudCover: surface.cloudCover,
    windSpeed: surface.windSpeed,
    windDirection: surface.windDirection,
    windGust: surface.windGust,
    weatherCode: override.relativeHumidity === undefined ? surface.weatherCode : null,
    source: { providerId: SCENARIO_PROVIDER_ID, providerName: provenance, fetchedAt: source.validAt },
  });
  const profile = createAtmosphericProfile({
    timestamp: source.validAt,
    latitude: source.latitude,
    longitude: source.longitude,
    elevation: source.elevation,
    surfacePressure: source.surface.surfacePressure,
    cape: source.cape,
    cin: source.cin,
    liftedIndex: source.liftedIndex,
    freezingLevelHeight: source.freezingLevelHeight,
    levels: source.levels.map(([pressure, height, temperature, relativeHumidity, dewPoint, windSpeed, windDirection]) => ({
      pressure,
      height,
      temperature,
      relativeHumidity,
      dewPoint,
      windSpeed,
      windDirection,
    })),
    source: {
      providerId: SCENARIO_PROVIDER_ID,
      providerName: SCENARIO_LABEL,
      model: `profilo congelato (v1) derivato da Open-Meteo, modelli combinati «best match», ${sourceName}`,
      fetchedAt: source.validAt,
    },
  });
  return Object.freeze({ id, version: 1, name, description, label: SCENARIO_LABEL, observation, profile });
}

export const SCENARIOS: Readonly<Record<ScenarioId, Scenario>> = Object.freeze({
  pianura: build(
    'pianura',
    'Pianura in una giornata tersa',
    'Aria calda ma secca al suolo, cielo sereno. In quota l’aria è fredda.',
    SCENARIO_SOURCES.bologna,
    'Pianura Padana',
  ),
  'pianura-grandine': build(
    'pianura-grandine',
    'Pianura afosa',
    'Stesso profilo in quota della pianura, ma aria al suolo calda e molto umida: la cella produce grandine.',
    SCENARIO_SOURCES.bologna,
    'Pianura Padana',
    { temperature: 26, relativeHumidity: 80 },
  ),
  altopiano: build(
    'altopiano',
    'Altopiano semi-arido',
    'Altopiano a oltre 1500 m, aria moderatamente umida al suolo.',
    SCENARIO_SOURCES.albuquerque,
    'altopiano del Nuovo Messico',
  ),
  meseta: build(
    'meseta',
    'Altopiano interno molto secco',
    'Caldo intenso e aria molto secca al suolo; aria secca anche in quota.',
    SCENARIO_SOURCES.madrid,
    'meseta spagnola',
  ),
  'meseta-downburst': build(
    'meseta-downburst',
    'Pomeriggio caldo sull’altopiano',
    'Aria calda al suolo con umidità sufficiente per una cella; sotto la nube l’aria resta secca.',
    SCENARIO_SOURCES.madrid,
    'meseta spagnola',
    { relativeHumidity: 45 },
  ),
});

export function isDidacticScenario(observation: AtmosphericState): boolean {
  return observation.source.providerId === SCENARIO_PROVIDER_ID;
}
