import type { Candle, Pivot } from '../types';

/**
 * Straight lines over the series, fitted and read in **bar index** space.
 *
 * Index, not time, and the difference matters on an intraday chart. A session
 * ends at 15:30 and the next opens at 09:15, so consecutive bars can be
 * seventeen hours apart in time and one step apart on screen. A slope fitted
 * against time would read the overnight gap as a near-vertical move and call
 * every boundary steep; fitted against index it measures what the eye sees.
 *
 * Times are put back on at the very end, when a line becomes something drawn.
 */
export interface Line {
  /** Price units per bar. */
  slope: number;
  /** Price at bar index 0 of the array the fit was performed on. */
  intercept: number;
}

/** Least squares through the points, x being the bar index. */
export function fitLine(points: readonly { index: number; price: number }[]): Line | null {
  const n = points.length;
  if (n === 0) return null;
  if (n === 1) {
    return { slope: 0, intercept: (points[0] as { price: number }).price };
  }

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.index;
    sumY += p.price;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let covariance = 0;
  let variance = 0;
  for (const p of points) {
    const dx = p.index - meanX;
    covariance += dx * (p.price - meanY);
    variance += dx * dx;
  }
  // Every point on one bar. A vertical line is not a boundary, and reporting
  // an infinite slope would poison every comparison downstream.
  if (variance === 0) return { slope: 0, intercept: meanY };

  const slope = covariance / variance;
  return { slope, intercept: meanY - slope * meanX };
}

export const lineValueAt = (line: Line, index: number): number =>
  line.intercept + line.slope * index;

/**
 * The bar index where two lines meet, or `null` when they never do.
 *
 * Used to place a triangle's apex. Parallel lines have no apex, which is why
 * a triangle whose boundaries do not converge is rejected rather than drawn
 * with its point at infinity.
 */
export function intersectAt(a: Line, b: Line): number | null {
  const denominator = a.slope - b.slope;
  if (Math.abs(denominator) < 1e-12) return null;
  return (b.intercept - a.intercept) / denominator;
}

/** Largest distance from any point to the line, in price. */
export function maxDeviation(
  line: Line,
  points: readonly { index: number; price: number }[],
): number {
  let worst = 0;
  for (const p of points) {
    const gap = Math.abs(p.price - lineValueAt(line, p.index));
    if (gap > worst) worst = gap;
  }
  return worst;
}

/**
 * The first bar at or after `from` whose **close** is beyond `level`.
 *
 * Close, never wick, and the whole engine depends on it. A wick through a
 * neckline is the level being tested; a close through it is the level being
 * broken. Counting wicks would confirm a head and shoulders on the first
 * nervous spike into the neckline and mark it broken on a bar that closed back
 * inside the pattern.
 */
export function firstCloseBeyond(
  candles: readonly Candle[],
  from: number,
  level: (index: number) => number,
  side: 'above' | 'below',
): number | null {
  for (let i = Math.max(0, from); i < candles.length; i++) {
    const close = (candles[i] as Candle).close;
    const at = level(i);
    if (side === 'above' ? close > at : close < at) return i;
  }
  return null;
}

/**
 * How far apart two levels may sit and still count as the same level.
 *
 * The larger of an ATR floor and a share of the shape’s own height. The
 * height term is what makes the rule scale-free: the same 10% reads as two
 * points on a twenty-point formation and twenty on a two-hundred-point one,
 * which is how a chart is actually read. The ATR floor only matters when the
 * height is near zero, where a percentage of nothing would demand exactness
 * that no real series delivers.
 */
export function equalityTolerance(
  atrUnit: number,
  height: number,
  priceTolAtr: number,
  heightPct: number,
): number {
  return Math.max(priceTolAtr * atrUnit, Math.abs(height) * heightPct);
}

/** Bars a pattern spans, from its first anchor to its last. */
export const barSpan = (pivots: readonly Pivot[]): number => {
  const first = pivots[0];
  const last = pivots[pivots.length - 1];
  if (!first || !last) return 0;
  return last.index - first.index;
};

/**
 * 1 when the two values are identical, falling to 0 as they part by `tol`.
 *
 * The scoring primitive the detectors share, so "how equal are these two tops"
 * means one thing across the engine rather than one thing per detector.
 */
export function closeness(a: number, b: number, tol: number): number {
  if (tol <= 0) return a === b ? 1 : 0;
  return Math.max(0, 1 - Math.abs(a - b) / tol);
}
