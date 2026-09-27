import { AtmosphereEngine } from '../engine/AtmosphereEngine';
import { REFERENCE, type ConvectiveOutlook } from '../engine/ConvectiveEngine';
import type { SevereOutlook } from '../engine/SevereWeather';
import type { AtmosphericProfile } from '../models/AtmosphericProfile';
import type { AtmosphericState } from '../models/AtmosphericState';
import { PARAMETER_LIMITS, type SimulationParameters, type SimulationState } from '../models/SimulationState';
import { SCENARIOS, type ScenarioId } from './scenarios';

/**
 * MissionEngine — regole del gioco METEO LAB MISSIONI.
 *
 * NON contiene meteorologia: ogni esito deriva dagli stessi motori del laboratorio
 * (VerticalProfileEngine → ConvectiveEngine → HailEngine + DownburstEngine, tramite
 * AtmosphereEngine.evaluateExperiment). Il MissionEngine interpreta i risultati:
 * esito osservato, condizione di successo, confronto con l'ipotesi, cause, indizi,
 * indice di intervento. Nessun numero casuale; l'ipotesi e gli indizi non influiscono
 * mai sulla simulazione.
 */

export type MissionId = '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08';
export type ParameterKey = keyof SimulationParameters;

/** Esito osservato di un esperimento. */
export type Outcome = 'NONE' | 'FAVORABLE' | 'STORM' | 'HAIL' | 'DOWNBURST' | 'BOTH';
/** Ipotesi del giocatore prima dell'esperimento. */
export type Hypothesis = 'NONE' | 'FAVORABLE' | 'STORM' | 'HAIL' | 'DOWNBURST';
export type HypothesisCheck = 'CONFIRMED' | 'PARTIAL' | 'NOT_CONFIRMED';

/** Risultati dei motori per un insieme di parametri. */
export interface MissionEvaluation {
  readonly parameters: SimulationParameters;
  readonly convection: ConvectiveOutlook;
  readonly severe: SevereOutlook;
  readonly outcome: Outcome;
  /** HailEngine produce uno stadio diverso da NONE durante il ciclo di vita. */
  readonly hailReached: boolean;
  /** DownburstEngine raggiunge almeno IMPACT. */
  readonly impactReached: boolean;
}

export type InterventionLevel = 'MINIMO' | 'MODERATO' | 'FORTE';

export interface InterventionIndex {
  /** Distanza normalizzata dallo stato iniziale (non è un punteggio scientifico). */
  readonly value: number;
  readonly level: InterventionLevel;
}

export interface MissionContext {
  readonly baseline: MissionEvaluation;
  readonly cost: InterventionIndex;
}

export interface HintRule {
  readonly when: (evaluation: MissionEvaluation, context: MissionContext) => boolean;
  readonly text: string;
}

export type MissionSourceKind = 'scenario' | 'live';

export interface MissionDefinition {
  readonly id: MissionId;
  readonly title: string;
  readonly objective: string;
  readonly description: string;
  readonly scenario: ScenarioId;
  readonly allowedControls: readonly ParameterKey[];
  readonly hypotheses: readonly Hypothesis[];
  /** true se la missione può essere giocata anche come LIVE CHALLENGE. */
  readonly liveChallenge: boolean;
  readonly successCondition: (evaluation: MissionEvaluation, context: MissionContext) => boolean;
  /** Perché la missione non è (ancora) riuscita: frasi derivate dai motori. */
  readonly failureAnalysis: (evaluation: MissionEvaluation, context: MissionContext) => string[];
  /** Perché è riuscita: frasi causali derivate dai motori (il momento «aha»). */
  readonly successAnalysis: (evaluation: MissionEvaluation, context: MissionContext) => { headline: string; reasons: string[] };
  readonly hintRules: readonly HintRule[];
}

export interface Change {
  readonly key: ParameterKey;
  readonly before: number;
  readonly after: number;
}

export interface Effect {
  readonly label: string;
  readonly direction: 'up' | 'down';
}

export interface MissionResult {
  readonly missionId: MissionId;
  readonly completed: boolean;
  readonly attempt: number;
  readonly hypothesis: Hypothesis;
  readonly hypothesisCheck: HypothesisCheck;
  readonly observedOutcome: Outcome;
  readonly headline: string | null;
  readonly reasons: readonly string[];
  readonly changeCost: InterventionIndex;
  readonly changes: readonly Change[];
  readonly effects: readonly Effect[];
}

export interface MissionSession {
  readonly missionId: MissionId;
  readonly source: MissionSourceKind;
  readonly initial: SimulationParameters;
  readonly baseline: MissionEvaluation;
  readonly attempts: number;
  readonly failedAttempts: number;
  readonly lastResult: MissionResult | null;
  readonly lastEvaluation: MissionEvaluation | null;
}

/** Scale di normalizzazione dell'indice di intervento (variazioni didattiche "tipiche"). */
export const INTERVENTION_SCALES: Record<ParameterKey, number> = { temperature: 10, relativeHumidity: 30, windSpeed: 30 };
export const INTERVENTION_THRESHOLDS = { minimal: 0.5, moderate: 1 } as const;

/** Numero di tentativi non riusciti dopo cui è disponibile l'INDIZIO. */
export const HINT_AFTER_FAILED_ATTEMPTS = 2;

export function outcomeOf(convection: ConvectiveOutlook, severe: SevereOutlook, favorable: boolean): Outcome {
  if (!convection.develops) return favorable ? 'FAVORABLE' : 'NONE';
  const hail = severe.hail.frames.some((frame) => frame.stage !== 'NONE');
  const burst = severe.downburst.frames.some((frame) => frame.stage === 'IMPACT');
  if (hail && burst) return 'BOTH';
  if (hail) return 'HAIL';
  if (burst) return 'DOWNBURST';
  return 'STORM';
}

export function checkHypothesis(hypothesis: Hypothesis, outcome: Outcome): HypothesisCheck {
  const storm = outcome === 'STORM' || outcome === 'HAIL' || outcome === 'DOWNBURST' || outcome === 'BOTH';
  switch (hypothesis) {
    case 'NONE':
      return outcome === 'NONE' ? 'CONFIRMED' : outcome === 'FAVORABLE' ? 'PARTIAL' : 'NOT_CONFIRMED';
    case 'FAVORABLE':
      return outcome === 'FAVORABLE' ? 'CONFIRMED' : storm ? 'PARTIAL' : 'NOT_CONFIRMED';
    case 'STORM':
      return outcome === 'STORM' ? 'CONFIRMED' : storm ? 'PARTIAL' : 'NOT_CONFIRMED';
    case 'HAIL':
      return outcome === 'HAIL' || outcome === 'BOTH' ? 'CONFIRMED' : storm ? 'PARTIAL' : 'NOT_CONFIRMED';
    case 'DOWNBURST':
      return outcome === 'DOWNBURST' || outcome === 'BOTH' ? 'CONFIRMED' : storm ? 'PARTIAL' : 'NOT_CONFIRMED';
  }
}

export function changeCost(initial: SimulationParameters, parameters: SimulationParameters): InterventionIndex {
  const value = Math.sqrt(
    (Object.keys(INTERVENTION_SCALES) as ParameterKey[]).reduce(
      (sum, key) => sum + ((parameters[key] - initial[key]) / INTERVENTION_SCALES[key]) ** 2,
      0,
    ),
  );
  const rounded = Math.round(value * 100) / 100;
  const level: InterventionLevel =
    rounded < INTERVENTION_THRESHOLDS.minimal ? 'MINIMO' : rounded < INTERVENTION_THRESHOLDS.moderate ? 'MODERATO' : 'FORTE';
  return { value: rounded, level };
}

/** Effetti misurati sui risultati dei motori (frecce solo se il calcolo cambia davvero). */
export function effectsBetween(before: MissionEvaluation, after: MissionEvaluation): Effect[] {
  const effects: Effect[] = [];
  const add = (label: string, a: number | null, b: number | null, tolerance: number) => {
    if (a === null || b === null || Math.abs(b - a) <= tolerance) return;
    effects.push({ label, direction: b > a ? 'up' : 'down' });
  };
  const vb = before.severe.vertical.available ? before.severe.vertical : null;
  const va = after.severe.vertical.available ? after.severe.vertical : null;
  add('ENERGIA CONVETTIVA', before.convection.diagnostics.capeProxy, after.convection.diagnostics.capeProxy, 25);
  add('UPDRAFT', before.convection.diagnostics.updraft, after.convection.diagnostics.updraft, 0.5);
  add('BASE NUBI', vb?.cloudBase ?? before.convection.diagnostics.lclHeight, va?.cloudBase ?? after.convection.diagnostics.lclHeight, 50);
  add('ARIA SECCA SOTTO LA NUBE', vb?.subCloudDryness ?? null, va?.subCloudDryness ?? null, 0.5);
  add('CONVEZIONE (indice didattico)', before.convection.stormProbability, after.convection.stormProbability, 0.02);
  if (after.severe.hail.available) add('GRANDINE (indice didattico)', before.severe.hail.hailPotential, after.severe.hail.hailPotential, 0.02);
  if (after.severe.downburst.available) {
    add('DOWNBURST (indice didattico)', before.severe.downburst.downburstPotential, after.severe.downburst.downburstPotential, 0.02);
  }
  return effects;
}

export interface LiveSource {
  readonly observation: AtmosphericState;
  readonly profile: AtmosphericProfile | null;
}

export class MissionEngine {
  constructor(private readonly atmosphere = new AtmosphereEngine()) {}

  /** Esegue i motori per i parametri della simulazione (senza modificarla). */
  evaluate(simulation: SimulationState): MissionEvaluation {
    const { convection, severe } = this.atmosphere.evaluateExperiment(simulation);
    // «Atmosfera favorevole»: energia convettiva didattica oltre la soglia di convezione marginale del motore.
    const favorable = convection.diagnostics.capeProxy >= REFERENCE.capeWeak;
    return Object.freeze({
      parameters: simulation.parameters,
      convection,
      severe,
      outcome: outcomeOf(convection, severe, favorable),
      hailReached: severe.hail.frames.some((frame) => frame.stage !== 'NONE'),
      impactReached: severe.downburst.frames.some((frame) => frame.stage === 'IMPACT'),
    });
  }

  /** Simulazione iniziale: scenario didattico o condizioni del momento (LIVE CHALLENGE). */
  createSimulation(definition: MissionDefinition, source: MissionSourceKind, live: LiveSource | null = null): SimulationState {
    if (source === 'live') {
      if (!live) throw new Error('LIVE CHALLENGE senza osservazione');
      return this.atmosphere.createSimulation(live.observation, { originKind: 'live', profile: live.profile, id: `live-${definition.id}` });
    }
    const scenario = SCENARIOS[definition.scenario];
    return this.atmosphere.createSimulation(scenario.observation, {
      originKind: 'didactic',
      profile: scenario.profile,
      id: `${scenario.id}-v${scenario.version}-${definition.id}`,
      now: new Date(scenario.observation.timestamp),
    });
  }

  startSession(definition: MissionDefinition, simulation: SimulationState, source: MissionSourceKind): MissionSession {
    return Object.freeze({
      missionId: definition.id,
      source,
      initial: simulation.parameters,
      baseline: this.evaluate(this.atmosphere.reset(simulation)),
      attempts: 0,
      failedAttempts: 0,
      lastResult: null,
      lastEvaluation: null,
    });
  }

  /**
   * AVVIA ESPERIMENTO: un tentativo. Restituisce la simulazione avviata (dagli stessi motori
   * del laboratorio), la sessione aggiornata e il risultato della missione.
   */
  attempt(
    definition: MissionDefinition,
    session: MissionSession,
    simulation: SimulationState,
    hypothesis: Hypothesis,
  ): { simulation: SimulationState; session: MissionSession; result: MissionResult; evaluation: MissionEvaluation } {
    const started = this.atmosphere.startExperiment(simulation);
    const evaluation = this.evaluate(started);
    const cost = changeCost(session.initial, started.parameters);
    const context: MissionContext = { baseline: session.baseline, cost };
    const completed = definition.successCondition(evaluation, context);
    const success = completed ? definition.successAnalysis(evaluation, context) : null;
    const attemptNumber = session.attempts + 1;
    const result: MissionResult = Object.freeze({
      missionId: definition.id,
      completed,
      attempt: attemptNumber,
      hypothesis,
      hypothesisCheck: checkHypothesis(hypothesis, evaluation.outcome),
      observedOutcome: evaluation.outcome,
      headline: success?.headline ?? null,
      reasons: Object.freeze(success ? success.reasons : definition.failureAnalysis(evaluation, context)),
      changeCost: cost,
      changes: Object.freeze(
        (Object.keys(PARAMETER_LIMITS) as ParameterKey[])
          .filter((key) => Math.abs(started.parameters[key] - session.initial[key]) > 1e-9)
          .map((key) => ({ key, before: session.initial[key], after: started.parameters[key] })),
      ),
      effects: Object.freeze(effectsBetween(session.baseline, evaluation)),
    });
    return {
      simulation: started,
      evaluation,
      result,
      session: Object.freeze({
        ...session,
        attempts: attemptNumber,
        failedAttempts: completed ? session.failedAttempts : session.failedAttempts + 1,
        lastResult: result,
        lastEvaluation: evaluation,
      }),
    };
  }

  /**
   * INDIZIO: disponibile solo dopo {@link HINT_AFTER_FAILED_ATTEMPTS} tentativi non riusciti.
   * Deriva dall'ultimo esito dei motori; non indica mai il valore da impostare.
   */
  hint(definition: MissionDefinition, session: MissionSession): string | null {
    if (session.failedAttempts < HINT_AFTER_FAILED_ATTEMPTS || !session.lastEvaluation || session.lastResult?.completed) return null;
    const context: MissionContext = { baseline: session.baseline, cost: session.lastResult?.changeCost ?? changeCost(session.initial, session.initial) };
    return definition.hintRules.find((rule) => rule.when(session.lastEvaluation as MissionEvaluation, context))?.text ?? null;
  }

  /**
   * La missione è realizzabile con i controlli consentiti? Esplora in modo deterministico
   * una griglia di valori (stessi motori). Usata per dire chiaramente, in LIVE CHALLENGE,
   * quando con le condizioni del giorno il fenomeno non è ottenibile nel modello.
   */
  feasibility(definition: MissionDefinition, simulation: SimulationState, session: MissionSession): boolean {
    const initial = session.initial;
    const values = (key: ParameterKey, candidates: number[]) =>
      definition.allowedControls.includes(key)
        ? [...new Set([initial[key], ...candidates.map((v) => Math.min(PARAMETER_LIMITS[key].max, Math.max(PARAMETER_LIMITS[key].min, v)))])]
        : [initial[key]];
    const temperatures = values('temperature', [-8, -6, -4, -2, 2, 4, 6, 8, 10, 12].map((d) => initial.temperature + d));
    const humidities = values('relativeHumidity', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const winds = values('windSpeed', [0, 10, 30, 60]);
    for (const temperature of temperatures) {
      for (const relativeHumidity of humidities) {
        for (const windSpeed of winds) {
          const parameters = { temperature, relativeHumidity, windSpeed };
          const evaluation = this.evaluate(this.atmosphere.withParameters(simulation, parameters));
          const context: MissionContext = { baseline: session.baseline, cost: changeCost(initial, evaluation.parameters) };
          if (definition.successCondition(evaluation, context)) return true;
        }
      }
    }
    return false;
  }
}
