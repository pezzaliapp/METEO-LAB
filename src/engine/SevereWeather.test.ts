import { describe, expect, it } from 'vitest';
import type { AtmosphericProfile } from '../models/AtmosphericProfile';
import { OpenMeteoProvider } from '../providers/OpenMeteoProvider';
import { makeObservation } from '../test/fixtures';
import {
  DRY_SUBCLOUD_PROFILE,
  HAIL_PROFILE,
  MOIST_PROFILE,
  REAL_PROFILE_RESPONSE,
  STABLE_PROFILE,
  WARM_ALOFT_PROFILE,
} from '../test/profiles';
import { AtmosphereEngine } from './AtmosphereEngine';
import type { DownburstStage } from './DownburstEngine';
import type { HailStage } from './HailEngine';
import { hailAt, hailGeometry, outflowAt, outflowGeometry } from './SevereGeometry';
import { runExperiment } from './SevereWeather';

const REAL_PROFILE = new OpenMeteoProvider().parseProfile(REAL_PROFILE_RESPONSE, 42.83, 12.89);

function run(profile: AtmosphericProfile | null, realT: number, t: number, rh: number, wind = 10) {
  return runExperiment({
    real: { temperature: realT, relativeHumidity: 55, windSpeed: 8, windDirection: 220 },
    sim: { temperature: t, relativeHumidity: rh, windSpeed: wind, windDirection: 220 },
    profile,
    surfacePressure: 1000,
    latitude: 45,
    longitude: 9,
  });
}

const HAIL_ORDER: HailStage[] = ['NONE', 'EMBRYO', 'GROWING', 'MATURE', 'FALLING', 'ENDED'];
const BURST_ORDER: DownburstStage[] = ['NONE', 'DEVELOPING', 'DESCENDING', 'IMPACT', 'OUTFLOW', 'DISSIPATING'];

describe('GRANDINE LAB e DOWNBURST LAB', () => {
  it('1. profilo stabile → niente cella, niente grandine né downburst', () => {
    const { convection, severe } = run(STABLE_PROFILE, 18, 25, 60);
    expect(convection.develops).toBe(false);
    expect(convection.diagnostics.environmentSource).toBe('profile');
    expect(severe.hail.occurs).toBe(false);
    expect(severe.downburst.occurs).toBe(false);
    expect(severe.hail.hailPotential).toBe(0);
    expect(severe.downburst.downburstPotential).toBe(0);
  });

  it('2. temporale con profilo reale → nessun fenomeno severo', () => {
    const { convection, severe } = run(REAL_PROFILE, 19.5, 26, 80, 5);
    expect(convection.develops).toBe(true);
    expect(severe.hail.occurs).toBe(false);
    expect(severe.downburst.occurs).toBe(false);
    expect(severe.hail.limitingFactor).not.toBeNull();
    expect(severe.downburst.limitingFactor).not.toBeNull();
  });

  it('3. forte updraft + profilo favorevole → grandine', () => {
    const { convection, severe } = run(HAIL_PROFILE, 24, 24, 70);
    expect(convection.develops).toBe(true);
    expect(severe.hail.occurs).toBe(true);
    expect(severe.hail.hailPotential).toBeGreaterThanOrEqual(0.5);
    expect(severe.hail.hailSizeClass).not.toBe('NONE');
    expect(severe.hail.hailCoreRadius).toBeGreaterThan(0);
    expect(severe.hail.hailCoreRadius).toBeLessThan(convection.cellRadius);
  });

  it('4. zero termico alto → grandine ridotta/assente per fusione', () => {
    const favorable = run(HAIL_PROFILE, 24, 27, 75).severe.hail;
    const warm = run(WARM_ALOFT_PROFILE, 29, 32, 80).severe.hail;
    expect(warm.occurs).toBe(false);
    expect(warm.limitingFactor).toBe('melting');
    expect(warm.hailPotential).toBeLessThan(favorable.hailPotential);
    expect(warm.factors.melting.value ?? 0).toBeGreaterThan(3400);
  });

  it('5. aria secca sotto la nube + precipitazione intensa → downburst', () => {
    const { severe } = run(DRY_SUBCLOUD_PROFILE, 30, 33, 40);
    expect(severe.downburst.occurs).toBe(true);
    expect(['sub-cloud', 'both']).toContain(severe.downburst.evaporationSource);
    expect(severe.downburst.factors.evaporation.score).toBeGreaterThan(0.8);
    expect(severe.downburst.dcape).toBeGreaterThan(1000);
    expect(severe.downburst.outflowSpeedClass).not.toBeNull();
    expect(severe.downburst.impactPoint).not.toBeNull();
  });

  it('6. atmosfera umida sotto la nube → downburst ridotto', () => {
    const dry = run(DRY_SUBCLOUD_PROFILE, 30, 33, 40).severe.downburst;
    const moist = run(MOIST_PROFILE, 26, 30, 85);
    expect(moist.convection.develops).toBe(true);
    expect(moist.severe.downburst.occurs).toBe(false);
    expect(moist.severe.downburst.downburstPotential).toBeLessThan(dry.downburstPotential / 2);
    expect(moist.severe.downburst.factors.evaporation.score).toBeLessThan(dry.factors.evaporation.score);
  });

  it('7. ciclo di vita della grandine sincronizzato con la cella', () => {
    const { convection, severe } = run(HAIL_PROFILE, 24, 24, 70);
    const stages = severe.hail.frames.map((frame) => frame.stage);
    expect(stages[0]).toBe('NONE'); // mai a T+0
    for (const stage of ['EMBRYO', 'GROWING', 'MATURE', 'FALLING'] as const) expect(stages).toContain(stage);
    const order = stages.map((stage) => HAIL_ORDER.indexOf(stage));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1] ?? 0);
    const embryo = stages.indexOf('EMBRYO');
    expect(convection.frames[embryo]?.stage).toBe('DEVELOPING');
    expect(convection.frames[stages.indexOf('GROWING')]?.stage).toBe('MATURE');
  });

  it('8. ciclo di vita del downburst: discesa, impatto, espansione, dissipazione', () => {
    const { convection, severe } = run(DRY_SUBCLOUD_PROFILE, 30, 33, 40);
    const stages = severe.downburst.frames.map((frame) => frame.stage);
    expect(stages[0]).toBe('NONE');
    expect(stages.filter((stage) => stage !== 'NONE')).toEqual(['DEVELOPING', 'DESCENDING', 'IMPACT', 'OUTFLOW', 'DISSIPATING']);
    const order = stages.map((stage) => BURST_ORDER.indexOf(stage)).filter((index) => index > 0);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1] ?? 0);
    const impact = stages.indexOf('IMPACT');
    expect(convection.frames[impact]?.stage).toBe('MATURE');
    const radii = severe.downburst.frames.map((frame) => frame.outflowRadius);
    expect(radii[impact - 1]).toBe(0); // in discesa non c'è ancora outflow al suolo
    expect(radii[impact]).toBeGreaterThan(0);
    expect(radii[impact + 1]).toBeGreaterThan(radii[impact] ?? 0);
    expect(radii[impact + 2]).toBeGreaterThan(radii[impact + 1] ?? 0);
    // la geometria sulla mappa si espande e poi si attenua
    const size = (minute: number) => outflowAt(severe.downburst, minute);
    const at = (index: number) => convection.frames[index]?.minute ?? 0;
    expect(size(at(impact + 1)).radius).toBeGreaterThan(size(at(impact)).radius);
    expect(size(at(impact + 2)).strength).toBeLessThan(size(at(impact + 1)).strength);
    expect(outflowGeometry(size(at(impact)), convection.cellDirection).features.length).toBeGreaterThan(10);
    expect(outflowGeometry(size(at(impact - 1)), convection.cellDirection).features).toHaveLength(0);
  });

  it('9. grandine e downburst terminano con la cella', () => {
    for (const [profile, realT, t, rh] of [
      [HAIL_PROFILE, 24, 24, 70],
      [DRY_SUBCLOUD_PROFILE, 30, 33, 40],
      [HAIL_PROFILE, 24, 27, 75],
      [DRY_SUBCLOUD_PROFILE, 30, 32, 50],
    ] as const) {
      const { convection, severe } = run(profile, realT, t, rh);
      convection.frames.forEach((frame, index) => {
        const hail = severe.hail.frames[index];
        const burst = severe.downburst.frames[index];
        if (frame.stage === 'NONE' || frame.stage === 'DISSIPATING') {
          expect(['NONE', 'ENDED']).toContain(hail?.stage);
          expect(hail?.coreRadius).toBe(0);
        }
        if (frame.stage === 'NONE') {
          expect(burst?.stage).toBe('NONE');
          expect(burst?.outflowRadius).toBe(0);
        }
      });
    }
    // Cella che finisce prima di T+90: nessun fenomeno dopo la fine.
    const single = run(HAIL_PROFILE, 24, 27, 75, 0);
    const last = single.convection.frames.at(-1);
    if (last?.stage === 'NONE') expect(single.severe.hail.frames.at(-1)?.coreRadius).toBe(0);
  });

  it('10. stesso input → stesso risultato', () => {
    const a = run(DRY_SUBCLOUD_PROFILE, 30, 33, 40);
    const b = run(DRY_SUBCLOUD_PROFILE, 30, 33, 40);
    expect(b).toEqual(a);
    expect(hailGeometry(hailAt(b.severe.hail, 52.5))).toEqual(hailGeometry(hailAt(a.severe.hail, 52.5)));
  });

  it('11. lo stato LIVE e il profilo reale non vengono modificati', () => {
    const engine = new AtmosphereEngine();
    const live = makeObservation({ temperature: 30, relativeHumidity: 55 });
    const snapshotLive = JSON.stringify(live);
    const snapshotProfile = JSON.stringify(DRY_SUBCLOUD_PROFILE);
    let sim = engine.createSimulation(live, { id: 'lab', profile: DRY_SUBCLOUD_PROFILE });
    sim = engine.withParameters(sim, { temperature: 33, relativeHumidity: 40 });
    sim = engine.startExperiment(sim);
    for (let i = 0; i < 6; i++) sim = engine.advance(sim);
    expect(sim.severe?.downburst.occurs).toBe(true);
    expect(JSON.stringify(live)).toBe(snapshotLive);
    expect(JSON.stringify(DRY_SUBCLOUD_PROFILE)).toBe(snapshotProfile);
    expect(sim.profile).not.toBe(DRY_SUBCLOUD_PROFILE);
    expect(Object.isFrozen(sim.profile)).toBe(true);
    expect(Object.isFrozen(sim.severe?.hail)).toBe(true);
  });

  it('12. senza profilo: TEMPESTA LAB funziona, GRANDINE e DOWNBURST dichiarano dati insufficienti', () => {
    const { convection, severe } = run(null, 23.3, 28, 80);
    expect(convection.develops).toBe(true);
    expect(convection.diagnostics.environmentSource).toBe('standard');
    expect(severe.vertical.available).toBe(false);
    for (const outlook of [severe.hail, severe.downburst]) {
      expect(outlook.available).toBe(false);
      expect(outlook.occurs).toBe(false);
      expect(outlook.missing).toContain('profilo verticale');
    }
    expect(Object.values(severe.hail.factors).every((factor) => factor.value === null)).toBe(true);
    expect(severe.downburst.dcape).toBe(0);
    expect(severe.hail.frames.every((frame) => frame.stage === 'NONE')).toBe(true);
  });

  it('il profilo sostituisce il profilo standard come ambiente della particella', () => {
    const withProfile = run(HAIL_PROFILE, 24, 24, 70).convection;
    const standard = run(null, 24, 24, 70).convection;
    expect(withProfile.diagnostics.capeProxy).not.toBeCloseTo(standard.diagnostics.capeProxy, 0);
    expect(withProfile.diagnostics.shearProxy).toBeGreaterThan(20);
  });
});
