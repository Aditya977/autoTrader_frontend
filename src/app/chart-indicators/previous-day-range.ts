import { LineType } from 'lightweight-charts';
import type { PreviousDayRange } from '../chart-stream/chart-stream.models';
import { istDateKey } from '../chart-stream/chart-time';

/**
 * Turning per-day PDH/PDL/mid into the three lines a chart draws.
 *
 * The arithmetic is not here — the backend derives PDH/PDL from each day's
 * actual 1D candle and this only decides *where on the x axis* each value is
 * drawn. That split is deliberate: `@core/indicators/previous-day-range.ts`
 * server-side is the one definition of what the numbers are, and a strategy
 * reading it gets the same figures the user is looking at.
 *
 * ## Why these are line series and not price lines
 *
 * Lightweight Charts' `createPriceLine` draws a horizontal rule across the
 * *entire* chart, which is right for exactly one case — a chart showing a
 * single day — and wrong for every other. On a multi-day chart each session
 * has its own previous day, so 14 Aug's PDH must stop where 14 Aug's bars stop
 * and 15 Aug's must take over. A line series with a break between days says
 * that; a price line cannot.
 */

/** The three lines, in the order they are created and drawn. */
export const PDR_LINES = ['pdh', 'pdl', 'mid'] as const;
export type PdrLine = (typeof PDR_LINES)[number];

/** A bar, reduced to what this needs. */
export interface PdrBar {
  /** Bar open time, epoch seconds — the chart's own x value. */
  time: number;
}

/**
 * A point on the line, or a break in it.
 *
 * A `value`-less point is Lightweight Charts' whitespace: it occupies the slot
 * on the time scale without drawing anything, which is what separates one
 * day's level from the next instead of joining them with a diagonal.
 */
export interface PdrPoint {
  time: number;
  value?: number;
}

const valueOf = (range: PreviousDayRange, line: PdrLine): number =>
  line === 'pdh' ? range.pdh : line === 'pdl' ? range.pdl : range.mid;

/**
 * One flat-per-day series for each of PDH, PDL and mid, over the bars on
 * screen.
 *
 * **Exactly one point per bar, and never two at the same time.** Lightweight
 * Charts' `setData` asserts strictly increasing timestamps, so the obvious way
 * to break the line between two days — pushing a whitespace point at the
 * boundary bar's own time, before the bar's real point — throws rather than
 * drawing a gap. The break is achieved with {@link PDR_LINE_TYPE} instead: a
 * stepped line holds each day's level flat across that day and turns the
 * change at the boundary into a vertical step, which is what a level that
 * changed overnight actually looks like.
 *
 * The one thing this cannot express is a break between two adjacent days whose
 * level happens to be identical — they render as one continuous line. That is
 * a fair reading of the data rather than a defect: the level genuinely was the
 * same on both days.
 *
 * A day with no range in `ranges` contributes whitespace rather than being
 * skipped: skipping it would join the day before it to the day after with a
 * single straight line, drawing a level across a session that never had one.
 * That is the same reasoning as VWAP's gaps — absent is not zero, and it is
 * not "carry the last value forward" either.
 */
export function previousDayRangeLines(
  bars: readonly PdrBar[],
  ranges: readonly PreviousDayRange[],
): Record<PdrLine, PdrPoint[]> {
  const byDate = new Map(ranges.map((range) => [range.date, range]));
  const out: Record<PdrLine, PdrPoint[]> = { pdh: [], pdl: [], mid: [] };

  for (const bar of bars) {
    const range = byDate.get(istDateKey(bar.time));
    for (const line of PDR_LINES) {
      out[line].push(
        range === undefined ? { time: bar.time } : { time: bar.time, value: valueOf(range, line) },
      );
    }
  }

  return out;
}

/**
 * How the three lines are painted.
 *
 * One hue for all three, because they are one object: a range, plus the
 * halfway mark inside it. Distinguishing them by colour would present three
 * unrelated levels; distinguishing them by weight presents a band with a
 * centre line, which is what it is.
 *
 * The hue is lime because it is the last one this chart has not spent. Green
 * and red are the candles and the support/resistance lines, cyan and violet
 * the pattern outlines, the warm ramp the moving averages, pink the VWAP, and
 * blue the interface chrome — a previous-day level in any of those would be
 * read as one of those things.
 */
export const PDR_COLOR = '#c3d94e';

/**
 * Stepped, not straight — see {@link previousDayRangeLines}.
 *
 * A straight line between the last bar of one day and the first of the next
 * draws a diagonal through prices that were never the level. A step holds each
 * day's value flat and changes it vertically at the boundary, which is both
 * what happened and the only way to separate two days without a whitespace
 * point that `setData` would reject.
 */
export const PDR_LINE_TYPE = LineType.WithSteps;

/** Per-line weight and dash, from the same reasoning as {@link PDR_COLOR}. */
export const PDR_STYLE: Readonly<
  Record<PdrLine, { width: 1 | 2; dashed: boolean; title: string }>
> = {
  // The observed extremes get the weight; the derived midpoint does not.
  pdh: { width: 2, dashed: true, title: 'PDH' },
  pdl: { width: 2, dashed: true, title: 'PDL' },
  mid: { width: 1, dashed: true, title: 'Mid' },
};
