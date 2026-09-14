import type { Bar } from '../chart-stream/candle-series-buffer';
import type { UTCTimestamp } from 'lightweight-charts';
import { CandlePatternSync, differs, withLabels } from './candle-pattern-sync';
import { CHART_PATTERNS, defaultCandlePatternTuning, tuningKey } from './config';
import type { CandlePatternHit } from './candle-patterns.models';
import type { RenderedCandlePattern } from './render/candle-pattern-overlay';

/**
 * The rules that decide when the chart asks the backend, and what it redraws.
 *
 * Detection is a network call on a surface that redraws many times a second,
 * so these rules are the difference between one request per closed bar and one
 * per tick. Each test below corresponds to a way that could go wrong and still
 * look fine on screen.
 */

/** Bar open time in **seconds**, which is what the chart holds. */
const T0 = 1_700_000_000;

function bar(i: number, close = 100): Bar {
  return {
    time: (T0 + i * 60) as UTCTimestamp,
    open: 100,
    high: 101,
    low: 99,
    close,
    volume: 500,
    vwap: null,
  };
}

const bars = (count: number): Bar[] => Array.from({ length: count }, (_, i) => bar(i));

function hit(over: Partial<RenderedCandlePattern> = {}): RenderedCandlePattern {
  return {
    id: 'bullish_engulfing@1700000600000',
    primary: 'bullish_engulfing',
    patterns: ['bullish_engulfing', 'inside_bar'],
    startTime: 1_700_000_540_000,
    endTime: 1_700_000_600_000,
    barCount: 2,
    candleType: 'full_body',
    candleTypeId: 11,
    direction: 1,
    sizeClass: 'normal',
    trendState: 'down',
    directionContext: 'BEARISH',
    reversalBias: 'BULLISH',
    confidence: 85,
    breakdown: { base: 50, context: 20, extreme: 15, geometry: 0, followThrough: 0 },
    status: 'pending',
    confirmationTime: null,
    confirmationLevel: 101,
    patternHigh: 101,
    patternLow: 99,
    atLocalExtreme: true,
    label: 'Bullish engulfing',
    ...over,
  };
}

describe('CandlePatternSync.closedBars', () => {
  /**
   * The newest bar is the only one that can still change: in a live session it
   * is rewritten on every tick and nothing on the wire says it has closed.
   * Sending it would let a box appear on a half-formed close and vanish on the
   * next tick.
   */
  it('excludes the forming bar', () => {
    const result = CandlePatternSync.closedBars(bars(5), 100);
    expect(result.length).toBe(4);
    expect(result[result.length - 1]?.time).toBe(bar(3).time);
  });

  it('returns nothing when there is only a forming bar', () => {
    expect(CandlePatternSync.closedBars(bars(1), 100)).toEqual([]);
  });

  it('returns nothing for an empty series', () => {
    expect(CandlePatternSync.closedBars([], 100)).toEqual([]);
  });

  it('keeps the newest bars when the window is exceeded', () => {
    const result = CandlePatternSync.closedBars(bars(10), 3);
    expect(result.length).toBe(3);
    // The three most recent closed bars, not the three oldest.
    expect(result[0]?.time).toBe(bar(6).time);
    expect(result[2]?.time).toBe(bar(8).time);
  });

  it('treats a window of zero as no cap rather than as no bars', () => {
    expect(CandlePatternSync.closedBars(bars(10), 0).length).toBe(9);
  });
});

describe('CandlePatternSync.toWire', () => {
  /**
   * The conversion that fails silently.
   *
   * The chart's x axis is in seconds and the whole backend is in milliseconds.
   * A factor of a thousand either way puts every box in 1970 or the year
   * 57000, `timeToCoordinate` answers `null`, and the overlay simply does not
   * appear — no error anywhere.
   */
  it('converts seconds to milliseconds', () => {
    const [first] = CandlePatternSync.toWire([bar(0)]);
    expect(first?.t).toBe(T0 * 1000);
  });

  it('carries the prices and the volume through unchanged', () => {
    const [first] = CandlePatternSync.toWire([bar(0, 104)]);
    expect(first).toEqual({ t: T0 * 1000, o: 100, h: 101, l: 99, c: 104, v: 500 });
  });

  it('keeps the series ascending, as the backend requires', () => {
    const wire = CandlePatternSync.toWire(bars(5));
    const times = wire.map((b) => b.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('CandlePatternSync.key', () => {
  const base = {
    seriesKey: 'NSE_INDEX|Nifty 50',
    interval: '5minute' as const,
    bars: bars(5),
    tuning: tuningKey(defaultCandlePatternTuning),
  };

  it('is null for an empty series, so nothing is asked', () => {
    expect(CandlePatternSync.key({ ...base, bars: [] })).toBeNull();
  });

  it('is stable for the same question', () => {
    expect(CandlePatternSync.key(base)).toBe(CandlePatternSync.key({ ...base }));
  });

  /**
   * Two instruments charted on the same day have the *same bar times*, so
   * without the instrument in the key a panel moved from a call to a put would
   * redraw the call's boxes over the put's bars.
   */
  it('changes with the instrument', () => {
    expect(CandlePatternSync.key({ ...base, seriesKey: 'other' })).not.toBe(
      CandlePatternSync.key(base),
    );
  });

  it('changes with the bar size', () => {
    expect(CandlePatternSync.key({ ...base, interval: '15minute' })).not.toBe(
      CandlePatternSync.key(base),
    );
  });

  it('changes when a bar closes', () => {
    expect(CandlePatternSync.key({ ...base, bars: bars(6) })).not.toBe(CandlePatternSync.key(base));
  });

  // Prepending history changes the warm-up, and so can change the answer for
  // bars that were already on screen.
  it('changes when history is prepended', () => {
    const older = [bar(-2), bar(-1), ...bars(5)];
    expect(CandlePatternSync.key({ ...base, bars: older })).not.toBe(CandlePatternSync.key(base));
  });

  it('changes when the tuning changes', () => {
    const tuning = tuningKey({ ...defaultCandlePatternTuning, minConfidence: 80 });
    expect(CandlePatternSync.key({ ...base, tuning })).not.toBe(CandlePatternSync.key(base));
  });
});

describe('CandlePatternSync.shouldRequest', () => {
  it('asks once for a given question', () => {
    const sync = new CandlePatternSync();
    expect(sync.shouldRequest('a')).toBe(true);
    expect(sync.shouldRequest('a')).toBe(false);
    expect(sync.shouldRequest('a')).toBe(false);
  });

  it('asks again when the question changes', () => {
    const sync = new CandlePatternSync();
    expect(sync.shouldRequest('a')).toBe(true);
    expect(sync.shouldRequest('b')).toBe(true);
  });

  it('never asks for a null key', () => {
    const sync = new CandlePatternSync();
    expect(sync.shouldRequest(null)).toBe(false);
  });

  /**
   * The whole point, stated as the scenario it prevents.
   *
   * A live chart redraws many times between two bar closes, and every one of
   * those redraws produces the same key.
   */
  it('issues one request across many redraws of the same series', () => {
    const sync = new CandlePatternSync();
    const key = CandlePatternSync.key({
      seriesKey: 'k',
      interval: '1minute',
      bars: bars(5),
      tuning: 'x',
    });
    let requests = 0;
    for (let tick = 0; tick < 50; tick++) {
      if (sync.shouldRequest(key)) requests++;
    }
    expect(requests).toBe(1);
  });

  it('asks again after a reset', () => {
    const sync = new CandlePatternSync();
    sync.shouldRequest('a');
    sync.reset();
    expect(sync.shouldRequest('a')).toBe(true);
  });
});

describe('CandlePatternSync.diff', () => {
  it('reports a first result as changed', () => {
    const sync = new CandlePatternSync();
    const { changed, removedIds } = sync.diff([hit()]);
    expect(changed.length).toBe(1);
    expect(removedIds).toEqual([]);
  });

  /**
   * The property the diffing exists for: the common case on a new closed bar
   * is that every existing box is unchanged, and republishing them all would
   * redraw identical boxes and read as a flicker.
   */
  it('reports nothing when the same result comes back', () => {
    const sync = new CandlePatternSync();
    sync.diff([hit()]);
    const { changed, removedIds } = sync.diff([hit()]);
    expect(changed).toEqual([]);
    expect(removedIds).toEqual([]);
  });

  it('reports a hit whose confirmation resolved', () => {
    const sync = new CandlePatternSync();
    sync.diff([hit()]);
    const resolved = hit({
      status: 'confirmed',
      confirmationTime: 1_700_000_660_000,
      confidence: 90,
    });
    const { changed } = sync.diff([resolved]);
    expect(changed.length).toBe(1);
    expect(changed[0]?.status).toBe('confirmed');
  });

  it('removes a hit that is no longer reported', () => {
    const sync = new CandlePatternSync();
    sync.diff([hit({ id: 'a' }), hit({ id: 'b' })]);
    const { removedIds } = sync.diff([hit({ id: 'a' })]);
    expect(removedIds).toEqual(['b']);
  });

  it('adds only the new hit when a bar closes', () => {
    const sync = new CandlePatternSync();
    sync.diff([hit({ id: 'a' })]);
    const { changed, removedIds } = sync.diff([hit({ id: 'a' }), hit({ id: 'b' })]);
    expect(changed.map((h) => h.id)).toEqual(['b']);
    expect(removedIds).toEqual([]);
  });

  it('forgets what is drawn on reset', () => {
    const sync = new CandlePatternSync();
    sync.diff([hit()]);
    sync.reset();
    expect(sync.current).toEqual([]);
    // And so redraws rather than assuming the box is still there.
    expect(sync.diff([hit()]).changed.length).toBe(1);
  });

  it('reports what it believes is drawn', () => {
    const sync = new CandlePatternSync();
    sync.diff([hit({ id: 'a' }), hit({ id: 'b' })]);
    expect(sync.current.map((h) => h.id).sort()).toEqual(['a', 'b']);
  });
});

describe('differs', () => {
  it('sees no change in an identical hit', () => {
    expect(differs(hit(), hit())).toBe(false);
  });

  // Everything here depends on bars that print *after* the pattern, which is
  // exactly why these are the fields that can move under a stable id.
  it('sees a changed status, confirmation, level or score', () => {
    expect(differs(hit(), hit({ status: 'confirmed' }))).toBe(true);
    expect(differs(hit(), hit({ confirmationTime: 1 }))).toBe(true);
    expect(differs(hit(), hit({ confidence: 90 }))).toBe(true);
    expect(differs(hit(), hit({ patternHigh: 102 }))).toBe(true);
    expect(differs(hit(), hit({ patternLow: 98 }))).toBe(true);
    expect(differs(hit(), hit({ label: 'Something else' }))).toBe(true);
  });
});

describe('withLabels', () => {
  const raw = hit() as CandlePatternHit;

  it('resolves the primary pattern name', () => {
    const [only] = withLabels([raw], { bullish_engulfing: 'Bullish engulfing' });
    expect(only?.label).toBe('Bullish engulfing');
  });

  /**
   * An unfamiliar label is a small puzzle for the reader; an empty plate is a
   * bug nobody can see. The key is always something.
   */
  it('falls back to the pattern key when no name was sent', () => {
    const [only] = withLabels([raw], {});
    expect(only?.label).toBe('bullish_engulfing');
  });

  it('leaves the rest of the hit untouched', () => {
    const [only] = withLabels([raw], {});
    expect(only?.id).toBe(raw.id);
    expect(only?.patterns).toEqual(raw.patterns);
    expect(only?.confidence).toBe(raw.confidence);
  });
});

describe('tuningKey', () => {
  it('changes when any threshold changes', () => {
    const base = tuningKey(defaultCandlePatternTuning);
    const fields = [
      { confirmationBars: 5 },
      { extremeLookback: 20 },
      { minConfidence: 80 },
      { windowBars: 300 },
      { maxHits: 10 },
    ];
    for (const field of fields) {
      expect(tuningKey({ ...defaultCandlePatternTuning, ...field })).not.toBe(base);
    }
  });

  it('changes when the drawn vocabulary changes', () => {
    const narrower = tuningKey({
      ...defaultCandlePatternTuning,
      patterns: ['doji'],
    });
    expect(narrower).not.toBe(tuningKey(defaultCandlePatternTuning));
  });
});

/**
 * The two settings that decide whether this overlay is useful or wallpaper.
 *
 * Measured on synthetic 375-bar sessions, the engine's own floor of forty
 * marks around 250 bars — two in three, which reads as a texture rather than
 * an annotation. The chart therefore has to be materially stricter, and it has
 * to draw fewer names than the engine classifies.
 */
describe('what the chart draws by default', () => {
  it('sets a stricter floor than the engine applies', () => {
    expect(defaultCandlePatternTuning.minConfidence).toBeGreaterThanOrEqual(75);
  });

  it('draws fewer names than the engine classifies', () => {
    expect(defaultCandlePatternTuning.patterns).toBe(CHART_PATTERNS);
  });

  // The dead bars, the readings the engine declined to resolve, and the shapes
  // too common to be findings.
  /**
   * The drawn vocabulary is exactly the published reference's, by name.
   *
   * Spelled out in full rather than spot-checked, because the requirement is
   * an exact set and a spot check cannot see an extra name creep in. If the
   * reference is ever changed, this list changes with it and the diff says
   * precisely what moved.
   */
  it('draws exactly the thirty-eight patterns the reference names', () => {
    expect([...CHART_PATTERNS].sort()).toEqual(
      [
        'bearish_abandoned_baby',
        'bearish_belt_hold',
        'bearish_doji_star',
        'bearish_engulfing',
        'bearish_harami',
        'bearish_kicker',
        'bearish_mat_hold',
        'bearish_three_line_strike',
        'bullish_abandoned_baby',
        'bullish_belt_hold',
        'bullish_engulfing',
        'bullish_harami',
        'bullish_kicker',
        'bullish_mat_hold',
        'bullish_meeting_lines',
        'bullish_separating_lines',
        'bullish_three_line_strike',
        'concealing_baby_swallow',
        'dark_cloud_cover',
        'dragonfly_doji',
        'evening_star',
        'hammer',
        'hanging_man',
        'inverted_hammer',
        'ladder_bottom',
        'morning_star',
        'piercing_line',
        'rising_three_methods',
        'shooting_star',
        'three_black_crows',
        'three_inside_down',
        'three_inside_up',
        'three_outside_down',
        'three_outside_up',
        'three_white_soldiers',
        'tweezer_bottom',
        'tweezer_top',
        'upside_gap_two_crows',
      ].sort(),
    );
  });

  /**
   * The names the engine knows and the reference does not.
   *
   * Two of these — plain `doji` and `inside_bar` — were drawn until the
   * vocabulary was pinned to the reference, and they are the ones most likely
   * to be added back by accident, being the commonest readings on any chart.
   */
  it('leaves out every name the reference does not list', () => {
    for (const excluded of [
      'doji',
      'near_doji',
      'long_legged_doji',
      'four_price_doji',
      'gravestone_doji',
      'inside_bar',
      'outside_bar',
      'spinning_top',
      'marubozu',
      'hammer_shape',
      'inverted_hammer_shape',
      'full_body',
      'normal',
      // Mirrors the engine detects and the reference does not name.
      'ladder_top',
      'falling_three_methods',
      'bullish_doji_star',
      'bearish_meeting_lines',
      'bearish_separating_lines',
    ]) {
      expect(CHART_PATTERNS).not.toContain(excluded);
    }
  });

  // An empty list would read to the backend as "show nothing" and be rejected
  // by its schema, so a mistake here must fail loudly in a test rather than
  // as a 400 on the first click.
  it('never sends an empty list', () => {
    expect(defaultCandlePatternTuning.patterns.length).toBeGreaterThan(0);
  });
});
