/**
 * Wait for the fast average to cross the slow one; leave when it crosses back.
 *
 * The counterpart to `manual`: it declines to fill until the market agrees, it
 * needs history before it can answer at all, and it exits on its own signal
 * rather than only on a level. Between the two, every branch of the engine's
 * decision loop is exercised by a real strategy rather than by a test double.
 *
 * ## Why the cross is read on closed bars only
 *
 * A forming bar crosses and un-crosses repeatedly within the minute. Acting on
 * it produces entries that vanish from the chart when the bar settles somewhere
 * else, and a P&L that cannot be reproduced from the same data twice. So the
 * signal is read from closed bars, while the *risk* levels the engine checks
 * still see every tick — which is the correct asymmetry: you want to be slow to
 * enter and fast to stop out, never the reverse.
 */

import type {
  PaperBar,
  PaperPlan,
  PaperSignal,
  PaperStrategy,
  PaperStrategyContext,
} from './paper-strategy';

export const emaCrossoverStrategy: PaperStrategy = {
  id: 'ema-crossover',
  name: 'EMA crossover',
  description:
    'Enters when the fast EMA closes above the slow EMA and exits when it closes back below. ' +
    'Reads closed bars only, so an entry never moves after the fact.',
  // The slow EMA needs roughly its own period of bars before it means anything.
  warmupBars: 21,

  paramSpecs: [
    {
      key: 'fast',
      label: 'Fast EMA',
      description: 'Bars in the fast average. Lower reacts sooner and whipsaws more.',
      min: 2,
      max: 50,
      step: 1,
    },
    {
      key: 'slow',
      label: 'Slow EMA',
      description: 'Bars in the slow average. The trend the fast one is measured against.',
      min: 3,
      max: 200,
      step: 1,
    },
    {
      key: 'stopPct',
      label: 'Stop loss %',
      description: 'Premium percentage below entry at which the position is closed.',
      min: 0,
      max: 90,
      step: 1,
    },
    {
      key: 'targetPct',
      label: 'Target %',
      description: 'Premium percentage above entry at which the position is closed.',
      min: 0,
      max: 500,
      step: 5,
    },
  ],

  params: { fast: 9, slow: 21, stopPct: 30, targetPct: 60 },

  plan(ctx: PaperStrategyContext, entryPrice: number): PaperPlan {
    const stopPct = ctx.params['stopPct'] ?? 0;
    const targetPct = ctx.params['targetPct'] ?? 0;
    const long = ctx.side === 'BUY';
    return {
      stopLoss: stopPct > 0 ? move(entryPrice, stopPct, !long) : null,
      target: targetPct > 0 ? move(entryPrice, targetPct, long) : null,
    };
  },

  entry(ctx: PaperStrategyContext): PaperSignal | null {
    const cross = crossState(ctx);
    if (!cross) return null;
    const wantAbove = ctx.side === 'BUY';
    // The *turn*, not the state: entering on "fast is above slow" would fill on
    // whatever bar the order happened to be placed on in an established trend,
    // which is the late entry this strategy exists to avoid.
    if (cross.wasAbove === cross.isAbove) return null;
    if (cross.isAbove !== wantAbove) return null;
    return {
      reason: `${ctx.params['fast']} EMA crossed ${wantAbove ? 'above' : 'below'} ${ctx.params['slow']} EMA`,
    };
  },

  exit(ctx: PaperStrategyContext): PaperSignal | null {
    const cross = crossState(ctx);
    if (!cross) return null;
    const heldWhileAbove = ctx.side === 'BUY';
    if (cross.wasAbove === cross.isAbove) return null;
    if (cross.isAbove === heldWhileAbove) return null;
    return {
      reason: `${ctx.params['fast']} EMA crossed back ${heldWhileAbove ? 'below' : 'above'} ${ctx.params['slow']} EMA`,
    };
  },
};

/**
 * Which side of the slow average the fast one is on, now and one bar ago.
 *
 * `null` when the update is not a bar close, or when there is not enough
 * history — both of which mean "no opinion" rather than "no".
 */
function crossState(ctx: PaperStrategyContext): { wasAbove: boolean; isAbove: boolean } | null {
  if (!ctx.update.closed) return null;

  const fast = Math.round(ctx.params['fast'] ?? 9);
  const slow = Math.round(ctx.params['slow'] ?? 21);
  if (fast >= slow) return null;

  const bars = ctx.bars;
  if (bars.length < slow + 1) return null;

  const fastNow = ema(bars, fast);
  const slowNow = ema(bars, slow);
  const previous = bars.slice(0, -1);
  const fastBefore = ema(previous, fast);
  const slowBefore = ema(previous, slow);
  if (fastNow === null || slowNow === null || fastBefore === null || slowBefore === null) {
    return null;
  }

  return { wasAbove: fastBefore > slowBefore, isAbove: fastNow > slowNow };
}

/**
 * Exponential moving average of the closes, seeded on a simple average.
 *
 * Recomputed from the window each call rather than carried incrementally: a
 * strategy holds no state between updates by design — that is what lets a
 * backtest replay the same bars and reach the same answer — and a few hundred
 * multiplications per bar is not the cost worth trading that for.
 */
function ema(bars: readonly PaperBar[], period: number): number | null {
  if (bars.length < period) return null;
  const k = 2 / (period + 1);
  let value = 0;
  for (let i = 0; i < period; i++) value += bars[i]!.close;
  value /= period;
  for (let i = period; i < bars.length; i++) {
    value = bars[i]!.close * k + value * (1 - k);
  }
  return value;
}

function move(price: number, pct: number, up: boolean): number {
  return price * (up ? 1 + pct / 100 : 1 - pct / 100);
}
