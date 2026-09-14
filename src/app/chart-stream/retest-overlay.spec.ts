import {
  SCENARIO_LABELS,
  SCENARIO_TAGS,
  describeRetest,
  labelFor,
  mergeMarkers,
  opacityFor,
  retestMarkers,
} from './retest-overlay';
import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import { bucketStartMs } from './chart-time';
import type { ChartRetest, RetestScenario } from './chart-stream.models';

/**
 * The translation from a retest to what the chart draws.
 *
 * Pure, so these are about the decisions rather than the canvas: that a retest
 * is marked and never drawn as a line, that quality reaches the rendering as
 * something continuous, that a mark lands on a bar the chart is actually
 * drawing, and that marks landing on the same bar merge instead of stacking
 * their labels on top of each other.
 */

/** 09:15 IST on 2026-08-14, the session open the buckets are anchored to. */
const OPEN = Date.parse('2026-08-14T03:45:00.000Z');
const MINUTE = 60_000;

const retest = (overrides: Partial<ChartRetest> = {}): ChartRetest => ({
  zoneLow: 101.5,
  zoneHigh: 102,
  zoneOrigin: 'RANGE_BOUNDARY',
  direction: 'BULLISH',
  breakoutAt: OPEN + 12 * MINUTE,
  approachAt: OPEN + 15 * MINUTE,
  resumptionAt: OPEN + 16 * MINUTE,
  scenario: 'exact',
  scenarios: ['exact', 'range_boundary'],
  valid: true,
  unresolved: false,
  invalidation: null,
  gapAtr: -0.08,
  touchedZone: true,
  closeSide: 1,
  touchCount: 1,
  opposingBars: 2,
  levelConsumed: true,
  barsToResolve: 1,
  confluenceCount: 2,
  levelStrength: 144_000,
  quality: 0.6,
  htfOnly: false,
  ...overrides,
});

describe('opacityFor', () => {
  it('rises with quality', () => {
    expect(opacityFor(1)).toBeGreaterThan(opacityFor(0.5));
    expect(opacityFor(0.5)).toBeGreaterThan(opacityFor(0));
  });

  it('never renders a requested retest invisible', () => {
    // A band drawn at zero opacity reads as a broken chart, not a weak signal.
    expect(opacityFor(0)).toBeGreaterThanOrEqual(0.3);
    expect(opacityFor(-5)).toBeGreaterThanOrEqual(0.3);
  });

  it('stays within bounds for out-of-range input', () => {
    expect(opacityFor(99)).toBeLessThanOrEqual(1);
  });
});

describe('labelFor', () => {
  it('names the scenario', () => {
    expect(labelFor([retest({ scenario: 'sweep' })])).toContain(SCENARIO_TAGS.sweep);
  });

  it('shows the touch count only once it is a warning', () => {
    // A decay term: a first touch has nothing to say, a third is a warning.
    expect(labelFor([retest({ touchCount: 1 })])).not.toContain('×');
    expect(labelFor([retest({ touchCount: 3 })])).toContain('×3');
  });

  it('drops the touch count once the mark stands for more than one retest', () => {
    // "×3" against two merged retests reads as a count of them, which it isn't.
    const merged = labelFor([retest({ touchCount: 3 }), retest({ scenario: 'deep' })]);
    expect(merged).not.toContain('×');
  });

  it('flags a higher-timeframe-only retest', () => {
    expect(labelFor([retest({ htfOnly: true })])).toContain('HTF');
    // Only when every retest behind the mark is: one on-timeframe retest means
    // the mark is on a bar that is really there.
    expect(labelFor([retest({ htfOnly: true }), retest({ htfOnly: false })])).not.toContain('HTF');
  });

  it('names each distinct shape on the bar once', () => {
    const label = labelFor([retest({ scenario: 'exact' }), retest({ scenario: 'exact' })]);
    expect(label).toBe(SCENARIO_TAGS.exact);
  });

  it('counts the shapes it has no room to spell out', () => {
    // Four tags on one bar is a word salad the eye skips.
    const label = labelFor([
      retest({ scenario: 'exact' }),
      retest({ scenario: 'deep' }),
      retest({ scenario: 'sweep' }),
      retest({ scenario: 'gap' }),
    ]);
    expect(label).toContain(SCENARIO_TAGS.exact);
    expect(label).toContain(SCENARIO_TAGS.deep);
    expect(label).toContain('+2');
    expect(label).not.toContain(SCENARIO_TAGS.gap);
  });

  it('has a label and a tag for every scenario the backend can emit', () => {
    const scenarios: RetestScenario[] = [
      'exact',
      'shallow',
      'sweep',
      'deep',
      'time',
      'dynamic',
      'gap',
      'range_boundary',
      'none',
    ];
    for (const scenario of scenarios) {
      expect(SCENARIO_LABELS[scenario]).toBeTruthy();
      expect(SCENARIO_TAGS[scenario]).toBeTruthy();
    }
  });
});

describe('retestMarkers', () => {
  it('snaps every mark to a bar the chart is drawing', () => {
    // 15:00 into the session is the 10:00 bucket on a 5-minute chart. A marker
    // on a time no bar occupies is a marker the chart silently drops.
    const markers = retestMarkers([retest()], 300);
    for (const marker of markers) {
      expect((marker.time as number) * 1000).toBe(
        bucketStartMs((marker.time as number) * 1000, 300),
      );
    }
    expect(markers[0].time as number).toBe(Math.floor((OPEN + 15 * MINUTE) / 1000));
  });

  it('re-snaps when the displayed interval changes', () => {
    const oneMinute = retestMarkers([retest({ approachAt: OPEN + 17 * MINUTE })], 60);
    const fiveMinute = retestMarkers([retest({ approachAt: OPEN + 17 * MINUTE })], 300);
    // 09:32 is its own 1-minute bar but belongs to the 09:30 five-minute bar.
    expect(oneMinute[0].time).not.toBe(fiveMinute[0].time);
    expect((fiveMinute[0].time as number) * 1000).toBe(OPEN + 15 * MINUTE);
  });

  it('marks the approach on the side price came from', () => {
    expect(retestMarkers([retest({ direction: 'BULLISH' })], 60)[0].position).toBe('belowBar');
    expect(retestMarkers([retest({ direction: 'BEARISH' })], 60)[0].position).toBe('aboveBar');
  });

  it('marks a retest once, on the bar price came back on', () => {
    // One mark, not two: an approach and a resumption two bars apart used to
    // put a second label on the chart saying nothing the first did not.
    const markers = retestMarkers([retest()], 60);
    expect(markers.length).toBe(1);
    expect(markers[0].time as number).toBe(Math.floor((OPEN + 15 * MINUTE) / 1000));
  });

  it('falls back to the resumption for a time-based retest', () => {
    // §4.5 — price never comes back, so there is no approach bar to mark and
    // no direction for an arrow to point.
    const markers = retestMarkers([retest({ scenario: 'time', approachAt: null })], 60);
    expect(markers.length).toBe(1);
    expect(markers[0].shape).toBe('circle');
    expect(markers[0].time as number).toBe(Math.floor((OPEN + 16 * MINUTE) / 1000));
  });

  it('leaves a retest with no bar yet to the table', () => {
    const markers = retestMarkers(
      [retest({ approachAt: null, resumptionAt: null, unresolved: true })],
      60,
    );
    expect(markers.length).toBe(0);
  });

  it('merges the retests that land on one bar into a single mark', () => {
    // The reason the chart was unreadable: two dozen labels stacked on the
    // same few bars near the right edge.
    const markers = retestMarkers(
      [
        retest({ scenario: 'exact', quality: 0.4 }),
        retest({ scenario: 'deep', approachAt: OPEN + 15 * MINUTE + 30_000, quality: 0.9 }),
      ],
      60,
    );
    expect(markers.length).toBe(1);
    // Named and coloured by the strongest of them, not by the first to arrive.
    expect(markers[0].text?.startsWith(SCENARIO_TAGS.deep)).toBeTrue();
    expect(markers[0].color).toBe(retestMarkers([retest({ quality: 0.9 })], 60)[0].color);
  });

  it('keeps the two sides of one bar apart', () => {
    // A bullish mark sits below the bar and a bearish one above it: merging
    // them would put one of them on the wrong side of the candle.
    const markers = retestMarkers(
      [retest({ direction: 'BULLISH' }), retest({ direction: 'BEARISH' })],
      60,
    );
    expect(markers.length).toBe(2);
    expect(markers.map((m) => m.position).sort()).toEqual(['aboveBar', 'belowBar']);
  });

  it('merges more of them the coarser the chart gets', () => {
    const spread = [
      retest({ approachAt: OPEN + 15 * MINUTE }),
      retest({ approachAt: OPEN + 17 * MINUTE }),
      retest({ approachAt: OPEN + 19 * MINUTE }),
    ];
    expect(retestMarkers(spread, 60).length).toBe(3);
    expect(retestMarkers(spread, 300).length).toBe(1);
  });

  it('fades a weak retest and keeps a strong one bright', () => {
    const strong = retestMarkers([retest({ quality: 0.9 })], 60)[0];
    const weak = retestMarkers([retest({ quality: 0.1 })], 60)[0];
    expect(strong.color).not.toBe(weak.color);
  });

  it('colours by breakout direction, from the shared palette', () => {
    // The same green as an up candle and a support line: the chart says the
    // same thing the same way everywhere.
    expect(retestMarkers([retest({ direction: 'BULLISH' })], 60)[0].color).toContain(
      '38, 161, 123',
    );
    expect(retestMarkers([retest({ direction: 'BEARISH' })], 60)[0].color).toContain(
      '239, 83, 80',
    );
  });

  it('returns markers in ascending time, as setMarkers requires', () => {
    const markers = retestMarkers(
      [
        retest({ approachAt: OPEN + 40 * MINUTE, resumptionAt: OPEN + 45 * MINUTE }),
        retest({ approachAt: OPEN + 15 * MINUTE, resumptionAt: OPEN + 16 * MINUTE }),
      ],
      60,
    );
    const times = markers.map((m) => m.time as number);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('draws nothing for an empty list', () => {
    expect(retestMarkers([], 60).length).toBe(0);
  });
});

describe('describeRetest', () => {
  it('spells out the zero-opposing-bar case', () => {
    // The counter-intuitive one: no opposing-colour bar at all is the
    // strongest form of the pattern, not a detection failure.
    expect(describeRetest(retest({ opposingBars: 0 }))).toContain('Opposing bars 0');
  });

  it('warns that an unconsumed level will be revisited', () => {
    expect(describeRetest(retest({ levelConsumed: false }))).toContain('unconsumed');
  });

  it('says when a retest has not resolved', () => {
    expect(describeRetest(retest({ unresolved: true }))).toContain('Not yet resolved');
    expect(describeRetest(retest({ unresolved: false }))).not.toContain('Not yet resolved');
  });

  it('names the scenario, the band and the gap', () => {
    const text = describeRetest(retest({ scenario: 'sweep' }));
    expect(text).toContain(SCENARIO_LABELS.sweep);
    expect(text).toContain('101.5 – 102');
    expect(text).toContain('ATR');
  });
});

describe('mergeMarkers', () => {
  const mark = (time: number, text: string): SeriesMarker<UTCTimestamp> => ({
    time: time as UTCTimestamp,
    position: 'belowBar',
    shape: 'circle',
    color: '#fff',
    text,
  });

  it('keeps every source, so one cannot erase the other', () => {
    // The plugin holds one list and setMarkers replaces it: a retest set
    // published on its own would wipe the strategy's entry and exit arrows.
    const merged = mergeMarkers([mark(100, 'trade')], [mark(200, 'retest')]);
    expect(merged.map((m) => m.text)).toEqual(['trade', 'retest']);
  });

  it('returns one ascending list, as setMarkers requires', () => {
    const merged = mergeMarkers([mark(300, 'trade'), mark(100, 'trade')], [mark(200, 'retest')]);
    expect(merged.map((m) => m.time as number)).toEqual([100, 200, 300]);
  });

  it('leaves the caller arrays untouched', () => {
    const trades = [mark(300, 'trade'), mark(100, 'trade')];
    mergeMarkers(trades, []);
    expect(trades.map((m) => m.time as number)).toEqual([300, 100]);
  });

  it('handles no sources and empty ones', () => {
    expect(mergeMarkers().length).toBe(0);
    expect(mergeMarkers([], []).length).toBe(0);
  });
});
