import {
  CandleSeriesBuffer,
  toCandlestickData,
  toChartTime,
  toVolumeData,
} from './candle-series-buffer';
import { formatIstTime } from './chart-time';
import type { ChartCandleEvent } from './chart-stream.models';

const candle = (
  timestamp: number,
  close: number,
  volume = 0,
  overrides: Partial<ChartCandleEvent> = {},
): ChartCandleEvent => ({
  type: 'CANDLE',
  sessionId: 's1',
  timestamp,
  emittedAt: timestamp,
  instrumentKey: 'NSE_INDEX|Nifty 50',
  timeframe: '1minute',
  open: close - 1,
  high: close + 2,
  low: close - 2,
  close,
  volume,
  openInterest: null,
  isSyntheticGap: false,
  ...overrides,
});

/** 09:15 IST on 2026-08-14. */
const OPEN_MS = Date.parse('2026-08-14T03:45:00.000Z');
const MINUTE = 60_000;

describe('toChartTime', () => {
  it('is re-exported from the buffer for consumers that only import from here', () => {
    expect(toChartTime(1_755_000_000_000)).toBe(1_755_000_000 as never);
  });
});

describe('CandleSeriesBuffer', () => {
  it('keys bars by time so a replayed backlog never duplicates', () => {
    const buffer = new CandleSeriesBuffer();
    buffer.add(candle(1_755_000_000_000, 100));
    buffer.add(candle(1_755_000_060_000, 101));
    // Reconnect: the backend re-sends everything it has produced so far.
    buffer.add(candle(1_755_000_000_000, 100));
    buffer.add(candle(1_755_000_060_000, 101));

    expect(buffer.size).toBe(2);
    expect(buffer.snapshot().length).toBe(2);
  });

  it('lets a repeated bar replace the earlier value', () => {
    const buffer = new CandleSeriesBuffer();
    buffer.add(candle(1_755_000_000_000, 100));
    buffer.add(candle(1_755_000_000_000, 123));

    expect(buffer.snapshot()[0].close).toBe(123);
  });

  it('returns bars ascending by time even when they arrive out of order', () => {
    const buffer = new CandleSeriesBuffer();
    buffer.add(candle(1_755_000_120_000, 102));
    buffer.add(candle(1_755_000_000_000, 100));
    buffer.add(candle(1_755_000_060_000, 101));

    const times = buffer.snapshot().map((bar) => bar.time as number);
    expect(times).toEqual([1_755_000_000, 1_755_000_060, 1_755_000_120]);
  });

  it('carries volume through, and treats a missing one as zero', () => {
    const buffer = new CandleSeriesBuffer();
    buffer.add(candle(OPEN_MS, 100, 1200));
    // An index carries no volume on the wire.
    buffer.add(candle(OPEN_MS + MINUTE, 101, undefined as unknown as number));

    expect(buffer.snapshot().map((b) => b.volume)).toEqual([1200, 0]);
  });

  it('drops everything on clear', () => {
    const buffer = new CandleSeriesBuffer();
    buffer.add(candle(1_755_000_000_000, 100));
    buffer.clear();

    expect(buffer.size).toBe(0);
    expect(buffer.snapshot()).toEqual([]);
  });

  describe('resampled', () => {
    /** Five ascending one-minute bars from the open. */
    function fiveMinutes(buffer: CandleSeriesBuffer): void {
      const closes = [100, 104, 99, 107, 103];
      closes.forEach((close, i) => {
        buffer.add(
          candle(OPEN_MS + i * MINUTE, close, 100 * (i + 1), {
            open: i === 0 ? 100 : closes[i - 1],
            high: close + 3,
            low: close - 3,
          }),
        );
      });
    }

    it('returns the wire series untouched at one minute', () => {
      const buffer = new CandleSeriesBuffer();
      fiveMinutes(buffer);
      expect(buffer.resampled(60).length).toBe(5);
    });

    it('folds five one-minute bars into a single 09:15 five-minute bar', () => {
      const buffer = new CandleSeriesBuffer();
      fiveMinutes(buffer);

      const bars = buffer.resampled(300);
      expect(bars.length).toBe(1);

      const bar = bars[0];
      expect(formatIstTime(bar.time)).toBe('09:15');
      // Open of the first, close of the last, extremes across all five.
      expect(bar.open).toBe(100);
      expect(bar.close).toBe(103);
      expect(bar.high).toBe(110); // 107 + 3
      expect(bar.low).toBe(96); // 99 - 3
      // Per-bar volumes sum; the backend never sends a running total.
      expect(bar.volume).toBe(100 + 200 + 300 + 400 + 500);
    });

    it('starts a new bucket at 09:20 rather than five minutes from the first bar', () => {
      const buffer = new CandleSeriesBuffer();
      fiveMinutes(buffer);
      buffer.add(candle(OPEN_MS + 5 * MINUTE, 110, 600));

      const bars = buffer.resampled(300);
      expect(bars.length).toBe(2);
      expect(bars.map((b) => formatIstTime(b.time))).toEqual(['09:15', '09:20']);
    });

    it('is order-independent: bars arriving late land in the right bucket', () => {
      const inOrder = new CandleSeriesBuffer();
      fiveMinutes(inOrder);

      const shuffled = new CandleSeriesBuffer();
      const closes = [100, 104, 99, 107, 103];
      for (const i of [3, 0, 4, 1, 2]) {
        shuffled.add(
          candle(OPEN_MS + i * MINUTE, closes[i], 100 * (i + 1), {
            open: i === 0 ? 100 : closes[i - 1],
            high: closes[i] + 3,
            low: closes[i] - 3,
          }),
        );
      }

      expect(shuffled.resampled(300)).toEqual(inOrder.resampled(300));
    });

    it('leaves a gap as a gap instead of inventing a flat candle', () => {
      const buffer = new CandleSeriesBuffer();
      buffer.add(candle(OPEN_MS, 100, 10));
      // Nothing traded for the next 10 minutes; the next bar is at 09:30.
      buffer.add(candle(OPEN_MS + 15 * MINUTE, 105, 10));

      const bars = buffer.resampled(300);
      expect(bars.map((b) => formatIstTime(b.time))).toEqual(['09:15', '09:30']);
    });

    it('folds a whole day into one daily bar', () => {
      const buffer = new CandleSeriesBuffer();
      for (let i = 0; i < 375; i++) {
        buffer.add(candle(OPEN_MS + i * MINUTE, 100 + i, 1));
      }

      const bars = buffer.resampled(86_400);
      expect(bars.length).toBe(1);
      expect(bars[0].volume).toBe(375);
      expect(bars[0].close).toBe(474);
    });
  });
});

describe('series adapters', () => {
  it('strips volume out of the candlestick payload', () => {
    const buffer = new CandleSeriesBuffer();
    buffer.add(candle(OPEN_MS, 100, 500));

    const [point] = toCandlestickData(buffer.snapshot());
    expect(Object.keys(point).sort()).toEqual(['close', 'high', 'low', 'open', 'time']);
  });

  it('colours each volume bar by that bar own direction', () => {
    const buffer = new CandleSeriesBuffer();
    buffer.add(candle(OPEN_MS, 100, 500, { open: 99 })); // up
    buffer.add(candle(OPEN_MS + MINUTE, 98, 400, { open: 101 })); // down

    const points = toVolumeData(buffer.snapshot(), 'GREEN', 'RED');
    expect(points.map((p) => p.color)).toEqual(['GREEN', 'RED']);
    expect(points.map((p) => p.value)).toEqual([500, 400]);
  });
});
