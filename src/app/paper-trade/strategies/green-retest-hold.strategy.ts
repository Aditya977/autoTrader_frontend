/**
 * Green Retest Buy, held a fixed number of candles.
 *
 * Buy when the retest overlay prints a **green** retest on a one-minute
 * candle, two seconds before that candle closes; hold for exactly the next
 * {@link HOLD_BARS} candles; sell two seconds before the last of them closes.
 * Long only, one trade at a time, and a new one on every later signal.
 *
 * ```
 *   11:14  green retest signalled     → buy  at 11:14:58
 *   11:15  first held candle
 *   11:16  second held candle         → sell at 11:16:58
 * ```
 *
 * ## The holding period is one number
 *
 * {@link HOLD_BARS} is the only place it is written down: the strategy's
 * display name, its description, its exit reason and its arithmetic all read
 * from it. Changing 2 to 3 changes the rule and everything that describes the
 * rule together, so the picker can never offer a "2-Candle" strategy that
 * holds for three — which is exactly what would have happened the first time
 * somebody edited the number and not the name.
 *
 * The `id` deliberately does **not** encode the count. It is an identity, not
 * a description: a position already open carries the id of the strategy that
 * took it, and if the id moved when the constant did, flipping the number
 * mid-session would orphan that position and it would silently stop being
 * processed.
 *
 * ## What "green" means, and why it is not re-derived here
 *
 * It means what it means on the chart: `direction === 'BULLISH'`, which is the
 * field the overlay colours from, on the bar the overlay marks — `approachAt`,
 * or `resumptionAt` for a time correction that never came back. Both are read
 * from the retest the overlay is already drawing, mapped across untouched.
 *
 * Deliberately no second opinion. Not a quality floor, not a `valid` filter,
 * not a re-scan of the bars: the moment this strategy decided for itself what
 * counted as a signal, the trades would stop lining up with the green arrows
 * on screen, and the first thing anybody would do is ask why the chart
 * disagrees with the journal. The overlay is the signal. This file is only the
 * timing and the sizing around it.
 *
 * ## Why the timing is expressed as an offset rather than a timer
 *
 * There is no timer anywhere. The engine decides on closed bars, so the
 * 11:14 candle's close *is* the moment 11:14:58 stands for — the last price
 * available before 11:15 begins, which is exactly what an order placed two
 * seconds early would have filled at. The 58 seconds are therefore a
 * **stamp**, declared once as {@link fillOffsetMs}, not a delay to sleep
 * through.
 *
 * That is also what makes the rule identical live and in a backtest, as the
 * spec requires. A strategy that genuinely waited two seconds would behave one
 * way against a live feed and another way against a replay running four
 * hundred times faster — or, worse, would be correct in one and quietly skip
 * fills in the other. Here the arithmetic is the same in both, because it is
 * arithmetic on bar times rather than on the wall clock.
 */

import type { PaperPlan, PaperSignal, PaperStrategy, PaperStrategyContext } from './paper-strategy';

/** One-minute bars: the timeframe the whole rule is written in. */
const BAR_MS = 60_000;

/** Two seconds before the close of a one-minute candle. */
const FILL_OFFSET_MS = BAR_MS - 2_000;

/**
 * Candles held after the signal candle.
 *
 * Currently **2**, for testing. Set it to 3 for the original rule; nothing
 * else needs editing, because the name, the description and the exit reason
 * are all derived from this.
 */
export const HOLD_BARS = 2;

export const greenRetestHoldStrategy: PaperStrategy = {
  // Stable across a change of holding period — see the note above.
  id: 'green-retest-candles',
  name: `Green Retest ${HOLD_BARS}-Candle Buy`,
  description:
    'Buys when the retest overlay prints a green (bullish) retest on a 1-minute candle, ' +
    `entering 2 seconds before that candle closes, and sells 2 seconds before the ` +
    `${ordinal(HOLD_BARS)} candle after it closes. Long only, one trade at a time.`,

  // It reads the overlay's signals rather than the bars, so it is ready on the
  // first candle it is given one for.
  warmupBars: 0,
  needsRetests: true,
  fillOffsetMs: FILL_OFFSET_MS,
  // Every later green retest is another trade; without this the strategy would
  // take the first of the day and ignore the rest.
  continuous: true,

  // Nothing to tune. The holding period and the two seconds are the strategy —
  // exposing them as parameters would invite a "Green Retest 5-Candle" that
  // shared this one's name and its journal.
  paramSpecs: [],
  params: {},

  /**
   * No stop and no target: the exit is the clock.
   *
   * Returning levels here would create a second way out, and a trade that
   * stopped at 11:16 would not be this strategy's trade — the rule is three
   * candles, whatever they do. The risk is bounded by the holding period
   * instead of by a price, which is the bargain a fixed-duration strategy
   * makes.
   */
  plan(): PaperPlan {
    return { stopLoss: null, target: null };
  },

  /**
   * Enter when this closing candle is one the overlay marked green.
   *
   * The engine only offers a `CREATED` order to this method, and re-arms a new
   * one only after the previous trade has settled — so "no additional entry
   * before the current trade has exited" needs no check here. It is a property
   * of there only ever being one order outstanding.
   */
  entry(ctx: PaperStrategyContext): PaperSignal | null {
    // Closed bars only. A forming candle has not signalled yet, and its
    // "close" is just the last tick.
    if (!ctx.update.closed) return null;
    // Long only. The engine already refuses to invert a BUY, but stating it
    // means the strategy cannot be handed a short mandate and quietly comply.
    if (ctx.side !== 'BUY') return null;

    const bar = barOpenOf(ctx.update.timeMs);
    const signal = ctx.retests.find((retest) => retest.bullish && barOpenOf(retest.atMs) === bar);
    if (!signal) return null;

    return { reason: `green ${signal.scenario} retest on this candle` };
  },

  /**
   * Leave on the third candle after the one entered on.
   *
   * Measured from the entry candle's **open** rather than by counting updates,
   * so a bar the feed never delivered cannot shorten the hold: the test is
   * "has 11:17 arrived", not "have three messages arrived". `>=` rather than
   * `===` so a missing 11:17 exits on 11:18 instead of holding forever.
   */
  exit(ctx: PaperStrategyContext): PaperSignal | null {
    if (!ctx.update.closed) return null;

    const entryTime = ctx.position?.entryTime;
    if (entryTime === null || entryTime === undefined) return null;

    const entryBar = barOpenOf(entryTime);
    const dueBar = entryBar + HOLD_BARS * BAR_MS;
    if (barOpenOf(ctx.update.timeMs) < dueBar) return null;

    return { reason: `held ${HOLD_BARS} candles` };
  },
};

/**
 * The open of the one-minute candle an instant falls in.
 *
 * Applied to both sides of every comparison, which is what lets an entry
 * stamped 11:14:58 still be recognised as belonging to the 11:14 candle.
 */
function barOpenOf(epochMs: number): number {
  return Math.floor(epochMs / BAR_MS) * BAR_MS;
}

/** "second", "third" — so the description reads as a sentence at any hold. */
function ordinal(n: number): string {
  return ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth'][n] ?? `${n}th`;
}
