import type { Candle, Pivot } from '../types';
import { unitAt } from './atr';

/**
 * Swing highs and lows, by ZigZag.
 *
 * A turn only becomes a turn once price has walked away from it. This walks
 * the series holding the running extreme in the current direction and commits
 * that extreme as a pivot the moment price reverses by `minSwingAtr` ATRs —
 * which means a pivot is always committed *later* than the bar it sits on, and
 * that lag is the honest cost of not knowing the future.
 *
 * ## Two properties the detectors depend on
 *
 * **Pivots alternate.** high, low, high, low, with no two of a kind in a row.
 * Every detector below reads fixed-length windows out of this list and would
 * silently match nonsense against a run of two highs.
 *
 * **The last pivot is provisional.** It is the running extreme, not yet proven
 * to be a turn, and it is flagged so a detector can refuse it. Treating it as
 * confirmed would let a pattern complete on a shape that has not happened —
 * the failure mode that makes a backtest look brilliant and trade badly.
 */
export function findPivots(
  candles: readonly Candle[],
  atrs: readonly (number | null)[],
  minSwingAtr: number,
): Pivot[] {
  const pivots: Pivot[] = [];
  if (candles.length < 2) return pivots;

  const first = candles[0] as Candle;
  let highPrice = first.high;
  let highIndex = 0;
  let lowPrice = first.low;
  let lowIndex = 0;
  /** `up` means the run in progress is upward, so the extreme being held is a high. */
  let direction: 'up' | 'down' | null = null;

  const push = (index: number, price: number, kind: 'high' | 'low'): void => {
    pivots.push({
      index,
      time: (candles[index] as Candle).time,
      price,
      kind,
      provisional: false,
    });
  };

  for (let i = 1; i < candles.length; i++) {
    const bar = candles[i] as Candle;
    const unit = unitAt(atrs, i);
    // No volatility unit yet — the threshold is unknowable, so track the
    // extremes and commit nothing. Guessing a unit here would scatter pivots
    // through the warm-up window at whatever density the guess implied.
    if (unit === null) {
      if (bar.high > highPrice) {
        highPrice = bar.high;
        highIndex = i;
      }
      if (bar.low < lowPrice) {
        lowPrice = bar.low;
        lowIndex = i;
      }
      continue;
    }
    const threshold = minSwingAtr * unit;

    if (direction === null) {
      // Undecided. Whichever reversal clears the threshold first sets the
      // direction and commits the extreme behind it.
      if (bar.high > highPrice) {
        highPrice = bar.high;
        highIndex = i;
      }
      if (bar.low < lowPrice) {
        lowPrice = bar.low;
        lowIndex = i;
      }
      if (highPrice - bar.low >= threshold) {
        push(highIndex, highPrice, 'high');
        direction = 'down';
        lowPrice = bar.low;
        lowIndex = i;
      } else if (bar.high - lowPrice >= threshold) {
        push(lowIndex, lowPrice, 'low');
        direction = 'up';
        highPrice = bar.high;
        highIndex = i;
      }
      continue;
    }

    if (direction === 'up') {
      if (bar.high >= highPrice) {
        highPrice = bar.high;
        highIndex = i;
        continue;
      }
      if (highPrice - bar.low >= threshold) {
        push(highIndex, highPrice, 'high');
        direction = 'down';
        lowPrice = bar.low;
        lowIndex = i;
      }
      continue;
    }

    if (bar.low <= lowPrice) {
      lowPrice = bar.low;
      lowIndex = i;
      continue;
    }
    if (bar.high - lowPrice >= threshold) {
      push(lowIndex, lowPrice, 'low');
      direction = 'up';
      highPrice = bar.high;
      highIndex = i;
    }
  }

  // The extreme still being held is a candidate turn that price has not yet
  // walked away from. Published so a forming pattern can use it, flagged so a
  // confirmed one cannot.
  if (direction === 'up') {
    pivots.push({
      index: highIndex,
      time: (candles[highIndex] as Candle).time,
      price: highPrice,
      kind: 'high',
      provisional: true,
    });
  } else if (direction === 'down') {
    pivots.push({
      index: lowIndex,
      time: (candles[lowIndex] as Candle).time,
      price: lowPrice,
      kind: 'low',
      provisional: true,
    });
  }

  return pivots;
}
