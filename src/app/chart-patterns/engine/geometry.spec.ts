import type { Candle } from '../types';
import {
  closeness,
  firstCloseBeyond,
  fitLine,
  intersectAt,
  lineValueAt,
  maxDeviation,
} from './geometry';

const at = (index: number, price: number) => ({ index, price });

describe('fitLine', () => {
  it('recovers a line that the points sit on exactly', () => {
    const line = fitLine([at(0, 10), at(10, 20), at(20, 30)]);
    expect(line?.slope).toBeCloseTo(1, 10);
    expect(line?.intercept).toBeCloseTo(10, 10);
  });

  it('fits the least-squares line through scattered points', () => {
    // y = 2x, perturbed symmetrically, so the fit must come back to 2x.
    const line = fitLine([at(0, 1), at(1, 1), at(2, 5), at(3, 5)]);
    expect(line?.slope).toBeCloseTo(1.6, 10);
  });

  /**
   * Two touches on one bar cannot define a boundary. Reporting an infinite
   * slope would poison every comparison downstream, so it flattens instead.
   */
  it('returns a flat line rather than an infinite one when every x is equal', () => {
    const line = fitLine([at(5, 10), at(5, 20)]);
    expect(line?.slope).toBe(0);
    expect(line?.intercept).toBeCloseTo(15, 10);
  });

  it('has nothing to fit through no points', () => {
    expect(fitLine([])).toBeNull();
  });
});

describe('intersectAt', () => {
  it('finds the bar where two converging lines meet', () => {
    // 10 + 1x and 30 − 1x meet where x = 10.
    const x = intersectAt({ slope: 1, intercept: 10 }, { slope: -1, intercept: 30 });
    expect(x).toBeCloseTo(10, 10);
  });

  /** Parallel boundaries are a channel, and a channel has no apex. */
  it('reports no meeting point for parallel lines', () => {
    expect(intersectAt({ slope: 2, intercept: 0 }, { slope: 2, intercept: 5 })).toBeNull();
  });
});

describe('maxDeviation', () => {
  it('is the largest gap from any point to the line', () => {
    const line = { slope: 0, intercept: 100 };
    expect(maxDeviation(line, [at(0, 100), at(1, 103), at(2, 98)])).toBeCloseTo(3, 10);
  });
});

describe('lineValueAt', () => {
  it('reads the line at a bar index', () => {
    expect(lineValueAt({ slope: 0.5, intercept: 10 }, 4)).toBeCloseTo(12, 10);
  });
});

describe('closeness', () => {
  it('is 1 for identical values and 0 once they are a whole tolerance apart', () => {
    expect(closeness(100, 100, 2)).toBe(1);
    expect(closeness(100, 101, 2)).toBeCloseTo(0.5, 10);
    expect(closeness(100, 102, 2)).toBe(0);
    expect(closeness(100, 110, 2)).toBe(0);
  });

  it('treats a zero tolerance as demanding exact equality', () => {
    expect(closeness(100, 100, 0)).toBe(1);
    expect(closeness(100, 100.01, 0)).toBe(0);
  });
});

describe('firstCloseBeyond', () => {
  const candle = (i: number, low: number, high: number, close: number): Candle => ({
    time: 1_700_000_000 + i * 60,
    open: close,
    high,
    low,
    close,
    volume: 1,
  });

  /**
   * The distinction the whole engine rests on.
   *
   * Bar 1's low pierces 100 and it closes back at 101 — the level was tested,
   * not broken. Counting that wick would confirm every pattern on the first
   * nervous spike into its neckline.
   */
  it('ignores a wick through the level and takes the close', () => {
    const candles = [
      candle(0, 101, 105, 103),
      candle(1, 98, 104, 101), // low pierces, close does not
      candle(2, 96, 102, 99), // close is through
    ];
    expect(firstCloseBeyond(candles, 0, () => 100, 'below')).toBe(2);
  });

  it('reads a sloped level at each bar rather than one fixed number', () => {
    const candles = [candle(0, 99, 105, 100), candle(1, 99, 105, 100), candle(2, 99, 105, 100)];
    // Every close is 100. A level rising two points a bar reads 98, 100, 102,
    // so the close is only below it at bar 2 — while a fixed level of 98
    // would never be crossed at all. That difference is the whole point: a
    // sloped neckline has to be read where the bar is, not once.
    expect(firstCloseBeyond(candles, 0, () => 98, 'below')).toBeNull();
    expect(firstCloseBeyond(candles, 0, (i) => 98 + i * 2, 'below')).toBe(2);
  });

  it('starts where it is told to, not at the beginning', () => {
    const candles = [candle(0, 90, 95, 91), candle(1, 99, 105, 103), candle(2, 90, 95, 91)];
    expect(firstCloseBeyond(candles, 1, () => 100, 'below')).toBe(2);
  });

  it('is null when the level is never closed through', () => {
    expect(firstCloseBeyond([candle(0, 99, 105, 103)], 0, () => 50, 'below')).toBeNull();
  });
});
