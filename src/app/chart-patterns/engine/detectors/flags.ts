import type { Candle, DetectedPattern, PatternType, Pivot } from '../../types';
import { unitAt } from '../atr';
import { fitLine, firstCloseBeyond, lineValueAt, maxDeviation } from '../geometry';
import { blend, buildPattern, restsOnProvisional, timeAt, type DetectorContext } from './shared';

/**
 * Most of its pole a flag's consolidation may be, measured at its widest.
 *
 * A third. The pole is the claim; the rest is meant to be a pause inside it,
 * and a pause as tall as half the move is the move turning round.
 */
const MAX_REST_SHARE_OF_POLE = 0.35;

/**
 * How steep a rest may be against its own pole, as a share of the pole slope.
 */
const MAX_REST_SLOPE_SHARE = 0.35;

/**
 * Flags and pennants: a sharp move, then a rest inside it.
 *
 * The only detectors here that are not fitted purely to pivots, and the reason
 * is the **pole**. A flag is not a shape on its own — it is a small
 * consolidation that means something because of the move immediately before
 * it. The same little channel after a quiet drift is a range and worth
 * nothing. So this looks for the move first and the shape second, which is the
 * reverse of how every other detector in this folder works.
 *
 * What separates the two names is only the outline of the rest:
 *
 * - **Flag** — the consolidation drifts inside two roughly parallel
 *   boundaries, usually leaning against the pole.
 * - **Pennant** — the consolidation converges instead, a small symmetrical
 *   triangle hanging off the pole.
 *
 * Both are continuations: the expected break is in the pole's direction, and a
 * break the other way is not a failed flag to be reported with a shrug, it is
 * not a flag.
 *
 * ## Why the consolidation is measured on bars, not pivots
 *
 * A flag is short by definition — often under twenty bars — and a swing
 * detector tuned to find the structure of a whole session will usually see no
 * pivots at all inside one. Reading the consolidation's highs and lows
 * directly is what lets a shape this small be found at the same scales that
 * find head and shoulders.
 */
export function detectFlags(context: DetectorContext): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const { candles, config } = context;

  // Every bar that could end a pole. The consolidation is then read forward
  // from it, so each flag is found once from its own pole rather than once
  // per bar inside it.
  //
  // From bar one, not from `poleMaxBars`: starting later skipped every flag
  // whose pole ran off the start of the series, which on a chart opened at a
  // gap is the first and most conspicuous one. `findPole` already clamps its
  // own search to the bars that exist.
  for (let poleEnd = 1; poleEnd < candles.length; poleEnd++) {
    const pattern = evaluateFrom(context, poleEnd);
    if (pattern && config.enabledPatterns.includes(pattern.type)) out.push(pattern);
  }

  return dropOverlapping(out);
}

/**
 * The best flag whose pole ends at `poleEnd`, over every plausible rest length.
 *
 * The rest is searched rather than fixed, and that is not an optimisation.
 * Fixing it at `flagMaxBars` meant the fitted channel always swallowed
 * whatever came after a shorter consolidation — including its own breakout —
 * so the boundaries were fitted through the very move they were supposed to
 * be broken by, and every genuine flag with a rest shorter than the maximum
 * was rejected for not fitting. A flag does not announce how long it intends
 * to rest.
 *
 * Stepping by two keeps the number of fits small. A flag whose rest is
 * seventeen bars rather than sixteen is the same flag, and the fit tolerance
 * absorbs the difference.
 */
function evaluateFrom(context: DetectorContext, poleEnd: number): DetectedPattern | null {
  const { candles, atrs, config } = context;
  const unit = unitAt(atrs, poleEnd);
  if (unit === null) return null;

  const pole = findPole(candles, poleEnd, unit, config);
  if (!pole) return null;

  const restStart = poleEnd + 1;
  const longest = Math.min(config.flagMaxBars, candles.length - restStart);
  if (longest < config.flagMinBars) return null;

  let best: DetectedPattern | null = null;
  for (let length = config.flagMinBars; length <= longest; length += 2) {
    const found = tryRest(context, pole, poleEnd, restStart + length - 1, unit);
    if (found && (!best || found.confidence > best.confidence)) best = found;
  }

  return best;
}

function tryRest(
  context: DetectorContext,
  pole: Pole,
  poleEnd: number,
  restEnd: number,
  unit: number,
): DetectedPattern | null {
  const { candles, config } = context;
  const restStart = poleEnd + 1;

  // A rest that gives back too much of the pole has undone the move it was
  // supposed to be pausing inside.
  //
  // Measured in a bare loop, and deliberately before anything is allocated.
  // This function runs once per bar of the series, so building the boundary
  // point arrays first — two arrays of thirty objects, five thousand times
  // over — cost more than every other detector in the engine put together.
  // Rejecting here keeps the common case allocation-free.
  let restLow = Infinity;
  let restHigh = -Infinity;
  for (let i = restStart; i <= restEnd; i++) {
    const bar = candles[i] as Candle;
    if (bar.low < restLow) restLow = bar.low;
    if (bar.high > restHigh) restHigh = bar.high;
  }

  const retraceLimit = pole.height * config.flagMaxRetrace;
  const worst = pole.direction === 'up' ? pole.top - restLow : restHigh - pole.bottom;
  if (worst > retraceLimit) return null;

  /* --- the outline of the rest -------------------------------------- */
  const highs: { index: number; price: number }[] = [];
  const lows: { index: number; price: number }[] = [];
  for (let i = restStart; i <= restEnd; i++) {
    const bar = candles[i] as Candle;
    highs.push({ index: i, price: bar.high });
    lows.push({ index: i, price: bar.low });
  }
  const upper = fitLine(highs);
  const lower = fitLine(lows);
  if (!upper || !lower) return null;

  const leftGap = lineValueAt(upper, restStart) - lineValueAt(lower, restStart);
  const rightGap = lineValueAt(upper, restEnd) - lineValueAt(lower, restEnd);
  if (leftGap <= 0 || rightGap <= 0) return null;

  // Fitted through every bar rather than a handful of pivots, so the bars have
  // to stay near their own boundary or this is a blob with two lines on it.
  const tol = Math.max(leftGap, rightGap) * 0.5;
  if (maxDeviation(upper, highs) > tol) return null;
  if (maxDeviation(lower, lows) > tol) return null;

  // The rest has to be small against the move it is resting from. This is the
  // gate that separates a flag from "some bars after a rise": a consolidation
  // half the height of its own pole is not a pause, it is a reversal forming.
  // Without it the detector found three flags on a plain double top and
  // shadowed the double top itself.
  if (Math.max(leftGap, rightGap) > pole.height * MAX_REST_SHARE_OF_POLE) return null;

  const converging = rightGap < leftGap * 0.7;
  const parallel = Math.abs(rightGap - leftGap) < leftGap * 0.5;
  if (!converging && !parallel) return null;

  /**
   * The rest has to lean against the pole, or at worst sit flat.
   *
   * Without this the detector's best find on any steadily falling series is a
   * "bear flag": fifteen bars of the decline become the pole, the next twenty
   * are a channel of roughly constant width sloping the same way, and every
   * geometric test passes. But that channel is not a pause in the move, it is
   * more of the move — and scoring 0.96 it shadowed the double top those bars
   * actually formed.
   *
   * A flag is a counter-trend drift. Allowing flat as well as against is the
   * only latitude here, because a genuine flag often goes sideways rather than
   * retracing at all.
   */
  const midSlope = (upper.slope + lower.slope) / 2;
  const withPole = (pole.direction === 'up' ? midSlope : -midSlope) / unit;
  if (withPole > config.flatSlope) return null;

  /**
   * And it has to be markedly flatter than the pole, either way.
   *
   * Steepness in ATRs cannot tell a flagpole from a trend, because on a smooth
   * run the ATR *is* the per-bar move — every leg of a steady ramp reads as
   * about one ATR per bar, so the absolute test passes for all of them. That
   * let flags form on ordinary trending legs and shadow the larger shapes
   * those legs belonged to.
   *
   * Comparing the rest against its own pole is scale-free and says the thing
   * that actually matters: a pause is a pause because it is slower than the
   * move it interrupts. A drift nearly as steep as the pole is a reversal, or
   * simply more trend.
   */
  const poleSlope = pole.height / Math.max(1, pole.bars);
  if (Math.abs(midSlope) > poleSlope * MAX_REST_SLOPE_SHARE) return null;

  const kind = converging ? 'pennant' : 'flag';
  const type: PatternType =
    pole.direction === 'up'
      ? kind === 'flag'
        ? 'bullish_flag'
        : 'bullish_pennant'
      : kind === 'flag'
        ? 'bearish_flag'
        : 'bearish_pennant';

  /* --- status ------------------------------------------------------- */
  const expected = pole.direction;
  const from = restEnd + 1;
  const line = expected === 'up' ? upper : lower;
  // Bounded: a flag that has not resolved within its own span again has
  // stopped being one. Unbounded, this scan alone cost the engine most of its
  // time budget — see `firstCloseBeyond`.
  const deadline = restEnd + config.flagMaxBars;
  const breakIndex = firstCloseBeyond(
    candles,
    from,
    (i) => lineValueAt(line, i),
    expected === 'up' ? 'above' : 'below',
    deadline,
  );

  // A rest that leaves against the pole is not a flag that failed; it is not
  // a flag. The pattern's entire claim is that the move resumes.
  const against = firstCloseBeyond(
    candles,
    from,
    (i) => lineValueAt(expected === 'up' ? lower : upper, i),
    expected === 'up' ? 'below' : 'above',
    deadline,
  );
  if (against !== null && (breakIndex === null || against < breakIndex)) return null;

  const status = breakIndex !== null ? 'confirmed' : 'forming';
  if (status === 'forming' && !config.showForming) return null;

  /* --- geometry ------------------------------------------------------ */
  // A flag that has not broken ends where its rest ends, not at the right edge
  // of the chart. The other detectors run to the last bar because their shapes
  // genuinely remain open; a flag has a deadline, and claiming the rest of the
  // series would let one forming flag overlap — and so suppress — every
  // pattern that formed after it.
  const endIndex = breakIndex ?? restEnd;
  // A flag's measured move is the pole again, from where price left the rest.
  const target =
    breakIndex === null
      ? undefined
      : expected === 'up'
        ? (candles[breakIndex] as Candle).close + pole.height
        : (candles[breakIndex] as Candle).close - pole.height;

  const lines: DetectedPattern['lines'] = [
    {
      from: { time: timeAt(candles, pole.start), price: pole.from },
      to: { time: timeAt(candles, poleEnd), price: pole.to },
      role: 'outline',
    },
    {
      from: { time: timeAt(candles, restStart), price: lineValueAt(upper, restStart) },
      to: { time: timeAt(candles, endIndex), price: lineValueAt(upper, endIndex) },
      role: 'resistance',
    },
    {
      from: { time: timeAt(candles, restStart), price: lineValueAt(lower, restStart) },
      to: { time: timeAt(candles, endIndex), price: lineValueAt(lower, endIndex) },
      role: 'support',
    },
  ];

  if (config.showTargets && target !== undefined && breakIndex !== null) {
    lines.push({
      from: { time: timeAt(candles, breakIndex), price: target },
      to: { time: timeAt(candles, endIndex), price: target },
      role: 'target',
    });
  }

  /* --- anchors ------------------------------------------------------- */
  // Synthesised rather than taken from the swing detector, because a flag is
  // usually too small to contain a pivot at the scale being scanned. They are
  // real bars and real extremes, which is what the id and the drawing need.
  const anchors: Pivot[] = [
    {
      index: pole.start,
      time: timeAt(candles, pole.start),
      price: pole.from,
      kind: expected === 'up' ? 'low' : 'high',
      provisional: false,
    },
    {
      index: poleEnd,
      time: timeAt(candles, poleEnd),
      price: pole.to,
      kind: expected === 'up' ? 'high' : 'low',
      // The pole's tip is only provisional while nothing has resolved after it.
      provisional: breakIndex === null,
    },
  ];
  if (restsOnProvisional(anchors) && status === 'confirmed') return null;

  /* --- confidence ---------------------------------------------------- */
  const steepness = Math.min(1, pole.height / unit / (config.poleMinAtr * 2));
  const tightness = 1 - Math.min(1, Math.max(leftGap, rightGap) / pole.height);
  const shallow = 1 - Math.min(1, worst / retraceLimit);

  const confidence = blend([
    // A pole that ran twice the minimum is a far better flag than one that
    // scraped in.
    { value: steepness, weight: 2 },
    // The rest should be small against the move it is resting from.
    { value: tightness, weight: 3 },
    // And should have given back little of it.
    { value: shallow, weight: 2 },
  ]);

  return buildPattern({
    type,
    direction: expected === 'up' ? 'bullish' : 'bearish',
    status,
    anchors,
    lines,
    labelAnchor: {
      time: timeAt(candles, restStart),
      price: expected === 'up' ? lineValueAt(upper, restStart) : lineValueAt(lower, restStart),
    },
    placement: expected === 'up' ? 'above' : 'below',
    startTime: timeAt(candles, pole.start),
    endTime: timeAt(candles, endIndex),
    ...(breakIndex !== null
      ? {
          breakout: {
            time: timeAt(candles, breakIndex),
            price: (candles[breakIndex] as Candle).close,
          },
        }
      : {}),
    ...(config.showTargets && target !== undefined ? { target } : {}),
    confidence,
  });
}

interface Pole {
  start: number;
  direction: 'up' | 'down';
  /** Price at the foot and the tip of the move. */
  from: number;
  to: number;
  height: number;
  /** Bars it took. */
  bars: number;
  /** Highest high and lowest low across it, for the retracement test. */
  top: number;
  bottom: number;
}

/**
 * The strongest move ending at `end`, if one is strong enough to be a pole.
 *
 * Searched over every start within `poleMaxBars` rather than a fixed length,
 * and the tallest qualifying one wins — a move does not announce how many bars
 * it intends to take, and fixing the length would find the same flag only when
 * its pole happened to match.
 */
function findPole(
  candles: readonly Candle[],
  end: number,
  unit: number,
  config: DetectorContext['config'],
): Pole | null {
  const tip = candles[end] as Candle;
  const minHeight = config.poleMinAtr * unit;
  const earliest = Math.max(0, end - config.poleMaxBars);

  // Scanned backwards from the tip, carrying the extremes as it goes. The
  // obvious version slices the leg and spreads it into `Math.max` for every
  // candidate start, which is fifteen allocations per bar and was measurably
  // the slowest thing in the whole engine — three hundred milliseconds over a
  // five-thousand-bar series against a fifty millisecond budget. Running
  // extremes give the same answer for one comparison per bar.
  let top = tip.high;
  let bottom = tip.low;
  let best: Pole | null = null;

  for (let start = end - 1; start >= earliest; start--) {
    const foot = candles[start] as Candle;
    if (foot.high > top) top = foot.high;
    if (foot.low < bottom) bottom = foot.low;

    const rise = tip.close - foot.open;
    const height = Math.abs(rise);
    if (height < minHeight) continue;
    // Steep enough to be a pole rather than a drift. See poleMinAtrPerBar.
    if (height < config.poleMinAtrPerBar * unit * (end - start)) continue;
    if (best && height <= best.height) continue;

    // A pole ends at its own extreme. If price has already come a quarter of
    // the move back off the high, the rest started earlier and this bar is
    // somewhere inside it rather than at its tip — the same flag would then be
    // found from a dozen neighbouring bars, all but one of them describing the
    // pole wrongly. Rejecting them is most of what brings this detector inside
    // the engine's time budget, and it is the right rule regardless.
    const endsAtExtreme =
      rise > 0 ? tip.close >= top - height * 0.25 : tip.close <= bottom + height * 0.25;
    if (!endsAtExtreme) continue;

    best = {
      start,
      direction: rise > 0 ? 'up' : 'down',
      from: foot.open,
      to: tip.close,
      height,
      bars: end - start,
      top,
      bottom,
    };
  }

  return best;
}

/**
 * Keeps the best flag out of any group describing the same rest.
 *
 * Scanning every bar that could end a pole finds the same consolidation from
 * several poles of slightly different lengths. They are one observation, and
 * the fullest-scoring version of it is the one worth keeping. The engine's own
 * deduplication would eventually do this, but it compares across families and
 * would let a weaker flag survive beside a stronger one it fully contains.
 */
function dropOverlapping(patterns: readonly DetectedPattern[]): DetectedPattern[] {
  const kept: DetectedPattern[] = [];
  for (const candidate of [...patterns].sort((a, b) => b.confidence - a.confidence)) {
    const clash = kept.some(
      (existing) =>
        candidate.startTime <= existing.endTime && existing.startTime <= candidate.endTime,
    );
    if (!clash) kept.push(candidate);
  }
  return kept;
}
