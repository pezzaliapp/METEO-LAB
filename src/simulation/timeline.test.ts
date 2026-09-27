import { describe, expect, it } from 'vitest';
import { TIMELINE_MINUTES, formatOffset, isTimelineMinute, nextMinute } from './timeline';

describe('timeline della simulazione', () => {
  it('copre T+0 … T+90 a passi di 15 minuti', () => {
    expect(TIMELINE_MINUTES).toEqual([0, 15, 30, 45, 60, 75, 90]);
  });

  it('avanza di un passo e si ferma a T+90', () => {
    expect(nextMinute(0)).toBe(15);
    expect(nextMinute(75)).toBe(90);
    expect(nextMinute(90)).toBeNull();
    expect(nextMinute(20)).toBeNull();
  });

  it('riconosce i minuti validi e li formatta', () => {
    expect(isTimelineMinute(45)).toBe(true);
    expect(isTimelineMinute(50)).toBe(false);
    expect(formatOffset(30)).toBe('T+30');
  });
});
