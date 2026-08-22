import { CandleSeriesBuffer, toChartTime } from './candle-series-buffer';
import type { ChartCandleEvent } from './chart-stream.models';

const candle = (timestamp: number, close: number): ChartCandleEvent => ({
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
  volume: 0,
  openInterest: null,
  isSyntheticGap: false,
});

describe('toChartTime', () => {
  it('converts epoch milliseconds to epoch seconds', () => {
    expect(toChartTime(1_755_000_000_000)).toBe(1_755_000_000 as never);
  });

  it('floors sub-second precision rather than rounding up', () => {
    expect(toChartTime(1_755_000_000_999)).toBe(1_755_000_000 as never);
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

  it('drops everything on clear', () => {
    const buffer = new CandleSeriesBuffer();
    buffer.add(candle(1_755_000_000_000, 100));
    buffer.clear();

    expect(buffer.size).toBe(0);
    expect(buffer.snapshot()).toEqual([]);
  });
});
