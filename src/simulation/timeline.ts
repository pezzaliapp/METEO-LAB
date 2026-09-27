/**
 * Timeline della simulazione didattica: T+0 … T+90 minuti, passo 15 minuti.
 */
export const SIMULATION_STEP_MINUTES = 15;
export const SIMULATION_DURATION_MINUTES = 90;

export const TIMELINE_MINUTES: readonly number[] = Object.freeze(
  Array.from(
    { length: SIMULATION_DURATION_MINUTES / SIMULATION_STEP_MINUTES + 1 },
    (_, index) => index * SIMULATION_STEP_MINUTES,
  ),
);

export function isTimelineMinute(minute: number): boolean {
  return TIMELINE_MINUTES.includes(minute);
}

/** Minuto successivo nella timeline, oppure null se si è già a fine timeline. */
export function nextMinute(minute: number): number | null {
  const index = TIMELINE_MINUTES.indexOf(minute);
  if (index === -1 || index === TIMELINE_MINUTES.length - 1) return null;
  return TIMELINE_MINUTES[index + 1] ?? null;
}

export function formatOffset(minute: number): string {
  return `T+${minute}`;
}
