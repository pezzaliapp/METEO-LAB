import { describe, expect, it } from 'vitest';
import { OpenMeteoProvider } from '../providers/OpenMeteoProvider';
import { HAIL_PROFILE, REAL_PROFILE_RESPONSE, STABLE_PROFILE, makeProfile } from '../test/profiles';
import { VerticalProfileEngine, buildColumn, temperatureAt, wetBulbStull, type SurfaceAir } from './VerticalProfileEngine';

const engine = new VerticalProfileEngine();
const surface: SurfaceAir = { temperature: 24, relativeHumidity: 70, windSpeed: 10, windDirection: 180 };

describe('VerticalProfileEngine', () => {
  it('temperatura di bulbo umido di Stull (2011): 20 °C, 50 % → ≈ 13,7 °C', () => {
    expect(wetBulbStull(20, 50)).toBeCloseTo(13.7, 1);
    expect(wetBulbStull(20, 99)).toBeCloseTo(20, 0);
  });

  it('usa quote sopra il suolo e interpola linearmente', () => {
    const column = buildColumn(HAIL_PROFILE, surface);
    expect(column?.points[0]).toMatchObject({ height: 0, temperature: 24 });
    // 925 hPa: 790 m s.l.m. − 120 m di elevazione
    expect(column?.points[1]?.height).toBe(670);
    if (!column) throw new Error('colonna');
    expect(temperatureAt(column, 670 + (1360 - 670) / 2)).toBeCloseTo((19 + 14) / 2, 5);
  });

  it('calcola zero termico, zero del bulbo umido, gradienti, shear e secchezza', () => {
    const analysis = engine.analyze(HAIL_PROFILE, surface, surface);
    if (!analysis.available) throw new Error('profilo completo');
    // 0 °C fra 700 hPa (1 °C a 2930 m AGL) e 500 hPa (−20 °C a 5530 m AGL)
    expect(analysis.freezingLevel).toBeCloseTo(2930 + (1 / 21) * 2600, 0);
    expect(analysis.freezingLevelSource).toBe('profile');
    expect(analysis.wetBulbZeroApprox).toBeLessThan(analysis.freezingLevel ?? 0);
    expect(analysis.lapseRateMid).toBeCloseTo((21 / 2600) * 1000, 3);
    expect(analysis.deepLayerShear).toBeGreaterThan(20);
    expect(analysis.midLevelDryness).toBeCloseTo((7 + 10) / 2, 5);
    expect(analysis.cloudBase).toBeGreaterThan(0);
    expect(analysis.isotherm10).toBeGreaterThan(analysis.freezingLevel ?? 0);
    expect(analysis.meanWind?.speed).toBeGreaterThan(0);
  });

  it('le modifiche al suolo cambiano gli strati bassi, non la struttura in quota', () => {
    const warm = engine.analyze(HAIL_PROFILE, surface, { ...surface, temperature: 32, relativeHumidity: 40 });
    const base = engine.analyze(HAIL_PROFILE, surface, surface);
    if (!warm.available || !base.available) throw new Error('profilo completo');
    expect(warm.lapseRateLow).toBeGreaterThan(base.lapseRateLow ?? 0);
    expect(warm.subCloudDryness).toBeGreaterThan(base.subCloudDryness);
    expect(warm.lapseRateMid).toBe(base.lapseRateMid);
    expect(warm.freezingLevel).toBe(base.freezingLevel);
  });

  it('profilo reale: esclude il livello sotto il suolo', () => {
    const real = new OpenMeteoProvider().parseProfile(REAL_PROFILE_RESPONSE, 42.83, 12.89);
    const analysis = engine.analyze(real, { ...surface, temperature: 19.5 }, surface);
    if (!analysis.available) throw new Error('profilo completo');
    expect(analysis.environment.points.every((point) => point.height >= 0)).toBe(true);
    expect(analysis.environment.points.some((point) => point.pressure === 1000)).toBe(false);
    // coerente con lo zero termico del provider (3980 m s.l.m. = 3398 m dal suolo)
    expect(Math.abs((analysis.freezingLevel ?? 0) - 3398)).toBeLessThan(250);
  });

  it('12. dati verticali mancanti → DATI VERTICALI INSUFFICIENTI, nessun valore inventato', () => {
    expect(engine.analyze(null, surface, surface)).toEqual({ available: false, missing: ['profilo verticale'] });
    const noUpper = makeProfile([
      [925, 800, 20, 15, 10, 200],
      [850, 1500, 15, 10, 15, 220],
      [700, 3100, 3, -5, null as unknown as number, 240],
    ]);
    const analysis = engine.analyze(noUpper, surface, surface);
    expect(analysis.available).toBe(false);
    if (analysis.available) return;
    expect(analysis.missing).toEqual(expect.arrayContaining(['vento a 700 hPa', '500 hPa']));
  });

  it('zero termico del provider solo come ripiego', () => {
    const cold = makeProfile(STABLE_PROFILE.levels.map((l) => [l.pressure, l.height ?? 0, -5, -10, 10, 200] as const), {
      freezingLevelHeight: 50,
    });
    const analysis = engine.analyze(cold, { ...surface, temperature: -2 }, surface);
    if (!analysis.available) throw new Error('profilo completo');
    expect(analysis.freezingLevel).toBe(0);
  });
});
