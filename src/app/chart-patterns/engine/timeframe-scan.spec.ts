import type { Candle } from '../types';
import { fromKeypoints, type Keypoint } from './fixtures';
import { SCAN_TIMEFRAMES, scanTimeframes } from './timeframe-scan';

/** A double bottom, drawn in one-minute bars. */
const SHAPE: Keypoint[] = [
  { at: 0, price: 112 },
  { at: 40, price: 100 },
  { at: 60, price: 108 },
  { at: 85, price: 100 },
  { at: 110, price: 114 },
];

/** The chart buffer's own trick: hold one-minute bars, bucket on demand. */
function resamplerFor(minutes: readonly Candle[]) {
  return (seconds: number): Candle[] => {
    if (seconds <= 60) return [...minutes];
    const buckets = new Map<number, Candle>();
    for (const bar of minutes) {
      const time = Math.floor(bar.time / seconds) * seconds;
      const open = buckets.get(time);
      if (!open) {
        buckets.set(time, { ...bar, time });
        continue;
      }
      open.high = Math.max(open.high, bar.high);
      open.low = Math.min(open.low, bar.low);
      open.close = bar.close;
    }
    return [...buckets.values()].sort((a, b) => a.time - b.time);
  };
}

describe('scanTimeframes', () => {
  const minutes = fromKeypoints(SHAPE, { noise: 0.25, seed: 11, step: 60 });
  const resample = resamplerFor(minutes);

  it('returns a row for every bar size, in order', () => {
    const rows = scanTimeframes(resample);
    expect(rows.map((r) => r.label)).toEqual(SCAN_TIMEFRAMES.map((t) => t.label));
  });

  /**
   * A coarse timeframe over a short series has almost no bars, and the engine
   * refuses a series shorter than its own warm-up. The row still comes back
   * carrying its bar count, because "nothing forming" and "not enough data to
   * say" are different answers and the table has to show which.
   */
  it('reports the bar count even when it found nothing', () => {
    const rows = scanTimeframes(resample);
    const hourly = rows.find((r) => r.label === '1h');
    expect(hourly).toBeDefined();
    expect(hourly?.bars).toBeLessThan(10);
    expect(hourly?.patterns).toEqual([]);
  });

  it('finds the shape at the size it was drawn at', () => {
    const rows = scanTimeframes(resample);
    const oneMinute = rows.find((r) => r.label === '1m');
    expect(oneMinute?.patterns.some((p) => p.type === 'double_bottom')).toBe(true);
  });

  /** Every row excludes the forming bar, exactly as the live path does. */
  it('never scans the newest bar', () => {
    const rows = scanTimeframes(resample);
    const oneMinute = rows.find((r) => r.label === '1m');
    expect(oneMinute?.bars).toBe(minutes.length - 1);
  });

  it('passes the config through to every timeframe', () => {
    const rows = scanTimeframes(resample, { enabledPatterns: ['ascending_triangle'] });
    expect(rows.every((r) => r.patterns.every((p) => p.type === 'ascending_triangle'))).toBe(true);
  });

  it('does not throw on an empty series', () => {
    const rows = scanTimeframes(() => []);
    expect(rows.every((r) => r.patterns.length === 0 && r.bars === 0)).toBe(true);
  });
});
