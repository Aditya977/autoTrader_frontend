import type { Candle } from '../types';

/**
 * Synthetic candles from a handful of keypoints, for tests.
 *
 * A pattern is a shape in price, so a fixture is a list of turning points and
 * the promise that price walks between them. `fromKeypoints` interpolates,
 * adds a little seeded noise so the bars are not a perfect ramp, and hands
 * back something the engine can be pointed at.
 *
 * **The noise is seeded.** A random fixture that passes today and fails on
 * Tuesday teaches nothing, and the failure cannot be reproduced to be read.
 */

/** Mulberry32 — small, fast, and identical on every machine and every run. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Keypoint {
  /** Bar index this price is reached at. Must ascend. */
  at: number;
  price: number;
}

export interface FixtureOptions {
  /** Peak-to-peak wobble added to each bar, in price units. */
  noise?: number;
  seed?: number;
  /** First bar's open time, epoch seconds. */
  startTime?: number;
  /** Seconds per bar. */
  step?: number;
}

/**
 * Candles walking through the keypoints in order.
 *
 * Each bar's body spans its own segment of the walk, so a bar's high and low
 * are its own two ends plus noise. That makes the series continuous — close of
 * one bar is the open of the next — which is what the ATR and the pivot finder
 * assume of a real feed.
 *
 * The turning-point bars are given their exact keypoint price as a high (on a
 * peak) or a low (on a trough), so a test can assert a pivot landed on the
 * price it asked for rather than on the price the noise happened to allow.
 */
export function fromKeypoints(
  keypoints: readonly Keypoint[],
  options: FixtureOptions = {},
): Candle[] {
  const { noise = 0.4, seed = 42, startTime = 1_700_000_000, step = 60 } = options;
  if (keypoints.length < 2) throw new Error('need at least two keypoints');

  const random = seeded(seed);
  const jitter = () => (random() - 0.5) * noise;

  const last = keypoints[keypoints.length - 1] as Keypoint;
  const path: number[] = new Array<number>(last.at + 1).fill(0);

  for (let k = 0; k + 1 < keypoints.length; k++) {
    const from = keypoints[k] as Keypoint;
    const to = keypoints[k + 1] as Keypoint;
    const bars = to.at - from.at;
    if (bars <= 0) throw new Error('keypoints must ascend in `at`');
    for (let i = 0; i <= bars; i++) {
      path[from.at + i] = from.price + ((to.price - from.price) * i) / bars;
    }
  }

  const turns = new Map<number, number>();
  for (const k of keypoints) turns.set(k.at, k.price);

  const candles: Candle[] = [];
  for (let i = 0; i < path.length; i++) {
    const open = i === 0 ? (path[0] as number) : (path[i - 1] as number);
    const close = path[i] as number;
    const turn = turns.get(i);

    let high = Math.max(open, close) + Math.abs(jitter());
    let low = Math.min(open, close) - Math.abs(jitter());

    // A keypoint bar reaches its stated price exactly, so tests can assert on
    // it. Which side depends on whether the walk turned up or down here.
    if (turn !== undefined) {
      const before = i > 0 ? (path[i - 1] as number) : turn;
      const after = i + 1 < path.length ? (path[i + 1] as number) : turn;
      const isPeak = turn >= before && turn >= after;
      if (isPeak) high = Math.max(high, turn);
      else low = Math.min(low, turn);
    }

    candles.push({
      time: startTime + i * step,
      open,
      high,
      low,
      close,
      volume: 1_000,
    });
  }

  return candles;
}

/** A flat-ish run, for padding a fixture out to the ATR warm-up length. */
export function flat(bars: number, price: number, options: FixtureOptions = {}): Candle[] {
  return fromKeypoints(
    [
      { at: 0, price },
      { at: bars - 1, price },
    ],
    options,
  );
}

/** Joins segments end to end, renumbering times so they form one series. */
export function concat(segments: readonly Candle[][], step = 60): Candle[] {
  const out: Candle[] = [];
  let time = segments[0]?.[0]?.time ?? 1_700_000_000;
  for (const segment of segments) {
    for (const candle of segment) {
      out.push({ ...candle, time });
      time += step;
    }
  }
  return out;
}
