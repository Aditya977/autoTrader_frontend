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
  stability: number;
  prefixMinutes: number;
  sessions: number;
  from: string;
  to: string;
  instruments: string[];
  isDefault: boolean;
}
