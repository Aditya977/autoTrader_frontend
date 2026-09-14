import type { Candle, DetectedPattern, PatternDirection, PatternType, Pivot } from '../../types';
import { unitAt } from '../atr';
import {
  fitLine,
  firstCloseBeyond,
  intersectAt,
  lineValueAt,
  maxDeviation,
  equalityTolerance,
  type Line,
} from '../geometry';
import { blend, buildPattern, restsOnProvisional, timeAt, type DetectorContext } from './shared';

/** Longest run of pivots a single triangle is fitted over. */
const MAX_WINDOW = 8;

/**
 * Ascending, descending and symmetrical triangles.
 *
 * Two converging boundaries, each touched at least twice, with price squeezed
 * between them until it leaves. Which of the three it is falls out of the two
 * slopes: one flat and one rising is ascending, one falling and one flat is
 * descending, both closing in is symmetrical.
 *
 * ## Two rules that keep this from matching everything
 *
 * **Every touch must sit on its line.** A least-squares fit through four
 * scattered pivots always produces two lines; requiring each pivot to land
 * within `priceTolAtr` of its own fit is what makes them boundaries rather
 * than a regression through noise.
 *
 * **The apex must be ahead, and not far ahead.** Lines that diverge have no
 * apex and are not a triangle. Lines that converge a thousand bars out are
 * parallel in every practical sense, so the apex is required within 1.5× the
 * pattern's own width — which also stops a nearly-flat channel being read as a
 * triangle whose point happens to lie somewhere off the chart.
 */
export function detectTriangles(context: DetectorContext): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const { pivots, config } = context;

  // Longest windows first: a five-pivot triangle and the four-pivot one inside
  // it are the same formation, and the fuller description is the better one.
  // Post-processing drops the overlap, but preferring the longer fit here
  // means the survivor is the one with more evidence behind it.
  for (let size = MAX_WINDOW; size >= 4; size--) {
    for (let i = 0; i + size <= pivots.length; i++) {
      const window = pivots.slice(i, i + size);
      const pattern = evaluate(context, window);
      if (pattern && config.enabledPatterns.includes(pattern.type)) {
        out.push(pattern);
      }
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
  // Two touches is the minimum that defines a line at all. One touch is a
  // point, and a "boundary" through one point is whatever slope you like.
  if (highs.length < 2 || lows.length < 2) return null;

  const upper = fitLine(highs.map((p) => ({ index: p.index, price: p.price })));
  const lower = fitLine(lows.map((p) => ({ index: p.index, price: p.price })));
  if (!upper || !lower) return null;

  // How far a touch may sit off its boundary, judged against the height of
  // the triangle at its widest. Half the share the other detectors use: a
  // boundary is a line price kept returning to, and a loose one turns any
  // four scattered pivots into a triangle.
  const widest = lineValueAt(upper, first.index) - lineValueAt(lower, first.index);
  const tol = equalityTolerance(unit, widest, config.priceTolAtr, config.equalityHeightPct / 2);

  // Every touch on its own line, or these are not boundaries.
  if (
    maxDeviation(
      upper,
      highs.map((p) => ({ index: p.index, price: p.price })),
    ) > tol
  ) {
    return null;
  }
  if (
    maxDeviation(
      lower,
      lows.map((p) => ({ index: p.index, price: p.price })),
    ) > tol
  ) {
    return null;
  }

  // The upper boundary must actually be above the lower one across the shape.
  if (lineValueAt(upper, first.index) <= lineValueAt(lower, first.index)) return null;

  const upperSlope = upper.slope / unit;
  const lowerSlope = lower.slope / unit;
  const flat = config.flatSlope;

  let type: PatternType;
  if (Math.abs(upperSlope) <= flat && lowerSlope > flat) {
    type = 'ascending_triangle';
  } else if (upperSlope < -flat && Math.abs(lowerSlope) <= flat) {
    type = 'descending_triangle';
  } else if (upperSlope < -flat && lowerSlope > flat) {
    type = 'symmetrical_triangle';
  } else {
    return null;
  }

  // Converging, with the apex ahead of the shape and within reach of it.
  const apex = intersectAt(upper, lower);
  if (apex === null) return null;
  if (apex <= last.index) return null;
  if (apex - first.index > span * 1.5) return null;

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

  // An ascending triangle that breaks downward has not confirmed anything; it
  // has failed. Reporting it as a confirmed bullish pattern that happens to
  // point the wrong way would be worse than saying nothing.
  const expected: 'up' | 'down' | null =
    type === 'ascending_triangle' ? 'up' : type === 'descending_triangle' ? 'down' : null;
  if (expected !== null && breakSide !== null && breakSide !== expected) return null;

  const anchors = [...window];
  const provisional = restsOnProvisional(anchors);
  const status = breakIndex !== null && !provisional ? 'confirmed' : 'forming';
  if (status === 'forming' && !config.showForming) return null;

  const direction: PatternDirection =
    type === 'ascending_triangle'
      ? 'bullish'
      : type === 'descending_triangle'
        ? 'bearish'
        : breakSide === 'up'
          ? 'bullish'
          : breakSide === 'down'
            ? 'bearish'
            : 'neutral';

  /* --- geometry ------------------------------------------------------ */
  const endIndex = breakIndex ?? candles.length - 1;
  // Height at the widest point, which is the left edge of a converging shape.
  const height = lineValueAt(upper, first.index) - lineValueAt(lower, first.index);
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
      Math.max(
        maxDeviation(
          upper,
          highs.map((p) => ({ index: p.index, price: p.price })),
        ),
        maxDeviation(
          lower,
          lows.map((p) => ({ index: p.index, price: p.price })),
        ),
      ) / tol,
    );

  const confidence = blend([
    // How cleanly the touches sit on their boundaries.
    { value: fit, weight: 3 },
    // Six touches is a well-tested triangle; four is the minimum that counts.
    { value: Math.min(1, (touches - 4) / 4 + 0.5), weight: 2 },
    // An apex just past the shape is a tight, decisive squeeze; one at the far
    // end of the allowance is barely converging.
    { value: 1 - Math.min(1, (apex - last.index) / (span * 1.5)), weight: 1 },
  ]);

  return buildPattern({
    type,
    direction,
    status,
    anchors,
    lines,
    labelAnchor: {
      time: last.time,
      price: lineValueAt(upper, last.index),
    },
    placement: type === 'descending_triangle' ? 'below' : 'above',
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
