/**
 * The vocabulary the pattern engine speaks.
 *
 * Nothing here imports Angular or the charting library, and nothing here knows
 * what a pixel is. The engine is a pure function from candles to patterns so it
 * can be tested without a DOM, profiled without a chart, and moved server-side
 * later without being rewritten.
 *
 * ## The one rule these types exist to enforce
 *
 * **A pattern is anchored by time and price, never by array index or pixel.**
 * Indices shift the moment older history is prepended to the series; pixels
 * change on every pan and zoom. A `DetectedPattern` that carried either would
 * be drawn in the wrong place the first time the user scrolled, and nothing in
 * the drawing code could tell that it had happened.
 *
 * `Pivot.index` is the one exception, and it is deliberate: it is an index into
 * the exact array the detector was handed, used while detecting and never
 * afterwards. Every field that survives into rendering carries a time.
 */

/**
 * One bar, at whatever timeframe is being examined.
 *
 * Structurally compatible with the chart's own `Bar`, so the resampled series
 * the chart is already drawing can be passed straight in. That matters more
 * than it looks: detecting on one series and drawing on another is how an
 * overlay ends up describing bars that are not on screen.
 */
export interface Candle {
  /** Bar **open** time, epoch seconds UTC — the chart's own x value. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** A confirmed turn in the series: a swing high or a swing low. */
export interface Pivot {
  /** Index into the candle array this was found in. Internal to detection. */
  index: number;
  /** Bar open time. This is what survives into a rendered pattern. */
  time: number;
  /** The extreme itself — the bar's high for a high, its low for a low. */
  price: number;
  kind: 'high' | 'low';
  /**
   * True while price has not yet moved far enough away to prove this is a turn.
   *
   * The newest pivot is always provisional: standing on an extreme, nobody
   * knows it is one. Detectors may use a provisional pivot only for a
   * `forming` pattern — treating it as confirmed is the quietest form of
   * lookahead there is, because the result looks identical until it is traded.
   */
  provisional: boolean;
}

export type PatternType =
  | 'double_top'
  | 'double_bottom'
  | 'head_and_shoulders'
  | 'inverse_head_and_shoulders'
  | 'ascending_triangle'
  | 'descending_triangle'
  | 'symmetrical_triangle';

export type PatternDirection = 'bullish' | 'bearish' | 'neutral';

/**
 * Where a pattern stands.
 *
 * `forming` — the shape is there and price has not yet broken its level.
 * `confirmed` — a **close** has gone beyond the level, in the expected
 * direction. `invalidated` — the shape failed before it confirmed.
 *
 * Every transition is decided on a candle close rather than a wick. A wick
 * through a neckline is a test of it; a close through it is a break, and the
 * difference is most of what separates a real signal from a shadow.
 */
export type PatternStatus = 'forming' | 'confirmed' | 'invalidated';

export interface ChartPoint {
  time: number;
  price: number;
}

/**
 * One drawn segment.
 *
 * `role` decides how it is painted, so the renderer holds no pattern-specific
 * knowledge: an outline is solid in the pattern's colour, a neckline is dashed
 * and neutral, a target is thin and dashed.
 */
export interface PatternLine {
  from: ChartPoint;
  to: ChartPoint;
  role: 'outline' | 'neckline' | 'support' | 'resistance' | 'target';
}

export interface PatternLabel {
  /** `Double bottom · Bullish · Confirmed` */
  text: string;
  anchor: ChartPoint;
  placement: 'above' | 'below';
}

export interface DetectedPattern {
  /**
   * Stable across recomputations: a hash of the type and the anchor pivots'
   * times.
   *
   * This is what lets the live tracker update an overlay in place instead of
   * removing and re-adding it. An id derived from anything that moves — an
   * array position, a counter, the current bar — would make every recompute
   * look like a brand-new pattern, and the chart would flicker once per bar.
   */
  id: string;
  type: PatternType;
  direction: PatternDirection;
  status: PatternStatus;
  /** Time of the first anchor pivot. */
  startTime: number;
  /** Time of the last anchor pivot, or of the breakout once there is one. */
  endTime: number;
  /** The key points, in the order the pattern reads them. */
  pivots: Pivot[];
  lines: PatternLine[];
  label: PatternLabel;
  /** Where the confirming close happened. Absent while forming. */
  breakout?: ChartPoint;
  /** The measured move, in price. Absent when it cannot be computed. */
  target?: number;
  /** 0..1. How well the shape fits its own definition — never a probability. */
  confidence: number;
}

/** Human-readable names, kept in one place so labels cannot drift. */
export const PATTERN_NAMES: Readonly<Record<PatternType, string>> = {
  double_top: 'Double top',
  double_bottom: 'Double bottom',
  head_and_shoulders: 'Head and shoulders',
  inverse_head_and_shoulders: 'Inverse head and shoulders',
  ascending_triangle: 'Ascending triangle',
  descending_triangle: 'Descending triangle',
  symmetrical_triangle: 'Symmetrical triangle',
};

const DIRECTION_NAMES: Readonly<Record<PatternDirection, string>> = {
  bullish: 'Bullish',
  bearish: 'Bearish',
  neutral: 'Neutral',
};

const STATUS_NAMES: Readonly<Record<PatternStatus, string>> = {
  forming: 'Forming',
  confirmed: 'Confirmed',
  invalidated: 'Invalidated',
};

/** `Double bottom · Bullish · Confirmed` — the note drawn beside the shape. */
export function labelText(
  type: PatternType,
  direction: PatternDirection,
  status: PatternStatus,
): string {
  return `${PATTERN_NAMES[type]} · ${DIRECTION_NAMES[direction]} · ${STATUS_NAMES[status]}`;
}
