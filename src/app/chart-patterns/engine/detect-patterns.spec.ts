import type { PatternConfig } from '../config';
import type { Candle, DetectedPattern, PatternType } from '../types';
import { detectPatterns } from './detect-patterns';
import { fromKeypoints, seeded, type Keypoint } from './fixtures';

const run = (candles: readonly Candle[], overrides: Partial<PatternConfig> = {}) =>
  detectPatterns(candles, overrides);

const find = (patterns: readonly DetectedPattern[], type: PatternType) =>
  patterns.find((p) => p.type === type);

const build = (keypoints: readonly Keypoint[], noise = 0.25) =>
  fromKeypoints(keypoints, { noise, seed: 11 });

/* ------------------------------------------------------------------ *
 * Shapes. Each keypoint is a genuine turn, so the pivot finder has
 * something to find — a keypoint mid-way through a monotonic run is not
 * a swing and would simply be walked through.
 * ------------------------------------------------------------------ */

/** Two equal lows around a peak at 108. Stops short of the neckline. */
const DOUBLE_BOTTOM_FORMING: Keypoint[] = [
  { at: 0, price: 112 },
  { at: 40, price: 100 },
  { at: 60, price: 108 },
  { at: 85, price: 100 },
  { at: 110, price: 105 },
];

/** The same, carried through the neckline. */
const DOUBLE_BOTTOM_CONFIRMED: Keypoint[] = [
  ...DOUBLE_BOTTOM_FORMING.slice(0, 4),
  { at: 110, price: 114 },
];

const HEAD_AND_SHOULDERS: Keypoint[] = [
  { at: 0, price: 100 },
  { at: 25, price: 112 },
  { at: 45, price: 104 },
  { at: 70, price: 122 },
  { at: 95, price: 104.5 },
  { at: 118, price: 112 },
  { at: 145, price: 96 },
];

/**
 * Flat resistance at 110, support rising exactly one point per ten bars.
 *
 * The touches are deliberately collinear. A detector that requires every
 * touch to sit on its own fitted line is doing its job, so a fixture whose
 * "boundary" bends slightly tests the tolerance rather than the shape — and
 * fails or passes on which way the noise fell.
 */
const ASCENDING_TRIANGLE: Keypoint[] = [
  { at: 0, price: 110 },
  { at: 20, price: 100 },
  { at: 40, price: 110 },
  { at: 60, price: 104 },
  { at: 80, price: 110 },
  { at: 100, price: 108 },
  { at: 125, price: 120 },
];

describe('detectPatterns', () => {
  describe('double bottom', () => {
    it('finds it, bullish, with the neckline at the middle peak', () => {
      const { patterns } = run(build(DOUBLE_BOTTOM_CONFIRMED));
      const found = find(patterns, 'double_bottom');
      expect(found).toBeDefined();
      expect(found?.direction).toBe('bullish');

      const neckline = found?.lines.find((l) => l.role === 'neckline');
      expect(neckline).toBeDefined();
      expect(neckline?.from.price).toBeCloseTo(108, 0);
      // Horizontal: a double bottom's neckline is one price, not a fit.
      expect(neckline?.from.price).toBeCloseTo(neckline?.to.price ?? 0, 6);
    });

    it('confirms only once a close clears the neckline', () => {
      expect(find(run(build(DOUBLE_BOTTOM_CONFIRMED)).patterns, 'double_bottom')?.status).toBe(
        'confirmed',
      );
      expect(find(run(build(DOUBLE_BOTTOM_FORMING)).patterns, 'double_bottom')?.status).toBe(
        'forming',
      );
    });

    /**
     * The measured move: the pattern's own height projected from the break.
     * Neckline 108 over lows at 100 is eight points of height, so the target
     * sits near 116.
     */
    it('projects the target by the pattern’s own height', () => {
      const found = find(run(build(DOUBLE_BOTTOM_CONFIRMED)).patterns, 'double_bottom');
      expect(found?.target).toBeCloseTo(116, 0);
    });

    it('marks a breakout where the confirming close happened', () => {
      const found = find(run(build(DOUBLE_BOTTOM_CONFIRMED)).patterns, 'double_bottom');
      expect(found?.breakout).toBeDefined();
      expect(found?.breakout?.price).toBeGreaterThan(108);
    });

    /** Two lows a long way apart are a downtrend and a bounce, not a retest. */
    it('refuses two lows further apart than the tolerance', () => {
      const unequal: Keypoint[] = [
        { at: 0, price: 112 },
        { at: 40, price: 100 },
        { at: 60, price: 108 },
        { at: 85, price: 94 },
        { at: 110, price: 114 },
      ];
      expect(find(run(build(unequal)).patterns, 'double_bottom')).toBeUndefined();
    });

    /**
     * Without a real pullback between them, the two lows are one low.
     *
     * Driven through the config rather than through a quiet fixture, and the
     * reason is worth recording. Depth is measured in ATRs, and ATR is a
     * trailing average of the pattern’s own bars — so a shallow trough in a
     * quiet stretch shrinks the unit along with itself and stays, correctly, a
     * significant pullback for that market. The rule to test is therefore
     * "does the depth requirement bind", not "is 0.8 points small".
     */
    it('refuses a trough too shallow to be a pullback', () => {
      const candles = build(DOUBLE_BOTTOM_CONFIRMED);
      expect(find(run(candles).patterns, 'double_bottom')).toBeDefined();
      // The same shape, asked for a pullback deeper than it has.
      expect(find(run(candles, { minDepthAtr: 60 }).patterns, 'double_bottom')).toBeUndefined();
    });

    /**
     * Price ran back through both lows before it ever cleared the neckline.
     * Whatever that was, it was not a double bottom, and it is dropped rather
     * than shown as a failure.
     */
    it('drops the pattern when price breaks the wrong way first', () => {
      const failed: Keypoint[] = [
        { at: 0, price: 112 },
        { at: 40, price: 100 },
        { at: 60, price: 108 },
        { at: 85, price: 100 },
        { at: 115, price: 92 },
      ];
      expect(find(run(build(failed)).patterns, 'double_bottom')).toBeUndefined();
    });
  });

  describe('head and shoulders', () => {
    it('finds it, bearish, with five anchor pivots', () => {
      const found = find(run(build(HEAD_AND_SHOULDERS)).patterns, 'head_and_shoulders');
      expect(found).toBeDefined();
      expect(found?.direction).toBe('bearish');
      expect(found?.pivots.length).toBe(5);
      expect(found?.pivots.map((p) => p.kind)).toEqual(['high', 'low', 'high', 'low', 'high']);
    });

    it('confirms on a close through the neckline', () => {
      const found = find(run(build(HEAD_AND_SHOULDERS)).patterns, 'head_and_shoulders');
      expect(found?.status).toBe('confirmed');
      expect(found?.breakout).toBeDefined();
    });

    it('labels itself with name, direction and status', () => {
      const found = find(run(build(HEAD_AND_SHOULDERS)).patterns, 'head_and_shoulders');
      expect(found?.label.text).toBe('Head and shoulders · Bearish · Confirmed');
      expect(found?.label.placement).toBe('above');
    });

    /** Three peaks of one height is a triple top, and it is not this. */
    it('refuses a head that does not clear its shoulders', () => {
      const flatHead: Keypoint[] = [
        { at: 0, price: 100 },
        { at: 25, price: 112 },
        { at: 45, price: 104 },
        { at: 70, price: 112.3 },
        { at: 95, price: 104.5 },
        { at: 118, price: 112 },
        { at: 145, price: 96 },
      ];
      expect(find(run(build(flatHead)).patterns, 'head_and_shoulders')).toBeUndefined();
    });

    it('refuses shoulders too unequal to be a pair', () => {
      const lopsided: Keypoint[] = [
        { at: 0, price: 100 },
        { at: 25, price: 112 },
        { at: 45, price: 104 },
        { at: 70, price: 122 },
        { at: 95, price: 104.5 },
        { at: 118, price: 106 },
        { at: 145, price: 96 },
      ];
      expect(find(run(build(lopsided)).patterns, 'head_and_shoulders')).toBeUndefined();
    });

    /**
     * A neckline steep enough is the trend itself. Left unbounded this
     * detector would report a confirmed reversal on every bar of an ordinary
     * decline, because each one closes below a line drawn through two of its
     * own lows.
     */
    it('refuses a neckline steep enough to be the trend', () => {
      const steep: Keypoint[] = [
        { at: 0, price: 140 },
        { at: 25, price: 132 },
        { at: 45, price: 120 },
        { at: 70, price: 142 },
        { at: 95, price: 82 },
        { at: 118, price: 132 },
        { at: 145, price: 40 },
      ];
      const found = find(run(build(steep, 0.6)).patterns, 'head_and_shoulders');
      expect(found).toBeUndefined();
    });
  });

  describe('inverse head and shoulders', () => {
    it('mirrors the regular one and reads bullish', () => {
      const mirrored = HEAD_AND_SHOULDERS.map((k) => ({ at: k.at, price: 220 - k.price }));
      const found = find(run(build(mirrored)).patterns, 'inverse_head_and_shoulders');
      expect(found).toBeDefined();
      expect(found?.direction).toBe('bullish');
      expect(found?.label.placement).toBe('below');
      expect(found?.pivots.map((p) => p.kind)).toEqual(['low', 'high', 'low', 'high', 'low']);
    });
  });

  describe('triangles', () => {
    it('finds an ascending triangle with a flat top and a rising floor', () => {
      const found = find(run(build(ASCENDING_TRIANGLE)).patterns, 'ascending_triangle');
      expect(found).toBeDefined();
      expect(found?.direction).toBe('bullish');

      const resistance = found?.lines.find((l) => l.role === 'resistance');
      const support = found?.lines.find((l) => l.role === 'support');
      expect(resistance).toBeDefined();
      expect(support).toBeDefined();
      // Flat top.
      expect(resistance?.from.price).toBeCloseTo(resistance?.to.price ?? 0, 0);
      // Rising floor.
      expect(support?.to.price ?? 0).toBeGreaterThan(support?.from.price ?? 0);
    });

    it('finds a descending triangle and reads it bearish', () => {
      const mirrored = ASCENDING_TRIANGLE.map((k) => ({ at: k.at, price: 220 - k.price }));
      const found = find(run(build(mirrored)).patterns, 'descending_triangle');
      expect(found).toBeDefined();
      expect(found?.direction).toBe('bearish');
    });

    /** Parallel boundaries are a channel. A channel has no apex to squeeze to. */
    it('refuses boundaries that never converge', () => {
      const channel: Keypoint[] = [
        { at: 0, price: 110 },
        { at: 20, price: 100 },
        { at: 40, price: 110 },
        { at: 60, price: 100 },
        { at: 80, price: 110 },
        { at: 100, price: 100 },
        { at: 120, price: 110 },
      ];
      const { patterns } = run(build(channel));
      expect(patterns.filter((p) => p.type.endsWith('triangle')).length).toBe(0);
    });

    /**
     * An ascending triangle that breaks downward has failed, not confirmed.
     * Publishing it as a bullish pattern pointing the wrong way would be worse
     * than publishing nothing.
     */
    it('drops an ascending triangle that breaks the wrong way', () => {
      // slice(0, 6) drops the upward break, so the only exit is downward.
      const wrongWay: Keypoint[] = [...ASCENDING_TRIANGLE.slice(0, 6), { at: 130, price: 96 }];
      expect(find(run(build(wrongWay)).patterns, 'ascending_triangle')).toBeUndefined();
    });
  });

  describe('the pass as a whole', () => {
    it('gives every pattern a confidence inside 0..1', () => {
      const { patterns } = run(build(HEAD_AND_SHOULDERS));
      expect(patterns.length).toBeGreaterThan(0);
      for (const p of patterns) {
        expect(p.confidence).toBeGreaterThanOrEqual(0);
        expect(p.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('drops anything under the confidence floor', () => {
      const { patterns } = run(build(HEAD_AND_SHOULDERS), { minConfidence: 0.99 });
      expect(patterns.every((p) => p.confidence >= 0.99)).toBe(true);
    });

    it('honours the enabled list', () => {
      const { patterns } = run(build(HEAD_AND_SHOULDERS), {
        enabledPatterns: ['double_top'],
      });
      expect(patterns.every((p) => p.type === 'double_top')).toBe(true);
    });

    it('caps what it returns, keeping the most confident', () => {
      const { patterns } = run(build(ASCENDING_TRIANGLE), { maxRenderedPatterns: 1 });
      expect(patterns.length).toBeLessThanOrEqual(1);
    });

    /**
     * The property the live tracker is built on. Same shape, same id — so an
     * overlay is updated in place rather than removed and re-added, which is
     * the difference between a steady chart and one that flickers every bar.
     */
    it('gives the same shape the same id on every pass', () => {
      const candles = build(HEAD_AND_SHOULDERS);
      const first = run(candles).patterns.map((p) => p.id);
      const second = run(candles).patterns.map((p) => p.id);
      expect(second).toEqual(first);
    });

    /**
     * Indices shift when older history is prepended; times do not. A pattern
     * that changed id for standing still would be torn down and rebuilt on
     * every history load.
     */
    it('keeps ids and anchors when older history is prepended', () => {
      const candles = build(HEAD_AND_SHOULDERS);
      const step = (candles[1] as Candle).time - (candles[0] as Candle).time;
      const random = seeded(3);
      const older: Candle[] = Array.from({ length: 60 }, (_, i) => {
        const price = 99 + random() * 2;
        return {
          time: (candles[0] as Candle).time - (60 - i) * step,
          open: price,
          high: price + 0.3,
          low: price - 0.3,
          close: price,
          volume: 1_000,
        };
      });

      const before = find(run(candles).patterns, 'head_and_shoulders');
      const after = find(run([...older, ...candles]).patterns, 'head_and_shoulders');
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect(after?.id).toBe(before?.id as string);
      expect(after?.startTime).toBe(before?.startTime as number);
      expect(after?.pivots.map((p) => p.time)).toEqual(before?.pivots.map((p) => p.time) ?? []);
    });

    it('returns nothing for a series too short to hold a pattern', () => {
      expect(
        run(
          build([
            { at: 0, price: 100 },
            { at: 10, price: 105 },
          ]),
        ).patterns,
      ).toEqual([]);
    });

    it('does not throw on an empty series', () => {
      expect(run([]).patterns).toEqual([]);
    });

    /**
     * The budget from the spec. Logged as well as asserted, because a number
     * creeping from 6 ms to 45 ms is worth seeing before it fails.
     */
    it('scans 5,000 candles well inside 50 ms', () => {
      const random = seeded(99);
      const keypoints: Keypoint[] = [];
      for (let i = 0; i <= 5_000; i += 25) {
        keypoints.push({ at: i, price: 100 + Math.sin(i / 60) * 12 + random() * 3 });
      }
      const candles = fromKeypoints(keypoints, { noise: 0.4, seed: 5 });
      expect(candles.length).toBeGreaterThan(4_900);

      const { elapsedMs, patterns } = run(candles);
      // eslint-disable-next-line no-console
      console.log(
        `detectPatterns: ${candles.length} candles in ${elapsedMs.toFixed(1)} ms, ${patterns.length} patterns`,
      );
      expect(elapsedMs).toBeLessThan(50);
    });
  });
});
