/**
 * The fitted day-shape taxonomies, mirrored from
 * `src/strategy/domain/shapes/day-shape-model.ts` in the backend repo.
 *
 * Hand-mirrored, same rule as every other model file here: when the backend
 * changes a shape, this changes with it in the same breath.
 */

/** Where a category sits, in the units the research documents use. */
export interface CategoryCentre {
  /** Close at 10:45 less the day's open, in ATRs. Signed. */
  netAtr: number;
  /** Best and worst excursion from the open by 10:45. */
  upAtr: number;
  downAtr: number;
  /** Net travel ÷ path length, 0–1. Low means it doubled back repeatedly. */
  efficiency: number;
  /** Where the morning closed inside its own range, 0 (low) to 1 (high). */
  closePosition: number;
  /** Open less the previous close, in ATRs. */
  gapAtr: number;
  /** Morning range against the trailing daily ATR. */
  rangeRatio: number;
  /** When the morning set its extremes, as a fraction of the window. */
  highAt: number;
  lowAt: number;
}

/**
 * What sessions in this category went on to do after 10:45.
 *
 * Descriptive, not predictive — `research/09` measured whether these separate
 * the categories in a way a shuffled price path cannot, and they do not. The UI
 * says so where it shows them.
 */
export interface CategoryOutcome {
  sessions: number;
  afternoonRangeAtr: number;
  afternoonNetAtr: number;
  /** Share of sessions where a long from 10:45 hit +2 ATR before −1.5 ATR. */
  barrierWinRate: number;
}

export interface CategoryProfile {
  id: number;
  name: string;
  description: string;
  sessions: number;
  /** Fraction of all fitted sessions, 0–1. */
  share: number;
  centre: CategoryCentre;
  /**
   * The exemplar session's own 25-point trajectory, in ATRs from its open.
   *
   * A medoid is a day that actually traded rather than an average of several,
   * so this is a real shape and can be drawn as one.
   */
  shape: number[];
  exemplar: { symbol: string; date: string };
  outcome: CategoryOutcome;
}

export interface DayShapeModel {
  k: number;
  /** Bar size the shape was measured on. Part of the model identity. */
  timeframeMinutes: number;
  prefixMinutes: number;
  trajectoryPoints: number;
  columns: string[];
  mean: number[];
  sd: number[];
  medoids: number[][];
  categories: CategoryProfile[];
  fitted: {
    sessions: number;
    from: string;
    to: string;
    instruments: string[];
    /** Median adjusted Rand index over refits — how reproducible this k is. */
    stability: number;
  };
}

/** One row of `GET /strategy/day-shapes`. */
export interface DayShapeModelSummary {
  k: number;
  timeframeMinutes: number;
  stability: number;
  prefixMinutes: number;
  sessions: number;
  from: string;
  to: string;
  instruments: string[];
  isDefault: boolean;
}

/* -------------------------------------------------------------------------
 * One session, looked up and classified
 * ---------------------------------------------------------------------- */

/** What the 90-minute prefix looked like — the numbers that chose a category. */
export interface PrefixFeatures {
  date: string;
  bars: number;
  netAtr: number;
  upAtr: number;
  downAtr: number;
  efficiency: number;
  closePosition: number;
  gapAtr: number | null;
  rangeRatio: number;
  highAt: number;
  lowAt: number;
}

/** What happened after 10:45. Every field prefixed, so nothing can collide. */
export interface SessionOutcome {
  fwdBars: number;
  fwdNetAtr: number;
  fwdRangeAtr: number;
  fwdUpAtr: number;
  fwdDownAtr: number;
  fwdEfficiency: number;
  fwdBarrierWin: number | null;
}

export interface Classification {
  categoryId: number;
  name: string;
  distance: number;
  runnerUpDistance: number;
  /** Winner over runner-up. Near 1 means the label is close to arbitrary. */
  margin: number;
}

export interface SessionShapeView {
  symbol: string;
  date: string;
  timeframeMinutes: number;
  k: number;
  /** Minutes of the morning the classification read. */
  windowMinutes: number;
  /** Bars the session held at this timeframe. */
  sessionBars: number;
  /**
   * Whether the session had finished when it was read.
   *
   * A live session is classifiable — the window is complete — but its outcome
   * is not yet knowable, and showing both without distinguishing them would
   * present half a day of range as a full one.
   */
  complete: boolean;
  atrPrior: number;
  bars: number;
  shape: number[];
  features: PrefixFeatures;
  classification: Classification;
  category: CategoryProfile;
  outcome: SessionOutcome | null;
  /** The same session read at every timeframe — the multi-timeframe view. */
  acrossTimeframes: {
    timeframeMinutes: number;
    categoryId: number;
    name: string;
    efficiency: number;
    margin: number;
  }[];
  insights: string[];
}

/** The endpoint answers with this when the question has no answer. */
export interface SessionShapeError {
  error: string;
}

export const isSessionShapeError = (
  value: SessionShapeView | SessionShapeError,
): value is SessionShapeError => 'error' in value;

/* -------------------------------------------------------------------------
 * Similar sessions — the lookalike search
 * ---------------------------------------------------------------------- */

/**
 * One past session scored against the one being looked at.
 *
 * `score` is `max(0, correlation) × amplitudeRatio`, as a percentage. Both
 * halves are carried so a middling score can be read: a 42 with a correlation
 * of 0.95 is the right shape at the wrong size, and a 42 with a ratio of 0.98
 * is the right size at the wrong shape. They are different findings.
 *
 * It is a **resemblance, not a probability**. Nothing here estimates how
 * likely anything is to happen next, and the panel must never render it as a
 * chance of an outcome.
 */
export interface ShapeMatch {
  date: string;
  /** 0 to 100. */
  score: number;
  /** Pearson correlation of the two paths, −1 to 1. Negative scores zero. */
  correlation: number;
  /** The smaller peak-to-trough swing over the larger, 0 to 1. */
  amplitudeRatio: number;
  /** Root-mean-square gap between the paths, in ATRs. Not normalised. */
  rmseAtr: number;
  points: number;
  /** Where the candidate's window ended, in ATRs from its own open. */
  netAtr: number;
  amplitudeAtr: number;
  complete: boolean;
}

export interface SimilarSessionsView {
  symbol: string;
  date: string;
  timeframeMinutes: number;
  windowMinutes: number;
  /** Trajectory points actually compared. */
  windowPoints: number;
  minScore: number;
  /**
   * Qualifying matches across the whole pool — the number shown collapsed.
   *
   * Counted before the response was capped, so a list of twenty can still say
   * truthfully that there were forty.
   */
  matchCount: number;
  matches: ShapeMatch[];
  query: {
    /** The looked-up session's own path, for drawing a match against it. */
    path: number[];
    complete: boolean;
    atrPrior: number;
  };
  pool: {
    sessions: number;
    from: string | null;
    to: string | null;
    priorOnly: boolean;
    /** Sessions without the fourteen days of history a trailing ATR needs. */
    skippedNoAtr: number;
    /** Sessions whose bars did not reach the end of the compared window. */
    skippedTooShort: number;
  };
}

/** One candle, with the taxonomy label the dataset stores for it. */
export interface SessionCandle {
  /** Bar **open** time, epoch milliseconds UTC. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Source minutes folded in. A short final bucket is a real, shorter bar. */
  sourceBars: number;
  /** Geometry alone: `hammer_shape`, `doji`, `marubozu`, and the rest. */
  type: string | number | null;
  /** The same shape resolved against the trend before it: `hanging_man`. */
  named: string | number | null;
  /** Frozen integer id of `type`. Never renumbered. */
  typeId: string | number | null;
  sizeClass: string | number | null;
  direction: string | number | null;
  /** Multi-bar patterns ending on this candle. */
  patterns: string[];
}

export interface SessionBarsView {
  symbol: string;
  date: string;
  timeframeMinutes: number;
  bars: SessionCandle[];
  /** Bars rejected as internally inconsistent. Should be zero. */
  issues: number;
}

export const isSimilarSessionsError = (
  value: SimilarSessionsView | SessionShapeError,
): value is SessionShapeError => 'error' in value;

export const isSessionBarsError = (
  value: SessionBarsView | SessionShapeError,
): value is SessionShapeError => 'error' in value;
