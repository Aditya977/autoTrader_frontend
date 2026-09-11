/** One EMA point, in the shape a line series takes. */
export interface EmaPoint {
  /** Bar open time, epoch seconds — the chart's own x value. */
  time: number;
  value: number;
}

/** A bar, reduced to what an average needs. */
export interface EmaBar {
  time: number;
  close: number;
}

/**
 * Exponential moving average, seeded from the simple average of its own window.
 *
 * ## Why it starts late, and why that is the point
 *
 * Nothing is emitted until `period` bars exist. An EMA seeded from the first
 * close alone can be drawn from bar two, and it is wrong for roughly the first
 * `period` bars while it converges — a line that leans toward wherever the
 * series happened to open. On a research column that is harmless, because the
 * warm-up is dropped before anything is fitted. On a chart it is a line the
 * user reads and compares against their broker's, so it has to agree with the
 * conventional calculation rather than merely converge to it.
 *
 * That is a deliberate divergence from the backend's feature store, which
 * seeds from the first value and publishes from the first bar. Two different
 * jobs: that one is a column with a documented warm-up, this one is a drawing.
 */
export function ema(bars: readonly EmaBar[], period: number): EmaPoint[] {
  const out: EmaPoint[] = [];
  if (period <= 0 || bars.length < period) return out;

  const k = 2 / (period + 1);

  let seed = 0;
  for (let i = 0; i < period; i++) seed += (bars[i] as EmaBar).close;
  let value = seed / period;

  out.push({ time: (bars[period - 1] as EmaBar).time, value });
  for (let i = period; i < bars.length; i++) {
    value = (bars[i] as EmaBar).close * k + value * (1 - k);
    out.push({ time: (bars[i] as EmaBar).time, value });
  }

  return out;
}

/**
 * The averages the dropdown offers, and the colour each is drawn in.
 *
 * One warm ramp rather than six unrelated hues, and both halves of that matter.
 *
 * **Warm**, because every other hue on this chart is already spoken for: green
 * and red belong to the candle bodies and to the support and resistance lines,
 * cyan and violet to the pattern outlines, and blue to the interface chrome. An
 * average drawn in any of them would be read as one of those things.
 *
 * **A ramp**, because six averages of different lengths are not six unrelated
 * series — they are one fan, and the ordering is the information. Pale for the
 * fastest through to deep for the slowest means the stack can be read without
 * consulting a legend, and a crossing is visible as two shades meeting rather
 * than as two arbitrary colours intersecting.
 */
export const EMA_INDICATORS: readonly { period: number; color: string }[] = [
  { period: 5, color: '#ffe9a8' },
  { period: 9, color: '#ffd166' },
  { period: 14, color: '#ffb03a' },
  { period: 21, color: '#ff8f1f' },
  { period: 50, color: '#f2701d' },
  { period: 100, color: '#e0561f' },
];

export const EMA_PERIODS: readonly number[] = EMA_INDICATORS.map((i) => i.period);

export const emaColor = (period: number): string =>
  EMA_INDICATORS.find((i) => i.period === period)?.color ?? '#ffd166';
