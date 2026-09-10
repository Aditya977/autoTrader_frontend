import type { Candle } from '../types';
import { atr, unitAt } from './atr';

const bar = (open: number, high: number, low: number, close: number, i = 0): Candle => ({
  time: 1_700_000_000 + i * 60,
  open,
  high,
  low,
  close,
  volume: 1,
});

describe('atr', () => {
  /**
   * Worked by hand rather than recorded from the implementation, so the test
   * would notice the implementation changing its mind.
   *
   *   bar 0: prev close is its own open, 100. TR = max(102-98, |102-100|, |98-100|) = 4
   *   bar 1: prev close 101.        TR = max(103-100, |103-101|, |100-101|) = 3
   *   bar 2: prev close 102.        TR = max(104-101, |104-102|, |101-102|) = 3
   *   ATR(3) at bar 2 = (4 + 3 + 3) / 3 = 3.3333…
   */
  it('averages the true ranges over the window', () => {
    const candles = [
      bar(100, 102, 98, 101, 0),
      bar(101, 103, 100, 102, 1),
      bar(102, 104, 101, 103, 2),
    ];
    const out = atr(candles, 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(10 / 3, 10);
  });

  /**
   * The first bar has no previous close. Its own open stands in, so a gap open
   * reads as the jump it was rather than as a quiet inside bar.
   */
  it('uses the first bar’s own open as its previous close', () => {
    const out = atr([bar(100, 101, 99, 100.5, 0)], 1);
    expect(out[0]).toBeCloseTo(2, 10);
  });

  it('is null until the window is full, never zero', () => {
    const candles = Array.from({ length: 5 }, (_, i) => bar(100, 101, 99, 100, i));
    const out = atr(candles, 4);
    expect(out.slice(0, 3)).toEqual([null, null, null]);
    expect(out[3]).toBeCloseTo(2, 10);
  });

  /**
   * A dead-flat series has a true range of zero, and a zero unit makes every
   * ratio built on it infinite. Reported as "no unit yet" instead.
   */
  it('reports a motionless series as having no unit rather than a zero one', () => {
    const candles = Array.from({ length: 4 }, (_, i) => bar(100, 100, 100, 100, i));
    expect(atr(candles, 2).every((v) => v === null)).toBe(true);
  });

  it('handles an empty series and a nonsense period without throwing', () => {
    expect(atr([], 14)).toEqual([]);
    expect(atr([bar(1, 2, 0, 1)], 0)).toEqual([null]);
  });
});

describe('unitAt', () => {
  it('returns the value at the bar when there is one', () => {
    expect(unitAt([null, 2, 3], 2)).toBe(3);
  });

  /**
   * A pattern anchored inside the warm-up window would otherwise be
   * unmeasurable and silently dropped. Reaching forward to the first unit that
   * exists is a stated approximation, not an accident.
   */
  it('falls back to the newest unit known when the bar is inside the warm-up', () => {
    expect(unitAt([null, null, 5], 0)).toBe(5);
  });

  it('is null only when nothing in the series has a unit', () => {
    expect(unitAt([null, null], 1)).toBeNull();
  });
});
