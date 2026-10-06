export type ChartSessionMode = 'LIVE' | 'TEST';

export type ChartSessionStatus = 'STARTING' | 'RUNNING' | 'COMPLETED' | 'STOPPED' | 'ERROR';

export type ChartInterval =
  '1minute' | '3minute' | '5minute' | '15minute' | '30minute' | '1hour' | '1day';

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
 * Which retest shape was detected — `retest__scenario` in the retest spec, and
 * the same strings the backend emits.
 *
 * Several can apply to one retest at once (a wick sweep at a range boundary is
 * two things), so {@link ChartRetest} carries both the winner and the full set.
 */
export type RetestScenario =
  'exact' | 'shallow' | 'sweep' | 'deep' | 'time' | 'dynamic' | 'gap' | 'range_boundary' | 'none';

/** How the level's band was derived. */
export type RetestZoneOrigin =
  | 'BREAKOUT_CANDLE'
  | 'CONSOLIDATION'
  | 'SWING'
  | 'ROUND_NUMBER'
  | 'MOVING_AVERAGE'
  | 'GAP_EDGE'
  | 'RANGE_BOUNDARY';

export type RetestDirection = 'BULLISH' | 'BEARISH';

/**
 * One retest of one level.
 *
 * A level here is a **band**, not a line — `zoneLow`/`zoneHigh` are the band,
 * and it is drawn as one. Collapsing it to a midpoint would recreate exactly
 * the "price never touched my level" confusion the zone exists to remove:
 * price genuinely does turn inside the band without printing the number.
 *
 * Every `*At` is epoch **milliseconds**, like a candle's `timestamp`, and needs
 * the same snap to the interval on screen before it can be drawn.
 */
export interface ChartRetest {
  zoneLow: number;
  zoneHigh: number;
  zoneOrigin: RetestZoneOrigin;
  direction: RetestDirection;

  /** Bar open time of the breakout that flipped the level. */
  breakoutAt: number;
  /** Deepest approach back toward the band; `null` for a time-based retest. */
  approachAt: number | null;
  /** Where price resolved in the breakout direction; `null` while unresolved. */
  resumptionAt: number | null;

  scenario: RetestScenario;
  /** Everything that applied; `scenario` is the winner by the backend's priority. */
  scenarios: RetestScenario[];
  /** All three conditions met. A completed label — never true of a live retest. */
  valid: boolean;
  /** Approached and rejected, but not yet resolved. */
  unresolved: boolean;
  invalidation: string | null;
  /** Signed distance from the approach extreme to the near band edge, in ATR. */
  gapAtr: number;
  touchedZone: boolean;
  /** +1 beyond the band, 0 inside it, -1 through it. */
  closeSide: 1 | 0 | -1;
  /**
   * Prior touches of this band. A **decay** term: each touch consumes resting
   * orders, so a fourth touch is weaker than a first, not stronger.
   */
  touchCount: number;
  /**
   * Pullback bars closing against the breakout direction.
   *
   * `0` is a real, informative value rather than missing data — an all-green
   * retest means the pullback was absorbed before it could complete a bar.
   */
  opposingBars: number;
  /** `false` for a shallow retest: the resting orders were never filled. */
  levelConsumed: boolean;
  barsToResolve: number | null;
  confluenceCount: number;
  levelStrength: number;
  /** Quality, 0–1 — what line weight and opacity follow. */
  quality: number;
  /** Visible only on a higher timeframe than the one requested. */
  htfOnly: boolean;
}

export interface ChartRetests {
  instrumentKey: string;
  tradingsymbol: string;
  interval: ChartInterval;
  barsAnalysed: number;
  from: string | null;
  to: string | null;
  /** Bumped when the backend changes how bands are derived; discard cached retests on a change. */
  zoneVersion: number;
  retests: ChartRetest[];
  /** How many were found before `minQuality`/`includeUnresolved` trimmed the list. */
  detected: number;
}

/** Tuning both retest endpoints accept; every field is defaulted server-side. */
export interface RetestTuning {
  /** Minimum breakout strength in ATR before the level counts as flipped. */
  minBreakoutRangeAtr?: number;
  approachWindow?: number;
  resolutionWindow?: number;
  /** `gap/ATR` past which a pullback is not a level interaction at all. */
  maxGapAtr?: number;
  /** Lowest quality worth drawing, 0–1. */
  minQuality?: number;
  /** Include retests that have not resolved yet — the only ones happening *now*. */
  includeUnresolved?: boolean;
  maxRetests?: number;
}

/** `POST /streamer/stream/retests` — retests for an instrument, no session needed. */
export interface RetestsRequest extends RetestTuning {
  instrument: InstrumentRequest;
  interval?: ChartInterval;
  /** Last trading day to analyse. Omit for "up to today". */
  date?: string;
  lookbackDays?: number;
}

/** `GET /streamer/stream/:id/retests` — retests in the series a session is drawing. */
export interface SessionRetestsQuery extends RetestTuning {
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

/* -------------------------------------------------------------------------
 * Previous day range (PDH / PDL / mid)
 * ---------------------------------------------------------------------- */

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
  /**
   * Session VWAP as of this bar's close, or `null` where there is none.
   *
   * Cumulative from the session open and reset each trading day, so a
   * prior-day history bar carries that day's average rather than this one's.
   * `null` until a bar with volume has closed — and therefore `null` for every
   * bar of an index, which reports no volume at all. Draw nothing for a
   * `null`; do not carry the previous value forward.
   */
  vwap: number | null;
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
