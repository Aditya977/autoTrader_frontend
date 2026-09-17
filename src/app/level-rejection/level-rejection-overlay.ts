import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import { bucketStartMs, istDateKey } from '../chart-stream/chart-time';
import type { DayLevels, LevelType, Setup } from './level-rejection.models';

/**
 * What the level rejection overlay draws, as pure functions of a response.
 *
 * Kept out of the chart component for the same reason `retest-overlay.ts` is:
 * what is drawn can be asserted without a canvas.
 */

export const LEVEL_COLOURS: Record<LevelType, string> = {
  PDH: '#ef5350',
  PDL: '#26a17b',
  PD50: '#8b9bad',
  S1H_HIGH: '#f0a35e',
  S1H_LOW: '#3ba7ff',
};

export const LEVEL_LABELS: Record<LevelType, string> = {
  PDH: 'PDH',
  PDL: 'PDL',
  PD50: 'PD 50%',
  S1H_HIGH: '13:15 1H H',
  S1H_LOW: '13:15 1H L',
};

export interface LevelLine {
  price: number;
  color: string;
  title: string;
}

/**
 * The levels in force on the newest day drawn: the latest `days` entry dated
 * on or before `lastBarSeconds`. Coinciding levels share one line.
 *
 * One day's set rather than every day's, because they are price lines across
 * the whole chart — the same reason the S/R overlay draws only the current set.
 */
export function levelLinesAt(
  days: readonly DayLevels[],
  lastBarSeconds: number | null,
): LevelLine[] {
  const today = lastBarSeconds === null ? null : istDateKey(lastBarSeconds);
  const day = [...days].reverse().find((d) => today === null || d.date <= today);
  if (!day) return [];

  const byPrice = new Map<number, LevelType[]>();
  for (const level of day.levels) {
    byPrice.set(level.price, [...(byPrice.get(level.price) ?? []), level.type]);
  }
  return [...byPrice.entries()].map(([price, types]) => ({
    price,
    color: LEVEL_COLOURS[types[0] as LevelType],
    title: types.map((t) => LEVEL_LABELS[t]).join(' · '),
  }));
}

/**
 * Marks for every setup: the 5M rejection, the 1M break, and the entry and exit
 * when there was one — each snapped to the bar on screen.
 *
 * Nothing is marked after `notAfterMs`, the close of the newest drawn bar. A
 * replay part-way through a day must not show the entry it has not reached yet.
 */
export function levelRejectionMarkers(
  setups: readonly Setup[],
  displaySeconds: number,
  notAfterMs: number,
): SeriesMarker<UTCTimestamp>[] {
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  const at = (ms: number) => Math.floor(bucketStartMs(ms, displaySeconds) / 1000) as UTCTimestamp;

  for (const setup of setups) {
    const long = setup.direction === 'LONG';
    const rejectionClose = setup.rejection.barTs + 5 * 60_000;
    if (rejectionClose > notAfterMs) continue;

    markers.push({
      time: at(setup.rejection.barTs),
      position: long ? 'belowBar' : 'aboveBar',
      shape: 'circle',
      color: '#e0a458',
      text: `${setup.zoneId} ${long ? 'rejection ↑' : 'rejection ↓'}`,
    });

    const structure = setup.structure;
    if (structure && structure.breakTs + 60_000 <= notAfterMs) {
      markers.push({
        time: at(structure.breakTs),
        position: long ? 'belowBar' : 'aboveBar',
        shape: 'square',
        color: '#c084fc',
        text: '1M break',
      });
    }

    const trade = setup.trade;
    if (trade && trade.entryTs <= notAfterMs) {
      markers.push({
        time: at(trade.entryTs),
        position: long ? 'belowBar' : 'aboveBar',
        shape: long ? 'arrowUp' : 'arrowDown',
        color: long ? '#26a17b' : '#ef5350',
        text: `${trade.direction} ${trade.entry}`,
      });
      if (trade.exitTs <= notAfterMs) {
        markers.push({
          // `exitTs` is the close of the exit bar, so step back into it.
          time: at(trade.exitTs - 1),
          position: long ? 'aboveBar' : 'belowBar',
          shape: 'circle',
          color:
            trade.result === 'WIN' ? '#26a17b' : trade.result === 'LOSS' ? '#ef5350' : '#8b9bad',
          text: `${trade.exitReason} ${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R`,
        });
      }
    }
  }
  return markers.sort((a, b) => a.time - b.time);
}
