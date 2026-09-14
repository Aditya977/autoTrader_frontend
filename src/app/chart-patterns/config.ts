import type { PatternType } from './types';

/**
 * Every threshold the engine uses, in one place.
 *
 * No detector carries a magic number. That is not tidiness for its own sake:
 * a tolerance buried in a detector cannot be tuned without reading the
 * detector, and two detectors that each invent their own "roughly equal" will
 * disagree about what equal means on the same chart.
 *
 * ## Why almost everything is in ATRs
 *
 * A NIFTY point and a ₹120 option premium do not share a scale, and neither
 * does the same index in a calm week and a violent one. "Two tops within 15
 * points" means something different on every symbol and every timeframe.
 * "Two tops within 0.6 ATR" means the same thing everywhere, which is what
 * lets one set of thresholds serve every chart the app can draw.
 *
 * Bar counts and slopes stay as they are — a bar is a bar, and a slope is
 * already normalised to ATR-per-bar where it matters.
 */
export interface PatternConfig {
  /** Bars of true range behind the volatility unit. */
  atrPeriod: number;
  /**
   * Reversal thresholds, in ATRs, that a swing must clear to be a swing.
   *
   * A list, not a number, and that is the difference between seeing one
   * scale and seeing the chart. A ZigZag has exactly one resolution: at 1.5
   * ATR a 375-bar session resolves into fifty-odd swings, and the detectors
   * — which read three or five *consecutive* pivots — can then only ever
   * describe the smallest shapes on screen. The large clean structure that
   * a reader sees immediately is invisible, not because it fails a test but
   * because it was never presented as three pivots in the first place.
   *
   * Running the same detectors over a coarse pass as well as a fine one is
   * what makes a big shape expressible. Deduplication then keeps whichever
   * scale described a given piece of price action best.
   */
  swingScales: readonly number[];
  /**
   * Floor on how far apart two "equal" levels may sit, in ATRs.
   *
   * A floor rather than the whole rule — see {@link equalityHeightPct}.
   */
  priceTolAtr: number;
  /**
   * How far apart two "equal" levels may sit, as a share of the pattern.
   *
   * The ATR floor alone was measurably wrong. Two peaks twenty points apart
   * inside a sixty-point formation are three percent apart and read as equal
   * to anyone looking at them; against a fixed 0.6 ATR they are four
   * tolerances apart and the pattern is thrown away. Measured on a real
   * session, "legs differ" was the reason for nearly every rejection.
   *
   * So equality is judged against the shape’s own height, with the ATR
   * figure kept as a floor for the case the height is near zero.
   */
  equalityHeightPct: number;
  /** How deep the trough between a double top's two peaks must be. */
  minDepthAtr: number;
  /** How far the head must clear both shoulders. */
  headMinAtr: number;
  /** How unequal the two shoulders may be. */
  shoulderTolAtr: number;
  /**
   * Steepest neckline still worth calling a neckline, in ATRs per bar.
   *
   * A head and shoulders whose neckline runs away at 45 degrees is a trend,
   * not a reversal, and naming it one produces a break signal on every bar of
   * an ordinary decline.
   */
  maxNecklineSlopeAtrPerBar: number;
  /** Below this, in ATRs per bar, a triangle boundary counts as flat. */
  flatSlope: number;
  /** Bars a pattern must span, and may not exceed. */
  minBars: number;
  maxBars: number;
  /**
   * Confidence a pattern must **exceed** to be published at all.
   *
   * Strictly exceed, not merely reach: a shape sitting exactly on the line is
   * excluded. That is the rule as specified — above the figure shows, at or
   * below it does not — and the difference only ever matters for a pattern
   * landing precisely on it, which is exactly the case a reader would find
   * arbitrary if it were decided the other way.
   *
   * Applied inside the engine rather than at each drawing surface, so the
   * chart overlay and the per-timeframe table cannot disagree about what
   * counts as good enough to show.
   */
  minConfidence: number;
  /** Bars the live pass re-examines on each candle close. */
  liveWindowBars: number;
  /** Cap on what reaches the chart, highest confidence first. */
  maxRenderedPatterns: number;
  /** Whether a shape that has not broken its level is published at all. */
  showForming: boolean;
  /** Whether the measured-move line is drawn. */
  showTargets: boolean;
  /**
   * How tall a rectangle must be, in ATRs, to be a range rather than a pause.
   *
   * Two flat boundaries a third of an ATR apart describe a quiet twenty
   * minutes, not a formation with a measured move behind it. Without a floor
   * this is the single easiest pattern in the set to find, and the least
   * worth finding.
   */
  rectangleMinHeightAtr: number;
  /**
   * How far a flag's pole must travel, in ATRs, and how few bars it may take.
   *
   * The pole is the whole claim of a flag or a pennant: a sharp directional
   * move that the consolidation is resting from. A drift of the same size
   * over fifty bars is a trend, and the shape that follows it is a range
   * rather than a flag.
   */
  poleMinAtr: number;
  /**
   * How steep the pole must be, in ATRs per bar.
   *
   * The height alone is not enough and leaving it out was a real mistake: a
   * three-ATR move spread over fifteen bars is a fifth of an ATR per bar,
   * which is ordinary drift. On a gently oscillating series that let five
   * bars in six qualify as a flagpole, and the detector spent its whole time
   * budget fitting channels to consolidations that were not resting from
   * anything. A flagpole is a near-vertical move by definition, and this is
   * the part of the definition that says so.
   */
  poleMinAtrPerBar: number;
  poleMaxBars: number;
  /** Bars the consolidation may span. Shorter than the shapes fitted on pivots. */
  flagMinBars: number;
  flagMaxBars: number;
  /**
   * Most of the pole a flag may give back, as a fraction.
   *
   * A consolidation that retraces the whole pole has undone the move it was
   * supposed to be pausing inside, which is a reversal wearing a flag's
   * outline. The golden ratio is the conventional line and is used here for
   * that reason rather than any other.
   */
  flagMaxRetrace: number;
  enabledPatterns: readonly PatternType[];
}

export const ALL_PATTERN_TYPES: readonly PatternType[] = [
  'double_top',
  'double_bottom',
  'head_and_shoulders',
  'inverse_head_and_shoulders',
  'ascending_triangle',
  'descending_triangle',
  'symmetrical_triangle',
  'rising_wedge',
  'falling_wedge',
  'rectangle',
  'bullish_flag',
  'bearish_flag',
  'bullish_pennant',
  'bearish_pennant',
];

export const defaultPatternConfig: PatternConfig = {
  atrPeriod: 14,
  swingScales: [1.5, 3, 6, 12],
  priceTolAtr: 0.6,
  equalityHeightPct: 0.1,
  minDepthAtr: 2,
  headMinAtr: 1,
  shoulderTolAtr: 1,
  maxNecklineSlopeAtrPerBar: 0.15,
  flatSlope: 0.03,
  minBars: 8,
  maxBars: 300,
  minConfidence: 0.75,
  liveWindowBars: 500,
  maxRenderedPatterns: 20,
  showForming: true,
  showTargets: true,
  rectangleMinHeightAtr: 1.5,
  poleMinAtr: 3,
  poleMinAtrPerBar: 0.75,
  poleMaxBars: 15,
  flagMinBars: 8,
  flagMaxBars: 30,
  flagMaxRetrace: 0.618,
  enabledPatterns: ALL_PATTERN_TYPES,
};

/** A config with some fields overridden, leaving the rest at their defaults. */
export function patternConfig(overrides: Partial<PatternConfig> = {}): PatternConfig {
  return { ...defaultPatternConfig, ...overrides };
}
