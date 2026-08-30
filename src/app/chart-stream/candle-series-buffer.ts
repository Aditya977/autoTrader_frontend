import type { CandlestickData, HistogramData, UTCTimestamp } from 'lightweight-charts';
import { bucketStartMs, toChartTime } from './chart-time';
import type { ChartCandleEvent } from './chart-stream.models';

export { toChartTime } from './chart-time';

/** One bar, at whatever timeframe the buffer was asked to produce it at. */
export interface Bar {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * The session's bars, keyed by time.
 *
 * Keyed rather than appended because the backlog replays on every connect and
 * reconnect, so bars repeat: `series.update()` throws if a bar's time goes
 * backwards relative to the last one, which would crash a naive append-only
 * implementation.
 *
 * The buffer holds the wire series (one-minute bars) and resamples on demand.
 * Storing the finest timeframe and deriving the rest is what lets the display
 * interval change without restarting the session — the alternative, asking the
 * backend for a different interval, throws away every bar already received and
 * makes a running LIVE chart flicker back to empty on a dropdown change.
 */
export class CandleSeriesBuffer {
  private readonly bars = new Map<number, Bar>();

  /** Idempotent: the same bar arriving twice replaces, never duplicates. */
  add(event: ChartCandleEvent): void {
    const time = toChartTime(event.timestamp);
    this.bars.set(time, {
      time,
      open: event.open,
      high: event.high,
      low: event.low,
      close: event.close,
      // A bar with no volume on the wire (an index carries none) is 0 here,
      // which the histogram simply draws as nothing.
      volume: event.volume ?? 0,
    });
  }

  /** Ascending by time — what `setData` requires. */
  snapshot(): Bar[] {
    return [...this.bars.values()].sort((a, b) => a.time - b.time);
  }

  /**
   * The series aggregated to `seconds`-wide bars.
   *
   * Open is the first bar's open, close the last bar's close, high/low the
   * extremes, and volume the sum — valid because the backend publishes *per
   * bar* volume (a difference of Upstox's cumulative day total), not the
   * running total itself. Summing a running total would compound it.
   *
   * A bucket with no bars is absent rather than synthesised: a gap in a
   * replayed day is information, and filling it with a flat candle invents
   * a trade that did not happen.
   */
  resampled(seconds: number): Bar[] {
    if (seconds <= 60) return this.snapshot();

    const buckets = new Map<number, Bar>();
    for (const bar of this.snapshot()) {
      const time = Math.floor(bucketStartMs(bar.time * 1000, seconds) / 1000) as UTCTimestamp;
      const open = buckets.get(time);
      if (!open) {
        buckets.set(time, { ...bar, time });
        continue;
      }
      // Ascending iteration, so `close` is always the newest seen so far and
      // `open` never needs revisiting.
      open.high = Math.max(open.high, bar.high);
      open.low = Math.min(open.low, bar.low);
      open.close = bar.close;
      open.volume += bar.volume;
    }
    return [...buckets.values()].sort((a, b) => a.time - b.time);
  }

  get size(): number {
    return this.bars.size;
  }

  clear(): void {
    this.bars.clear();
  }
}

/** `Bar[]` → what the candlestick series takes. */
export function toCandlestickData(bars: readonly Bar[]): CandlestickData<UTCTimestamp>[] {
  return bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
}

/**
 * `Bar[]` → the volume histogram, coloured by the bar's own direction.
 *
 * Colour is decided here rather than by the series' single `color` option so
 * an up-bar and a down-bar read the same way in the histogram as they do in
 * the candles above it.
 */
export function toVolumeData(
  bars: readonly Bar[],
  upColor: string,
  downColor: string,
): HistogramData<UTCTimestamp>[] {
  return bars.map((bar) => ({
    time: bar.time,
    value: bar.volume,
    color: bar.close >= bar.open ? upColor : downColor,
  }));
}
