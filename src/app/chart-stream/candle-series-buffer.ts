import type { CandlestickData, HistogramData, UTCTimestamp } from 'lightweight-charts';
import { bucketStartMs, toChartTime } from './chart-time';
import type { ChartCandleEvent, ChartFormingCandleEvent } from './chart-stream.models';

export { toChartTime } from './chart-time';

/** One bar, at whatever timeframe the buffer was asked to produce it at. */
export interface Bar {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /**
   * The backend's session VWAP at this bar, or `null` where it published none.
   *
   * Carried through rather than recomputed: it is cumulative from the session
   * open, and a chart opened mid-session has no way to rebuild it. See
   * `chart-indicators/vwap.ts`.
   */
  vwap: number | null;
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
  /**
   * The LIVE minute still in progress, kept apart from the closed bars.
   *
   * Apart so that `size` counts closed bars only — consumers key "a bar has
   * closed" off it — and so a forming bar can never overwrite a closed one: a
   * frame that arrives after its minute's `CANDLE` is simply ignored.
   */
  private forming: Bar | null = null;

  /** Idempotent: the same bar arriving twice replaces, never duplicates. */
  add(event: ChartCandleEvent): void {
    const bar = toBar(event);
    this.bars.set(bar.time, bar);
    if (this.forming && this.forming.time <= bar.time) this.forming = null;
  }

  /** The newest LIVE minute so far; replaced by the next one or by its close. */
  setForming(event: ChartFormingCandleEvent): void {
    const bar = toBar(event);
    if (this.bars.has(bar.time)) return;
    this.forming = bar;
  }

  /** Ascending by time — what `setData` requires. Includes the forming bar. */
  snapshot(): Bar[] {
    const closed = [...this.bars.values()].sort((a, b) => a.time - b.time);
    const last = closed[closed.length - 1];
    if (this.forming && (!last || this.forming.time > last.time)) closed.push(this.forming);
    return closed;
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
      // The last bar's value, not a sum or an average of the bucket's: VWAP is
      // already cumulative from the session open, so the newest bar in the
      // bucket carries the figure the whole bucket ends on.
      open.vwap = bar.vwap;
    }
    return [...buckets.values()].sort((a, b) => a.time - b.time);
  }

  get size(): number {
    return this.bars.size;
  }

  clear(): void {
    this.bars.clear();
    this.forming = null;
  }
}

function toBar(event: ChartCandleEvent | ChartFormingCandleEvent): Bar {
  return {
    time: toChartTime(event.timestamp),
    open: event.open,
    high: event.high,
    low: event.low,
    close: event.close,
    // A bar with no volume on the wire (an index carries none) is 0 here,
    // which the histogram simply draws as nothing.
    volume: event.volume ?? 0,
    vwap: event.vwap ?? null,
  };
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
