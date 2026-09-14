import { EMA_INDICATORS, EMA_PERIODS, ema, emaColor, type EmaBar } from './ema';

const bars = (closes: readonly number[]): EmaBar[] =>
  closes.map((close, i) => ({ time: 1_700_000_000 + i * 60, close }));

describe('ema', () => {
  /**
   * Worked by hand rather than recorded from the implementation.
   *
   *   seed  = mean(1, 2, 3)                 = 2
   *   k     = 2 / (3 + 1)                   = 0.5
   *   bar 3 = 4 × 0.5 + 2 × 0.5             = 3
   *   bar 4 = 5 × 0.5 + 3 × 0.5             = 4
   */
  it('seeds from the simple average and then smooths', () => {
    const out = ema(bars([1, 2, 3, 4, 5]), 3);
    expect(out.map((p) => p.value)).toEqual([2, 3, 4]);
  });

  /**
   * The first point sits on the bar that completed the window, not on the
   * first bar of the series — otherwise the line would start before the
   * average it draws was computable.
   */
  it('starts on the bar that completed its window', () => {
    const input = bars([1, 2, 3, 4, 5]);
    const out = ema(input, 3);
    expect(out[0]?.time).toBe(input[2]?.time as number);
    expect(out.length).toBe(3);
  });

  it('emits nothing until there are enough bars', () => {
    expect(ema(bars([1, 2]), 3)).toEqual([]);
    expect(ema([], 14)).toEqual([]);
  });

  it('sits exactly on a flat series', () => {
    const out = ema(bars(Array.from({ length: 30 }, () => 100)), 9);
    expect(out.every((p) => Math.abs(p.value - 100) < 1e-9)).toBe(true);
  });

  /**
   * A shorter average has to react faster than a longer one, or the fan is
   * upside down and every crossing reads backwards.
   */
  it('tracks a step more closely the shorter it is', () => {
    const stepped = bars([
      ...Array.from({ length: 40 }, () => 100),
      ...Array.from({ length: 10 }, () => 120),
    ]);
    const fast = ema(stepped, 5).at(-1)?.value ?? 0;
    const slow = ema(stepped, 50).at(-1)?.value ?? 0;
    const slower = ema(stepped, 21).at(-1)?.value ?? 0;
    expect(fast).toBeGreaterThan(slower);
    expect(slower).toBeGreaterThan(slow);
  });

  it('refuses a nonsense period rather than dividing by zero', () => {
    expect(ema(bars([1, 2, 3]), 0)).toEqual([]);
    expect(ema(bars([1, 2, 3]), -5)).toEqual([]);
  });
});

describe('the indicator palette', () => {
  it('offers the six averages the dropdown lists', () => {
    expect(EMA_PERIODS).toEqual([5, 9, 14, 21, 50, 100]);
  });

  it('gives every average its own colour', () => {
    const colors = EMA_INDICATORS.map((i) => i.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  /**
   * Every other hue on this chart is claimed: green and red by the candles and
   * by support and resistance, cyan and violet by the patterns, blue by the
   * chrome. An average in any of them would be read as one of those.
   */
  it('shares no colour with the candles, the levels or the patterns', () => {
    const taken = ['#26a17b', '#ef5350', '#22d3ee', '#c084fc', '#3ba7ff'];
    for (const { color } of EMA_INDICATORS) {
      expect(taken).not.toContain(color.toLowerCase());
    }
  });

  it('falls back to a real colour for a period it does not know', () => {
    expect(emaColor(999)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
