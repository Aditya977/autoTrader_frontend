import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';
import type { ChartCandleEvent } from './chart-stream.models';

/**
 * The whole ms → s conversion, in one place.
 *
 * `timestamp` on the wire is epoch milliseconds; Lightweight Charts'
 * `UTCTimestamp` is epoch seconds. Passing ms straight through puts bars
 * somewhere around the year 58,000 — the chart renders, it is simply empty
 * where you are looking.
 */
export const toChartTime = (epochMs: number): UTCTimestamp =>
  Math.floor(epochMs / 1000) as UTCTimestamp;

/**
 * Bars keyed by time.
 *
 * The backlog replays on every connect and reconnect, so bars repeat.
 * `series.update()` throws if a bar's time goes backwards relative to the
 * last one, which would crash a naive append-only implementation.
 */
export class CandleSeriesBuffer {
  private readonly bars = new Map<number, CandlestickData<UTCTimestamp>>();

  /** Idempotent: the same bar arriving twice replaces, never duplicates. */
  add(event: ChartCandleEvent): void {
    const time = toChartTime(event.timestamp);
    this.bars.set(time, {
      time,
      open: event.open,
      high: event.high,
      low: event.low,
      close: event.close,
    });
  }

  /** Ascending by time — what `setData` requires. */
  snapshot(): CandlestickData<UTCTimestamp>[] {
    return [...this.bars.values()].sort((a, b) => (a.time as number) - (b.time as number));
  }

  get size(): number {
    return this.bars.size;
  }

  clear(): void {
    this.bars.clear();
  }
}
