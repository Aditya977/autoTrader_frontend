import { LineStyle } from 'lightweight-charts';
import {
  SCENARIO_LABELS,
  SCENARIO_TAGS,
  describeRetest,
  mergeMarkers,
  opacityFor,
  retestMarkers,
  retestPriceLines,
  titleFor,
} from './retest-overlay';
import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import { bucketStartMs } from './chart-time';
import type { ChartRetest, RetestScenario } from './chart-stream.models';

/**
 * The translation from a retest to what the chart draws.
 *
 * Pure, so these are about the decisions rather than the canvas: that a level
 * is drawn as a band and never as a line, that quality reaches the rendering
 * as something continuous, that an unresolved retest stays visibly distinct
 * from a settled one, and that a marker lands on a bar the chart is actually
 * drawing.
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

describe('retestPriceLines', () => {
  it('draws the level as a band, never as a single line', () => {
    const lines = retestPriceLines(retest());
    expect(lines.length).toBe(2);
    expect(lines.map((line) => line.price).sort()).toEqual([101.5, 102]);
    // Collapsing the band to a midpoint would put back exactly the "price
    // never touched my level" confusion the zone exists to remove.
    expect(lines.some((line) => line.price === 101.75)).toBeFalse();
  });

  it('labels only the upper edge, so two axis tags cannot overlap', () => {
    const lines = retestPriceLines(retest());
    expect(lines.filter((line) => line.axisLabelVisible).length).toBe(1);
    expect(lines[0].axisLabelVisible).toBeTrue();
    expect(lines[0].title).toContain(SCENARIO_TAGS.exact);
    expect(lines[1].title).toBe('');
  });

  it('dots an unresolved retest and dashes a settled one', () => {
    expect(retestPriceLines(retest({ unresolved: true }))[0].lineStyle).toBe(LineStyle.Dotted);
    expect(retestPriceLines(retest({ unresolved: false }))[0].lineStyle).toBe(LineStyle.Dashed);
  });

  it('colours by breakout direction, from the shared palette', () => {
    // The same green as an up candle and a support line: the chart says the
    // same thing the same way everywhere.
    expect(retestPriceLines(retest({ direction: 'BULLISH' }))[0].color).toContain('38, 161, 123');
    expect(retestPriceLines(retest({ direction: 'BEARISH' }))[0].color).toContain('239, 83, 80');
  });

  it('fades and thins by quality rather than switching on valid', () => {
    const strong = retestPriceLines(retest({ quality: 0.9 }))[0];
    const weak = retestPriceLines(retest({ quality: 0.1 }))[0];
    expect(strong.color).not.toBe(weak.color);
    expect(strong.lineWidth).toBeGreaterThan(weak.lineWidth);
  });

  it('gives both edges of one band the same weight and colour', () => {
    const [upper, lower] = retestPriceLines(retest());
    expect(lower.color).toBe(upper.color);
    expect(lower.lineWidth).toBe(upper.lineWidth);
    expect(lower.lineStyle).toBe(upper.lineStyle);
  });
});

describe('titleFor', () => {
  it('names the scenario', () => {
    expect(titleFor(retest({ scenario: 'sweep' }))).toContain(SCENARIO_TAGS.sweep);
  });

  it('shows the touch count only once it is a warning', () => {
    // A decay term: a first touch has nothing to say, a third is a warning.
    expect(titleFor(retest({ touchCount: 1 }))).not.toContain('×');
    expect(titleFor(retest({ touchCount: 3 }))).toContain('×3');
  });

  it('flags a higher-timeframe-only retest', () => {
    expect(titleFor(retest({ htfOnly: true }))).toContain('HTF');
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

  it('marks the resumption only once there is one', () => {
    expect(retestMarkers([retest()], 60).length).toBe(2);
    expect(retestMarkers([retest({ resumptionAt: null, unresolved: true })], 60).length).toBe(1);
  });

  it('draws no approach mark for a time-based retest', () => {
    // §4.5 — price never comes back, so there is no approach bar to mark.
    const markers = retestMarkers([retest({ scenario: 'time', approachAt: null })], 60);
    expect(markers.length).toBe(1);
    expect(markers[0].shape).toBe('circle');
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
