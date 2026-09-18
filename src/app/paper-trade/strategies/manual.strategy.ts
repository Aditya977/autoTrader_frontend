/**
 * Take the trade now; leave on the stop, the target, or when the user says so.
 *
 * The strategy for someone who has already decided. It fills on the first
 * update after the order is placed and never exits on its own, so the position
 * lives exactly as long as its risk levels do.
 *
 * It is also the proof that the strategy interface is not shaped around one
 * kind of logic: this one uses no history, no params beyond its risk
 * percentages, and answers `null` to every exit — and the engine needs no
 * special case for it.
 */

import type { PaperPlan, PaperSignal, PaperStrategy, PaperStrategyContext } from './paper-strategy';

export const manualStrategy: PaperStrategy = {
  id: 'manual',
  name: 'Manual',
  description:
    'Enters immediately at the next traded price and holds until the stop, the target, or you close it.',
  warmupBars: 0,

  paramSpecs: [
    {
      key: 'stopPct',
      label: 'Stop loss %',
      description:
        'How far the premium may fall below the entry before the position is closed. ' +
        'Percent of the premium, not of the capital — an option can halve in an hour.',
      min: 0,
      max: 90,
      step: 1,
    },
    {
      key: 'targetPct',
      label: 'Target %',
      description: 'How far the premium must rise above the entry before the position is closed.',
      min: 0,
      max: 500,
      step: 5,
    },
  ],

  // 25% down, 50% up: a 1:2 on the premium, which is the shape an intraday
  // option buyer is usually after. Both are switchable off with a 0.
  params: { stopPct: 25, targetPct: 50 },

  plan(ctx: PaperStrategyContext, entryPrice: number): PaperPlan {
    const stopPct = ctx.params['stopPct'] ?? 0;
    const targetPct = ctx.params['targetPct'] ?? 0;
    const long = ctx.side === 'BUY';
    return {
      // A zero percentage means "no level", not "a stop at the entry price".
      stopLoss: stopPct > 0 ? level(entryPrice, stopPct, !long) : null,
      target: targetPct > 0 ? level(entryPrice, targetPct, long) : null,
    };
  },

  entry(): PaperSignal | null {
    return { reason: 'manual entry at market' };
  },

  exit(): PaperSignal | null {
    return null;
  },
};

/** `entryPrice` moved `pct` percent up when `up`, down otherwise. */
function level(entryPrice: number, pct: number, up: boolean): number {
  return entryPrice * (up ? 1 + pct / 100 : 1 - pct / 100);
}
