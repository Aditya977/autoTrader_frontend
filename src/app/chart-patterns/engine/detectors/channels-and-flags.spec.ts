import { detectPatterns } from '../detect-patterns';
import { fromKeypoints, type Keypoint } from '../fixtures';
import { ALL_PATTERN_TYPES, defaultPatternConfig } from '../../config';
import { PATTERN_NAMES, type PatternType } from '../../types';
import { atr } from '../atr';
import { findPivots } from '../pivots';
import { detectChannels } from './channels';

/**
 * The four families added to cover the published reference: wedges,
 * rectangles, flags and pennants.
 *
 * Driven through `detectPatterns` rather than the detectors directly, because
 * three of the four bugs found while writing them were not in the geometry at
 * all — they were in how the new shapes interacted with the old ones. A
 * rectangle outscoring the double top it was drawn on top of, and a "bear
 * flag" fitted to the middle of an ordinary decline, are both invisible to a
 * test that calls one detector in isolation.
 */

const build = (keypoints: readonly Keypoint[], noise = 0.3) =>
  fromKeypoints(keypoints, { noise, seed: 11 });

/** No confidence floor, so a shape is judged on its geometry alone. */
const found = (keypoints: readonly Keypoint[], noise = 0.3): PatternType[] =>
  detectPatterns(build(keypoints, noise), { minConfidence: 0 }).patterns.map((p) => p.type);

describe('the vocabulary', () => {
  it('offers every pattern the reference names', () => {
    for (const required of [
      'double_top',
      'double_bottom',
      'head_and_shoulders',
      'ascending_triangle',
      'symmetrical_triangle',
      'rising_wedge',
      'falling_wedge',
      'rectangle',
      'bullish_flag',
      'bearish_flag',
      'bullish_pennant',
      'bearish_pennant',
    ] as PatternType[]) {
      expect(ALL_PATTERN_TYPES).toContain(required);
    }
  });

  it('names every type it can report', () => {
    for (const type of ALL_PATTERN_TYPES) {
      expect(PATTERN_NAMES[type]).toBeTruthy();
    }
  });

  it('enables them all by default', () => {
    expect(defaultPatternConfig.enabledPatterns).toBe(ALL_PATTERN_TYPES);
  });
});

describe('wedges', () => {
  /**
   * A rising wedge: higher highs and higher lows, the lows gaining faster, so
   * the two boundaries close on each other while price still climbs.
   *
   * It is bearish precisely because of that — price is working harder for less
   * room, which is why the pattern points against its own slope.
   */
  it('finds a rising wedge, and reads it as bearish', () => {
    const keypoints: Keypoint[] = [
      { at: 0, price: 100 },
      { at: 20, price: 120 },
      { at: 40, price: 106 },
      { at: 60, price: 124 },
      { at: 80, price: 114 },
      { at: 100, price: 127 },
      { at: 120, price: 121 },
      { at: 160, price: 100 },
    ];
    const { patterns } = detectPatterns(build(keypoints), { minConfidence: 0 });
    const wedge = patterns.find((p) => p.type === 'rising_wedge');
    expect(wedge).toBeDefined();
    expect(wedge?.direction).toBe('bearish');
  });

  it('finds a falling wedge, and reads it as bullish', () => {
    const keypoints: Keypoint[] = [
      { at: 0, price: 130 },
      { at: 20, price: 110 },
      { at: 40, price: 125 },
      { at: 60, price: 107 },
      { at: 80, price: 120 },
      { at: 100, price: 104 },
      { at: 120, price: 116 },
      { at: 140, price: 101 },
      { at: 180, price: 140 },
    ];
    const { patterns } = detectPatterns(build(keypoints), { minConfidence: 0 });
    const wedge = patterns.find((p) => p.type === 'falling_wedge');
    expect(wedge).toBeDefined();
    expect(wedge?.direction).toBe('bullish');
  });

  /**
   * Two boundaries rising in parallel are a channel, not a wedge.
   *
   * Nothing about a corridor says the trend is tiring, and the squeeze is the
   * whole content of the pattern.
   */
  it('refuses a parallel rising channel', () => {
    const keypoints: Keypoint[] = [
      { at: 0, price: 100 },
      { at: 20, price: 115 },
      { at: 40, price: 105 },
      { at: 60, price: 120 },
      { at: 80, price: 110 },
      { at: 100, price: 125 },
      { at: 120, price: 115 },
    ];
    expect(found(keypoints)).not.toContain('rising_wedge');
  });
});

describe('rectangles', () => {
  /**
   * A level tested three times either side, which is what a range is.
   *
   * Asked of the detector rather than of the whole engine, and deliberately.
   * A range this clean also contains a double bottom on its first two lows,
   * and which of the two survives is the deduplication policy's call, not this
   * detector's — testing through the engine here would be asserting that
   * policy while appearing to test geometry.
   */
  it('finds a range that was repeatedly respected', () => {
    const keypoints: Keypoint[] = [
      { at: 0, price: 100 },
      { at: 20, price: 120 },
      { at: 40, price: 101 },
      { at: 60, price: 119 },
      { at: 80, price: 100 },
      { at: 100, price: 120 },
      { at: 120, price: 101 },
      { at: 160, price: 135 },
    ];
    const candles = build(keypoints);
    const atrs = atr(candles, defaultPatternConfig.atrPeriod);
    const pivots = findPivots(candles, atrs, defaultPatternConfig.swingScales[0] as number);
    const found = detectChannels({ candles, atrs, pivots, config: defaultPatternConfig });

    const rectangle = found.find((p) => p.type === 'rectangle');
    expect(rectangle).toBeDefined();
    // A range says nothing about direction until price leaves it.
    expect(['bullish', 'neutral']).toContain(rectangle?.direction as string);
  });

  /**
   * Four pivots are a double top, not a rectangle.
   *
   * Two highs and two lows is the fewest that define any pair of boundaries,
   * and on exactly that many the two readings are the same four points. The
   * more specific name wins — this was a real regression, where a rectangle
   * scoring 0.83 suppressed the double top those bars had formed.
   */
  it('yields to a double top on the four pivots they share', () => {
    const keypoints: Keypoint[] = [
      { at: 0, price: 100 },
      { at: 40, price: 130 },
      { at: 90, price: 100 },
      { at: 140, price: 128 },
      { at: 190, price: 94 },
    ];
    const types = found(keypoints);
    expect(types).toContain('double_top');
    expect(types).not.toContain('rectangle');
  });

  /**
   * The height floor does what it says.
   *
   * Stated as a comparison rather than as a hand-built shallow fixture, and
   * that is the honest way to test it: the threshold is ATR-relative, and on a
   * synthetic series the noise that makes a band look shallow raises the ATR
   * by the same proportion. Two runs over one fixture isolate the knob from
   * the fixture.
   */
  it('drops a range once the height floor is raised past it', () => {
    const keypoints: Keypoint[] = [
      { at: 0, price: 100 },
      { at: 20, price: 120 },
      { at: 40, price: 101 },
      { at: 60, price: 119 },
      { at: 80, price: 100 },
      { at: 100, price: 120 },
      { at: 120, price: 101 },
      { at: 160, price: 135 },
    ];
    const candles = build(keypoints);
    const atrs = atr(candles, defaultPatternConfig.atrPeriod);
    const pivots = findPivots(candles, atrs, defaultPatternConfig.swingScales[0] as number);

    const asIs = detectChannels({ candles, atrs, pivots, config: defaultPatternConfig });
    expect(asIs.some((p) => p.type === 'rectangle')).toBe(true);

    const strict = detectChannels({
      candles,
      atrs,
      pivots,
      config: { ...defaultPatternConfig, rectangleMinHeightAtr: 100 },
    });
    expect(strict.some((p) => p.type === 'rectangle')).toBe(false);
  });
});

describe('flags and pennants', () => {
  /** A near-vertical rise, a shallow drift back, then the move resuming. */
  const BULL_FLAG: Keypoint[] = [
    { at: 0, price: 100 },
    { at: 10, price: 145 },
    { at: 18, price: 138 },
    { at: 26, price: 141 },
    { at: 34, price: 136 },
    { at: 55, price: 190 },
  ];

  it('finds a bull flag and points it the way the pole went', () => {
    const { patterns } = detectPatterns(build(BULL_FLAG), { minConfidence: 0 });
    const flag = patterns.find((p) => p.type === 'bullish_flag' || p.type === 'bullish_pennant');
    expect(flag).toBeDefined();
    expect(flag?.direction).toBe('bullish');
  });

  it('finds a bear flag on the mirror', () => {
    const mirrored: Keypoint[] = BULL_FLAG.map((k) => ({ at: k.at, price: 290 - k.price }));
    const { patterns } = detectPatterns(build(mirrored), { minConfidence: 0 });
    const flag = patterns.find((p) => p.type === 'bearish_flag' || p.type === 'bearish_pennant');
    expect(flag).toBeDefined();
    expect(flag?.direction).toBe('bearish');
  });

  /**
   * The rule that stopped the detector fitting flags to ordinary declines.
   *
   * A steady fall reads as fifteen bars of pole followed by a channel of
   * constant width sloping the same way. Every geometric test passes, and the
   * result scored 0.96 while describing nothing — the channel is not a pause
   * in the move, it is more of the move.
   */
  it('refuses a consolidation that runs with the pole rather than against it', () => {
    const steadyFall: Keypoint[] = [
      { at: 0, price: 160 },
      { at: 60, price: 100 },
      { at: 120, price: 60 },
    ];
    const types = found(steadyFall);
    expect(types).not.toContain('bearish_flag');
    expect(types).not.toContain('bearish_pennant');
  });

  /**
   * A drift is not a pole.
   *
   * The same total move stretched over enough bars is ordinary trend. Without
   * a steepness rule five bars in six of a gently oscillating series qualified
   * as a flagpole, which was both wrong and the reason the whole engine spent
   * six times its time budget.
   */
  it('refuses a pole that took too long to be one', () => {
    const slowRise: Keypoint[] = [
      { at: 0, price: 100 },
      { at: 120, price: 130 },
      { at: 140, price: 128 },
      { at: 160, price: 129 },
      { at: 200, price: 160 },
    ];
    const types = found(slowRise);
    expect(types).not.toContain('bullish_flag');
    expect(types).not.toContain('bullish_pennant');
  });

  /** A rest that gives the pole back has undone the move it was resting from. */
  it('refuses a consolidation that retraced the whole pole', () => {
    // The give-back has to be quick as well as complete. Spread over enough
    // bars, the first part of it is a shallow pullback and genuinely is a
    // flag — it is only the whole retracement that is not one.
    const deepRetrace: Keypoint[] = [
      { at: 0, price: 100 },
      { at: 10, price: 145 },
      { at: 18, price: 105 },
      { at: 40, price: 190 },
    ];
    const types = found(deepRetrace);
    expect(types).not.toContain('bullish_flag');
    expect(types).not.toContain('bullish_pennant');
  });
});
