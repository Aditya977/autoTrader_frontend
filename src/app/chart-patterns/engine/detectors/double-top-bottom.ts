import type { Candle, DetectedPattern, Pivot } from '../../types';
import { unitAt } from '../atr';
import { firstCloseBeyond, closeness, equalityTolerance } from '../geometry';
import {
  blend,
  buildPattern,
  restsOnProvisional,
  symmetry,
  timeAt,
  type DetectorContext,
} from './shared';

/**
 * Double tops and double bottoms.
 *
 * Two attempts at the same level with a meaningful pullback between them, and
 * then a close through the level that pullback established. The neckline is
 * horizontal — at the trough for a top, at the peak for a bottom — because
 * that is the price the pattern is actually about: the level the market
 * defended twice and then gave up.
 *
 * ## What separates this from noise
 *
 * Three tests, and each rejects a different impostor. **Equality** of the two
 * extremes stops an ordinary higher high being read as a retest. **Depth** of
 * the trough stops two adjacent bars of chop counting as two attempts. **Span**
 * stops both a three-bar wiggle and a six-month range from wearing the name.
 *
 * Everything is measured in ATRs, so the same three tests work on a ₹120
 * option and a 23,000-point index.
 */
export function detectDoubleTopsAndBottoms(context: DetectorContext): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const { pivots, config } = context;

  for (let i = 0; i + 2 < pivots.length; i++) {
    const first = pivots[i] as Pivot;
    const middle = pivots[i + 1] as Pivot;
    const second = pivots[i + 2] as Pivot;

    const isTop = first.kind === 'high';
    // Pivots alternate, so this only fails if the caller handed us a list that
    // does not — which would make every window below meaningless.
    if (middle.kind === first.kind || second.kind !== first.kind) continue;

    const type = isTop ? 'double_top' : 'double_bottom';
    if (!config.enabledPatterns.includes(type)) continue;

    const pattern = evaluate(context, first, middle, second, isTop);
    if (pattern) out.push(pattern);
  }

  return out;
}

function evaluate(
  context: DetectorContext,
  first: Pivot,
  middle: Pivot,
  second: Pivot,
  isTop: boolean,
): DetectedPattern | null {
  const { candles, atrs, config } = context;
  const unit = unitAt(atrs, second.index);
  if (unit === null) return null;

  const span = second.index - first.index;
  if (span < config.minBars || span > config.maxBars) return null;

  // Depth of the trough between the two attempts. `min` for a top because the
  // shallower peak is the one that has to clear the trough; `max` for a
  // bottom, mirrored. Measured before equality, because the depth is the
  // height that equality is then judged against.
  const shoulderLevel = isTop
    ? Math.min(first.price, second.price)
    : Math.max(first.price, second.price);
  const depth = isTop ? shoulderLevel - middle.price : middle.price - shoulderLevel;
  if (depth < config.minDepthAtr * unit) return null;

  // Two peaks are the same peak if they differ by little against the
  // formation they belong to — not against a fixed multiple of ATR, which
  // rejects almost every real double top on a large swing.
  const tol = equalityTolerance(unit, depth, config.priceTolAtr, config.equalityHeightPct);
  if (Math.abs(first.price - second.price) > tol) return null;

  const neckline = middle.price;
  const anchors = [first, middle, second];

  /* --- status ------------------------------------------------------- */
  // Both races start at the bar after the second attempt: a close before it
  // belongs to the pattern being formed, not to its resolution.
  const from = second.index + 1;
  const breakIndex = firstCloseBeyond(candles, from, () => neckline, isTop ? 'below' : 'above');
  const failLevel = isTop
    ? Math.max(first.price, second.price) + tol
    : Math.min(first.price, second.price) - tol;
  const failIndex = firstCloseBeyond(candles, from, () => failLevel, isTop ? 'above' : 'below');

  // Whichever happened first decides. A pattern that broke its neckline and
  // later ran back through its own top is a completed pattern that then
  // reversed, not one that never existed.
  const failedFirst = failIndex !== null && (breakIndex === null || failIndex < breakIndex);
  if (failedFirst) return null;

  const provisional = restsOnProvisional(anchors);
  const status = breakIndex !== null && !provisional ? 'confirmed' : 'forming';
  if (status === 'forming' && !config.showForming) return null;

  /* --- geometry ------------------------------------------------------ */
  const endIndex = breakIndex ?? candles.length - 1;
  const level = (first.price + second.price) / 2;
  // The measured move: the pattern's own height, projected from the break.
  const target = isTop ? neckline - (level - neckline) : neckline + (neckline - level);

  const lines: DetectedPattern['lines'] = [
    { from: point(first), to: point(middle), role: 'outline' },
    { from: point(middle), to: point(second), role: 'outline' },
    {
      from: { time: first.time, price: neckline },
      to: { time: timeAt(candles, endIndex), price: neckline },
      role: 'neckline',
    },
  ];

  if (config.showTargets && breakIndex !== null) {
    lines.push({
      from: { time: timeAt(candles, breakIndex), price: target },
      to: { time: timeAt(candles, endIndex), price: target },
      role: 'target',
    });
  }

  /* --- confidence ---------------------------------------------------- */
  const confidence = blend([
    // How alike the two attempts were. The defining property, so it weighs most.
    { value: closeness(first.price, second.price, tol), weight: 3 },
    // How decisively price left the level between them. Capped at twice the
    // minimum: deeper than that is not more convincing, just bigger.
    {
      value: Math.min(1, depth / (config.minDepthAtr * unit * 2)),
      weight: 2,
    },
    // Two attempts spaced evenly around the trough read better than one that
    // happened immediately and one much later.
    {
      value: symmetry(middle.index - first.index, second.index - middle.index),
      weight: 1,
    },
  ]);

  return buildPattern({
    type: isTop ? 'double_top' : 'double_bottom',
    direction: isTop ? 'bearish' : 'bullish',
    status,
    anchors,
    lines,
    labelAnchor: { time: middle.time, price: isTop ? level : level },
    placement: isTop ? 'above' : 'below',
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
    ...(config.showTargets ? { target } : {}),
    confidence,
  });
}

const point = (pivot: Pivot) => ({ time: pivot.time, price: pivot.price });
