export type ChartSessionMode = 'LIVE' | 'TEST';

export type ChartSessionStatus = 'STARTING' | 'RUNNING' | 'COMPLETED' | 'STOPPED' | 'ERROR';

export type ChartInterval =
  | '1minute'
  | '3minute'
  | '5minute'
  | '15minute'
  | '30minute'
  | '1hour'
  | '1day';

export type InstrumentType = 'INDEX' | 'EQUITY' | 'FUTURE' | 'CE' | 'PE';

export interface InstrumentRequest {
  type: InstrumentType;
  underlying: string;
  /** Required for CE / PE. */
  strike?: number;
  /** Required for FUTURE / CE / PE. `YYYY-MM-DD`. */
  expiry?: string;
}

export interface ResolvedInstrument {
  instrumentKey: string;
  tradingsymbol: string;
  instrumentType: string;
  underlyingSymbol: string;
  strike: number | null;
  expiryDate: string | null;
  lotSize: number;
  tickSize: number;
}

/** One tradable option contract, as `GET /streamer/instruments/chain` lists it. */
export interface OptionContract {
  instrumentKey: string;
  tradingsymbol: string;
  /**
   * Strike price — what the contract is struck at, not its live premium. The
   * instrument master carries no premium, and the backend does not invent one.
   */
  strike: number;
  lotSize: number;
  tickSize: number;
}

/**
 * An {@link OptionContract} with market data attached.
 *
 * Every field is nullable and `null` never means zero — an untraded strike has
 * no price, and showing 0 would put a real-looking number on a contract nobody
 * has paid for. Render an em dash instead.
 */
export interface PricedOptionContract extends OptionContract {
  /** Last traded premium: live when quoting now, the close on a past date. */
  ltp: number | null;
  /** Closing premium — the previous session's when live. */
  close: number | null;
  openInterest: number | null;
  volume: number | null;
  /** Implied volatility as the broker reports it. */
  iv: number | null;
}

/** Both legs of one underlying/expiry, each ascending by strike. */
export interface OptionChain {
  underlying: string;
  expiry: string;
  calls: PricedOptionContract[];
  puts: PricedOptionContract[];
  /**
   * `null` when the numbers are live, or the trading date they are the close
   * of — so a historical close is never shown as a current price.
   */
  pricedOn: string | null;
  /** The underlying's own price, read alongside the strikes. */
  underlyingPrice: number | null;
}

/* -------------------------------------------------------------------------
 * Support & resistance
 * ---------------------------------------------------------------------- */

/**
 * How the backend should look for levels.
 *
 * - `swing` — price areas the market actually turned at, found by clustering
 *   swing highs and lows. Six of them by default, and the useful default.
 * - `pivot` — the floor-trader set (PP, R1–R3, S1–S3) computed from the
 *   previous session's range. Seven fixed lines, the same ones every other
 *   chart shows.
 * - `both` — both, at once. Thirteen lines; a lot on one chart, but it is what
 *   a pivot trader who also watches structure actually looks at.
 */
export type LevelMethod = 'swing' | 'pivot' | 'both';

/** Relative to the last close, so it moves as price crosses the line. */
export type LevelKind = 'SUPPORT' | 'RESISTANCE';
export type LevelSource = 'SWING' | 'PIVOT';

/** One horizontal line to draw. */
export interface SupportResistanceLevel {
  price: number;
  kind: LevelKind;
  source: LevelSource;
  /** `PP`/`R1`/`S2`… for a pivot; empty for a swing level, which is named by its price. */
  label: string;
  /** Swings that formed the cluster. `0` for a pivot, which is a formula. */
  touches: number;
  /** `0`–`1`. Comparable only within one response — use it for weight, not for ranking across charts. */
  strength: number;
  /** The band the clustered swings spanned; `price` is its centre. */
  bandLow: number;
  bandHigh: number;
  firstTouchMs: number | null;
  lastTouchMs: number | null;
}

/** The previous session a pivot set was derived from. */
export interface PivotBasis {
  date: string;
  high: number;
  low: number;
  close: number;
}

/** What both levels endpoints return. */
export interface ChartLevels {
  instrumentKey: string;
  tradingsymbol: string;
  /** The bar size the levels were found on. */
  interval: ChartInterval;
  /** Last close of the analysed series — what SUPPORT/RESISTANCE is relative to. */
  referencePrice: number | null;
  barsAnalysed: number;
  from: string | null;
  to: string | null;
  levels: SupportResistanceLevel[];
  pivotBasis: PivotBasis | null;
}

/** The knobs every levels request shares. Omit them all for sensible defaults. */
export interface LevelTuning {
  method?: LevelMethod;
  /** Bars either side a swing must beat. Higher finds fewer, bigger turns. */
  swingLookback?: number;
  /** Cluster width as a percentage of price — how close is "the same level". */
  tolerancePct?: number;
  maxLevels?: number;
  minTouches?: number;
}

/** `POST /streamer/stream/levels` — levels for an instrument, no session needed. */
export interface LevelsRequest extends LevelTuning {
  instrument: InstrumentRequest;
  interval?: ChartInterval;
  /** Last trading day to analyse. Omit for "up to today". */
  date?: string;
  lookbackDays?: number;
}

/** `GET /streamer/stream/:id/levels` — levels for the series a session is drawing. */
export interface SessionLevelsQuery extends LevelTuning {
  /** Defaults to the session's own interval. */
  interval?: ChartInterval;
  /** Prior sessions to fold in behind the session's bars. `0` = its bars only. */
  contextDays?: number;
}

/**
 * The `levels` field on a start request: plot support and resistance with this
 * chart, and keep them updated as it streams.
 *
 * Presence is the switch — send `{}` for defaults. Works identically for LIVE
 * and TEST.
 */
export interface StreamLevelsOptions extends LevelTuning {
  interval?: ChartInterval;
  contextDays?: number;
  /** Closed bars between recomputations while the session runs. */
  refreshEveryBars?: number;
}

export interface StartStreamRequest {
  mode: ChartSessionMode;
  instrument: InstrumentRequest;
  interval: ChartInterval;
  /** TEST only. `YYYY-MM-DD`. */
  date?: string;
  /** TEST only. 0 = as fast as possible, 1 = real recorded pace. */
  replaySpeed?: number;
  /**
   * Prior *trading* days of already-closed bars to send before the stream
   * starts. Counted back from `date` (TEST) or today (LIVE), so asking for 1
   * on a Monday yields the previous Friday.
   */
  historyDays?: number;
  /** Omit for a bare chart; send an object to have levels plotted with it. */
  levels?: StreamLevelsOptions;
}

export interface ChartSessionSnapshot {
  sessionId: string;
  mode: ChartSessionMode;
  status: ChartSessionStatus;
  instrumentKey: string;
  interval: ChartInterval;
  date: string | null;
  startedAt: string;
  error: string | null;
}

export interface ChartCandleEvent {
  type: 'CANDLE';
  sessionId: string;
  /** Bar OPEN time, epoch MILLISECONDS UTC. This is the x-axis value. */
  timestamp: number;
  /** Wall-clock instant the event was published. Rarely needed. */
  emittedAt: number;
  instrumentKey: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number | null;
  isSyntheticGap: boolean;
}

/**
 * A complete replacement set of levels — never a delta.
 *
 * Draw exactly these and forget what was drawn before: a level that stopped
 * qualifying simply is not in the next message, and a client reconciling
 * additions against removals would drift out of step the first time a frame
 * was missed. Arrives at least once per session that asked for levels, again
 * every `refreshEveryBars` closed bars, and once more at the end; a client
 * that connects late is sent the newest set after the candle backlog.
 */
export interface ChartLevelsEvent extends ChartLevels {
  type: 'LEVELS';
  sessionId: string;
  /** Wall-clock instant this set was computed. */
  timestamp: number;
}

/** Sent once, immediately on connect. Carries the snapshot, not a timestamp. */
export interface ChartSessionStatusEvent extends ChartSessionSnapshot {
  type: 'SESSION_STATUS';
}

export interface ChartLifecycleEvent {
  type: 'SESSION_STARTED' | 'SESSION_COMPLETED' | 'SESSION_STOPPED';
  sessionId: string;
  timestamp: number;
}

export interface ChartErrorEvent {
  type: 'SESSION_ERROR';
  sessionId: string;
  timestamp: number;
  message: string;
}

export type ChartStreamEvent =
  | ChartCandleEvent
  | ChartLevelsEvent
  | ChartSessionStatusEvent
  | ChartLifecycleEvent
  | ChartErrorEvent;

/** Shape of every non-2xx response body. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Present only for VALIDATION_ERROR (HTTP 400). */
    issues?: { path: string; message: string }[];
  };
}

/**
 * The statuses a session never moves out of.
 *
 * For **rendering** — dimming a finished panel, disabling Stop. Explicitly
 * **not** for deciding that a WebSocket stream has ended: `SESSION_STATUS`
 * arrives ahead of the candle backlog and already reads `COMPLETED` for an
 * instant replay, so closing the socket on it discards the entire day. That
 * bug is what this note exists to stop happening twice; see
 * `ChartStreamSocketService.connect`, which ends only on an explicit lifecycle
 * event.
 */
export const TERMINAL_STATUSES: readonly ChartSessionStatus[] = ['COMPLETED', 'STOPPED', 'ERROR'];
