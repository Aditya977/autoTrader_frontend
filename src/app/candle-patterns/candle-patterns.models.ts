import type { ChartInterval, InstrumentRequest } from '../chart-stream/chart-stream.models';

/**
 * The vocabulary of `POST /strategy/candle-patterns`.
 *
 * ## Why this feature has no detector on the frontend
 *
 * Its sibling, `chart-patterns/`, detects double tops and head-and-shoulders
 * in the browser, and that is the right call there: those shapes are found
 * from pivots in the series on screen and nothing else in the system has an
 * opinion about them.
 *
 * Candlesticks are the opposite case. The backend's candle taxonomy already
 * decides what a hammer is, the feature store writes that decision into every
 * recorded session, and strategies are fitted against those columns. A second
 * implementation here would be a second answer to "is this bar a dragonfly
 * doji" — and the two would drift apart on the first threshold either side
 * tuned, leaving a chart that disagrees with the research behind it. So the
 * chart sends its bars and asks.
 *
 * ## Why the bars go up the wire
 *
 * Every other annotation endpoint takes an instrument and fetches its own
 * candles. This one does not, because of the two modes the chart runs in. A
 * `TEST` replay is part-way through a past day the backend could fetch in
 * full: it would find patterns in bars the user cannot see and judge the
 * newest visible one against the afternoon. And the chart resamples its
 * one-minute feed locally, so the bar size on screen is often one the backend
 * never fetched. Sending the series makes one endpoint right in both modes.
 */

/** One closed bar, in the request's compact form. `t` is epoch milliseconds. */
export interface CandlePatternBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface CandlePatternsRequest {
  interval: ChartInterval;
  /** Closed bars, strictly ascending by `t`. The forming bar is never here. */
  bars: CandlePatternBar[];
  confirmationBars?: number;
  extremeLookback?: number;
  minConfidence?: number;
  /** Omit for every pattern. Never send an empty array — the backend rejects it. */
  patterns?: string[];
  maxHits?: number;
  /**
   * The instrument the bars are from. When sent, the backend fetches the bars
   * that closed before the first one here and uses them only to settle the
   * trend and ATR, so a chart opened at 09:15 scores its first candles the way
   * a chart with history behind it would.
   */
  instrument?: InstrumentRequest;
}

/** Which way the trend was running into the bar. `UNKNOWN` during warm-up. */
export type DirectionContext = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';

/** Which way the pattern points, where it points anywhere. */
export type ReversalBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

/**
 * Where a pattern stands against its confirmation window.
 *
 * `none` — no directional claim, so nothing to confirm. `pending` — the window
 * has not elapsed. `confirmed` — a close cleared the pattern's extreme.
 * `failed` — the window elapsed and none did.
 *
 * `pending` and `failed` must be drawn differently. The newest pattern on any
 * chart is always `pending`, and it is the only one a reader can still act on.
 */
export type ConfirmationStatus = 'none' | 'pending' | 'confirmed' | 'failed';

export type SizeClass = 'micro' | 'normal' | 'large' | 'extreme';
export type TrendState = 'up' | 'down' | 'range';

/** The points each component of the score contributed. */
export interface ConfidenceBreakdown {
  base: number;
  context: number;
  extreme: number;
  geometry: number;
  followThrough: number;
}

export interface CandlePatternHit {
  /** Stable across recomputations, so an overlay can update in place. */
  id: string;
  /** The one name to draw. */
  primary: string;
  /** Every match on the bar, primary first. For the tooltip. */
  patterns: string[];
  /** Bar open times, epoch **milliseconds**. The chart works in seconds. */
  startTime: number;
  endTime: number;
  barCount: number;
  candleType: string;
  candleTypeId: number;
  direction: -1 | 0 | 1;
  sizeClass: SizeClass | null;
  trendState: TrendState | null;
  directionContext: DirectionContext;
  reversalBias: ReversalBias;
  /** `0`–`100`. An engineering score, never a probability. */
  confidence: number;
  breakdown: ConfidenceBreakdown;
  status: ConfirmationStatus;
  confirmationTime: number | null;
  confirmationLevel: number | null;
  patternHigh: number;
  patternLow: number;
  atLocalExtreme: boolean;
}

export interface CandlePatternsResponse {
  interval: ChartInterval;
  /** The taxonomy timeframe label the thresholds came from. */
  timeframe: string;
  barsAnalysed: number;
  from: number | null;
  to: number | null;
  patternsFound: number;
  hits: CandlePatternHit[];
  issues: number;
  /** Bars behind the window used only as warm-up. `0` when none could be fetched. */
  warmupBars?: number;
  /**
   * Display names for the patterns present, from the backend.
   *
   * Read rather than duplicated here, so a chart label and the engine cannot
   * disagree about what a `dark_cloud_cover` is called.
   */
  labels: Record<string, string>;
}
