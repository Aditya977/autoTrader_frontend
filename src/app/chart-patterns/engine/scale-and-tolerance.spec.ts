import { detectPatterns } from './detect-patterns';
import { fromKeypoints, type Keypoint } from './fixtures';

/**
 * The two flaws a real session exposed, and the fixes for them.
 *
 * Both were found the same way: by running the engine over a captured NIFTY
 * option session and asking, for every three-pivot window it rejected, which
 * test did the rejecting. The answers were unambiguous, and neither was a bug
 * in the arithmetic — both were rules that had been written to the wrong scale.
 */

/**
 * A large double top whose legs are made of small wiggles.
 *
 * Two peaks at 130, a trough at 100 between them, and a break below — but the
 * walk to each peak zigzags by six points at a time. That is what an ordinary
 * chart looks like, and it is exactly what a single fine ZigZag cannot
 * describe: at 1.5 ATR the shape resolves into a couple of dozen swings, and a
 * detector reading three *consecutive* pivots never sees the top at all.
 */
const WIGGLY_DOUBLE_TOP: Keypoint[] = [
  { at: 0, price: 100 },
  { at: 8, price: 112 },
  { at: 14, price: 106 },
  { at: 22, price: 120 },
  { at: 28, price: 114 },
  { at: 40, price: 130 },

  { at: 50, price: 118 },
  { at: 58, price: 124 },
  { at: 70, price: 110 },
  { at: 80, price: 116 },
  { at: 100, price: 100 },

  { at: 112, price: 112 },
  { at: 122, price: 106 },
  { at: 136, price: 122 },
  { at: 148, price: 116 },
  { at: 170, price: 130 },

  { at: 185, price: 112 },
  { at: 205, price: 94 },
];

const build = (keypoints: readonly Keypoint[], noise = 0.6) =>
  fromKeypoints(keypoints, { noise, seed: 23 });

describe('detecting at more than one scale', () => {
  const candles = build(WIGGLY_DOUBLE_TOP);

  /**
   * The failure the screenshot showed: a structure obvious to a reader, and
   * nothing drawn on it.
   */
  it('misses the large shape when only the fine scale is used', () => {
    const { patterns } = detectPatterns(candles, { swingScales: [1.5] });
    const big = patterns.filter(
      (p) => p.type === 'double_top' && p.endTime - p.startTime > 100 * 60,
    );
    expect(big.length).toBe(0);
  });

  it('finds it once a coarse pass is run as well', () => {
    const { patterns } = detectPatterns(candles);
    const top = patterns.find((p) => p.type === 'double_top');
    expect(top).toBeDefined();
    expect(top?.direction).toBe('bearish');
    // Spans the whole formation, not one wiggle inside it.
    expect((top?.endTime ?? 0) - (top?.startTime ?? 0)).toBeGreaterThan(100 * 60);
  });

  /**
   * A shape that large also has to be allowed to be that wide. The old
   * 120-bar cap refused it on span alone, whatever the scale found.
   */
  it('allows a pattern wider than the old span cap', () => {
    const { patterns } = detectPatterns(candles, { maxBars: 120 });
    expect(patterns.some((p) => p.type === 'double_top')).toBe(false);
    expect(detectPatterns(candles).patterns.some((p) => p.type === 'double_top')).toBe(true);
  });

  it('does not multiply the same shape across scales', () => {
    const { patterns } = detectPatterns(candles);
    const tops = patterns.filter((p) => p.type === 'double_top');
    // Deduplication keeps one reading of one piece of price action.
    expect(tops.length).toBe(1);
  });
});

describe('equality measured against the shape, not against ATR alone', () => {
  /**
   * Two peaks two points apart on a formation twenty-eight points tall.
   *
   * A reader calls those equal without hesitating. Against a fixed 0.6 ATR —
   * roughly one point on this series — they are three tolerances apart and the
   * pattern is thrown away. On the captured session this was the single most
   * common reason for a rejection.
   */
  const UNEVEN_TOP: Keypoint[] = [
    { at: 0, price: 100 },
    { at: 40, price: 130 },
    { at: 90, price: 100 },
    { at: 140, price: 128 },
    { at: 190, price: 94 },
  ];

  const candles = build(UNEVEN_TOP, 0.3);

  it('accepts peaks that differ by a little of the pattern’s own height', () => {
    const top = detectPatterns(candles).patterns.find((p) => p.type === 'double_top');
    expect(top).toBeDefined();
  });

  it('rejects them again once the height term is switched off', () => {
    const { patterns } = detectPatterns(candles, { equalityHeightPct: 0 });
    expect(patterns.some((p) => p.type === 'double_top')).toBe(false);
  });

  /**
   * Loosening a rule has to stop somewhere. Peaks a third of the height apart
   * are two different peaks, and no share of the height should admit them.
   */
  it('still refuses peaks that are plainly not the same level', () => {
    const wrong: Keypoint[] = [
      { at: 0, price: 100 },
      { at: 40, price: 130 },
      { at: 90, price: 100 },
      { at: 140, price: 119 },
      { at: 190, price: 94 },
    ];
    const { patterns } = detectPatterns(build(wrong, 0.3));
    expect(patterns.some((p) => p.type === 'double_top')).toBe(false);
  });
});
