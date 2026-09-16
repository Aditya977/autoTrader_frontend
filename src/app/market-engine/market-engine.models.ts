import type { InstrumentRequest } from '../chart-stream/chart-stream.models';

/**
 * The multi-timeframe market engine, as the wire carries it.
 *
 * A mirror of `chart-market-engine.service.ts` on the backend, and like the
 * retest models it is kept as a plain projection rather than re-modelled: the
 * fields mean what the engine's documentation says they mean, and renaming
 * them here would put a translation layer between a reading and the rules that
 * produced it.
 *
 * Two things about the shape are worth knowing before drawing anything with it.
 *
 * **Every timestamp is a bar close.** `at`, `confirmedAt` and `event.confirmedAt`
 * are all the instant a fact became *knowable*, not the instant it happened.
 * `event.barAt` is the only bar-open time in the whole structure, and it exists
 * so a chart can mark the candle price actually broke on. Placing a reading at
 * `at` is correct; placing it at the bar it describes is not.
 *
 * **`null` means "not knowable", never "zero".** A `protectedLevel` of `null`
 * is a market with no confirmed higher high to have been launched from; an
 * `rvol` of `null` is an instrument that reports no volume at all — which is
 * every NSE index. Rendering either as 0 states something the backend
 * deliberately refused to state.
 */

/** Which five bar sizes fill the cascade. */
export type ChartSet = 'standard' | 'nse';

export type EngineTimeframe = '1m' | '5m' | '15m' | '75m' | '1h' | '125m' | '4h';

export type TimeframeState =
  | 'UNKNOWN'
  | 'RANGE'
  | 'TREND_UP'
  | 'TREND_DOWN'
  | 'PULLBACK_DOWN'
  | 'PULLBACK_UP'
  | 'AT_RISK_UP'
  | 'AT_RISK_DOWN'
  | 'RESUMPTION_UP'
  | 'RESUMPTION_DOWN'
  | 'BREAKOUT_UP'
  | 'BREAKOUT_DOWN'
  | 'REVERSAL_UP'
  | 'REVERSAL_DOWN'
  | 'EXHAUSTION';

/** What the reaction timeframe says — `ASLEEP` most of the session, by design. */
export type ReactionReading = 'RETEST_HOLD' | 'RETEST_FAIL' | 'RETEST_SWEEP' | 'ASLEEP';

export type Grade = 'A' | 'B' | 'C';

export type LegCharacter = 'IMPULSIVE' | 'CORRECTIVE' | 'MIXED';

/** One reference line the engine used — PDH/PDL/PDC, CPR, opening range, round number. */
export interface SessionLevel {
  name: string;
  price: number;
  source: 'PREV_DAY' | 'CPR' | 'OPENING_RANGE' | 'ROUND';
}

/** What price did to a level, and when the engine was entitled to say so. */
export interface EngineBreakEvent {
  /** `SWEEP`, `WEAK_BREAK`, `FAILED_BREAK`, `BOS` or `BOS_DISPLACEMENT`. */
  kind: string;
  direction: 'UP' | 'DOWN';
  level: number;
  /** Bar OPEN time of the candle that interacted with the level. */
  barAt: number;
  /** Bar CLOSE time of the candle that settled what it was — one bar later for a BOS. */
  confirmedAt: number;
  beyondAtr: number;
  bodyAtr: number;
  leftFvg: boolean;
  fvg: { low: number; high: number } | null;
}

export interface TimeframeReading {
  timeframe: EngineTimeframe;
  state: TimeframeState;
  confirmedAt: number | null;
  barsInState: number;
  /** `null` for states that do not expire; a bar count for setup-type states. */
  expiresAfterBars: number | null;
  /** The level whose close-through changes the structure. `null` in a range. */
  protectedLevel: number | null;
  protectedFrom: 'HIGHER_HIGH' | 'LOWER_LOW' | null;
  rangeHigh: number | null;
  rangeLow: number | null;
  /** Retracement of the last impulse, 0–1. */
  pullbackDepth: number | null;
  leg: {
    character: LegCharacter;
    netAtr: number;
    bars: number;
    overlapRatio: number;
    bodyRatio: number;
  } | null;
  event: EngineBreakEvent | null;
  invalidationLevel: number | null;
  /** A sentence, not a number — what would make this reading wrong. */
  invalidatedBy: string | null;
}

/** The forming higher-timeframe candle's running extremes, from closed finer bars. */
export interface DevelopingReading {
  high: number | null;
  low: number | null;
  barsSoFar: number;
  /** The one live question the developing view answers. */
  testingProtectedLevel: boolean;
}

export interface EngineSessionReading {
  date: string;
  /** `GAP_UP_ABOVE_PDH`, `GAP_DOWN_INSIDE`, `FLAT`… */
  gapKind: string | null;
  gapPoints: number | null;
  cprBand: 'narrow' | 'normal' | 'wide' | null;
  openingRange: { high: number; low: number; complete: boolean } | null;
  /** `UNDETERMINED` until the first hour has closed — and often afterwards. */
  dayType: string;
  efficiencyRatio: number | null;
  /** `EXPIRY_DAY`, `DAY_BEFORE_EXPIRY`, `EVENT_DAY`, `EVENT_WINDOW`. */
  flags: string[];
  /** Names of scheduled events on this date. */
  events: string[];
}

/** Where stops cluster — equal highs/lows, PDH/PDL, opening range, swings. */
export interface RestingPool {
  source: string;
  side: 'BUY_SIDE' | 'SELL_SIDE';
  price: number;
  /** `2`+ for equal highs/lows: a flatter top, a bigger cluster. */
  touches: number;
}

/**
 * An order block or imbalance, **with its status as of the reading**.
 *
 * Never the zone's end-of-history status: a reading at 10:00 shows the zone as
 * it was at 10:00, even if price mitigated it at 14:30.
 */
export interface EngineZone {
  kind: 'ORDER_BLOCK' | 'FAIR_VALUE_GAP';
  direction: 'BULLISH' | 'BEARISH';
  low: number;
  high: number;
  status: 'FRESH' | 'TESTED' | 'MITIGATED' | 'INVALID';
  tests: number;
  /** When the break that created it confirmed — the earliest it could be seen. */
  createdAt: number;
  /** The candle its prices come from, which is always earlier. */
  originAt: number;
  sweptLiquidity: boolean;
  leftFvg: boolean;
}

export interface EngineGrade {
  value: Grade;
  present: string[];
  partial: string[];
  missing: string[];
  /**
   * Items that could not be evaluated at all — not items that failed.
   *
   * `volume_pattern` lands here for every index, which reports no traded
   * volume. Showing it as a failed check would tell a user their setup was
   * weak when the truth is that the feed cannot answer.
   */
  unavailable: string[];
  /** Why the grade could go no higher — the most useful line in the read-out. */
  capReason: string | null;
}

/** One complete reading of the market, at one setup-timeframe bar close. */
export interface MarketReading {
  /** The instant this reading became knowable, epoch ms UTC. */
  at: number;
  session: EngineSessionReading;
  context: TimeframeReading & { developing: DevelopingReading | null };
  structure: TimeframeReading;
  setup: TimeframeReading;
  trigger: TimeframeReading;
  reaction: ReactionReading;
  location: {
    positionInRangePct: number | null;
    confluence: SessionLevel[];
    atrToNextOpposingLevel: number | null;
  };
  volume: {
    rvol: number | null;
    effortResult: string | null;
    unavailable: boolean;
  };
  liquidity: {
    /** The pool this reading's sweep took, or `null`. */
    tookPool: {
      source: string;
      price: number;
      touches: number;
      penetrationAtr: number;
    } | null;
    /** Nearest resting pools first — where price is drawn next. */
    resting: RestingPool[];
  };
  /** Live zones, nearest to price first. */
  zones: EngineZone[];
  /** Named events that led here, oldest first. */
  sequence: string[];
  /** Context and structure genuinely disagree; every reading caps at grade C. */
  transition: boolean;
  direction: 'UP' | 'DOWN' | null;
  grade: EngineGrade | null;
}

export interface MarketEngineResult {
  instrumentKey: string;
  tradingsymbol: string;
  chartSet: ChartSet;
  /** Bumped when a rule changes shape; discard cached readings on a change. */
  ruleVersion: string;
  timeframes: Record<string, EngineTimeframe>;
  barsAnalysed: number;
  from: string | null;
  to: string | null;
  /** Oldest first. */
  readings: MarketReading[];
  /** How many were produced before `maxReadings` trimmed the list. */
  produced: number;
  /** The day's reference lines, sent once rather than repeated per reading. */
  sessionLevels: SessionLevel[];
}

/** Tuning both endpoints accept; every field is defaulted server-side. */
export interface MarketEngineTuning {
  chartSet?: ChartSet;
  maxReadings?: number;
  /** 50 on NIFTY, 100 on BANKNIFTY — it feeds the location confluence count. */
  roundNumberStep?: number;
}

/** `POST /streamer/stream/market-engine` — a reading with no session needed. */
export interface MarketEngineRequest extends MarketEngineTuning {
  instrument: InstrumentRequest;
  date?: string;
  lookbackDays?: number;
}

/** `GET /streamer/stream/:id/market-engine` — the session's own series. */
export interface SessionMarketEngineQuery extends MarketEngineTuning {
  contextDays?: number;
}

/* --- Phases 9, 11, 12: the event log, validation and parity ----------------- */

/** Shared body for the research endpoints. */
export interface MarketEngineResearchRequest {
  instrument: InstrumentRequest;
  date?: string;
  lookbackDays?: number;
  chartSet?: ChartSet;
  roundNumberStep?: number;
}

/** `POST /streamer/stream/market-engine/log` — what an ingest wrote. */
export interface EventLogIngestResult {
  instrumentKey: string;
  sessionDate: string | null;
  ruleVersion: string;
  produced: number;
  written: number;
  /** Already stored. A re-run of the same session writes nothing, by design. */
  skipped: number;
  byType: Record<string, number>;
}

/** `POST /streamer/stream/market-engine/parity` — does a replay match the log? */
export interface ParityCheckResult {
  instrumentKey: string;
  sessionDate: string;
  ruleVersion: string;
  identical: boolean;
  matched: number;
  onlyInReplay: number;
  onlyInStored: number;
  /** Same event, different numbers — what a silently moved threshold looks like. */
  changed: number;
  examples: {
    kind: 'ONLY_IN_REPLAY' | 'ONLY_IN_STORED' | 'CHANGED';
    type: string;
    at: number;
    timeframe: string;
    detail: string;
  }[];
}

export type ForwardHorizon = 3 | 6 | 12;

export interface OutcomeStats {
  samples: number;
  meanMoveAtr: Record<ForwardHorizon, number | null>;
  medianMoveAtr: Record<ForwardHorizon, number | null>;
  upFirstRate: number | null;
  downFirstRate: number | null;
  meanMaxUpAtr: number | null;
  meanMaxDownAtr: number | null;
}

/** One label's forward behaviour against a time-of-day matched baseline. */
export interface LabelReport {
  label: string;
  events: OutcomeStats;
  baseline: OutcomeStats;
  /**
   * Event mean minus baseline mean, in ATRs, oriented so positive means "went
   * the way the label claimed". Near zero means the label says nothing the time
   * of day did not already explain.
   */
  edgeAtr: Record<ForwardHorizon, number | null>;
  upFirstEdge: number | null;
  /** Samples left after overlapping forward windows were thinned. */
  independentSamples: number;
}

export interface ResolutionReport {
  state: TimeframeState;
  samples: number;
  rates: Record<'RESUMED' | 'REVERSED' | 'RANGED' | 'UNRESOLVED', number>;
}

/** `POST /streamer/stream/market-engine/validate`. */
export interface ValidationResult {
  instrumentKey: string;
  chartSet: ChartSet;
  ruleVersion: string;
  barsAnalysed: number;
  sessions: number;
  events: number;
  byEventType: LabelReport[];
  byGrade: LabelReport[];
  stateResolution: ResolutionReport[];
  walkForward: { tune: number; check: number; confirm: number };
}
