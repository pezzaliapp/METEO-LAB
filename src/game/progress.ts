import type { MissionEvaluation, MissionId, MissionResult } from './MissionEngine';

/**
 * Progressione LOCALE delle missioni (IndexedDB, nessun account, nessun cloud, nessun tracciamento).
 */

export interface MissionRecord {
  readonly attempts: number;
  readonly completed: boolean;
  readonly completedAt: string | null;
  /** Indice di intervento più basso con cui la missione è stata completata. */
  readonly bestIntervention: number | null;
}

export interface MissionProgress {
  readonly version: 1;
  readonly missions: Readonly<Partial<Record<MissionId, MissionRecord>>>;
  /** Fenomeni già osservati in almeno un esperimento (per rendere evidenti le missioni 06 e 07). */
  readonly experienced: { readonly hail: boolean; readonly downburst: boolean };
  readonly lastMission: MissionId | null;
}

export const EMPTY_PROGRESS: MissionProgress = Object.freeze({
  version: 1,
  missions: Object.freeze({}),
  experienced: Object.freeze({ hail: false, downburst: false }),
  lastMission: null,
});

export function recordAttempt(progress: MissionProgress, result: MissionResult, evaluation: MissionEvaluation, now: Date): MissionProgress {
  const previous = progress.missions[result.missionId] ?? { attempts: 0, completed: false, completedAt: null, bestIntervention: null };
  const best =
    result.completed && (previous.bestIntervention === null || result.changeCost.value < previous.bestIntervention)
      ? result.changeCost.value
      : previous.bestIntervention;
  return Object.freeze({
    version: 1,
    missions: Object.freeze({
      ...progress.missions,
      [result.missionId]: Object.freeze({
        attempts: previous.attempts + 1,
        completed: previous.completed || result.completed,
        completedAt: previous.completedAt ?? (result.completed ? now.toISOString() : null),
        bestIntervention: best,
      }),
    }),
    experienced: Object.freeze({
      hail: progress.experienced.hail || evaluation.hailReached,
      downburst: progress.experienced.downburst || evaluation.impactReached,
    }),
    lastMission: result.missionId,
  });
}

export function withLastMission(progress: MissionProgress, id: MissionId): MissionProgress {
  return Object.freeze({ ...progress, lastMission: id });
}

export function isCompleted(progress: MissionProgress, id: MissionId): boolean {
  return progress.missions[id]?.completed === true;
}

/**
 * Sblocco morbido: nessuna missione è mai inaccessibile (MOSTRA TUTTE LE MISSIONI),
 * ma alcune diventano "evidenti" dopo le esperienze giuste.
 */
export function isHighlighted(progress: MissionProgress, id: MissionId): boolean {
  switch (id) {
    case '01':
    case '02':
      return true;
    case '03':
    case '04':
    case '05':
    case '08':
      return isCompleted(progress, '02');
    case '06':
      return progress.experienced.hail;
    case '07':
      return progress.experienced.downburst;
  }
}

/** Legge dati salvati in modo difensivo (versioni future o dati parziali). */
export function normalizeProgress(value: unknown): MissionProgress {
  if (typeof value !== 'object' || value === null) return EMPTY_PROGRESS;
  const raw = value as Partial<MissionProgress>;
  return Object.freeze({
    version: 1,
    missions: Object.freeze({ ...(raw.missions ?? {}) }),
    experienced: Object.freeze({ hail: raw.experienced?.hail === true, downburst: raw.experienced?.downburst === true }),
    lastMission: raw.lastMission ?? null,
  });
}
