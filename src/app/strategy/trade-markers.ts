import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import { bucketStartMs } from '../chart-stream/chart-time';
import type { SimTrade } from './strategy.models';

/**
 * Simulated trades → the arrows drawn on the chart.
 *
 * ## Why the times are snapped, and why to `time - 1`
 *
 * Lightweight Charts places a marker on the data point whose time matches; a
 * marker whose time falls between two bars is dropped without a word. The chart
 * resamples the one-minute wire series to whatever interval the user is
 * viewing, so a marker has to be snapped to that same bucket or half of them
 * simply never appear when the timeframe changes.
 *
 * The snap is applied to `time - 1` rather than to `time` because a fill is
 * stamped with the **close** of the bar that produced it, and a bar's close
 * instant is the next bar's open. Snapping the raw value would draw every entry
 * one bar to the right of the bar that decided it — a chart that looks right
 * and is consistently, invisibly late.
 *
 * ## Why a marker is not simply "buy" and "sell"
 *
 * The exit reason is the most useful thing on the chart: a run of green
 * triangles says nothing, whereas seeing that four exits in a row were stops
 * says the stop is too tight for this instrument. So the exit's text carries
 * the reason and its colour follows the trade's own outcome rather than its
 * direction.
 */

const ENTRY_COLOUR = '#4fd1a5';
const EXIT_WIN_COLOUR = '#26a17b';
const EXIT_LOSS_COLOUR = '#ef5350';
const EXIT_FLAT_COLOUR = '#8b9bad';

/** Short label per exit kind — the chart has room for two or three characters. */
const EXIT_LABEL: Record<string, string> = {
  STOP: 'SL',
  TARGET: 'TP',
  SQUARE_OFF: 'SQ',
  SESSION_END: 'EOD',
  SIGNAL: 'X',
};

/**
 * Markers for one chart, from every book trading that chart's instrument.
 *
 * `displaySeconds` is the interval the chart is *currently drawing*, not the
 * strategy's timeframe: the two are independent, and it is the drawn one a
 * marker has to land on.
 */
export function markersFor(
  trades: readonly SimTrade[],
  displaySeconds: number,
): SeriesMarker<UTCTimestamp>[] {
  const markers: SeriesMarker<UTCTimestamp>[] = [];

  for (const trade of trades) {
    markers.push({
      time: snap(trade.entryTime, displaySeconds),
      position: 'belowBar',
      color: ENTRY_COLOUR,
      shape: 'arrowUp',
      text: `B ${trade.lots}L`,
    });

    if (trade.status === 'CLOSED' && trade.exitTime !== null) {
      const outcome =
        trade.netPnl > 0 ? EXIT_WIN_COLOUR : trade.netPnl < 0 ? EXIT_LOSS_COLOUR : EXIT_FLAT_COLOUR;
      const kind = trade.exitReasonKind ?? 'SIGNAL';
      markers.push({
        time: snap(trade.exitTime, displaySeconds),
        position: 'aboveBar',
        color: outcome,
        shape: 'arrowDown',
        text: `${EXIT_LABEL[kind] ?? 'X'} ${formatSigned(trade.netPnl)}`,
      });
    }
  }

  // `setMarkers` requires ascending time, and two trades can close and open in
  // the same bucket once the chart is zoomed out to 15m or coarser.
  return markers.sort((a, b) => (a.time as number) - (b.time as number));
}

/** Epoch ms at a bar close → the epoch-seconds time of the bar it closed. */
function snap(epochMs: number, displaySeconds: number): UTCTimestamp {
  return Math.floor(bucketStartMs(epochMs - 1, displaySeconds) / 1000) as UTCTimestamp;
}

function formatSigned(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString('en-IN')}`;
}
