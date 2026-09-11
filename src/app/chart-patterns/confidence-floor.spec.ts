import { defaultPatternConfig } from './config';
import { detectPatterns } from './engine/detect-patterns';
import { fromKeypoints, type Keypoint } from './engine/fixtures';
import { scanTimeframes } from './engine/timeframe-scan';
import { readPalette } from './render/styles';
import type { Candle, DetectedPattern } from './types';

/**
 * Only shapes that clear the bar reach the screen.
 *
 * The floor lives in the engine rather than at each drawing surface, which is
 * what makes it consistent: the chart overlay and the per-timeframe table both
 * read the same filtered list, so they cannot disagree about what was good
 * enough to show.
 */

const SHAPE: Keypoint[] = [
  { at: 0, price: 112 },
  { at: 40, price: 100 },
  { at: 60, price: 108 },
  { at: 85, price: 100 },
  { at: 110, price: 114 },
];

const candles = fromKeypoints(SHAPE, { noise: 0.25, seed: 11 });

describe('the confidence floor', () => {
  it('is set at 75%', () => {
    expect(defaultPatternConfig.minConfidence).toBe(0.75);
  });

  it('publishes nothing at or below the floor', () => {
    const { patterns } = detectPatterns(candles);
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(pattern.confidence).toBeGreaterThan(0.75);
    }
  });

  /**
   * Strictly above, not merely reaching.
   *
   * A shape landing exactly on the figure is excluded. The rule reads "above
   * 75% shows, at or below does not", and the only case the distinction ever
   * touches is the one a reader would find arbitrary if it went the other way.
   */
  it('excludes a pattern sitting exactly on the floor', () => {
    const { patterns } = detectPatterns(candles, { minConfidence: 0 });
    const scored = patterns[0];
    expect(scored).toBeDefined();

    const exact = (scored as DetectedPattern).confidence;
    // Asking for a floor equal to a real pattern's own score must drop it.
    const atFloor = detectPatterns(candles, { minConfidence: exact }).patterns;
    expect(atFloor.some((p) => p.id === scored?.id)).toBe(false);

    // A hair below, and the same pattern survives — so the exclusion above was
    // the boundary rule and not the pattern failing some other test.
    const justUnder = detectPatterns(candles, {
      minConfidence: exact - 1e-9,
    }).patterns;
    expect(justUnder.some((p) => p.id === scored?.id)).toBe(true);
  });

  it('drops the weaker shapes that a lower floor would have admitted', () => {
    const loose = detectPatterns(candles, { minConfidence: 0.5 }).patterns;
    const shipped = detectPatterns(candles).patterns;
    expect(shipped.length).toBeLessThanOrEqual(loose.length);
    expect(loose.every((p) => p.confidence > 0.5)).toBe(true);
  });

  /**
   * The table is the second surface the same patterns reach. It reads the
   * engine's output, so it inherits the floor rather than filtering again —
   * two filters would be two places to forget to change.
   */
  it('applies to the per-timeframe table as well as the chart', () => {
    const resample = (seconds: number): Candle[] =>
      seconds <= 60 ? [...candles] : bucket(candles, seconds);
    for (const row of scanTimeframes(resample)) {
      for (const pattern of row.patterns) {
        expect(pattern.confidence).toBeGreaterThan(0.75);
      }
    }
  });
});

/**
 * Pattern colours, kept clear of the ones the chart already spends.
 *
 * Green and red are claimed twice over here: the candle bodies use them, and
 * so do the support and resistance lines. An outline drawn in either would read
 * as a level or as a rising bar rather than as a shape laid over both.
 */
describe('the pattern palette', () => {
  const palette = readPalette();
  const UP = '#26a17b';
  const DOWN = '#ef5350';

  it('shares no colour with support and resistance', () => {
    expect(palette.bullish).not.toBe(UP);
    expect(palette.bullish).not.toBe(DOWN);
    expect(palette.bearish).not.toBe(UP);
    expect(palette.bearish).not.toBe(DOWN);
  });

  it('still tells a bullish shape from a bearish one', () => {
    expect(palette.bullish).not.toBe(palette.bearish);
  });

  it('has a colour for every direction', () => {
    for (const colour of [palette.bullish, palette.bearish, palette.neutral]) {
      expect(colour.length).toBeGreaterThan(0);
    }
  });
});

function bucket(bars: readonly Candle[], seconds: number): Candle[] {
  const out = new Map<number, Candle>();
  for (const bar of bars) {
    const time = Math.floor(bar.time / seconds) * seconds;
    const open = out.get(time);
    if (!open) {
      out.set(time, { ...bar, time });
      continue;
    }
    open.high = Math.max(open.high, bar.high);
    open.low = Math.min(open.low, bar.low);
    open.close = bar.close;
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}
