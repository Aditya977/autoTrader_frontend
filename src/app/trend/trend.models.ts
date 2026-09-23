import type { InstrumentRequest } from '../chart-stream/chart-stream.models';

/**
 * The trend overlay's wire contract — a mirror of the backend's
 * `ChartTrendResponse` (`src/streamer/api/chart-stream/chart-trend.service.ts`
 * and `src/streamer/analysis/trend/`). Every reading is what was knowable at
 * its bar's close; the backend tests that.
 */

export const TREND_TIMEFRAMES = ['1m', '5m', '15m', '75m', '1h', '125m', '4h', '1D'] as const;
export type TrendTimeframe = (typeof TREND_TIMEFRAMES)[number];

/** The spec's ladder, and what the overlay asks for. */
export const DEFAULT_TREND_TIMEFRAMES: readonly TrendTimeframe[] = [
  '1m',
  '5m',
  '15m',
  '1h',
  '4h',
  '1D',
];

export type TrendDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type TrendPhase = 'EMERGING' | 'ESTABLISHED' | 'WEAKENING' | 'TRANSITIONING' | 'RANGE';
export type BreakState =
  | 'NONE'
  | 'BULLISH_STRUCTURE_BREAK'
  | 'BEARISH_STRUCTURE_BREAK'
  | 'FALSE_BREAK'
  | 'CONFIRMED_REVERSAL'
  | 'BULLISH_BREAKOUT'
  | 'BEARISH_BREAKOUT';
export type TrendEventKind =
  | Exclude<BreakState, 'NONE'>
  | 'RETEST_REJECTED'
  | 'TREND_ESTABLISHED'
  | 'RANGE_ENTERED'
  | 'TRENDLINE_BREAK';
export type SwingLabel = 'HH' | 'LH' | 'EQH' | 'HL' | 'LL' | 'EQL' | 'FIRST';

export interface TrendEvent {
  kind: TrendEventKind;
  /** Close of the bar it happened on, epoch ms. */
  at: number;
  barTs: number;
  direction: 'UP' | 'DOWN';
  level: number | null;
  beyondAtr: number | null;
  barsToReclaim: number | null;
  breakQuality: number | null;
  note: string;
  /** TRENDLINE_BREAK only: the line that broke. */
  trendlineId?: number;
}

export interface TrendSwing {
  kind: 'HIGH' | 'LOW';
  price: number;
  /** The timeframe bar that printed the extreme. */
  ts: number;
  /** The one-minute bar that printed it — where the label goes, on the wick. */
  exactTs: number;
  /** When it became known — nothing may show it before this. */
  confirmedTs: number;
  significant: boolean;
  label: SwingLabel | null;
  moveAtr: number | null;
}

export interface HtfContext {
  timeframe: TrendTimeframe;
  direction: TrendDirection;
  strength: number;
  phase: TrendPhase;
  structure: string;
  trendScore: number;
}

export interface TrendComponents {
  structure: number | null;
  higherTimeframe: number | null;
  ema: number | null;
  momentum: number | null;
  adx: number | null;
  efficiency: number | null;
  volume: number | null;
}

export interface TransitionState {
  from: 'BULLISH' | 'BEARISH';
  brokenLevel: number;
  brokeAt: number;
  barsSinceBreak: number;
  maxBeyondAtr: number;
  retest: 'NONE' | 'REJECTED';
  oppositeSwing: number | null;
  breakQuality: number;
}

export interface TrendFeatures {
  atr: number | null;
  atrPct: number | null;
  rangeAtr: number | null;
  rsi: number | null;
  roc: number | null;
  macdHistogram: number | null;
  adx: number | null;
  plusDi: number | null;
  minusDi: number | null;
  efficiency: number | null;
  relativeVolume: number | null;
  ema: (number | null)[];
  emaAlignment: number | null;
  emaSlopes: (number | null)[];
  distanceFromEmaAtr: (number | null)[];
}

export interface LevelZone {
  low: number;
  high: number;
  kind: 'SUPPORT' | 'RESISTANCE' | 'AT_PRICE';
  touches: number;
  reactionAtr: number | null;
  recency: number;
  relativeVolume: number | null;
  strength: number;
  lastTouchedAt: number;
}

export interface LevelReading {
  zones: LevelZone[];
  nearestSupport: LevelZone | null;
  nearestResistance: LevelZone | null;
  distanceToSupportAtr: number | null;
  distanceToResistanceAtr: number | null;
}

/** A multi-touch trendline, as the backend found it. */
export interface WireTrendline {
  id: number;
  kind: 'SUPPORT' | 'RESISTANCE';
  a: { ts: number; price: number };
  b: { ts: number; price: number };
  /** Each swing on the line: minute, when it became known, and the line's price there. */
  touches: { ts: number; confirmedTs: number; value: number }[];
  /** Price change per bar of its timeframe. */
  slopePerBar: number;
  /** When it became a line — nothing may draw it before this. */
  formedAt: number;
  end: 'BROKEN' | 'SUPERSEDED' | 'EXPIRED' | null;
  endAt: number | null;
  breakLevel: number | null;
  breakBeyondAtr: number | null;
}

export interface TrendReading {
  timeframe: TrendTimeframe;
  at: number;
  barTs: number;
  close: number;
  direction: TrendDirection;
  strength: number;
  phase: TrendPhase;
  structure: string;
  structureScore: number | null;
  trendScore: number;
  breakState: BreakState;
  components: TrendComponents;
  weakening: string[];
  transition: TransitionState | null;
  range: { high: number; low: number; evidence: string[] } | null;
  protectedLevel: number | null;
  htf: { alignment: number | null; frames: HtfContext[] };
  features: TrendFeatures;
}

export interface CompactReading {
  at: number;
  barTs: number;
  direction: TrendDirection;
  strength: number;
  phase: TrendPhase;
  structure: string;
  trendScore: number;
  breakState: BreakState;
}

export interface TimeframeTrend {
  timeframe: TrendTimeframe;
  barsAnalysed: number;
  latest: (TrendReading & { levels: LevelReading | null }) | null;
  readings: CompactReading[];
  swings: TrendSwing[];
  events: TrendEvent[];
  trendlines: WireTrendline[];
}

export interface TrendResult {
  instrumentKey: string;
  tradingsymbol: string;
  asOf: string | null;
  barsAnalysed: number;
  from: string | null;
  to: string | null;
  options: Record<string, unknown>;
  timeframes: TimeframeTrend[];
}

/** `POST /streamer/stream/trend`. */
export interface TrendRequest {
  instrument: InstrumentRequest;
  date?: string;
  lookbackDays?: number;
  timeframes?: TrendTimeframe[];
  maxReadings?: number;
  maxSwings?: number;
  maxEvents?: number;
}

/** `GET /streamer/stream/:id/trend` — a query string. */
export interface SessionTrendQuery {
  contextDays?: number;
  /** Comma list. */
  timeframes?: string;
  maxReadings?: number;
  maxSwings?: number;
  maxEvents?: number;
}
