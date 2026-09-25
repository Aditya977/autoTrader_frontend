import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import { bucketStartMs } from '../chart-stream/chart-time';
import type { Setup } from './vwap-ema.models';

/**
 * What the VWAP + 21 EMA overlay draws, as pure functions of a response.
 *
 * Markers only — there are no static price lines to draw. The VWAP and the 21
 * EMA are the chart's own indicators (the Indicators chips), so this overlay
 * adds just the setups on top of them: the rejection/confirmation candle, the
 * entry on its break, the 1R partial, and the final exit. Kept out of the chart
 * component for the same reason `level-rejection-overlay.ts` is: what is drawn
 * can be asserted without a canvas.
 */

/**
 * Marks for every setup: the confirmation candle, the entry, the 1R partial and
 * the exit — each snapped to the bar on screen.
 *
 * Nothing is marked after `notAfterMs`, the close of the newest drawn bar. A
 * replay part-way through a day must not show the entry it has not reached yet.
 */
export function vwapEmaMarkers(
  setups: readonly Setup[],
  displaySeconds: number,
  notAfterMs: number,
): SeriesMarker<UTCTimestamp>[] {
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  const at = (ms: number) => Math.floor(bucketStartMs(ms, displaySeconds) / 1000) as UTCTimestamp;

  for (const setup of setups) {
    const long = setup.direction === 'LONG';

    // The rejection/confirmation candle — where the setup was armed.
    const conf = setup.confirmation;
    if (conf.barTs + 60_000 <= notAfterMs) {
      markers.push({
        time: at(conf.barTs),
        position: long ? 'belowBar' : 'aboveBar',
        shape: 'circle',
        color: '#e0a458',
        text: long ? 'rejection ↑' : 'rejection ↓',
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
      // The 1R partial, when it filled.
      if (trade.scaleOut && trade.scaleOut.ts <= notAfterMs) {
        markers.push({
          time: at(trade.scaleOut.ts - 1),
          position: long ? 'aboveBar' : 'belowBar',
          shape: 'square',
          color: '#c084fc',
          text: `+1R (${Math.round(trade.scaleOut.fraction * 100)}%)`,
        });
      }
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
