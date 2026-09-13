/**
 * The tuning the chart sends, in one place.
 *
 * Every value here is stated explicitly in the request rather than left to a
 * backend default. That looks like duplication and is deliberate: the numbers
 * on screen are the numbers the chart asked for, so a backend default that
 * moves cannot silently change what a user is looking at. The one thing that
 * must not drift is the *meaning*, and the meanings live in
 * `strategy/domain/shapes/candle-patterns.ts`.
 *
 * ## The chart is stricter than the engine, on purpose
 *
 * The engine answers with everything it found above a permissive floor,
 * because an API answer that omits a real classification is lying by omission.
 * A chart has the opposite duty: a box on one bar in four communicates less
 * than a box on one bar in twenty, because the reader stops looking. So the
 * two numbers that decide readability — {@link minConfidence} and
 * {@link patterns} — are set here, well inside what the engine would return.
 */
export interface CandlePatternTuning {
  /** Bars after a pattern in which a confirming close still counts. */
  confirmationBars: number;
  /** Bars behind a pattern it must top or bottom to sit at a local extreme. */
  extremeLookback: number;
  /**
   * Score a pattern must reach to be drawn.
   *
   * Seventy-five, against the engine's own floor of forty, and the gap was
   * measured rather than guessed. On synthetic 375-bar sessions the engine's
   * floor marks around 250 bars — two in three — which is not an overlay but a
   * texture. Seventy-five marks twenty to thirty, which is about one bar in
   * fifteen and close to the density of a hand-annotated chart.
   *
   * It also sets the bar semantically: at seventy-five a pattern needs its base
   * score plus either the directional context or a local extreme *and* clean
   * geometry. Nothing gets a box for its shape alone.
   */
  minConfidence: number;
  /**
   * The patterns the chart draws. Everything else is computed and not shown.
   *
   * See {@link CHART_PATTERNS} for which, and why those.
   */
  patterns: readonly string[];
  /**
   * Bars one request carries.
   *
   * The payload is the series, so this is the wire cost as well as the compute
   * cost. Six hundred covers a full day of one-minute bars with room over, and
   * a chart showing more than that has bars narrower than the boxes drawn
   * around them.
   */
  windowBars: number;
  /** Cap on boxes drawn, most convincing kept. */
  maxHits: number;
}

/**
 * The vocabulary the chart draws, out of the full taxonomy the engine knows.
 *
 * This is exactly the thirty-eight patterns named in the published reference
 * this feature was specified against, and nothing else. The engine still
 * classifies every bar against the whole taxonomy — the names left out are
 * computed, and still ride along in a hit's `patterns` list where a bar
 * matched one — but only these are drawn or given a bar's primary label.
 *
 * ## Deliberately absent
 *
 * Three groups, and the distinction matters when reading a chart that seems
 * quieter than expected:
 *
 * - **Not in the reference.** Plain `doji`, `gravestone_doji`, `inside_bar`,
 *   `spinning_top` and `marubozu` are real readings the engine makes and the
 *   reference does not name. They are also, with the exception of the
 *   gravestone, the commonest labels on any chart, so leaving them out is
 *   most of what keeps the overlay readable.
 * - **Unresolved shapes.** `hammer_shape` and `inverted_hammer_shape` are
 *   what a hammer is called when there was no trend to reverse. The four
 *   resolved names are drawn instead; drawing the unresolved one would assert
 *   a direction the data does not carry.
 * - **Dead bars.** `four_price_doji` is the label for any bar under a
 *   twentieth of its ATR.
 *
 * ## The asymmetries are deliberate
 *
 * Several entries have a mirror the engine detects and this list omits:
 * `ladder_bottom` without `ladder_top`, `rising_three_methods` without
 * `falling_three_methods`, `bearish_doji_star` without its bullish twin,
 * `bullish_meeting_lines` and `bullish_separating_lines` without theirs, and
 * `dragonfly_doji` without `gravestone_doji`.
 *
 * That is not an oversight to be tidied up. The reference names one side of
 * each of those pairs and not the other, and this list follows it exactly.
 * Anyone who wants the mirrors has only to add them here — the detection is
 * already there and tested.
 */
export const CHART_PATTERNS: readonly string[] = [
  /* --- single-bar --------------------------------------------------- */
  'hammer',
  'inverted_hammer',
  'dragonfly_doji',
  'bullish_belt_hold',
  'hanging_man',
  'shooting_star',
  'bearish_belt_hold',
  /* --- two-bar ------------------------------------------------------ */
  'bullish_engulfing',
  'bearish_engulfing',
  'bullish_harami',
  'bearish_harami',
  'piercing_line',
  'dark_cloud_cover',
  'bullish_kicker',
  'bearish_kicker',
  'tweezer_bottom',
  'tweezer_top',
  'bearish_doji_star',
  'bullish_meeting_lines',
  'bullish_separating_lines',
  /* --- three-bar ---------------------------------------------------- */
  'morning_star',
  'evening_star',
  'three_white_soldiers',
  'three_black_crows',
  'bullish_abandoned_baby',
  'bearish_abandoned_baby',
  'three_inside_up',
  'three_inside_down',
  'three_outside_up',
  'three_outside_down',
  'upside_gap_two_crows',
  /* --- four-bar ----------------------------------------------------- */
  'bullish_three_line_strike',
  'bearish_three_line_strike',
  'concealing_baby_swallow',
  /* --- five-bar ----------------------------------------------------- */
  'rising_three_methods',
  'bullish_mat_hold',
  'bearish_mat_hold',
  'ladder_bottom',
];

export const defaultCandlePatternTuning: CandlePatternTuning = {
  confirmationBars: 3,
  extremeLookback: 10,
  minConfidence: 75,
  patterns: CHART_PATTERNS,
  windowBars: 600,
  maxHits: 60,
};

/**
 * The tuning as a cache key.
 *
 * Part of what identifies a request, so changing a threshold re-asks rather
 * than redrawing the previous answer. Assembled by hand rather than with
 * `JSON.stringify` so a field added to the interface has to be added here
 * too — silently keying on a subset is how a changed setting appears to do
 * nothing.
 */
export function tuningKey(tuning: CandlePatternTuning): string {
  return [
    tuning.confirmationBars,
    tuning.extremeLookback,
    tuning.minConfidence,
    tuning.windowBars,
    tuning.maxHits,
    // Joined with a character the names cannot contain, so two different
    // lists cannot collide into one key.
    tuning.patterns.join('+'),
  ].join(',');
}
