import { atr } from './atr';
import { fromKeypoints } from './fixtures';
import { findPivots } from './pivots';

/** The engine's own two steps, run together the way a detector sees them. */
function pivotsOf(
  keypoints: readonly { at: number; price: number }[],
  minSwingAtr = 1.5,
  noise = 0.3,
) {
  const candles = fromKeypoints(keypoints, { noise, seed: 7 });
  return { candles, pivots: findPivots(candles, atr(candles, 14), minSwingAtr) };
}

describe('findPivots', () => {
  const zigzag = [
    { at: 0, price: 100 },
    { at: 30, price: 120 },
    { at: 60, price: 104 },
    { at: 90, price: 126 },
    { at: 120, price: 108 },
  ];

  /**
   * The property every detector below depends on. Each reads a fixed window —
   * three pivots, or five — and would happily match nonsense against two highs
   * in a row.
   */
  it('alternates high and low, with no two of a kind in a row', () => {
    const { pivots } = pivotsOf(zigzag);
    expect(pivots.length).toBeGreaterThan(2);
    for (let i = 1; i < pivots.length; i++) {
      expect(pivots[i]?.kind).not.toBe(pivots[i - 1]?.kind);
    }
  });

  it('finds the turns the fixture was built around', () => {
    const { pivots } = pivotsOf(zigzag);
    const highs = pivots.filter((p) => p.kind === 'high').map((p) => p.price);
    const lows = pivots.filter((p) => p.kind === 'low').map((p) => p.price);
    // Within the noise band of the keypoints, not exactly on them.
    expect(highs.some((p) => Math.abs(p - 120) < 1)).toBe(true);
    expect(highs.some((p) => Math.abs(p - 126) < 1)).toBe(true);
    expect(lows.some((p) => Math.abs(p - 104) < 1)).toBe(true);
  });

  /**
   * A pivot sits on the bar the extreme happened, not on the bar the reversal
   * was recognised. Those are different bars, and drawing the second would put
   * every pattern's shoulders and troughs to the right of where they are.
   */
  it('places a pivot on the extreme, not on the bar that confirmed it', () => {
    const { candles, pivots } = pivotsOf(zigzag);
    const peak = pivots.find((p) => p.kind === 'high' && Math.abs(p.price - 120) < 1);
    expect(peak).toBeDefined();
    // The fixture's first peak is at bar 30.
    expect(Math.abs((peak?.index ?? -1) - 30)).toBeLessThanOrEqual(2);
    expect(peak?.time).toBe(candles[peak?.index ?? 0]?.time);
  });

  /**
   * Standing on an extreme, nobody knows it is one. The newest pivot is the
   * running extreme and is flagged so a detector can refuse to confirm on it.
   */
  it('flags only the newest pivot as provisional', () => {
    const { pivots } = pivotsOf(zigzag);
    const provisional = pivots.filter((p) => p.provisional);
    expect(provisional.length).toBe(1);
    expect(pivots[pivots.length - 1]?.provisional).toBe(true);
  });

  /**
   * The threshold is what separates a swing from a wiggle. Raising it must
   * strictly reduce what is registered, or it is not doing anything.
   */
  it('registers fewer swings as the threshold rises', () => {
    const noisy = [
      { at: 0, price: 100 },
      { at: 10, price: 106 },
      { at: 20, price: 101 },
      { at: 30, price: 107 },
      { at: 40, price: 102 },
      { at: 50, price: 130 },
      { at: 80, price: 105 },
    ];
    const loose = pivotsOf(noisy, 0.75).pivots.length;
    const strict = pivotsOf(noisy, 4).pivots.length;
    expect(strict).toBeLessThan(loose);
  });

  it('finds nothing in a series with no room to turn', () => {
    const candles = fromKeypoints(
      [
        { at: 0, price: 100 },
        { at: 5, price: 100 },
      ],
      { noise: 0 },
    );
    expect(findPivots(candles, atr(candles, 14), 1.5)).toEqual([]);
  });

  it('does not throw on an empty or single-bar series', () => {
    expect(findPivots([], [], 1.5)).toEqual([]);
    const one = fromKeypoints(
      [
        { at: 0, price: 100 },
        { at: 1, price: 101 },
      ],
      { noise: 0 },
    ).slice(0, 1);
    expect(findPivots(one, atr(one, 14), 1.5)).toEqual([]);
  });
});
