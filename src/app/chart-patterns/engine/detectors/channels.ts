import type { Candle, DetectedPattern, PatternDirection, PatternType, Pivot } from '../../types';
import { unitAt } from '../atr';
import {
  fitLine,
  firstCloseBeyond,
  lineValueAt,
  maxDeviation,
  equalityTolerance,
  type Line,
} from '../geometry';
import { blend, buildPattern, restsOnProvisional, timeAt, type DetectorContext } from './shared';

/**
 * Most a rectangle boundary may drift across the shape, as a share of its
 * height. See the rectangle branch of `classify` for why an ATR-relative
 * slope test is not enough on its own.
 */
const RECTANGLE_MAX_DRIFT = 0.15;

/** Longest run of pivots one channel is fitted over. Matches the triangles. */
const MAX_WINDOW = 8;

/**
 * Wedges and rectangles: the two boundary shapes that are not triangles.
 *
 * The same two fitted lines the triangle detector uses, classified by a
 * different reading of their slopes. A triangle has one flat boundary and one
 * sloping, or two sloping *towards* each other. The two shapes here are what
 * is left over:
 *
 * - **Wedge** — both boundaries slope the *same* way while closing in on each
 *   other. Price is still making progress and running out of room to do it,
 *   which is why a wedge points against its own slope: a rising wedge is
 *   bearish and a falling wedge bullish.
 * - **Rectangle** — both boundaries flat. A range, and the only shape here
 *   with no direction of its own until price leaves it.
 *
 * Sharing a file because they share every line of the expensive part: fitting
 * the boundaries, checking each pivot sits on its own line, and deciding what
 * a break of one means. Only the slope test and the labelling differ, and
 * splitting them would have meant maintaining that fitting code twice.
 *
 * ## Why a wedge must converge
 *
 * Two boundaries rising in parallel are a channel, not a wedge — price is
 * trending inside a corridor with no squeeze in it, and nothing about that
 * says the trend is tiring. Requiring the gap at the right edge to be
 * meaningfully narrower than at the left is what separates the two, and it is
 * the whole content of the pattern.
 */
export function detectChannels(context: DetectorContext): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const { pivots, config } = context;

  // Longest windows first, as the triangles do: a five-pivot wedge and the
  // four-pivot one inside it are one formation, and the fuller fit is the
  // better description of it.
  for (let size = MAX_WINDOW; size >= 4; size--) {
    for (let i = 0; i + size <= pivots.length; i++) {
      const pattern = evaluate(context, pivots.slice(i, i + size));
      if (pattern && config.enabledPatterns.includes(pattern.type)) out.push(pattern);
    }
  }

  return out;
}

function evaluate(context: DetectorContext, window: readonly Pivot[]): DetectedPattern | null {
  const { candles, atrs, config } = context;
  const first = window[0] as Pivot;
  const last = window[window.length - 1] as Pivot;

  const span = last.index - first.index;
  if (span < config.minBars || span > config.maxBars) return null;

  const unit = unitAt(atrs, last.index);
  if (unit === null) return null;

  const highs = window.filter((p) => p.kind === 'high');
  const lows = window.filter((p) => p.kind === 'low');
  // Two touches is the fewest that define a line. One is a point, and a
  // boundary through one point has whatever slope you care to give it.
  if (highs.length < 2 || lows.length < 2) return null;

  const points = (ps: readonly Pivot[]) => ps.map((p) => ({ index: p.index, price: p.price }));
  const upper = fitLine(points(highs));
  const lower = fitLine(points(lows));
  if (!upper || !lower) return null;

  const leftGap = lineValueAt(upper, first.index) - lineValueAt(lower, first.index);
  const rightGap = lineValueAt(upper, last.index) - lineValueAt(lower, last.index);
  // The upper boundary has to stay above the lower one across the shape, or
  // the two lines have crossed and this is not a channel at all.
  if (leftGap <= 0 || rightGap <= 0) return null;

  const tol = equalityTolerance(unit, leftGap, config.priceTolAtr, config.equalityHeightPct / 2);
  if (maxDeviation(upper, points(highs)) > tol) return null;
  if (maxDeviation(lower, points(lows)) > tol) return null;

  const upperSlope = upper.slope / unit;
  const lowerSlope = lower.slope / unit;
  const flat = config.flatSlope;

  const classified = classify({
    upperSlope,
    lowerSlope,
    flat,
    leftGap,
    rightGap,
    upperLeft: lineValueAt(upper, first.index),
    upperRight: lineValueAt(upper, last.index),
    lowerLeft: lineValueAt(lower, first.index),
    lowerRight: lineValueAt(lower, last.index),
    unit,
    config,
  });
  if (!classified) return null;
  const { type, direction: intrinsic, expected } = classified;

  /**
   * A rectangle needs a level tested more than twice.
   *
   * Two highs and two lows is the fewest that define any pair of boundaries,
   * and on exactly that many pivots a "range" is indistinguishable from a
   * double top or double bottom — same four points, same two levels. Those
   * names are more specific and say what price did next, so the tie goes to
   * them and a rectangle has to earn its reading with a fifth touch.
   *
   * Wedges are exempt: their claim is the squeeze between two sloping lines,
   * which four pivots describe perfectly well and no other pattern here
   * competes for.
   */
  if (type === 'rectangle' && highs.length + lows.length < 5) return null;

  /* --- status ------------------------------------------------------- */
  const from = last.index + 1;
  const upIndex = firstCloseBeyond(candles, from, (i) => lineValueAt(upper, i), 'above');
  const downIndex = firstCloseBeyond(candles, from, (i) => lineValueAt(lower, i), 'below');

  let breakIndex: number | null = null;
  let breakSide: 'up' | 'down' | null = null;
  if (upIndex !== null && (downIndex === null || upIndex < downIndex)) {
    breakIndex = upIndex;
    breakSide = 'up';
  } else if (downIndex !== null) {
    breakIndex = downIndex;
    breakSide = 'down';
  }

  // A rising wedge that breaks upward has not confirmed a bearish reading —
  // it has failed. Reporting it as confirmed while it points the wrong way
  // would be worse than saying nothing, which is the rule the triangles keep.
  if (expected !== null && breakSide !== null && breakSide !== expected) return null;

  const anchors = [...window];
  const provisional = restsOnProvisional(anchors);
  const status = breakIndex !== null && !provisional ? 'confirmed' : 'forming';
  if (status === 'forming' && !config.showForming) return null;

  const direction: PatternDirection =
    intrinsic ?? (breakSide === 'up' ? 'bullish' : breakSide === 'down' ? 'bearish' : 'neutral');

  /* --- geometry ------------------------------------------------------ */
  const endIndex = breakIndex ?? candles.length - 1;
  // Measured from the widest part, which is the left edge of a wedge and
  // either edge of a rectangle.
  const height = Math.max(leftGap, rightGap);
  const target =
    breakIndex === null
      ? undefined
      : breakSide === 'up'
        ? (candles[breakIndex] as Candle).close + height
        : (candles[breakIndex] as Candle).close - height;

  const lines: DetectedPattern['lines'] = [
    boundary(candles, upper, first.index, endIndex, 'resistance'),
    boundary(candles, lower, first.index, endIndex, 'support'),
  ];

  if (config.showTargets && target !== undefined && breakIndex !== null) {
    lines.push({
      from: { time: timeAt(candles, breakIndex), price: target },
      to: { time: timeAt(candles, endIndex), price: target },
      role: 'target',
    });
  }

  /* --- confidence ---------------------------------------------------- */
  const touches = highs.length + lows.length;
  const fit =
    1 -
    Math.min(
      1,
      Math.max(maxDeviation(upper, points(highs)), maxDeviation(lower, points(lows))) / tol,
    );
  // For a wedge, how much of the width the squeeze took out. For a rectangle,
  // how parallel the two boundaries stayed — which is the same number read
  // the other way round, so one expression serves both.
  const convergence = 1 - Math.min(1, rightGap / leftGap);
  const shapeliness = type === 'rectangle' ? 1 - Math.min(1, Math.abs(convergence)) : convergence;

  const confidence = blend([
    { value: fit, weight: 3 },
    { value: Math.min(1, (touches - 4) / 4 + 0.5), weight: 2 },
    { value: shapeliness, weight: 2 },
  ]);

  return buildPattern({
    type,
    direction,
    status,
    anchors,
    lines,
    labelAnchor: { time: last.time, price: lineValueAt(upper, last.index) },
    placement: direction === 'bearish' ? 'above' : 'below',
    startTime: first.time,
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

/**
 * Which shape the two slopes describe, if either.
 *
 * `direction` is the reading the shape carries on its own; `null` means it has
 * none until price leaves, which is true of a rectangle and of nothing else
 * here. `expected` is the break that would confirm it rather than break it.
 */
function classify(input: {
  upperSlope: number;
  lowerSlope: number;
  flat: number;
  leftGap: number;
  rightGap: number;
  upperLeft: number;
  upperRight: number;
  lowerLeft: number;
  lowerRight: number;
  unit: number;
  config: DetectorContext['config'];
}): {
  type: PatternType;
  direction: PatternDirection | null;
  expected: 'up' | 'down' | null;
} | null {
  const {
    upperSlope,
    lowerSlope,
    flat,
    leftGap,
    rightGap,
    upperLeft,
    upperRight,
    lowerLeft,
    lowerRight,
    unit,
    config,
  } = input;

  const bothRising = upperSlope > flat && lowerSlope > flat;
  const bothFalling = upperSlope < -flat && lowerSlope < -flat;
  const bothFlat = Math.abs(upperSlope) <= flat && Math.abs(lowerSlope) <= flat;

  if (bothRising || bothFalling) {
    // Converging, and by enough to see. A tenth is the least squeeze that
    // reads as one rather than as two lines drawn a little unevenly.
    if (rightGap > leftGap * 0.9) return null;
    return bothRising
      ? { type: 'rising_wedge', direction: 'bearish', expected: 'down' }
      : { type: 'falling_wedge', direction: 'bullish', expected: 'up' };
  }

  if (bothFlat) {
    // A range has to be worth ranging in. See `rectangleMinHeightAtr`.
    if (leftGap < config.rectangleMinHeightAtr * unit) return null;
    // And the two boundaries have to stay level *against the range's own
    // height*, which the ATR slope test above cannot see. A shape thirty
    // points tall whose floor drops six is drifting by a fifth of itself
    // while every slope in it still reads as flat in ATRs — a broadening
    // formation, or the back half of a double top, and calling it a range
    // was suppressing the better reading of those bars.
    const drift = (a: number, b: number) => Math.abs(b - a);
    const limit = leftGap * RECTANGLE_MAX_DRIFT;
    if (drift(upperLeft, upperRight) > limit) return null;
    if (drift(lowerLeft, lowerRight) > limit) return null;
    return { type: 'rectangle', direction: null, expected: null };
  }

  return null;
}

function boundary(
  candles: readonly Candle[],
  line: Line,
  fromIndex: number,
  toIndex: number,
  role: 'support' | 'resistance',
): DetectedPattern['lines'][number] {
  return {
    from: { time: timeAt(candles, fromIndex), price: lineValueAt(line, fromIndex) },
    to: { time: timeAt(candles, toIndex), price: lineValueAt(line, toIndex) },
    role,
  };
}
