/** One VWAP point, in the shape a line series takes. */
export interface VwapPoint {
  /** Bar open time, epoch seconds — the chart's own x value. */
  time: number;
  value: number;
}

/** A bar, reduced to what the line needs. */
export interface VwapBar {
  time: number;
  /** The backend's session VWAP as of this bar, or `null` where it has none. */
  vwap: number | null;
}

/**
 * The volume-weighted average price line, read straight off the bars.
 *
 * ## Why this one is not computed here
 *
 * Every other indicator on this chart is derived locally — the EMA beside it
 * takes closes and an integer and that is the whole calculation. VWAP is the
 * exception, and deliberately so: it is cumulative from the session open, so
 * getting it right needs every bar of the day from the first one, weighted by
 * a volume the chart does not always hold. A user who opens a chart mid-session
 * has the last two hours of bars, and an average computed from those is not the
 * day's VWAP — it is a two-hour VWAP wearing its name, and it sits visibly in
 * the wrong place against the same line on any other platform.
 *
 * The backend already accumulates the real one from the session open and
 * stamps it on each candle as it publishes. Drawing that value is therefore
 * both simpler and more correct than recomputing it, and it guarantees the line
 * on the page and the number the engine trades against are the same number.
 *
 * ## Gaps rather than a flat line
 *
 * A bar whose `vwap` is `null` contributes no point. That is not a rendering
 * nicety — an index reports no volume at all, so its VWAP is `null` for the
 * whole session, and carrying the last known value forward would draw a
 * confident horizontal line across a chart that has no VWAP to show.
 */
export function vwapLine(bars: readonly VwapBar[]): VwapPoint[] {
  const out: VwapPoint[] = [];
  for (const bar of bars) {
    if (bar.vwap === null || !Number.isFinite(bar.vwap)) continue;
    out.push({ time: bar.time, value: bar.vwap });
  }
  return out;
}

/**
 * The one colour VWAP is drawn in.
 *
 * Pink, because every other hue on this chart is spoken for: green and red are
 * the candle bodies and the support and resistance lines, cyan and violet the
 * pattern outlines, the warm ramp the moving averages, and blue the interface
 * chrome. A VWAP in any of those would be read as one of those things.
 */
export const VWAP_COLOR = '#f472b6';
