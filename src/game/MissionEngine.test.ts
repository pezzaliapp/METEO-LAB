import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AtmosphereEngine } from '../engine/AtmosphereEngine';
import type { SimulationParameters, SimulationState } from '../models/SimulationState';
import { makeObservation } from '../test/fixtures';
import { HAIL_PROFILE, STABLE_PROFILE } from '../test/profiles';
import { HINT_AFTER_FAILED_ATTEMPTS, MissionEngine, changeCost, checkHypothesis, type MissionId } from './MissionEngine';
import { MISSIONS, missionById } from './missions';
import { EMPTY_PROGRESS, isCompleted, isHighlighted, recordAttempt } from './progress';
import { SCENARIOS, SCENARIO_LABEL, isDidacticScenario } from './scenarios';

const atmosphere = new AtmosphereEngine();
const engine = new MissionEngine(atmosphere);

function setup(id: MissionId) {
  const mission = missionById(id);
  const simulation = engine.createSimulation(mission, 'scenario');
  return { mission, simulation, session: engine.startSession(mission, simulation, 'scenario') };
}

function play(id: MissionId, parameters: Partial<SimulationParameters>, hypothesis: Parameters<MissionEngine['attempt']>[3] = 'STORM') {
  const { mission, simulation, session } = setup(id);
  return engine.attempt(mission, session, atmosphere.withParameters(simulation, parameters), hypothesis);
}

describe('MissionEngine', () => {
  it('1. COSTRUISCI UNA TEMPESTA: completata solo se il ConvectiveEngine produce una cella', () => {
    const fail = play('02', {});
    expect(fail.evaluation.convection.develops).toBe(false);
    expect(fail.result.completed).toBe(false);
    const ok = play('02', { temperature: 25.5, relativeHumidity: 60 });
    expect(ok.evaluation.convection.develops).toBe(true);
    expect(ok.simulation.convection).toEqual(ok.evaluation.convection);
    expect(ok.result.completed).toBe(true);
    expect(ok.result.headline).toBe('HAI COSTRUITO UNA TEMPESTA.');
  });

  it('2. CREA GRANDINE: completata solo se HailEngine produce uno stadio ≠ NONE', () => {
    const storm = play('03', { temperature: 25.5, relativeHumidity: 60 }, 'HAIL');
    expect(storm.evaluation.convection.develops).toBe(true);
    expect(storm.evaluation.severe.hail.frames.every((f) => f.stage === 'NONE')).toBe(true);
    expect(storm.result.completed).toBe(false);
    const hail = play('03', { temperature: 25.5, relativeHumidity: 80 }, 'HAIL');
    expect(hail.evaluation.severe.hail.frames.some((f) => f.stage !== 'NONE')).toBe(true);
    expect(hail.result.completed).toBe(true);
    expect(hail.result.hypothesisCheck).toBe('CONFIRMED');
  });

  it('3. CREA UN DOWNBURST: completata solo dopo IMPACT', () => {
    const noImpact = play('04', {}, 'DOWNBURST');
    expect(noImpact.evaluation.convection.develops).toBe(true);
    expect(noImpact.evaluation.severe.downburst.frames.some((f) => f.stage === 'IMPACT')).toBe(false);
    expect(noImpact.result.completed).toBe(false);
    const impact = play('04', { temperature: 28.5 }, 'DOWNBURST');
    expect(impact.evaluation.severe.downburst.frames.map((f) => f.stage)).toContain('IMPACT');
    expect(impact.result.completed).toBe(true);
  });

  it('4. TEMPORALE, MA NON SEVERO: rifiuta grandine e downburst', () => {
    const severe = play('05', { temperature: 25.5, relativeHumidity: 80 });
    expect(severe.evaluation.convection.develops).toBe(true);
    expect(severe.evaluation.hailReached).toBe(true);
    expect(severe.result.completed).toBe(false);
    expect(severe.result.reasons.join(' ')).toMatch(/grandine/i);
    const ordinary = play('05', { temperature: 25.5, relativeHumidity: 60 });
    expect(ordinary.evaluation.hailReached || ordinary.evaluation.impactReached).toBe(false);
    expect(ordinary.result.completed).toBe(true);
  });

  it('5. FERMA LA GRANDINE: lo scenario parte con grandine, serve mantenere il temporale', () => {
    const { session } = setup('06');
    expect(session.baseline.hailReached).toBe(true);
    const lost = play('06', { temperature: 15, relativeHumidity: 30 });
    expect(lost.evaluation.convection.develops).toBe(false);
    expect(lost.result.completed).toBe(false);
    const stopped = play('06', { relativeHumidity: 60 });
    expect(stopped.evaluation.convection.develops).toBe(true);
    expect(stopped.evaluation.hailReached).toBe(false);
    expect(stopped.result.completed).toBe(true);
    expect(stopped.result.headline).toBe('HAI FERMATO LA GRANDINE.');
  });

  it('6. FERMA IL DOWNBURST: lo scenario parte con downburst, serve mantenere il temporale', () => {
    const { session } = setup('07');
    expect(session.baseline.impactReached).toBe(true);
    const lost = play('07', { temperature: 22 });
    expect(lost.evaluation.convection.develops).toBe(false);
    expect(lost.result.completed).toBe(false);
    const stopped = play('07', { relativeHumidity: 60 });
    expect(stopped.evaluation.convection.develops).toBe(true);
    expect(stopped.evaluation.impactReached).toBe(false);
    expect(stopped.result.completed).toBe(true);
    expect(stopped.result.reasons[0]).toMatch(/rimasta attiva/);
  });

  it('7. i tentativi incrementano e l’INDIZIO compare solo dopo il secondo tentativo non riuscito', () => {
    const { mission, simulation, session: s0 } = setup('02');
    const a1 = engine.attempt(mission, s0, simulation, 'NONE');
    expect(a1.session.attempts).toBe(1);
    expect(engine.hint(mission, a1.session)).toBeNull();
    const a2 = engine.attempt(mission, a1.session, atmosphere.clearExperiment(a1.simulation), 'STORM');
    expect(a2.session.attempts).toBe(2);
    expect(a2.result.attempt).toBe(2);
    expect(a2.session.failedAttempts).toBe(HINT_AFTER_FAILED_ATTEMPTS);
    const hint = engine.hint(mission, a2.session);
    expect(hint).toBeTruthy();
    expect(hint).not.toMatch(/\d/); // nessun valore da impostare
  });

  it('8. l’ipotesi non modifica la simulazione', () => {
    const outcomes = (['NONE', 'STORM', 'HAIL', 'DOWNBURST'] as const).map((h) => play('05', { temperature: 25.5, relativeHumidity: 80 }, h));
    for (const o of outcomes) {
      expect(o.simulation).toEqual(outcomes[0]?.simulation);
      expect(o.result.observedOutcome).toBe(outcomes[0]?.result.observedOutcome);
      expect(o.result.completed).toBe(outcomes[0]?.result.completed);
    }
    expect(checkHypothesis('STORM', 'HAIL')).toBe('PARTIAL');
    expect(checkHypothesis('HAIL', 'BOTH')).toBe('CONFIRMED');
    expect(checkHypothesis('NONE', 'STORM')).toBe('NOT_CONFIRMED');
  });

  it('9. l’indizio non modifica la simulazione', () => {
    const { mission, simulation, session: s0 } = setup('03');
    const a1 = engine.attempt(mission, s0, simulation, 'HAIL');
    const a2 = engine.attempt(mission, a1.session, atmosphere.clearExperiment(a1.simulation), 'HAIL');
    const snapshot = JSON.stringify(a2.simulation);
    const sessionSnapshot = JSON.stringify(a2.session);
    engine.hint(mission, a2.session);
    engine.hint(mission, a2.session);
    expect(JSON.stringify(a2.simulation)).toBe(snapshot);
    expect(JSON.stringify(a2.session)).toBe(sessionSnapshot);
  });

  it('10. progressione salvata in IndexedDB e sblocco morbido', async () => {
    const { loadProgress, saveProgress } = await import('../storage/localStore');
    expect(await loadProgress()).toEqual(EMPTY_PROGRESS);
    expect(isHighlighted(EMPTY_PROGRESS, '03')).toBe(false);
    const { result, evaluation } = play('02', { temperature: 25.5, relativeHumidity: 80 });
    const progress = recordAttempt(EMPTY_PROGRESS, result, evaluation, new Date('2026-09-27T20:00:00Z'));
    await saveProgress(progress);
    const loaded = await loadProgress();
    expect(isCompleted(loaded, '02')).toBe(true);
    expect(loaded.missions['02']).toMatchObject({ attempts: 1, completed: true, bestIntervention: result.changeCost.value });
    expect(loaded.lastMission).toBe('02');
    expect(loaded.experienced.hail).toBe(true);
    for (const id of ['03', '04', '05', '06', '08'] as const) expect(isHighlighted(loaded, id)).toBe(true);
    expect(isHighlighted(loaded, '07')).toBe(false);
  });

  it('11. indice di intervento deterministico e normalizzato', () => {
    const initial = { temperature: 20, relativeHumidity: 50, windSpeed: 10 };
    expect(changeCost(initial, initial)).toEqual({ value: 0, level: 'MINIMO' });
    expect(changeCost(initial, { ...initial, temperature: 23 })).toEqual({ value: 0.3, level: 'MINIMO' });
    expect(changeCost(initial, { ...initial, relativeHumidity: 74 })).toEqual({ value: 0.8, level: 'MODERATO' });
    expect(changeCost(initial, { temperature: 30, relativeHumidity: 80, windSpeed: 10 }).level).toBe('FORTE');
    expect(changeCost(initial, { ...initial, relativeHumidity: 74 })).toEqual(changeCost(initial, { ...initial, relativeHumidity: 74 }));
  });

  it('12. stesso scenario + stesse modifiche = stesso risultato', () => {
    const a = play('07', { relativeHumidity: 55, windSpeed: 20 }, 'DOWNBURST');
    const b = play('07', { relativeHumidity: 55, windSpeed: 20 }, 'DOWNBURST');
    expect(b.result).toEqual(a.result);
    expect(b.evaluation).toEqual(a.evaluation);
    expect(b.simulation).toEqual(a.simulation);
  });

  it('13. lo stato LIVE resta immutabile anche in LIVE CHALLENGE', () => {
    const live = makeObservation({ temperature: 24, relativeHumidity: 70 });
    const snapshot = JSON.stringify(live);
    const profileSnapshot = JSON.stringify(HAIL_PROFILE);
    const mission = missionById('03');
    const simulation = engine.createSimulation(mission, 'live', { observation: live, profile: HAIL_PROFILE });
    const session = engine.startSession(mission, simulation, 'live');
    const run = engine.attempt(mission, session, atmosphere.withParameters(simulation, { temperature: 30 }), 'HAIL');
    expect(simulation.originKind).toBe('live');
    expect(run.simulation.origin.temperature).toBe(24);
    expect(JSON.stringify(live)).toBe(snapshot);
    expect(JSON.stringify(HAIL_PROFILE)).toBe(profileSnapshot);
  });

  it('14. lo scenario didattico non è mai etichettato LIVE', () => {
    for (const mission of MISSIONS) {
      const simulation = engine.createSimulation(mission, 'scenario');
      expect(simulation.originKind).toBe('didactic');
      expect(isDidacticScenario(simulation.origin)).toBe(true);
      expect(simulation.origin.source.providerName).toContain(SCENARIO_LABEL);
      expect(simulation.origin.source.providerName).not.toMatch(/live/i);
      expect(simulation.profile?.source.providerName).toBe(SCENARIO_LABEL);
    }
    for (const scenario of Object.values(SCENARIOS)) expect(scenario.label).toBe('SCENARIO DIDATTICO');
  });
});

describe('missioni realizzabili e non già risolte', () => {
  it.each(MISSIONS.map((m) => [m.id, m.title] as const))('missione %s (%s)', (id) => {
    const { mission, simulation, session } = setup(id);
    expect(engine.feasibility(mission, simulation, session)).toBe(true);
    const start = engine.attempt(mission, session, simulation, 'NONE');
    expect(start.result.completed).toBe(false);
  });

  it('LIVE CHALLENGE: con un profilo sfavorevole il gioco lo dichiara non realizzabile', () => {
    const mission = missionById('04');
    const live = makeObservation({ temperature: 18, relativeHumidity: 60 });
    const simulation = engine.createSimulation(mission, 'live', { observation: live, profile: STABLE_PROFILE });
    const session = engine.startSession(mission, simulation, 'live');
    expect(engine.feasibility(mission, simulation, session)).toBe(false);
    const noProfile = engine.createSimulation(missionById('03'), 'live', { observation: live, profile: null });
    expect(engine.feasibility(missionById('03'), noProfile, engine.startSession(missionById('03'), noProfile, 'live'))).toBe(false);
  });

  it('il MissionEngine non ridefinisce la meteorologia: esito = motori del laboratorio', () => {
    const { simulation } = setup('03');
    const params = { temperature: 25.5, relativeHumidity: 80, windSpeed: 10 };
    const viaMission = engine.evaluate(atmosphere.withParameters(simulation, params));
    const viaLab: SimulationState = atmosphere.startExperiment(atmosphere.withParameters(simulation, params));
    expect(viaMission.convection).toEqual(viaLab.convection);
    expect(viaMission.severe).toEqual(viaLab.severe);
  });
});
