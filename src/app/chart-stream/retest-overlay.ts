import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import { THEME, fade } from './chart-theme';
import { bucketStartMs } from './chart-time';
import type { ChartRetest, RetestScenario } from './chart-stream.models';

/**
 * Retests → the marks a chart draws for them.
 *
 * Pure, and deliberately shaped like `markersFor`: no chart, no DOM, no
 * Angular, so the decisions that matter are testable without a canvas and the
 * component stays "call this, hand the result to the series".
 *
 * Retests are *marked*, never drawn as lines. Two dozen of them on one chart is
 * an ordinary afternoon, and a band apiece is four dozen horizontal lines plus
 * their axis tags: the levels they were meant to explain vanish behind them,
 * and so do the candles. A mark on the bar where price came back says the same
 * thing, and says it where the trader is already looking — the numbers behind
 * it live in the tooltip.
 *
 * Two things the marking still has to get right, each of them the reason the
 * backend reports what it reports:
 *
 * 1. **Marks land on bars the chart is drawing.** Times are snapped to the
 *    displayed interval, exactly as `trade-markers.ts` does: a retest that
 *    resolved at 10:42 has to mark the 10:40 bar on a 5-minute chart, or it
 *    marks nothing at all.
 *
 * 2. **One bar carries one mark.** Once snapped, several retests genuinely
 *    share a bar — more so the coarser the chart, and levels cluster anyway —
 *    and the marker plugin stacks their labels straight on top of each other.
 *    Marks that land together are merged into one that names what arrived, so
 *    the chart stays readable at 1m and at 1D.
 *
 * Colour comes from the shared palette, so a retest of a level below price is
 * the same green as a support line and as an up candle.
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

/** Compact forms for the summary row and the marks, where space is one line. */
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

/** How many scenario tags one merged mark spells out before it counts instead. */
const MAX_TAGS_PER_MARK = 2;

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
 * The label one mark carries.
 *
 * Names the shapes that landed on the bar, best-scoring first, and counts the
 * rest rather than spelling them out — four tags on one bar is a word salad the
 * eye skips. `touchCount` rides along while a mark still stands for a single
 * retest, because it is a decay term: by the third or fourth touch the resting
 * liquidity is largely gone, so "×3" should read as a warning rather than as
 * confirmation.
 */
export function labelFor(retests: readonly ChartRetest[]): string {
  const tags: string[] = [];
  for (const retest of retests) {
    const tag = SCENARIO_TAGS[retest.scenario];
    if (!tags.includes(tag)) tags.push(tag);
  }

  const shown = tags.slice(0, MAX_TAGS_PER_MARK);
  const hidden = tags.length - shown.length;
  const parts = [shown.join('/')];
  if (hidden > 0) parts.push(`+${hidden}`);

  const only = retests.length === 1 ? retests[0] : null;
  if (only && only.touchCount > 1) parts.push(`×${only.touchCount}`);
  if (retests.every((retest) => retest.htfOnly)) parts.push('HTF');

  return parts.join(' ');
}

/**
 * One mark per retest, snapped to the drawn interval and merged where they collide.
 *
 * The marked bar is the one the retest was **confirmed** on — the resumption
 * close — because that is the first moment it existed. The backend reads every
 * bar at its own close from the bars before it, so a mark here is exactly what
 * was on screen live, and what the strategy traded; marking the approach bar
 * instead would put it on a candle that, when it printed, had not yet shown a
 * retest at all. A retest still in play has no confirmation yet and marks its
 * approach, the bar it is currently standing on; one with neither is left to
 * the table.
 *
 * `displaySeconds` is the interval the chart is *currently* drawing, not the
 * one the retests were detected on: it is the drawn one a mark has to land on.
 * Same rule, and the same `bucketStartMs`, as the trade markers.
 */
export function retestMarkers(
  retests: readonly ChartRetest[],
  displaySeconds: number,
): SeriesMarker<UTCTimestamp>[] {
  /** bar + side → the retests that landed there. */
  const byBar = new Map<string, { time: UTCTimestamp; bullish: boolean; at: ChartRetest[] }>();

  for (const retest of retests) {
    const at = retest.resumptionAt ?? retest.approachAt;
    if (at === null) continue;

    const bullish = retest.direction === 'BULLISH';
    const time = snap(at, displaySeconds);
    const key = `${time}|${bullish}`;

    const bucket = byBar.get(key);
    if (bucket) bucket.at.push(retest);
    else byBar.set(key, { time, bullish, at: [retest] });
  }

  const markers: SeriesMarker<UTCTimestamp>[] = [];
  for (const { time, bullish, at } of byBar.values()) {
    // Strongest first, so a merged mark is coloured and named by the retest
    // most worth looking at rather than by whichever arrived first.
    at.sort((a, b) => b.quality - a.quality);
    const best = at[0];

    markers.push({
      time,
      // On the side price came from, so the mark never covers the wick that did
      // the testing.
      position: bullish ? 'belowBar' : 'aboveBar',
      // An arrow points the way the move resumed; a retest price never returned
      // to has no such approach to point at.
      shape: best.approachAt === null ? 'circle' : bullish ? 'arrowUp' : 'arrowDown',
      color: fade(bullish ? THEME.up : THEME.down, opacityFor(best.quality)),
      text: labelFor(at),
    });
  }

  // `setMarkers` requires ascending time, and the map is in insertion order.
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
 * Carries what the mark cannot — the band the retest was against, above all.
 * With no lines on the chart this is the only place the zone is spelled out,
 * which is the trade the marking makes: the levels stay legible, and the price
 * pair is one hover away.
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
