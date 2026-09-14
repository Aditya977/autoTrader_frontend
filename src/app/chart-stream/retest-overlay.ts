import {
  LineStyle,
  type PriceLineOptions,
  type SeriesMarker,
  type UTCTimestamp,
} from 'lightweight-charts';
import { THEME, fade } from './chart-theme';
import { bucketStartMs } from './chart-time';
import type { ChartRetest, RetestScenario } from './chart-stream.models';

/**
 * Retests → the price lines and markers a chart draws for them.
 *
 * Pure, and deliberately shaped like `priceLineFor` and `markersFor`: no chart,
 * no DOM, no Angular, so the decisions that matter are testable without a
 * canvas and the component stays "call this, hand the result to the series".
 *
 * Three things the drawing has to get right, each of them the reason the
 * backend reports what it reports:
 *
 * 1. **A level is a band.** Every retest draws *two* lines, at `zoneLow` and
 *    `zoneHigh`. Collapsing them to a midpoint puts back exactly the "price
 *    never touched my level" confusion the zone exists to remove — price
 *    genuinely turns inside the band without printing the number.
 *
 * 2. **Quality is continuous, so the drawing is too.** Weight and opacity
 *    follow `quality` rather than a valid/invalid switch, because the backend
 *    scores rather than gates, and rendering a 0.9 and a 0.3 identically would
 *    throw that away at the last step.
 *
 * 3. **Markers land on bars the chart is drawing.** Times are snapped to the
 *    displayed interval, exactly as `trade-markers.ts` does: a retest that
 *    resolved at 10:42 has to mark the 10:40 bar on a 5-minute chart, or it
 *    marks nothing at all.
 *
 * Colour comes from the shared palette, so a retest band under price is the
 * same green as a support line and as an up candle.
 */

/** Short labels for the scenario column — what a trader would call each shape. */
export const SCENARIO_LABELS: Readonly<Record<RetestScenario, string>> = {
  exact: 'Exact retest',
  shallow: 'Shallow (front-run)',
  sweep: 'Wick sweep',
  deep: 'Deep reclaim',
  time: 'Time correction',
  dynamic: 'Dynamic (MA)',
  gap: 'Gap fill',
  range_boundary: 'Range boundary',
  none: 'Unclassified',
};

/** Compact forms for the summary row, where space is one line. */
export const SCENARIO_TAGS: Readonly<Record<RetestScenario, string>> = {
  exact: 'exact',
  shallow: 'shallow',
  sweep: 'sweep',
  deep: 'deep',
  time: 'time',
  dynamic: 'MA',
  gap: 'gap',
  range_boundary: 'range',
  none: '—',
};

/**
 * Opacity from quality, floored at 0.3.
 *
 * Never zero: a retest that was asked for and then drawn invisibly reads as a
 * broken chart, not as a weak signal.
 */
export function opacityFor(quality: number): number {
  const clamped = quality < 0 ? 0 : quality > 1 ? 1 : quality;
  return 0.3 + 0.55 * clamped;
}

/**
 * The two lines that bound one retest's band.
 *
 * Only the upper edge claims a price-scale tag: two axis labels a few ticks
 * apart overlap and neither can be read. An unresolved retest is drawn dotted
 * rather than dashed — the same distinction the backend keeps between `valid`
 * and `unresolved`, and the reason it refuses to guess which one it will
 * become.
 */
export function retestPriceLines(retest: ChartRetest): PriceLineOptions[] {
  const bullish = retest.direction === 'BULLISH';
  const base = bullish ? THEME.up : THEME.down;
  const color = fade(base, opacityFor(retest.quality));
  const lineStyle = retest.unresolved ? LineStyle.Dotted : LineStyle.Dashed;
  const lineWidth = retest.quality >= 0.6 ? 2 : 1;

  const shared = {
    color,
    lineWidth,
    lineStyle,
    lineVisible: true,
    axisLabelColor: fade(base, 0.85),
    axisLabelTextColor: '#06121d',
  } satisfies Partial<PriceLineOptions>;

  return [
    { ...shared, price: retest.zoneHigh, axisLabelVisible: true, title: titleFor(retest) },
    { ...shared, price: retest.zoneLow, axisLabelVisible: false, title: '' },
  ];
}

/**
 * The title on the band's upper edge.
 *
 * Carries the two things the geometry does not show: which shape it was, and
 * how worn the level is. `touchCount` appears from the second touch on,
 * because it is a decay term — by the third or fourth the resting liquidity is
 * largely gone — so "×3" should read as a warning, not as confirmation.
 */
export function titleFor(retest: ChartRetest): string {
  const parts = [SCENARIO_TAGS[retest.scenario]];
  if (retest.touchCount > 1) parts.push(`×${retest.touchCount}`);
  if (retest.htfOnly) parts.push('HTF');
  return parts.join(' ');
}

/**
 * Entry and resumption marks for every retest, snapped to the drawn interval.
 *
 * `displaySeconds` is the interval the chart is *currently* drawing, not the
 * one the retests were detected on: it is the drawn one a marker has to land
 * on. Same rule, and the same `bucketStartMs`, as the trade markers.
 */
export function retestMarkers(
  retests: readonly ChartRetest[],
  displaySeconds: number,
): SeriesMarker<UTCTimestamp>[] {
  const markers: SeriesMarker<UTCTimestamp>[] = [];

  for (const retest of retests) {
    const bullish = retest.direction === 'BULLISH';
    const color = fade(bullish ? THEME.up : THEME.down, opacityFor(retest.quality));

    if (retest.approachAt !== null) {
      markers.push({
        time: snap(retest.approachAt, displaySeconds),
        // On the side price came from, so the mark never covers the wick that
        // did the testing.
        position: bullish ? 'belowBar' : 'aboveBar',
        shape: bullish ? 'arrowUp' : 'arrowDown',
        color,
        text: SCENARIO_TAGS[retest.scenario],
      });
    }

    if (retest.resumptionAt !== null) {
      markers.push({
        time: snap(retest.resumptionAt, displaySeconds),
        position: bullish ? 'belowBar' : 'aboveBar',
        shape: 'circle',
        color,
        text: '',
      });
    }
  }

  // `setMarkers` requires ascending time, and two retests genuinely can resolve
  // into the same bucket once the chart is zoomed out to 15m or coarser.
  return markers.sort((a, b) => (a.time as number) - (b.time as number));
}

/**
 * Every marker source on one chart, merged into the single set the plugin takes.
 *
 * The marker plugin holds one list and `setMarkers` *replaces* it, so trade
 * arrows and retest marks cannot each publish their own — whichever ran last
 * would erase the other. Merging here rather than at the call site keeps that
 * rule in one place and makes it something a test can hold onto.
 */
export function mergeMarkers(
  ...sources: readonly (readonly SeriesMarker<UTCTimestamp>[])[]
): SeriesMarker<UTCTimestamp>[] {
  return sources
    .flat()
    .slice()
    .sort((a, b) => (a.time as number) - (b.time as number));
}

/**
 * Epoch ms → the epoch-seconds time of the bar it falls in.
 *
 * No `- 1` here, unlike `trade-markers.ts`: a trade carries the *close* time of
 * the bar it filled on, so it has to be nudged back inside it, whereas every
 * `*At` on a retest is already a bar **open** time — the same value a candle's
 * `timestamp` carries.
 */
function snap(epochMs: number, displaySeconds: number): UTCTimestamp {
  return Math.floor(bucketStartMs(epochMs, displaySeconds) / 1000) as UTCTimestamp;
}

/**
 * The tooltip: the numbers behind the label.
 *
 * `Opposing bars 0` is spelled out rather than hidden, because it is the
 * counter-intuitive case — a retest with no opposing-colour bar at all is the
 * strongest form of the pattern, not a detection failure.
 */
export function describeRetest(retest: ChartRetest): string {
  const lines = [
    `${SCENARIO_LABELS[retest.scenario]} — ${retest.direction.toLowerCase()}`,
    `Zone ${retest.zoneLow} – ${retest.zoneHigh}`,
    `Gap ${retest.gapAtr.toFixed(2)} ATR${retest.touchedZone ? ', touched' : ''}`,
    `Quality ${Math.round(retest.quality * 100)}%`,
    `Prior touches ${retest.touchCount}`,
    `Opposing bars ${retest.opposingBars}`,
  ];
  if (!retest.levelConsumed) lines.push('Level unconsumed — price often returns');
  if (retest.unresolved) lines.push('Not yet resolved');
  if (retest.htfOnly) lines.push('Visible on a higher timeframe only');
  return lines.join('\n');
}
