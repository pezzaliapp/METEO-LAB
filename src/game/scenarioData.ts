/**
 * Dati congelati degli SCENARI DIDATTICI (versione 1).
 *
 * Derivati da risposte reali di Open-Meteo (Forecast API, blocco "current", modelli combinati
 * «best match») ricevute il 2026-09-27T17:30:00.000Z per tre punti.
 * Sono CONGELATI e versionati nel progetto: NON sono dati attuali e non vanno presentati come tali.
 * Dati Open-Meteo: licenza CC BY 4.0 (https://open-meteo.com/).
 * Riga livello: [hPa, quota m s.l.m., T °C, UR %, Td °C, vento km/h, direzione °]
 */
export type LevelRow = readonly [number, number, number, number, number, number, number];

export interface ScenarioSource {
  readonly validAt: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly elevation: number;
  readonly surface: {
    readonly temperature: number;
    readonly apparentTemperature: number;
    readonly relativeHumidity: number;
    readonly dewPoint: number;
    readonly pressure: number;
    readonly surfacePressure: number;
    readonly cloudCover: number;
    readonly windSpeed: number;
    readonly windDirection: number;
    readonly windGust: number;
    readonly weatherCode: number;
  };
  readonly levels: readonly LevelRow[];
  readonly cape: number | null;
  readonly cin: number | null;
  readonly liftedIndex: number | null;
  readonly freezingLevelHeight: number | null;
}

export const SCENARIO_SOURCES = {
  bologna: {
    validAt: "2026-09-27T17:30:00.000Z",
    latitude: 44.5,
    longitude: 11.279999,
    elevation: 43,
    surface: { temperature: 23.6, apparentTemperature: 21.1, relativeHumidity: 32, dewPoint: 5.9, pressure: 1021.6, surfacePressure: 1016.6, cloudCover: 0, windSpeed: 10.5, windDirection: 112, windGust: 22, weatherCode: 0 },
    levels: [
      [1000, 185, 22.6, 33, 5.5, 25.4, 111],
      [925, 855.92, 18, 33, 1.5, 5.7, 104],
      [850, 1572, 14.6, 23, -6.3, 19, 314],
      [700, 3188, 5.5, 62, -1.2, 17.4, 325],
      [500, 5846, -12.8, 37, -24.5, 18.3, 337],
      [300, 9535.48, -40.5, 22, -54, 4.3, 304],
    ],
    cape: 0, cin: 0, liftedIndex: 6.3, freezingLevelHeight: 4000,
  },
  albuquerque: {
    validAt: "2026-09-27T17:30:00.000Z",
    latitude: 35.10862,
    longitude: -106.60762,
    elevation: 1561,
    surface: { temperature: 24.4, apparentTemperature: 26.1, relativeHumidity: 46, dewPoint: 12, pressure: 1013.6, surfacePressure: 849.8, cloudCover: 100, windSpeed: 2.4, windDirection: 243, windGust: 4.7, weatherCode: 3 },
    levels: [
      [1000, 118, 32, 44, 18.2, 2.9, 263],
      [925, 791, 27.6, 44, 14.2, 2.9, 254],
      [850, 1534, 22.9, 44, 10, 3.2, 262],
      [700, 3184, 9.7, 53, 0.7, 11, 227],
      [500, 5884, -6.5, 4, -41.6, 32.5, 274],
      [300, 9662.9, -33.5, 62, -38.3, 69.1, 278],
    ],
    cape: 100, cin: 52, liftedIndex: 0.1, freezingLevelHeight: 4490,
  },
  madrid: {
    validAt: "2026-09-27T17:30:00.000Z",
    latitude: 40.4375,
    longitude: -3.6875,
    elevation: 664,
    surface: { temperature: 29.5, apparentTemperature: 27.1, relativeHumidity: 19, dewPoint: 3.5, pressure: 1013.7, surfacePressure: 941, cloudCover: 99, windSpeed: 6.5, windDirection: 161, windGust: 19.4, weatherCode: 3 },
    levels: [
      [1000, 117, 33.1, 18, 5.6, 6.4, 164],
      [925, 798, 28.4, 19, 2.6, 15.4, 165],
      [850, 1538, 21.2, 26, 1, 20.2, 162],
      [700, 3171, 5.9, 46, -4.9, 26.8, 184],
      [500, 5827, -12.8, 49, -21.4, 45.3, 212],
      [300, 9538.71, -38, 58, -43.2, 65.9, 237],
    ],
    cape: 10, cin: 0, liftedIndex: 0.8, freezingLevelHeight: 3900,
  },
} as const satisfies Record<string, ScenarioSource>;
