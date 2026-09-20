/**
 * 21 EMA Breakout → Retest → Reclaim, targeting the 14 EMA.
 *
 * ```
 *        focus high ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┄┄┄ reclaimed → BUY
 *                    ╱╲                            ╱
 *   breakout ──────╱    ╲  pullback              ╱
 *   close > 21EMA╱        ╲                    ╱
 *   ┄┄┄┄┄┄┄┄┄┄┄╱┄┄┄┄┄┄┄┄┄┄┄╲┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╱┄┄┄ 21 EMA
 *             │             ╲______________╱
 *   SL = breakout candle's open
 * ```
 *
 * ## The rule this file refuses to implement
 *
 * "Price must come back and touch the 21 EMA." It is the obvious rule, it is
 * easy to code, and it is wrong in both directions: it throws away the setup
 * where price held two ticks above the average and ran, and it accepts the one
 * where price sliced straight through and kept going. A touch is a
 * coincidence of where the average happens to sit on that bar.
 *
 * What is asked instead is whether the *structure* happened:
 *
 * 1. a candle **breaks through** the 21 EMA and closes above it — it must have
 *    been below, or nothing was broken;
 * 2. price makes an initial push, and the last bullish candle before it stalls
 *    leaves a high worth remembering — the **focus price**;
 * 3. price **pulls back**, giving some of that up, anywhere around the average —
 *    above it, onto it, or through it;
 * 4. price **reclaims** the focus price.
 *
 * Step 4 is the confirmation and it is the one that cannot be faked. Up-then-
 * down is not a retest, and neither is a pullback that never comes back: both
 * die at the reclaim, which is exactly why the reclaim is the entry rather
 * than the pullback. Nothing here tries to find an N where price did not draw
 * one — if the reclaim has not happened by the end of the window, there is no
 * trade and the setup is abandoned.
 *
 * ## Where the numbers come from
 *
 * The EMAs are the chart's own {@link ema}, the same function the 14 and 21
 * lines are drawn with, so a user who switches those two on is looking at the
 * exact series this strategy reasons about. A second implementation here would
 * drift from the drawing by a bar or a seeding convention and nobody would be
 * able to tell which was lying.
 */

import { ema } from '../../chart-indicators/ema';
import type {
  PaperBar,
  PaperPlan,
  PaperSignal,
  PaperStrategy,
  PaperStrategyContext,
} from './paper-strategy';

/** The breakout reference. */
const CONTEXT_EMA = 21;
/** The target. */
const TARGET_EMA = 14;

/** What the detector found, when it found one. */
export interface EmaRetestSetup {
  /** Index of the breakout candle (Candle 1) in the bars given. */
  breakoutIndex: number;
  /** Index of the bullish candle whose high became the focus price. */
  focusIndex: number;
  /** The high to reclaim. */
  focusPrice: number;
  /** Index of the first pullback candle. */
  pullbackIndex: number;
  /** Deepest price of the pullback. */
  pullbackLow: number;
  /** Open of the breakout candle — the stop. */
  stopLoss: number;
  /**
   * The 14 EMA at the reclaim bar, wherever it happens to be.
   *
   * Not yet "the target": whether it is one depends on which side of price it
   * sits, which is {@link PaperStrategy.plan}'s decision rather than the
   * detector's. `null` only before the average is warm.
   */
  ema14: number | null;
  /** Close of the reclaim bar — the fill. */
  entryPrice: number;
}

export const emaRetestReclaimStrategy: PaperStrategy = {
  id: 'ema-retest-reclaim',
  name: '21 EMA Retest Reclaim',
  description:
    'Buys when price breaks above the 21 EMA, pulls back toward it, and then reclaims the high ' +
    'of the last bullish candle before that pullback — an N-shape. Stop at the breakout ' +
    'candle’s open, target the 14 EMA. No exact EMA touch is required.',

  // The 21 EMA needs 21 bars, and deciding that a candle *broke through* needs
  // the bar before it as well.
  warmupBars: CONTEXT_EMA + 1,
  continuous: true,

  paramSpecs: [
    {
      key: 'window',
      label: 'Retest window',
      description:
        'Candles after the breakout in which the reclaim must happen. Past this the setup is ' +
        'stale: the market has stopped reacting to the level it broke.',
      min: 2,
      max: 12,
      step: 1,
    },
    {
      key: 'pullbackReach',
      label: 'Pullback reach',
      description:
        'How far above the 21 EMA a pullback may stall and still count as having reached the ' +
        'area, measured in breakout-candle ranges. Higher is more permissive. This is the knob ' +
        'that replaces "must touch the EMA".',
      min: 0,
      max: 5,
      step: 0.25,
    },
  ],

  params: { window: 4, pullbackReach: 1 },

  /**
   * The stop is the breakout candle's open, and nothing moves it.
   *
   * Re-derived rather than remembered, because a strategy holds no state
   * between bars — that is what lets a replay of the same bars produce the
   * same ledger. The detector is deterministic, so running it again at the
   * fill finds the same breakout candle it found a moment ago in {@link entry}.
   */
  plan(ctx: PaperStrategyContext): PaperPlan {
    const setup = findSetup(ctx);
    if (!setup) return { stopLoss: null, target: null };
    // Armed only when the average is overhead. Handing the engine a target
    // below the fill would close the trade on the spot, at a price the market
    // never offered on the way up. When it is underneath, the 14 EMA is still
    // the exit — reached the other way round, which {@link exit} handles.
    const ahead = setup.ema14 !== null && setup.ema14 > setup.entryPrice;
    return { stopLoss: setup.stopLoss, target: ahead ? setup.ema14 : null };
  },

  entry(ctx: PaperStrategyContext): PaperSignal | null {
    if (!ctx.update.closed) return null;
    // Long only.
    if (ctx.side !== 'BUY') return null;

    const setup = findSetup(ctx);
    if (!setup) return null;

    return {
      reason:
        `reclaimed ${setup.focusPrice.toFixed(2)} after a ${CONTEXT_EMA} EMA breakout ` +
        `and pullback`,
    };
  },

  /**
   * The 14 EMA, reached from above.
   *
   * The rule is "the target is reached when price touches the 14 EMA", and a
   * long can arrive at that line from either side. Overhead, it is a profit
   * objective and the engine's own target machinery fills it exactly — see
   * {@link retarget}. Underneath, price is extended above the average and the
   * same line becomes the level it falls back to, which is the classic way of
   * riding a fast EMA and is still, literally, touching it.
   *
   * Never on the entry bar itself. A reclaim that closes well clear of the
   * average would otherwise be opened and closed by the same candle, booking a
   * round trip that never happened.
   */
  exit(ctx: PaperStrategyContext): PaperSignal | null {
    if (!ctx.update.closed) return null;
    if ((ctx.position?.marksHeld ?? 0) < 1) return null;

    const level = emaAt(ctx.bars, TARGET_EMA);
    if (level === null) return null;

    // Overhead of the entry is the engine's target to fill, not this one's —
    // see {@link retarget}. Only the fall-back case is handled here.
    const entry = ctx.position?.entryPrice ?? ctx.price;
    if (level > entry) return null;

    // Reached is about the bar's *range*, not its close. Asking whether the
    // close finished under the average would miss the bar that traded down
    // onto it and recovered, which is the touch the rule is about.
    const low = ctx.update.low ?? ctx.price;
    if (low > level) return null;

    return { reason: `touched the ${TARGET_EMA} EMA` };
  },

  /**
   * The 14 EMA, as it stands on this bar.
   *
   * Armed against the **entry**, not against the current price, and the
   * difference is the whole correctness of the thing. Measured against the
   * current price, the target disarms itself on precisely the bar that reaches
   * it: a candle whose high trades through the average and then closes above
   * it leaves `price > ema`, the target is withdrawn a moment before the
   * engine tests it, and the exit that did happen is recorded as something
   * else. Measured against the entry, a level that was overhead when the trade
   * was taken stays the target until it is hit.
   *
   * `null` when the average is not above the entry at all. That is not this
   * trade's target — price is extended above the line rather than travelling
   * to it — and handing the engine a level under the fill would close the
   * position instantly at a price the market never offered. {@link exit} picks
   * that case up as a touch from above instead.
   *
   * With no position yet — at plan time, or in a test — the current price
   * stands in for the entry, which is what it is about to become.
   */
  retarget(ctx: PaperStrategyContext): number | null {
    const target = emaAt(ctx.bars, TARGET_EMA);
    if (target === null) return null;
    const reference = ctx.position?.entryPrice ?? ctx.price;
    return target > reference ? target : null;
  },
};

/* -------------------------------------------------------------------------
 * The detector
 * ---------------------------------------------------------------------- */

/**
 * Whether the bar that just closed completes a valid setup.
 *
 * Exported because it is the strategy: the timing around it is four lines, and
 * everything worth testing — which pullbacks count, which reclaims count, what
 * kills a setup — lives here where a test can reach it with a hand-built
 * series instead of through an engine.
 *
 * Reads backwards from the newest bar and returns the most recent breakout
 * that the newest bar completes, or `null`. Deterministic and stateless: the
 * same bars always give the same answer, which is what lets {@link
 * PaperStrategy.plan} re-run it at the fill and get the same setup.
 */
export function findSetup(ctx: PaperStrategyContext): EmaRetestSetup | null {
  const bars = ctx.bars;
  const n = bars.length - 1;
  if (n < CONTEXT_EMA) return null;

  const window = Math.round(ctx.params['window'] ?? 4);
  const reach = ctx.params['pullbackReach'] ?? 1;

  const context = emaSeries(bars, CONTEXT_EMA);
  const now = bars[n]!;

  // The most recent breakout first: if two are in range, the setup belongs to
  // the one price is actually reacting to.
  for (let b = n - 1; b >= n - window && b >= 1; b--) {
    const setup = evaluate(bars, context, b, n, reach);
    if (setup) {
      // Where the 14 EMA sits is recorded but not judged here: it decides how
      // the trade *ends*, not whether the structure happened, and conflating
      // the two would throw away a textbook reclaim for standing in the wrong
      // place relative to an average it never referenced.
      return { ...setup, ema14: emaAt(bars, TARGET_EMA), entryPrice: now.close };
    }
  }

  return null;
}

/** One candidate breakout, judged against the bar that just closed. */
function evaluate(
  bars: readonly PaperBar[],
  context: readonly (number | null)[],
  b: number,
  n: number,
  reach: number,
): Omit<EmaRetestSetup, 'ema14' | 'entryPrice'> | null {
  const emaAtBreak = context[b];
  const emaBefore = context[b - 1];
  if (emaAtBreak === null || emaBefore === null) return null;

  const breakout = bars[b]!;
  const previous = bars[b - 1]!;

  // 1. Broke *through*. Closing above an average it was already above breaks
  //    nothing — that is a candle in a trend, not a breakout.
  if (!(breakout.close > emaAtBreak)) return null;
  if (!(previous.close <= emaBefore)) return null;

  // 2. The focus price: the last bullish candle before price first gives
  //    ground. Scanning forward from the breakout candle, which is itself a
  //    candidate — most often it *is* the one, because the pullback starts on
  //    the bar straight after the break.
  let pullbackIndex = -1;
  for (let i = b + 1; i <= n; i++) {
    if (bars[i]!.close < bars[i - 1]!.close) {
      pullbackIndex = i;
      break;
    }
  }
  // 3. No pullback yet: price has gone straight up and there is nothing to
  //    retest. Not a failure, just not finished.
  if (pullbackIndex < 0) return null;

  const focusIndex = pullbackIndex - 1;
  const focus = bars[focusIndex]!;
  // The reference has to be a bullish candle. Where the candle before the
  // pullback closed red there is no "last green candle before it stalled", and
  // inventing one by walking further back would be drawing the N rather than
  // finding it.
  if (!(focus.close > focus.open)) return null;

  const focusPrice = focus.high;

  // 4. The reclaim has to be a later bar than the pullback, and it is a close
  //    above the focus price rather than a wick through it: a bar that poked
  //    above and closed back under did not reclaim anything.
  if (n <= pullbackIndex) return null;
  const now = bars[n]!;
  if (!(now.close > focusPrice)) return null;

  // 5. The pullback itself. Deepest point between the focus candle and the
  //    reclaim.
  let pullbackLow = Infinity;
  for (let i = pullbackIndex; i < n; i++) pullbackLow = Math.min(pullbackLow, bars[i]!.low);
  if (!Number.isFinite(pullbackLow)) return null;

  // It has to have given something back. A "pullback" whose low never dips
  // under the focus candle's own close is a pause, and treating it as a
  // retest is how up-then-sideways becomes a signal.
  if (!(pullbackLow < focus.close)) return null;

  // And it has to have come back to the area of the average — *the area*, not
  // the line. The tolerance is a multiple of the breakout candle's own range,
  // so it scales with how violent the break was instead of being a number of
  // points that means something different on every instrument. Below the
  // average is always near enough; above it, this is how far is still near.
  const emaNow = context[n];
  if (emaNow === null) return null;
  const range = Math.max(breakout.high - breakout.low, 0);
  if (!(pullbackLow <= emaNow + reach * range)) return null;

  // 6. The stop has to be a stop: below the fill, and never touched on the way
  //    here. A setup whose stop already traded is one the trade would have
  //    been carried out of before this bar arrived.
  const stopLoss = breakout.open;
  if (!(stopLoss < now.close)) return null;
  // From the bar *after* the breakout. The breakout candle's own low is below
  // its open on almost every bullish break — that dip is how the candle got
  // going, not the setup failing — and counting it would reject essentially
  // every valid setup there is.
  for (let i = b + 1; i <= n; i++) {
    if (bars[i]!.low <= stopLoss) return null;
  }

  return { breakoutIndex: b, focusIndex, focusPrice, pullbackIndex, pullbackLow, stopLoss };
}

/* -------------------------------------------------------------------------
 * EMA helpers — the chart's own function, aligned to the bars given
 * ---------------------------------------------------------------------- */

/** The EMA at each bar, `null` until the average has enough history. */
function emaSeries(bars: readonly PaperBar[], period: number): (number | null)[] {
  const points = ema(
    bars.map((bar) => ({ time: bar.timeMs, close: bar.close })),
    period,
  );
  const byTime = new Map(points.map((point) => [point.time, point.value]));
  return bars.map((bar) => byTime.get(bar.timeMs) ?? null);
}

/** The EMA on the newest bar, or `null` if it is not warm yet. */
function emaAt(bars: readonly PaperBar[], period: number): number | null {
  const points = ema(
    bars.map((bar) => ({ time: bar.timeMs, close: bar.close })),
    period,
  );
  return points.at(-1)?.value ?? null;
}
