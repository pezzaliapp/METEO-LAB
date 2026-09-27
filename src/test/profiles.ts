import { createAtmosphericProfile, type AtmosphericProfile } from '../models/AtmosphericProfile';

/**
 * Profili di prova. REAL_PROFILE è una risposta reale di Open-Meteo (Umbria, 27/09/2026);
 * gli altri sono profili sintetici costruiti per isolare un fenomeno nei test.
 * Riga: [hPa, quota m s.l.m., T °C, Td °C, vento km/h, direzione °]
 */
type Row = readonly [number, number, number, number, number, number];

export function makeProfile(rows: readonly Row[], overrides: Partial<{ elevation: number; surfacePressure: number; freezingLevelHeight: number | null }> = {}): AtmosphericProfile {
  return createAtmosphericProfile({
    timestamp: '2026-09-27T12:00:00Z',
    latitude: 45.46,
    longitude: 9.19,
    elevation: overrides.elevation ?? 120,
    surfacePressure: overrides.surfacePressure ?? 1000,
    freezingLevelHeight: overrides.freezingLevelHeight ?? null,
    cape: null,
    cin: null,
    liftedIndex: null,
    levels: rows.map(([pressure, height, temperature, dewPoint, windSpeed, windDirection]) => ({
      pressure,
      height,
      temperature,
      dewPoint,
      relativeHumidity: null,
      windSpeed,
      windDirection,
    })),
    source: { providerId: 'test', providerName: 'Test', model: 'profilo di prova', fetchedAt: '2026-09-27T12:05:00Z' },
  });
}

/** Atmosfera stabile: aria calda in quota (inversione a 850 hPa), gradiente medio debole. */
export const STABLE_PROFILE = makeProfile([
  [1000, 110, 18, 12, 8, 200],
  [925, 780, 17, 8, 10, 220],
  [850, 1500, 16, 2, 15, 240],
  [700, 3120, 6, -8, 20, 250],
  [500, 5850, -9, -25, 30, 260],
  [300, 9600, -38, -50, 45, 260],
]);

/**
 * Profilo favorevole alla grandine: aria fredda in quota (−20 °C a 500 hPa), gradiente 700–500
 * ripido, zero termico basso, shear 0–6 km forte, aria umida nei bassi strati.
 */
export const HAIL_PROFILE = makeProfile([
  [1000, 110, 24, 19, 10, 180],
  [925, 790, 19, 15, 25, 200],
  [850, 1480, 14, 10, 40, 220],
  [700, 3050, 1, -6, 60, 240],
  [500, 5650, -20, -30, 85, 250],
  [300, 9250, -48, -58, 110, 250],
]);

/** Come HAIL_PROFILE ma con aria molto più calda in quota: zero termico ~4,8 km. */
export const WARM_ALOFT_PROFILE = makeProfile([
  [1000, 110, 29, 24, 10, 180],
  [925, 800, 25, 21, 25, 200],
  [850, 1540, 21, 17, 40, 220],
  [700, 3190, 11, 5, 60, 240],
  [500, 5900, -6, -12, 85, 250],
  [300, 9700, -33, -42, 110, 250],
]);

/**
 * "V rovesciata": strato vicino al suolo profondo, caldo e secco (gradiente quasi adiabatico secco),
 * aria secca anche a 700–500 hPa, umidità sufficiente in quota per la nube.
 */
export const DRY_SUBCLOUD_PROFILE = makeProfile([
  [1000, 110, 30, 12, 10, 200],
  [925, 800, 24, 6, 15, 220],
  [850, 1540, 17, 1, 20, 230],
  [700, 3150, 3, -12, 35, 240],
  [500, 5780, -16, -34, 55, 250],
  [300, 9400, -44, -58, 80, 250],
]);

/** Atmosfera umida in tutta la colonna: evaporazione minima. */
export const MOIST_PROFILE = makeProfile([
  [1000, 110, 26, 24, 8, 200],
  [925, 800, 21, 20, 12, 220],
  [850, 1520, 17, 16, 18, 230],
  [700, 3130, 6, 5, 25, 240],
  [500, 5780, -11, -12, 35, 250],
  [300, 9450, -39, -41, 50, 250],
]);

/** Risposta reale Open-Meteo (livello 1000 hPa sotto il terreno: elevazione 582 m). */
export const REAL_PROFILE_RESPONSE = {
  latitude: 42.8125,
  longitude: 12.875,
  elevation: 582.0,
  current_units: {
    time: 'unixtime', interval: 'seconds',
    temperature_1000hPa: '°C', relative_humidity_1000hPa: '%', dew_point_1000hPa: '°C', wind_speed_1000hPa: 'km/h', wind_direction_1000hPa: '°', geopotential_height_1000hPa: 'm',
    temperature_925hPa: '°C', relative_humidity_925hPa: '%', dew_point_925hPa: '°C', wind_speed_925hPa: 'km/h', wind_direction_925hPa: '°', geopotential_height_925hPa: 'm',
    temperature_850hPa: '°C', relative_humidity_850hPa: '%', dew_point_850hPa: '°C', wind_speed_850hPa: 'km/h', wind_direction_850hPa: '°', geopotential_height_850hPa: 'm',
    temperature_700hPa: '°C', relative_humidity_700hPa: '%', dew_point_700hPa: '°C', wind_speed_700hPa: 'km/h', wind_direction_700hPa: '°', geopotential_height_700hPa: 'm',
    temperature_500hPa: '°C', relative_humidity_500hPa: '%', dew_point_500hPa: '°C', wind_speed_500hPa: 'km/h', wind_direction_500hPa: '°', geopotential_height_500hPa: 'm',
    temperature_300hPa: '°C', relative_humidity_300hPa: '%', dew_point_300hPa: '°C', wind_speed_300hPa: 'km/h', wind_direction_300hPa: '°', geopotential_height_300hPa: 'm',
    cape: 'J/kg', convective_inhibition: 'J/kg', lifted_index: '', freezing_level_height: 'm', surface_pressure: 'hPa',
  },
  current: {
    time: 1790526600, interval: 900,
    temperature_1000hPa: 23.8, relative_humidity_1000hPa: 58, dew_point_1000hPa: 15.0, wind_speed_1000hPa: 4.9, wind_direction_1000hPa: 17, geopotential_height_1000hPa: 175.0,
    temperature_925hPa: 19.6, relative_humidity_925hPa: 57, dew_point_925hPa: 10.8, wind_speed_925hPa: 6.4, wind_direction_925hPa: 18, geopotential_height_925hPa: 843.0,
    temperature_850hPa: 14.1, relative_humidity_850hPa: 66, dew_point_850hPa: 7.9, wind_speed_850hPa: 3.9, wind_direction_850hPa: 36, geopotential_height_850hPa: 1564.0,
    temperature_700hPa: 4.6, relative_humidity_700hPa: 60, dew_point_700hPa: -2.5, wind_speed_700hPa: 30.8, wind_direction_700hPa: 19, geopotential_height_700hPa: 3178.0,
    temperature_500hPa: -11.9, relative_humidity_500hPa: 30, dew_point_500hPa: -26.0, wind_speed_500hPa: 26.4, wind_direction_500hPa: 357, geopotential_height_500hPa: 5835.0,
    temperature_300hPa: -40.5, relative_humidity_300hPa: 48, dew_point_300hPa: -47.3, wind_speed_300hPa: 24.1, wind_direction_300hPa: 27, geopotential_height_300hPa: 9527.42,
    cape: 0.0, convective_inhibition: 0.0, lifted_index: 4.0, freezing_level_height: 3980.0, surface_pressure: 954.5,
  },
};
