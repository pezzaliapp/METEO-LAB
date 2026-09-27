import { describe, expect, it } from 'vitest';
import type { SimulationFrame, SimulationState } from '../models/SimulationState';
import { makeObservation } from '../test/fixtures';
import { TIMELINE_MINUTES } from '../simulation/timeline';
import { AtmosphereEngine, DIDACTIC_DEFAULTS } from './AtmosphereEngine';
import { dewPointFrom, relativeHumidityFrom, solarFactor } from './physics';

const engine = new AtmosphereEngine();

function edges(sim: SimulationState): { first: SimulationFrame; last: SimulationFrame } {
  const first = sim.timeline[0];
  const last = sim.timeline.at(-1);
  if (!first || !last) throw new Error('timeline vuota');
  return { first, last };
}

describe('conversione LIVE → SIM', () => {
  it('copia lo stato reale senza modificarlo', () => {
    const live = makeObservation();
    const snapshot = JSON.stringify(live);
    const sim = engine.createSimulation(live, { id: 'a' });

    expect(sim.kind).toBe('simulation');
    expect(sim.origin).toEqual(live);
    expect(sim.origin).not.toBe(live);
    expect(sim.parameters).toEqual({ temperature: 23.3, relativeHumidity: 51, windSpeed: 2.1 });

    const changed = engine.withParameters(sim, { temperature: 5, relativeHumidity: 95, windSpeed: 60 });
    engine.advance(changed);
    expect(JSON.stringify(live)).toBe(snapshot);
    expect(changed.origin.temperature).toBe(23.3);
    expect(Object.isFrozen(changed)).toBe(true);
  });

  it('dichiara i valori ipotizzati quando il dato reale manca', () => {
    const live = makeObservation({ temperature: null, cloudCover: null });
    const sim = engine.createSimulation(live);
    expect(sim.assumed).toEqual(['temperature', 'cloudCover']);
    expect(sim.parameters.temperature).toBe(DIDACTIC_DEFAULTS.temperature);
    expect(live.temperature).toBeNull();
  });
});

describe('AtmosphereEngine', () => {
  it('genera un frame per ogni minuto della timeline, partendo dalle condizioni iniziali', () => {
    const sim = engine.createSimulation(makeObservation());
    expect(sim.timeline.map((frame) => frame.minute)).toEqual(TIMELINE_MINUTES);
    expect(sim.currentMinute).toBe(0);
    expect(engine.currentFrame(sim)).toMatchObject({ temperature: 23.3, relativeHumidity: 51, windSpeed: 2.1 });
  });

  it('è deterministico', () => {
    const live = makeObservation();
    expect(engine.createSimulation(live, { id: 'x' }).timeline).toEqual(engine.createSimulation(live, { id: 'y' }).timeline);
  });

  it('di giorno con cielo sereno la temperatura sale e l’umidità relativa scende', () => {
    const sim = engine.createSimulation(makeObservation({ timestamp: '2026-06-21T10:00:00Z', longitude: 12 }));
    const { first, last } = edges(sim);
    expect(last.temperature).toBeGreaterThan(first.temperature);
    expect(last.relativeHumidity).toBeLessThan(first.relativeHumidity);
    // vapore conservato: punto di rugiada invariato
    expect(last.dewPoint).toBeCloseTo(first.dewPoint, 1);
  });

  it('il vento attenua la variazione di temperatura', () => {
    const base = engine.createSimulation(makeObservation({ timestamp: '2026-06-21T10:00:00Z', longitude: 12 }));
    const calm = engine.withParameters(base, { windSpeed: 0 });
    const windy = engine.withParameters(base, { windSpeed: 80 });
    const rise = (s: SimulationState) => edges(s).last.temperature - edges(s).first.temperature;
    expect(rise(windy)).toBeLessThan(rise(calm));
  });

  it('di notte, con aria umida, raggiunge la saturazione senza superare il 100 %', () => {
    const night = makeObservation({ timestamp: '2026-01-15T02:00:00Z', longitude: 12, cloudCover: 0 });
    const sim = engine.withParameters(engine.createSimulation(night), { temperature: 8, relativeHumidity: 97, windSpeed: 0 });
    const { last } = edges(sim);
    expect(sim.timeline.some((frame) => frame.saturated)).toBe(true);
    expect(last.relativeHumidity).toBe(100);
    expect(last.temperature).toBeLessThan(8);
    expect(last.cloudCover).toBeGreaterThan(0);
    for (const frame of sim.timeline) expect(frame.relativeHumidity).toBeLessThanOrEqual(100);
  });

  it('limita i parametri utente agli intervalli consentiti', () => {
    const sim = engine.withParameters(engine.createSimulation(makeObservation()), { temperature: 99, windSpeed: -5 });
    expect(sim.parameters.temperature).toBe(45);
    expect(sim.parameters.windSpeed).toBe(0);
  });

  it('avanza, si posiziona e si resetta lungo la timeline', () => {
    let sim = engine.createSimulation(makeObservation());
    sim = engine.withParameters(sim, { temperature: 30 });
    for (let i = 0; i < 10; i++) sim = engine.advance(sim);
    expect(sim.currentMinute).toBe(90);
    expect(engine.isFinished(sim)).toBe(true);

    sim = engine.seek(sim, 45);
    expect(engine.currentFrame(sim).minute).toBe(45);
    expect(() => engine.seek(sim, 50)).toThrow(RangeError);

    const reset = engine.reset(sim);
    expect(reset.currentMinute).toBe(0);
    expect(reset.parameters.temperature).toBe(23.3);
    expect(reset.id).toBe(sim.id);
  });
});

describe('fisica elementare', () => {
  it('punto di rugiada e umidità relativa sono coerenti (Magnus)', () => {
    const td = dewPointFrom(23.3, 51);
    expect(td).toBeCloseTo(12.6, 0);
    expect(relativeHumidityFrom(23.3, td)).toBeCloseTo(51, 5);
  });

  it('insolazione nulla di notte e massima a mezzogiorno solare', () => {
    expect(solarFactor(new Date('2026-06-21T00:00:00Z'), 0)).toBe(0);
    expect(solarFactor(new Date('2026-06-21T12:00:00Z'), 0)).toBeCloseTo(1, 5);
  });
});
