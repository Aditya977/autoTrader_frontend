/**
 * Paper positions → what the chart draws for them.
 *
 * Two different jobs, kept apart because the chart draws them with two
 * different primitives:
 *
 * - **marks** ({@link paperMarkers}) for the *events* — the bar the trade was
 *   taken on, the bar it left on. A thing that happened at a time.
 * - **lines** ({@link paperPriceLines}) for the *levels* — entry, stop and
 *   target of whatever is still open. A price, valid across the whole chart,
 *   which a marker fundamentally cannot express.
 *
 * Pure functions returning descriptions, with no chart API imported beyond the
 * marker type: the component turns a `PaperPriceLine` into a `createPriceLine`
 * call, which keeps what-to-draw testable without a canvas. The retest and
 * market-engine overlays in this codebase are built the same way.
 *
 * ## The time snap, again
 *
 * Identical to `strategy/trade-markers.ts` and for the identical reason:
 * Lightweight Charts silently drops a marker whose time falls between two bars,
 * and the chart resamples the one-minute wire into whatever interval is on
 * screen. What differs is that a paper fill is stamped with the bar's **open**
 * — the engine reads `ChartCandleEvent.timestamp`, which is an open time — so
 * this snaps the raw value rather than `time - 1`. Snapping `time - 1` here,
 * by copying the other file, would draw every paper entry one bar to the left.
 */

import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import { bucketStartMs } from '../chart-stream/chart-time';
import type { PaperExitReason, PaperPosition } from './paper-trade.models';

const ENTRY_COLOUR = '#38bdf8';
const CREATED_COLOUR = '#8b9bad';
const EXIT_WIN_COLOUR = '#26a17b';
const EXIT_LOSS_COLOUR = '#ef5350';
const EXIT_FLAT_COLOUR = '#8b9bad';

/** Two or three characters is all a marker has room for. */
const EXIT_TAG: Record<PaperExitReason, string> = {
  STOP_LOSS: 'SL',
  TARGET: 'TGT',
  STRATEGY_EXIT: 'EXIT',
  MANUAL_EXIT: 'MAN',
  SESSION_END: 'EOD',
};

/**
 * Entry and exit marks for the paper positions on one instrument.
 *
 * `displaySeconds` is the interval the chart is drawing *now*, not the one the
 * strategy reasons on — it is the drawn bar a marker has to land on.
 */
export function paperMarkers(
  positions: readonly PaperPosition[],
  displaySeconds: number,
): SeriesMarker<UTCTimestamp>[] {
  const markers: SeriesMarker<UTCTimestamp>[] = [];

  for (const position of positions) {
    // A `CREATED` order has no fill to mark, and marking the moment it was
    // placed would put an entry arrow on a bar no trade was taken on. The
    // position card is where a waiting order belongs.
    if (position.entryTime === null || position.entryPrice === null) continue;

    markers.push({
      time: snap(position.entryTime, displaySeconds),
      position: 'belowBar',
      color: position.status === 'CREATED' ? CREATED_COLOUR : ENTRY_COLOUR,
      shape: 'arrowUp',
      text: `▲ ${position.lots}L @ ${round(position.entryPrice)}`,
    });

    if (position.status === 'EXITED' && position.exitTime !== null) {
      const colour =
        position.netPnl > 0
          ? EXIT_WIN_COLOUR
          : position.netPnl < 0
            ? EXIT_LOSS_COLOUR
            : EXIT_FLAT_COLOUR;
      markers.push({
        time: snap(position.exitTime, displaySeconds),
        position: 'aboveBar',
        color: colour,
        shape: 'arrowDown',
        // The reason, not just the direction: a run of red arrows says nothing,
        // whereas four `SL` in a row says the stop is too tight for this
        // contract.
        text: `${EXIT_TAG[position.exitReason ?? 'MANUAL_EXIT']} ${signed(position.netPnl)}`,
      });
    }
  }

  // `setMarkers` requires ascending time, and an exit and the next entry can
  // land in one bucket once the chart is zoomed out to 15m.
  return markers.sort((a, b) => (a.time as number) - (b.time as number));
}

/** One horizontal line the chart should draw, described without the chart API. */
export interface PaperPriceLine {
  /** Stable across redraws, so the component can diff rather than rebuild. */
  id: string;
  price: number;
  colour: string;
  /** Rendered on the price axis. */
  title: string;
  /** Dashed for the levels that are intentions; solid for the fill that happened. */
  dashed: boolean;
  width: 1 | 2;
}

/**
 * Entry, stop and target of the positions still working on this instrument.
 *
 * Only the live ones. A closed trade's stop is history — it is already told by
 * the exit arrow — and drawing the levels of every trade of the day would bury
 * the chart in lines describing positions nobody holds.
 */
export function paperPriceLines(positions: readonly PaperPosition[]): PaperPriceLine[] {
  const lines: PaperPriceLine[] = [];

  for (const position of positions) {
    if (position.status === 'EXITED') continue;

    // A `CREATED` order still shows its planned levels where the user set them,
    // so the plan is visible before the fill — but its entry line is the
    // reference price, which is a plan rather than a fill, so it is dashed too.
    const filled = position.status === 'ACTIVE' && position.entryPrice !== null;
    const entry = position.entryPrice ?? position.referencePrice;

    lines.push({
      id: `${position.id}:entry`,
      price: entry,
      colour: filled ? ENTRY_COLOUR : CREATED_COLOUR,
      title: filled ? `Entry ${round(entry)}` : `Planned ${round(entry)}`,
      dashed: !filled,
      width: filled ? 2 : 1,
    });

    if (position.stopLoss !== null) {
      lines.push({
        id: `${position.id}:stop`,
        price: position.stopLoss,
        colour: EXIT_LOSS_COLOUR,
        title: `SL ${round(position.stopLoss)}`,
        dashed: true,
        width: 1,
      });
    }

    if (position.target !== null) {
      lines.push({
        id: `${position.id}:target`,
        price: position.target,
        colour: EXIT_WIN_COLOUR,
        title: `Target ${round(position.target)}`,
        dashed: true,
        width: 1,
      });
    }
  }

  return lines;
}

/** Bar open time in epoch ms → the epoch-seconds time of the bucket it opens. */
function snap(epochMs: number, displaySeconds: number): UTCTimestamp {
  return Math.floor(bucketStartMs(epochMs, displaySeconds) / 1000) as UTCTimestamp;
}

function round(value: number): string {
  return value.toFixed(2);
}

function signed(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString('en-IN')}`;
}
