import type { Candle } from '../types';

/**
 * Average true range, one value per bar.
 *
 * A simple mean of the last `period` true ranges rather than Wilder's
 * smoothing. That is not the textbook ATR, and the reason to prefer it here is
 * consistency: the backend's feature store and candle taxonomy both average
 * the window plainly, so a tolerance of "0.6 ATR" means the same quantity on
 * the chart as it does in the dataset. Two different ATRs under one name would
 * make every threshold in this engine untranslatable to the research already
 * recorded against those columns.
 *
 * `null` until the window is full. Never a placeholder number: a zero that
 * means "not known yet" is indistinguishable from a zero that means the market
 * did not move, and every comparison against it silently succeeds.
 */
export function atr(candles: readonly Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(candles.length).fill(null);
  if (period <= 0 || candles.length === 0) return out;

  const window: number[] = [];
  let sum = 0;

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i] as Candle;
    // The first bar has no previous close, so its own open stands in. Using
    // its high-low alone would understate a gap open as a quiet bar.
    const previousClose = i > 0 ? (candles[i - 1] as Candle).close : bar.open;
    const trueRange = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose),
    );

    window.push(trueRange);
    sum += trueRange;
    if (window.length > period) sum -= window.shift() as number;

    if (window.length === period) {
      const mean = sum / period;
      // A zero ATR makes every ratio built on it infinite. Treated as "no unit
      // yet" rather than as a very small one.
      out[i] = mean > 0 ? mean : null;
    }
  }

  return out;
}

/**
 * The volatility unit at a bar, falling back to the newest one known.
 *
 * A pattern's anchor pivot can sit inside the warm-up window, where there is
 * no ATR yet. Refusing to measure it would throw away every pattern near the
 * start of a series; measuring it against the first ATR that does exist is a
 * small, stated approximation.
 */
export function unitAt(atrs: readonly (number | null)[], index: number): number | null {
  for (let i = Math.min(index, atrs.length - 1); i >= 0; i--) {
    const value = atrs[i];
    if (value !== null && value !== undefined) return value;
  }
  for (const value of atrs) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}
