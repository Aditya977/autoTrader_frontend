import type { SimTrade } from '../strategy/strategy.models';

/**
 * The backtest half of the strategy API, mirrored from
 * `src/strategy/backtest/backtest.types.ts` in the backend repo.
 *
 * Hand-mirrored, same rule as every other model file here: when the backend
 * changes a shape, this changes with it in the same breath.
 */

export type BacktestStatus = 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED';

/* -------------------------------------------------------------------------
 * Datasets — the captured month a run reads from
 * ---------------------------------------------------------------------- */

export type DatasetStatus = 'PENDING' | 'RUNNING' | 'COMPLETE' | 'PARTIAL' | 'FAILED';

export interface JournalDataset {
  id: number;
  label: string;
  status: DatasetStatus;
  underlyings: string[];
  expiry: string;
  fromDate: string;
  toDate: string;
  interval: string;
  instrumentCount: number;
  barCount: number;
  error: string | null;
  requestedAt: string;
  completedAt: string | null;
}

export interface CaptureDatasetRequest {
  label?: string;
  underlyings?: string[];
  /** Calendar days back from the expiry. 30 is one monthly cycle. */
  lookbackDays?: number;
  /**
   * Calls and puts either side of the money, plus the index alongside them.
   *
   * The capture is anchored on the nearest expiry **still live** and reaches
   * back from it, which is why a month of option history is available at all: a
   * settled expiry drops out of the instrument master and its strikes stop
   * being nameable. `0` captures the index alone.
   */
  strikesPerSide?: number;
  /**
   * Cash equities to capture — **research data, never traded**.
   *
   * They exist for one reason: an option expiry lives for weeks, so a captured
   * month is all there is, and twenty-one days cannot separate an edge from a
   * lucky run. An equity has years of intraday history.
   *
   * A symbol must be listed in the backend's `RESEARCH_SYMBOLS` for the
   * instrument master to have synced it.
   */
  equities?: string[];
}

/**
 * One instrument a capture holds bars for.
 *
 * `tradingDays` is the field to read before choosing: an option leg that spent
 * the first half of the month far out of the money has bars for only part of
 * the window, and a run over it covers a shorter month than the label says.
 */
export interface DatasetInstrument {
  instrumentKey: string;
  tradingsymbol: string;
  role: 'UNDERLYING' | 'CE' | 'PE';
  underlying: string;
  strike: number | null;
  expiry: string | null;
  bars: number;
  firstDate: string;
  lastDate: string;
  tradingDays: number;
  /** Whether the series carries volume — an index does not; an option or an equity does. */
  hasVolume: boolean;
}

/* -------------------------------------------------------------------------
 * Regimes — what kind of day it was
 * ---------------------------------------------------------------------- */

export type TrendRegime = 'TREND_UP' | 'TREND_DOWN' | 'SIDEWAYS';
export type GapRegime = 'GAP_UP' | 'GAP_DOWN' | 'FLAT_OPEN';
export type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH';

export interface DayRegime {
  trend: TrendRegime;
  gap: GapRegime;
  volatility: VolatilityRegime;
  /** One readable line, e.g. `GAP_UP · TREND_UP · HIGH`. */
  label: string;
}

/** The measured session, before anything is labelled. */
export interface DayShape {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  bars: number;
  netMovePct: number;
  rangePct: number;
  /** `null` on the first day of a dataset — nothing to gap from. */
  gapPct: number | null;
  /**
   * Net move ÷ total path travelled. `1` never came back, `0` ended where it
   * started. This is what separates "trending" from "moved a lot".
   */
  efficiency: number;
}

/* -------------------------------------------------------------------------
 * Metrics
 * ---------------------------------------------------------------------- */

export interface TradeMetrics {
  trades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number | null;
  grossPnl: number;
  costs: number;
  netPnl: number;
  /** Mean net per trade — the figure comparable across sample sizes. */
  expectancy: number | null;
  /** Gross won ÷ gross lost. `null` when nothing lost — not Infinity. */
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  payoffRatio: number | null;
  largestWin: number;
  largestLoss: number;
  maxDrawdown: number;
  longestWinStreak: number;
  longestLossStreak: number;
  /** Closed trades by how they ended — where a tuning problem shows first. */
  exitBreakdown: Record<string, number>;
}

export interface MetricDelta {
  metric: string;
  baseline: number | null;
  candidate: number | null;
  change: number | null;
  /** Whether a rise is an improvement — so "+2,400 drawdown" reads correctly. */
  higherIsBetter: boolean;
}

/* -------------------------------------------------------------------------
 * Runs
 * ---------------------------------------------------------------------- */

export interface BacktestDay {
  date: string;
  shape: DayShape;
  regime: DayRegime;
  netPnl: number;
  grossPnl: number;
  costs: number;
  trades: number;
  wins: number;
  losses: number;
  bars: number;
  /** Why the day produced nothing. Render it — a blank row is a shrug. */
  note: string | null;
}

export interface RegimeBreakdown {
  trend: Record<string, TradeMetrics>;
  gap: Record<string, TradeMetrics>;
  volatility: Record<string, TradeMetrics>;
}

export interface BacktestSummary {
  id: number;
  label: string;
  strategy: string;
  strategyName: string;
  /** The complete configuration this run used. Without it a comparison is noise. */
  params: Record<string, number>;
  datasetId: number;
  underlying: string;
  tradingsymbol: string;
  fromDate: string;
  toDate: string;
  /** Starting capital of **each day**, not of the run. */
  capital: number;
  lotSize: number;
  timeframeMinutes: number;
  status: BacktestStatus;
  tradingDays: number;
  tradeCount: number;
  netPnl: number;
  metrics: TradeMetrics | null;
  notes: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface BacktestDetail extends BacktestSummary {
  days: BacktestDay[];
  trades: SimTrade[];
  byRegime: RegimeBreakdown;
  /** Days that produced no trade — 20 days and 3 trades is not 3 setups. */
  skippedDays: number;
}

/**
 * The bar sizes a run may be asked for — mirrored from the backend's
 * `SUPPORTED_TIMEFRAMES`, which refuses anything else.
 *
 * The list is closed for a reason worth knowing: the aggregator floors its
 * buckets against a fixed 09:15, so a timeframe only keeps every session's open
 * on a boundary if it divides the 1,440-minute day evenly. These do.
 */
export const TIMEFRAMES = [1, 3, 5, 15, 30] as const;

export interface RunBacktestRequest {
  datasetId: number;
  /** Which contract to trade. Omitted, the most liquid option leg is chosen. */
  instrumentKey?: string;
  strategyId: string;
  params?: Record<string, number>;
  capital?: number;
  lotSize?: number;
  /**
   * Bar size to run on, overriding the one the strategy declares.
   *
   * The same rules on a different bar are a different experiment — a 1-minute
   * VWAP reclaim fires many times a day where a 30-minute one barely fires — so
   * it belongs on the run rather than in the compiled registry. One of
   * {@link TIMEFRAMES}.
   */
  timeframeMinutes?: number;
  label?: string;
  notes?: string;
  /** The holdout discipline, as two dates. */
  fromDate?: string;
  toDate?: string;
}

export interface BacktestComparison {
  baseline: BacktestDetail;
  candidate: BacktestDetail;
  deltas: MetricDelta[];
}
