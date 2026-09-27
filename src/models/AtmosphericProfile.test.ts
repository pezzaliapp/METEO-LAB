import { describe, expect, it } from 'vitest';
import { OpenMeteoProvider } from '../providers/OpenMeteoProvider';
import { REAL_PROFILE_RESPONSE } from '../test/profiles';
import { PROFILE_LEVELS, createAtmosphericProfile, usableLevels } from './AtmosphericProfile';

const provider = new OpenMeteoProvider({ now: () => new Date('2026-09-27T16:31:00Z'), isOnline: () => true });

describe('AtmosphericProfile', () => {
  it('richiede i livelli 1000…300 hPa e le variabili documentate da Open-Meteo', () => {
    const url = new URL(provider.buildProfileUrl(42.83, 12.89));
    const current = url.searchParams.get('current')?.split(',') ?? [];
    for (const level of PROFILE_LEVELS) {
      for (const name of ['temperature', 'relative_humidity', 'dew_point', 'wind_speed', 'wind_direction', 'geopotential_height']) {
        expect(current).toContain(`${name}_${level}hPa`);
      }
    }
    expect(current).toEqual(expect.arrayContaining(['cape', 'convective_inhibition', 'lifted_index', 'freezing_level_height']));
    expect(url.searchParams.get('wind_speed_unit')).toBe('kmh');
  });

  it('converte la risposta reale in un profilo e marca i livelli sotto il terreno', () => {
    const profile = provider.parseProfile(REAL_PROFILE_RESPONSE, 42.83, 12.89);
    expect(profile.levels.map((level) => level.pressure)).toEqual([1000, 925, 850, 700, 500, 300]);
    expect(profile.elevation).toBe(582);
    expect(profile.surfacePressure).toBe(954.5);
    // 1000 hPa a 175 m con terreno a 582 m: estrapolato dal provider, non aria reale.
    expect(profile.levels[0]?.aboveGround).toBe(false);
    expect(profile.levels[1]).toMatchObject({ pressure: 925, height: 843, temperature: 19.6, dewPoint: 10.8, aboveGround: true });
    expect(usableLevels(profile).map((level) => level.pressure)).toEqual([925, 850, 700, 500, 300]);
    expect(profile).toMatchObject({ cape: 0, cin: 0, liftedIndex: 4, freezingLevelHeight: 3980 });
    expect(profile.source.model).toContain('Open-Meteo');
    expect(profile.source.model).not.toMatch(/radiosond/i);
  });

  it('12. dati mancanti o con unità inattese → null, nessun valore inventato', () => {
    const current: Record<string, unknown> = { ...REAL_PROFILE_RESPONSE.current };
    delete current.temperature_500hPa;
    current.dew_point_700hPa = null;
    delete current.convective_inhibition;
    const units = { ...REAL_PROFILE_RESPONSE.current_units, wind_speed_850hPa: 'm/s' };
    const profile = provider.parseProfile({ ...REAL_PROFILE_RESPONSE, current, current_units: units }, 42.83, 12.89);
    const level = (p: number) => profile.levels.find((item) => item.pressure === p);
    expect(level(500)?.temperature).toBeNull();
    expect(level(700)?.dewPoint).toBeNull();
    expect(level(850)?.windSpeed).toBeNull();
    expect(profile.cin).toBeNull();
    expect(level(500)?.height).toBe(5835);
  });

  it('scarta valori implausibili ed è immutabile', () => {
    const profile = createAtmosphericProfile({
      timestamp: '2026-09-27T12:00:00Z',
      latitude: 45,
      longitude: 9,
      elevation: 100,
      surfacePressure: 1005,
      levels: [{ pressure: 850, height: 1500, temperature: 250, relativeHumidity: 140, dewPoint: 5, windSpeed: -3, windDirection: 400 }],
      source: { providerId: 't', providerName: 'T', model: 'm', fetchedAt: '2026-09-27T12:00:00Z' },
    });
    expect(profile.levels[0]).toMatchObject({ temperature: null, relativeHumidity: null, windSpeed: null, windDirection: null, dewPoint: 5 });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.levels[0])).toBe(true);
    expect(() =>
      createAtmosphericProfile({ ...profile, levels: [], latitude: 99, source: profile.source, timestamp: profile.timestamp }),
    ).toThrow(RangeError);
  });
});
