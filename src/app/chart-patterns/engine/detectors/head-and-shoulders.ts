import type { Candle, DetectedPattern, Pivot } from '../../types';
import { unitAt } from '../atr';
import { closeness, equalityTolerance, fitLine, firstCloseBeyond, lineValueAt } from '../geometry';
import {
  blend,
  buildPattern,
  restsOnProvisional,
  symmetry,
  timeAt,
  type DetectorContext,
} from './shared';

/**
 * Head and shoulders, and its mirror.
 *
 * Five pivots: a peak, a higher peak, a lower peak, with the two troughs
 * between them defining a neckline. Unlike a double top the neckline here is
 * *sloped* — it is fitted through both troughs — which is why confirmation has
 * to compare each close against the neckline's value **at that bar**, not
 * against a single number.
 *
 * ## The slope limit is not cosmetic
 *
 * A neckline steep enough is not a neckline at all, it is the trend. Left
 * unbounded, any ordinary decline offers five alternating pivots that satisfy
 * the shape tests, and every bar of it closes below a line drawn through two
 * of its own lows — so the detector would report a confirmed reversal
 * continuously, all the way down. `maxNecklineSlopeAtrPerBar` is what stops
 * that, and it is expressed per bar in ATRs so it means the same thing at one
 * minute and at one day.
 */
export function detectHeadAndShoulders(context: DetectorContext): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const { pivots, config } = context;

  for (let i = 0; i + 4 < pivots.length; i++) {
    const window = pivots.slice(i, i + 5) as Pivot[];
    const [leftShoulder, firstTrough, head, secondTrough, rightShoulder] = window as [
      Pivot,
      Pivot,
      Pivot,
      Pivot,
      Pivot,
    ];

    // Regular: high, low, high, low, high. Inverse: the mirror.
    const isRegular = leftShoulder.kind === 'high';
    const expected: ('high' | 'low')[] = isRegular
      ? ['high', 'low', 'high', 'low', 'high']
      : ['low', 'high', 'low', 'high', 'low'];
    if (window.some((p, k) => p.kind !== expected[k])) continue;

    const type = isRegular ? 'head_and_shoulders' : 'inverse_head_and_shoulders';
    if (!config.enabledPatterns.includes(type)) continue;

    const pattern = evaluate(
      context,
      { leftShoulder, firstTrough, head, secondTrough, rightShoulder },
      isRegular,
    );
    if (pattern) out.push(pattern);
  }

  return out;
}

interface Anatomy {
  leftShoulder: Pivot;
  firstTrough: Pivot;
  head: Pivot;
  secondTrough: Pivot;
  rightShoulder: Pivot;
}

function evaluate(
  context: DetectorContext,
  a: Anatomy,
  isRegular: boolean,
): DetectedPattern | null {
  const { candles, atrs, config } = context;
  const unit = unitAt(atrs, a.rightShoulder.index);
  if (unit === null) return null;

  const span = a.rightShoulder.index - a.leftShoulder.index;
  if (span < config.minBars || span > config.maxBars) return null;

  // The head must genuinely clear both shoulders. `beyond` reads "further in
  // the pattern's own direction", so the same arithmetic serves both mirrors.
  const beyond = (of: number, over: number) => (isRegular ? of - over : over - of);
  const headClearance = Math.min(
    beyond(a.head.price, a.leftShoulder.price),
    beyond(a.head.price, a.rightShoulder.price),
  );
  if (headClearance < config.headMinAtr * unit) return null;

  // Judged against how far the head stands above them, for the reason
  // `equalityTolerance` gives: a fixed ATR figure calls two shoulders
  // unequal on any formation big enough to be worth naming.
  const shoulderTol = equalityTolerance(
    unit,
    headClearance,
    config.shoulderTolAtr,
    config.equalityHeightPct,
  );
  const shoulderGap = Math.abs(a.leftShoulder.price - a.rightShoulder.price);
  if (shoulderGap > shoulderTol) return null;

  // Rough time symmetry. A "head and shoulders" whose right shoulder took five
  // times as long as its left is two different things drawn next to each other.
  const leftBars = a.head.index - a.leftShoulder.index;
  const rightBars = a.rightShoulder.index - a.head.index;
  const balance = symmetry(leftBars, rightBars);
  if (balance < 0.5) return null;

  const neckline = fitLine([
    { index: a.firstTrough.index, price: a.firstTrough.price },
    { index: a.secondTrough.index, price: a.secondTrough.price },
  ]);
  if (!neckline) return null;
  if (Math.abs(neckline.slope) / unit > config.maxNecklineSlopeAtrPerBar) return null;

  /* --- status ------------------------------------------------------- */
  const from = a.rightShoulder.index + 1;
  const breakIndex = firstCloseBeyond(
    candles,
    from,
    (i) => lineValueAt(neckline, i),
    isRegular ? 'below' : 'above',
  );
  // A close past the head says the shape failed: whatever this is, price never
  // turned where the pattern requires it to.
  const failIndex = firstCloseBeyond(
    candles,
    from,
    () => a.head.price,
    isRegular ? 'above' : 'below',
  );
  if (failIndex !== null && (breakIndex === null || failIndex < breakIndex)) {
    return null;
  }

  const anchors = [a.leftShoulder, a.firstTrough, a.head, a.secondTrough, a.rightShoulder];
  const provisional = restsOnProvisional(anchors);
  const status = breakIndex !== null && !provisional ? 'confirmed' : 'forming';
  if (status === 'forming' && !config.showForming) return null;

  /* --- geometry ------------------------------------------------------ */
  const endIndex = breakIndex ?? candles.length - 1;
  // Height is measured head-to-neckline **at the head's own bar**, then
  // projected from where the break actually happened. Measuring both against
  // one point would misstate the move by the neckline's own drift.
  const height = Math.abs(a.head.price - lineValueAt(neckline, a.head.index));
  const necklineAtBreak = lineValueAt(neckline, endIndex);
  const target = isRegular ? necklineAtBreak - height : necklineAtBreak + height;

  const lines: DetectedPattern['lines'] = [
    { from: point(a.leftShoulder), to: point(a.firstTrough), role: 'outline' },
    { from: point(a.firstTrough), to: point(a.head), role: 'outline' },
    { from: point(a.head), to: point(a.secondTrough), role: 'outline' },
    { from: point(a.secondTrough), to: point(a.rightShoulder), role: 'outline' },
    {
      from: {
        time: a.firstTrough.time,
        price: lineValueAt(neckline, a.firstTrough.index),
      },
      to: { time: timeAt(candles, endIndex), price: necklineAtBreak },
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
    // Equal shoulders are the hardest part of the shape to get by chance.
    {
      value: closeness(a.leftShoulder.price, a.rightShoulder.price, shoulderTol),
      weight: 3,
    },
    // A head that only just clears its shoulders is a triple top wearing the
    // wrong name; twice the minimum is treated as fully convincing.
    { value: Math.min(1, headClearance / (config.headMinAtr * unit * 2)), weight: 2 },
    { value: balance, weight: 2 },
    // A flat neckline is the textbook case; the limit is the worst allowed.
    {
      value: 1 - Math.min(1, Math.abs(neckline.slope) / unit / config.maxNecklineSlopeAtrPerBar),
      weight: 1,
    },
  ]);

  return buildPattern({
    type: isRegular ? 'head_and_shoulders' : 'inverse_head_and_shoulders',
    direction: isRegular ? 'bearish' : 'bullish',
    status,
    anchors,
    lines,
    labelAnchor: { time: a.head.time, price: a.head.price },
    placement: isRegular ? 'above' : 'below',
    startTime: a.leftShoulder.time,
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
