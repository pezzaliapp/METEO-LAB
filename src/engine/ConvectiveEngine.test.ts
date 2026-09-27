import { describe, expect, it } from 'vitest';
import { makeObservation } from '../test/fixtures';
import { TIMELINE_MINUTES } from '../simulation/timeline';
import { AtmosphereEngine } from './AtmosphereEngine';
import {
  ConvectiveEngine,
  FRICTION_TURNING,
  REFERENCE,
  STEERING_FACTOR,
  bearingBetween,
  cellAt,
  distanceKm,
  liftParcel,
  moistAdiabaticLapseRate,
  rainRateFromReflectivity,
  type ConvectiveInput,
  type LifecycleStage,
} from './ConvectiveEngine';
import { RADAR_BANDS, contourFraction, radarAt, ringAreaKm2, ringCentroid } from './SimulatedRadar';

const convective = new ConvectiveEngine();

/** Osservazione di riferimento: Milano, 27/09, 23,3 °C, 51 %, vento 2,1 km/h da 239°. */
function input(overrides: Partial<ConvectiveInput> = {}): ConvectiveInput {
  return {
    temperature: 23.3,
    relativeHumidity: 51,
    windSpeed: 10,
    windDirection: 239,
    environmentTemperature: 23.3,
    surfacePressure: 1007.7,
    latitude: 45.46,
    longitude: 9.19,
    ...overrides,
  };
}

const STABLE = input({ temperature: 10, relativeHumidity: 40, windSpeed: 5 });
const MODERATE = input({ relativeHumidity: 70, windSpeed: 5 });
const FAVORABLE = input({ temperature: 28, relativeHumidity: 80, windSpeed: 10 });

function stages(frames: readonly { stage: LifecycleStage }[]): LifecycleStage[] {
  return frames.map((frame) => frame.stage);
}

describe('fisica della particella', () => {
  it('gradiente saturo minore del secco e crescente con il freddo', () => {
    const warm = moistAdiabaticLapseRate(25, 900);
    const cold = moistAdiabaticLapseRate(-20, 500);
    expect(warm).toBeGreaterThan(0.003);
    expect(warm).toBeLessThan(cold);
    expect(cold).toBeLessThan(9.8e-3);
  });

  it('la base delle nubi è coerente con la regola di Espy (≈125 m per °C di scarto T − Td)', () => {
    const ascent = liftParcel(input());
    const spread = 23.3 - ascent.dewPoint;
    expect(ascent.lclHeight).not.toBeNull();
    expect(Math.abs((ascent.lclHeight ?? 0) - 125 * spread)).toBeLessThan(150);
  });

  it('Marshall–Palmer: 40 dBZ ≈ 11,5 mm/h, limite a 53 dBZ, nulla sotto il primo eco', () => {
    expect(rainRateFromReflectivity(40)).toBeCloseTo(11.5, 0);
    expect(rainRateFromReflectivity(65)).toBe(rainRateFromReflectivity(53));
    expect(rainRateFromReflectivity(10)).toBe(0);
  });
});

describe('ConvectiveEngine', () => {
  it('1. atmosfera stabile → nessuna cella', () => {
    const outlook = convective.evaluate(STABLE);
    expect(outlook.develops).toBe(false);
    expect(outlook.diagnostics.capeProxy).toBe(0);
    expect(outlook.stormProbability).toBeLessThan(0.5);
    expect(outlook.limitingFactor).toBe('stable');
    expect(outlook.frames.every((frame) => frame.stage === 'NONE' && frame.reflectivity === 0)).toBe(true);
    for (const minute of TIMELINE_MINUTES) expect(radarAt(outlook, minute).geometry.features).toHaveLength(0);
  });

  it('l’osservazione reale di riferimento, senza modifiche, non produce convezione', () => {
    expect(convective.evaluate(input({ windSpeed: 2.1 })).develops).toBe(false);
  });

  it('aria molto secca → fattore limitante "dry"', () => {
    const outlook = convective.evaluate(input({ temperature: 30, relativeHumidity: 30 }));
    expect(outlook.develops).toBe(false);
    expect(outlook.limitingFactor).toBe('dry');
    expect(outlook.diagnostics.lclHeight ?? 0).toBeGreaterThan(REFERENCE.dryCloudBase);
  });

  it('2. condizioni moderate → sviluppo debole', () => {
    const outlook = convective.evaluate(MODERATE);
    expect(outlook.develops).toBe(true);
    expect(outlook.diagnostics.capeProxy).toBeGreaterThan(REFERENCE.capeWeak);
    expect(outlook.diagnostics.capeProxy).toBeLessThan(REFERENCE.capeModerate);
    expect(outlook.peakReflectivity).toBeLessThan(45); // solo verde/giallo
    expect(outlook.organization).toBe('single');
  });

  it('3. condizioni favorevoli → cella intensa con nucleo', () => {
    const outlook = convective.evaluate(FAVORABLE);
    expect(outlook.develops).toBe(true);
    expect(outlook.stormProbability).toBeGreaterThan(0.9);
    expect(outlook.peakReflectivity).toBeGreaterThanOrEqual(55);
    expect(outlook.cellRadius).toBeGreaterThan(convective.evaluate(MODERATE).cellRadius);
    expect(outlook.convectivePotential).toBeGreaterThan(convective.evaluate(MODERATE).convectivePotential);
    const mature = radarAt(outlook, 45).geometry.features.map((feature) => feature.properties.band);
    expect(mature).toEqual(RADAR_BANDS.map((band) => band.key));
  });

  it('più umidità → più energia (monotonia)', () => {
    const capes = [60, 70, 80, 90].map((rh) => convective.evaluate(input({ relativeHumidity: rh })).diagnostics.capeProxy);
    for (let i = 1; i < capes.length; i++) expect(capes[i]).toBeGreaterThan(capes[i - 1] ?? 0);
  });

  it('4. ciclo di vita: innesco → sviluppo → maturità → indebolimento → dissipazione', () => {
    const outlook = convective.evaluate(FAVORABLE);
    expect(stages(outlook.frames)).toEqual([
      'NONE',
      'INITIATION',
      'DEVELOPING',
      'MATURE',
      'MATURE',
      'WEAKENING',
      'DISSIPATING',
    ]);
    const reflectivity = outlook.frames.map((frame) => frame.reflectivity);
    expect(reflectivity[1]).toBeLessThan(reflectivity[2] ?? 0);
    expect(reflectivity[2]).toBeLessThan(reflectivity[3] ?? 0);
    expect(reflectivity[5]).toBeLessThan(reflectivity[4] ?? 0);
    expect(reflectivity[6]).toBeLessThan(reflectivity[5] ?? 0);
    expect(convective.lifecycleStage(outlook, 45)).toBe('MATURE');
  });

  it('condizioni deboli con inibizione: innesco ritardato e fase matura breve', () => {
    const outlook = convective.evaluate(MODERATE);
    expect(outlook.diagnostics.cinProxy).toBeGreaterThan(REFERENCE.cinWeak);
    expect(outlook.onsetMinute).toBe(30);
    expect(stages(outlook.frames)).toEqual(['NONE', 'NONE', 'INITIATION', 'DEVELOPING', 'MATURE', 'WEAKENING', 'DISSIPATING']);
  });

  it('vento moderato organizza multicelle più longeve; vento eccessivo disperde una cella debole', () => {
    const multicell = convective.evaluate({ ...FAVORABLE, windSpeed: 30 });
    expect(multicell.organization).toBe('multicell');
    expect(stages(multicell.frames).filter((stage) => stage === 'MATURE')).toHaveLength(3);

    const sheared = convective.evaluate({ ...MODERATE, windSpeed: 60 });
    expect(sheared.organization).toBe('sheared');
    expect(stages(sheared.frames)).not.toContain('MATURE');
  });

  it('5. movimento coerente con il vento', () => {
    const outlook = convective.evaluate(FAVORABLE);
    const first = outlook.frames[0];
    const last = outlook.frames.at(-1);
    if (!first || !last) throw new Error('frames');
    // parte dal punto scelto
    expect(first.center.latitude).toBeCloseTo(FAVORABLE.latitude, 6);
    expect(first.center.longitude).toBeCloseTo(FAVORABLE.longitude, 6);
    // si sposta VERSO dove soffia il vento (da 239° → verso ~59°), ruotato per attrito
    const expectedBearing = (239 + 180 + FRICTION_TURNING) % 360;
    expect(outlook.cellDirection).toBeCloseTo(expectedBearing, 5);
    expect(bearingBetween(first.center, last.center)).toBeCloseTo(expectedBearing, 0);
    // distanza = velocità di trasporto × 90 min
    const expectedKm = ((10 * STEERING_FACTOR) * 90) / 60;
    expect(distanceKm(first.center, last.center)).toBeCloseTo(expectedKm, 0);
    // passi regolari: spostamento uguale a ogni passo di 15 minuti
    const steps = outlook.frames.slice(1).map((frame, i) => distanceKm(outlook.frames[i]?.center ?? frame.center, frame.center));
    for (const step of steps) expect(step).toBeCloseTo(expectedKm / 6, 1);
    // più vento → più spostamento; vento nullo → cella ferma
    const faster = convective.evaluate({ ...FAVORABLE, windSpeed: 20 });
    expect(faster.cellSpeed).toBeCloseTo(outlook.cellSpeed * 2, 5);
    const calm = convective.evaluate({ ...FAVORABLE, windSpeed: 0 });
    expect(distanceKm(calm.frames[0]?.center ?? first.center, calm.frames.at(-1)?.center ?? first.center)).toBe(0);
  });

  it('direzione mancante: ipotizzata e dichiarata', () => {
    const outlook = convective.evaluate({ ...FAVORABLE, windDirection: null });
    expect(outlook.directionAssumed).toBe(true);
    expect(outlook.cellDirection).toBeCloseTo(110, 5); // da ovest (270°) verso est, +20°
  });

  it('6. stesso input → stesso risultato (nessun elemento casuale)', () => {
    const a = convective.evaluate(FAVORABLE);
    const b = convective.evaluate({ ...FAVORABLE });
    expect(b).toEqual(a);
    for (const minute of [0, 22.5, 45, 67.5, 90]) expect(radarAt(b, minute)).toEqual(radarAt(a, minute));
    expect(convective.evaluate({ ...FAVORABLE, relativeHumidity: 81 }).seed).not.toBe(a.seed);
  });

  it('interpolazione continua fra i passi (animazione)', () => {
    const outlook = convective.evaluate(FAVORABLE);
    const mid = cellAt(outlook, 37.5);
    const a = outlook.frames[2];
    const b = outlook.frames[3];
    if (!a || !b) throw new Error('frames');
    expect(mid.reflectivity).toBeCloseTo((a.reflectivity + b.reflectivity) / 2, 5);
    expect(mid.radius).toBeGreaterThan(a.radius);
    expect(mid.radius).toBeLessThan(b.radius);
  });
});

describe('radar simulato', () => {
  it('soglie annidate: il nucleo è interno alle classi più deboli', () => {
    expect(contourFraction(60, 20)).toBeGreaterThan(contourFraction(60, 35));
    expect(contourFraction(60, 45)).toBeGreaterThan(contourFraction(60, 55));
    expect(contourFraction(40, 45)).toBe(0);
  });

  it('la geometria della cella cambia e si sposta lungo la timeline', () => {
    const outlook = convective.evaluate(FAVORABLE);
    const lightRings = TIMELINE_MINUTES.map((minute) => {
      const feature = radarAt(outlook, minute).geometry.features.find((item) => item.properties.band === 'light');
      return feature?.geometry.coordinates[0] ?? null;
    });
    expect(lightRings[0]).toBeNull(); // T+0: nessun eco
    const areas = lightRings.map((ring) => (ring ? ringAreaKm2(ring) : 0));
    // cresce fino alla maturità
    expect(areas[1]).toBeGreaterThan(0);
    expect(areas[2]).toBeGreaterThan(areas[1] ?? 0);
    expect(areas[3]).toBeGreaterThan(areas[2] ?? 0);
    // forma diversa a ogni passo
    const signatures = lightRings.slice(1).map((ring) => JSON.stringify(ring));
    expect(new Set(signatures).size).toBe(signatures.length);
    // il baricentro dell'eco avanza nella direzione del moto
    const centroids = lightRings.slice(1).map((ring) => (ring ? ringCentroid(ring) : null));
    const start = centroids[0];
    const end = centroids.at(-1);
    if (!start || !end) throw new Error('centroidi');
    expect(distanceKm(start, end)).toBeGreaterThan(10);
    expect(Math.abs(bearingBetween(start, end) - outlook.cellDirection)).toBeLessThan(15);
  });

  it('anelli chiusi e coordinate valide', () => {
    const outlook = convective.evaluate(FAVORABLE);
    for (const feature of radarAt(outlook, 45).geometry.features) {
      const ring = feature.geometry.coordinates[0] ?? [];
      expect(ring.length).toBeGreaterThan(10);
      expect(ring[0]).toEqual(ring.at(-1));
      for (const [lon, lat] of ring) {
        expect(Number.isFinite(lon) && Number.isFinite(lat)).toBe(true);
      }
    }
  });
});

describe('TEMPESTA LAB nell’AtmosphereEngine', () => {
  const engine = new AtmosphereEngine();

  it('7. lo stato LIVE non viene modificato', () => {
    const live = makeObservation();
    const snapshot = JSON.stringify(live);
    let sim = engine.createSimulation(live, { id: 'lab' });
    sim = engine.withParameters(sim, { temperature: 28, relativeHumidity: 80, windSpeed: 10 });
    sim = engine.startExperiment(sim);
    for (let i = 0; i < 6; i++) sim = engine.advance(sim);
    radarAt(sim.convection ?? engine.evaluateConvection(sim), 45);
    expect(JSON.stringify(live)).toBe(snapshot);
    expect(Object.isFrozen(live)).toBe(true);
    expect(sim.origin.temperature).toBe(23.3);
    expect(sim.convection?.input.environmentTemperature).toBe(23.3);
    expect(Object.isFrozen(sim.convection)).toBe(true);
  });

  it('avvia, annulla e riparte da T+0; modificare l’atmosfera chiude l’esperimento', () => {
    let sim = engine.withParameters(engine.createSimulation(makeObservation()), { temperature: 28, relativeHumidity: 80 });
    expect(sim.convection).toBeNull();
    sim = engine.startExperiment(sim);
    expect(sim.convection?.develops).toBe(true);
    expect(sim.currentMinute).toBe(0);
    sim = engine.advance(engine.advance(sim));
    expect(sim.currentMinute).toBe(30);
    expect(engine.withParameters(sim, { windSpeed: 20 }).convection).toBeNull();
    expect(engine.clearExperiment(sim).convection).toBeNull();
    expect(engine.startExperiment(sim).currentMinute).toBe(0);
  });
});
