/**
 * Enter when the premium takes out the recent high; leave when it gives back
 * the recent low.
 *
 * A third shape again, and the one that shows why {@link PaperStrategy.plan} is
 * a method rather than a pair of percentages on the order: this strategy puts
 * its stop at a *place on the chart* — the low of the range that broke — not at
 * a fixed distance from the fill. Two strategies sizing risk in incompatible
 * ways is the case the interface has to survive, so one of them is in the box
 * from the start.
 */

import type {
  PaperBar,
  PaperPlan,
  PaperSignal,
  PaperStrategy,
  PaperStrategyContext,
} from './paper-strategy';

export const breakoutStrategy: PaperStrategy = {
  id: 'range-breakout',
  name: 'Range breakout',
  description:
    'Enters when the premium closes above the highest close of the lookback window, ' +
    'and stops out at that window’s low rather than at a fixed percentage.',
  warmupBars: 15,

  paramSpecs: [
    {
      key: 'lookback',
      label: 'Lookback bars',
      description: 'How far back the range is measured. Wider means fewer, larger breakouts.',
      min: 3,
      max: 120,
      step: 1,
    },
    {
      key: 'buffer',
      label: 'Stop buffer %',
      description:
        'How far beyond the range low the stop sits, so a wick through the level does not close the trade.',
      min: 0,
      max: 25,
      step: 0.5,
    },
    {
      key: 'rewardMultiple',
      label: 'Reward multiple',
      description:
        'Target distance as a multiple of the risk. 2 puts the target twice as far away as the stop.',
      min: 0,
      max: 10,
      step: 0.5,
    },
  ],

  params: { lookback: 15, buffer: 5, rewardMultiple: 2 },

  /**
   * Stop under the broken range, target a multiple of that risk away.
   *
   * The risk distance is measured from the *fill*, not from the range, so a
   * breakout that filled well above the level carries the wider stop it
   * genuinely has rather than the one the range implies.
   */
  plan(ctx: PaperStrategyContext, entryPrice: number): PaperPlan {
    const range = rangeOf(ctx.bars, Math.round(ctx.params['lookback'] ?? 15), 1);
    const buffer = (ctx.params['buffer'] ?? 0) / 100;
    const reward = ctx.params['rewardMultiple'] ?? 0;
    const long = ctx.side === 'BUY';

    if (!range) return { stopLoss: null, target: null };

    const stopLoss = long ? range.low * (1 - buffer) : range.high * (1 + buffer);
    const risk = Math.abs(entryPrice - stopLoss);
    // A stop at or through the fill is not a stop; the breakout was already
    // over by the time it filled. Take the trade unprotected rather than
    // inventing a level, and let the strategy's own exit handle it.
    if (risk <= 0) return { stopLoss: null, target: null };

    return {
      stopLoss,
      target: reward > 0 ? (long ? entryPrice + risk * reward : entryPrice - risk * reward) : null,
    };
  },

  entry(ctx: PaperStrategyContext): PaperSignal | null {
    if (!ctx.update.closed) return null;
    const lookback = Math.round(ctx.params['lookback'] ?? 15);
    const range = rangeOf(ctx.bars, lookback, 1);
    if (!range) return null;

    const close = ctx.bars.at(-1)?.close;
    if (close === undefined) return null;

    const broke = ctx.side === 'BUY' ? close > range.high : close < range.low;
    if (!broke) return null;
    return {
      reason: `closed ${ctx.side === 'BUY' ? 'above' : 'below'} the ${lookback}-bar range`,
    };
  },

  exit(ctx: PaperStrategyContext): PaperSignal | null {
    if (!ctx.update.closed) return null;
    const lookback = Math.round(ctx.params['lookback'] ?? 15);
    // Half the entry window: the trade is given less room to fail than it
    // needed to qualify, which is what makes the exit faster than the entry
    // rather than a mirror of it.
    const range = rangeOf(ctx.bars, Math.max(2, Math.floor(lookback / 2)), 1);
    if (!range) return null;

    const close = ctx.bars.at(-1)?.close;
    if (close === undefined) return null;

    const lost = ctx.side === 'BUY' ? close < range.low : close > range.high;
    if (!lost) return null;
    return { reason: 'closed back inside the range' };
  },
};

/**
 * High and low of the `count` bars ending `skip` bars before the newest.
 *
 * `skip` is what keeps the breakout bar out of its own range. Including it
 * would mean the close is compared against a high it just set, and nothing
 * would ever break out.
 */
function rangeOf(
  bars: readonly PaperBar[],
  count: number,
  skip: number,
): { high: number; low: number } | null {
  const end = bars.length - skip;
  if (count < 1 || end < count) return null;

  const window = bars.slice(end - count, end);
  let high = -Infinity;
  let low = Infinity;
  for (const bar of window) {
    if (bar.close > high) high = bar.close;
    if (bar.close < low) low = bar.close;
  }
  return Number.isFinite(high) && Number.isFinite(low) ? { high, low } : null;
}
