import {
  chartTimeframe,
  eventMarkers,
  eventNotesAtBar,
  latestKnown,
  readingAt,
  swingMarkers,
  trendLines,
  trendlineSegments,
  type ChartAxis,
} from './trend-overlay';
import type {
  CompactReading,
  TimeframeTrend,
  TrendReading,
  TrendSwing,
  WireTrendline,
} from './trend.models';

const MIN = 60_000;
/** 2026-09-16 09:15 IST. */
const OPEN = Date.UTC(2026, 8, 16, 3, 45);

function compact(at: number, overrides: Partial<CompactReading> = {}): CompactReading {
  return {
    at,
    barTs: at - 5 * MIN,
    direction: 'BULLISH',
    strength: 60,
    phase: 'ESTABLISHED',
    structure: 'HH_HL',
    trendScore: 40,
    breakState: 'NONE',
    ...overrides,
  };
}

function latest(at: number, overrides: Partial<TrendReading> = {}): TimeframeTrend['latest'] {
  return {
    timeframe: '5m',
    at,
    barTs: at - 5 * MIN,
    close: 105,
    direction: 'BULLISH',
    strength: 60,
    phase: 'ESTABLISHED',
    structure: 'HH_HL',
    structureScore: 1,
    trendScore: 40,
    breakState: 'NONE',
    components: {
      structure: 1,
      higherTimeframe: null,
      ema: 0.5,
      momentum: 0.2,
      adx: 0.4,
      efficiency: 0.3,
      volume: null,
    },
    weakening: [],
    transition: null,
    range: null,
    protectedLevel: 100,
    htf: { alignment: null, frames: [] },
    features: {
      atr: 2,
      atrPct: 0.02,
      rangeAtr: 1,
      rsi: 60,
      roc: 0.1,
      macdHistogram: 0.1,
      adx: 25,
      plusDi: 30,
      minusDi: 15,
      efficiency: 0.3,
      relativeVolume: null,
      ema: [104, 102, null, null],
      emaAlignment: 1,
      emaSlopes: [0.1, 0.05, null, null],
      distanceFromEmaAtr: [0.5, 1.5, null, null],
    },
    levels: {
      zones: [],
      nearestSupport: {
        low: 98.5,
        high: 99,
        kind: 'SUPPORT',
        touches: 2,
        reactionAtr: 2,
        recency: 1,
        relativeVolume: null,
        strength: 0.7,
        lastTouchedAt: at,
      },
      nearestResistance: null,
      distanceToSupportAtr: 2.5,
      distanceToResistanceAtr: null,
    },
    ...overrides,
  };
}

function swing(
  kind: 'HIGH' | 'LOW',
  label: TrendSwing['label'],
  minute: number,
  price: number,
): TrendSwing {
  return {
    kind,
    price,
    ts: OPEN + minute * MIN,
    exactTs: OPEN + (minute + 2) * MIN,
    confirmedTs: OPEN + (minute + 15) * MIN,
    significant: label !== null,
    label,
    moveAtr: 1,
  };
}

/** A falling resistance through three highs, formed at 10:15, broken at 10:40. */
function resistance(overrides: Partial<WireTrendline> = {}): WireTrendline {
  return {
    id: 1,
    kind: 'RESISTANCE',
    a: { ts: OPEN + 10 * MIN, price: 110 },
    b: { ts: OPEN + 45 * MIN, price: 103 },
    touches: [
      { ts: OPEN + 10 * MIN, confirmedTs: OPEN + 25 * MIN, value: 110 },
      { ts: OPEN + 25 * MIN, confirmedTs: OPEN + 40 * MIN, value: 107 },
      { ts: OPEN + 45 * MIN, confirmedTs: OPEN + 60 * MIN, value: 103 },
    ],
    // One 5m bar is 1.0 lower; five 1m bars on a 1-minute chart.
    slopePerBar: -1,
    formedAt: OPEN + 60 * MIN,
    end: 'BROKEN',
    endAt: OPEN + 85 * MIN,
    breakLevel: 98,
    breakBeyondAtr: 0.5,
    ...overrides,
  };
}

function timeframe(): TimeframeTrend {
  return {
    timeframe: '5m',
    barsAnalysed: 20,
    latest: latest(OPEN + 60 * MIN),
    readings: [
      compact(OPEN + 30 * MIN),
      compact(OPEN + 45 * MIN, { direction: 'BEARISH' }),
      compact(OPEN + 60 * MIN),
    ],
    swings: [
      swing('HIGH', 'HH', 0, 104),
      swing('LOW', 'HL', 5, 100),
      swing('HIGH', 'HH', 10, 106),
      swing('LOW', 'HL', 15, 101),
      swing('HIGH', 'LH', 20, 105),
      swing('LOW', null, 22, 102),
    ],
    events: [
      {
        kind: 'BULLISH_STRUCTURE_BREAK',
        at: OPEN + 60 * MIN,
        barTs: OPEN + 55 * MIN,
        direction: 'DOWN',
        level: 100,
        beyondAtr: 0.4,
        barsToReclaim: null,
        breakQuality: null,
        note: 'closed below the latest higher low 100',
      },
      {
        kind: 'RETEST_REJECTED',
        at: OPEN + 70 * MIN,
        barTs: OPEN + 65 * MIN,
        direction: 'DOWN',
        level: 100,
        beyondAtr: 0.2,
        barsToReclaim: null,
        breakQuality: null,
        note: 'retested',
      },
    ],
    trendlines: [resistance()],
  };
}

/** A one-minute axis from 09:15, one bar a minute for two hours. */
const axis: ChartAxis = {
  firstSec: OPEN / 1000,
  lastSec: (OPEN + 119 * MIN) / 1000,
  indexOf: (sec) => Math.max(0, Math.min(119, Math.floor((sec * 1000 - OPEN) / MIN))),
};

describe('trend overlay', () => {
  it('draws the structure one step up from the candles', () => {
    const all = ['1m', '5m', '15m', '1h', '4h', '1D'] as const;
    expect(chartTimeframe(60, all)).toBe('5m');
    expect(chartTimeframe(180, all)).toBe('5m');
    expect(chartTimeframe(300, all)).toBe('15m');
    expect(chartTimeframe(900, all)).toBe('1h');
    expect(chartTimeframe(1800, all)).toBe('1h');
    expect(chartTimeframe(86_400, all)).toBe('1D');
  });

  it('labels only the current structure on a clean chart, every swing in detail', () => {
    const tf = timeframe();
    expect(swingMarkers(tf, 60, null, 'clean').map((m) => m.text)).toEqual([
      'HH',
      'LH',
      'HL',
      'HL',
    ]);
    expect(swingMarkers(tf, 60, null, 'detailed').length).toBe(5);
  });

  it('puts a swing label on the minute of its wick, and only once confirmed', () => {
    const tf = timeframe();
    // At 09:34 only the first swing (confirmed 09:30) is known.
    const early = swingMarkers(tf, 60, OPEN + 19 * MIN, 'detailed');
    expect(early.map((m) => m.text)).toEqual(['HH']);
    expect(early[0]?.time as number).toBe((OPEN + 2 * MIN) / 1000);
  });

  it('marks only trend-changing events on a clean chart, never before they closed', () => {
    const tf = timeframe();
    expect(eventMarkers(tf, 300, null, 'clean').map((m) => m.text)).toEqual(['HL broken']);
    expect(eventMarkers(tf, 300, null, 'detailed').map((m) => m.text)).toEqual([
      'HL broken',
      'retest held',
    ]);
    expect(eventMarkers(tf, 300, OPEN + 59 * MIN, 'detailed')).toEqual([]);
  });

  it('marks a trendline break on a clean chart only when its line is drawn', () => {
    const tf = timeframe();
    tf.events.push({
      kind: 'TRENDLINE_BREAK',
      at: OPEN + 85 * MIN,
      barTs: OPEN + 80 * MIN,
      direction: 'UP',
      level: 98,
      beyondAtr: 0.5,
      barsToReclaim: null,
      breakQuality: null,
      note: 'closed above the 3-touch falling resistance line',
      trendlineId: 7,
    });
    const texts = (lines: ReadonlySet<number>) =>
      eventMarkers(tf, 300, null, 'clean', lines).map((m) => m.text);
    expect(texts(new Set([1]))).toEqual(['HL broken']);
    expect(texts(new Set([7]))).toEqual(['HL broken', 'TL break']);
  });

  it('returns the reading as of a replay cursor', () => {
    const tf = timeframe();
    expect(readingAt(tf, null)?.at).toBe(OPEN + 60 * MIN);
    expect(readingAt(tf, OPEN + 50 * MIN)?.direction).toBe('BEARISH');
    expect(readingAt(tf, OPEN + 10 * MIN)).toBeNull();
  });

  it('draws the newest reading’s lines only once a replay has reached it', () => {
    const tf = timeframe();
    expect(latestKnown(tf, OPEN + 55 * MIN)).toBeNull();
    expect(trendLines(tf, OPEN + 55 * MIN)).toEqual([]);
    expect(trendLines(tf, null, 'clean').map((l) => l.title)).toEqual(['5m protected HL']);
    expect(trendLines(tf, null, 'detailed').map((l) => l.title)).toEqual([
      '5m protected HL',
      'S ×2',
    ]);
  });

  describe('trendlines', () => {
    it('does not exist before it formed', () => {
      expect(trendlineSegments(timeframe(), 60, OPEN + 59 * MIN, 'clean', axis)).toEqual([]);
    });

    it('runs to the newest bar while active, and stops where it broke', () => {
      // Replay at 10:30: formed (10:15), not yet broken (10:40).
      const [active] = trendlineSegments(timeframe(), 60, OPEN + 75 * MIN, 'clean', axis);
      expect(active?.broken).toBeFalse();
      expect(active?.points[0]).toEqual({ time: ((OPEN + 10 * MIN) / 1000) as never, value: 110 });
      // Drawn from the newest known touch (09:40, 107) at −1 per 5 bars.
      expect(active?.points[1].time as number).toBe((OPEN + 119 * MIN) / 1000);

      const [broken] = trendlineSegments(timeframe(), 60, null, 'clean', axis);
      expect(broken?.broken).toBeTrue();
      expect(broken?.points[1].time as number).toBe((OPEN + 84 * MIN) / 1000);
      // At the break bar the line is 103 − (84 − 45) / 5 = 95.2.
      expect(broken?.points[1].value).toBeCloseTo(95.2, 5);
    });

    it('keeps superseded lines off the chart, and expired ones out of a clean chart', () => {
      const tf = timeframe();
      tf.trendlines = [
        resistance({ id: 1, end: 'SUPERSEDED' }),
        resistance({ id: 2, end: 'EXPIRED' }),
      ];
      expect(trendlineSegments(tf, 60, null, 'clean', axis)).toEqual([]);
      expect(trendlineSegments(tf, 60, null, 'detailed', axis).map((s) => s.id)).toEqual([2]);
      // Superseded later than the cursor: at the cursor it is still the active line.
      expect(trendlineSegments(tf, 60, OPEN + 75 * MIN, 'clean', axis).map((s) => s.id)).toEqual([
        1, 2,
      ]);
    });

    it('keeps only the newest three broken lines on a clean chart', () => {
      const tf = timeframe();
      tf.trendlines = [1, 2, 3, 4].map((id) => resistance({ id, endAt: OPEN + (80 + id) * MIN }));
      expect(trendlineSegments(tf, 60, null, 'clean', axis).map((s) => s.id)).toEqual([4, 3, 2]);
      expect(trendlineSegments(tf, 60, null, 'detailed', axis).length).toBe(4);
    });
  });

  it('explains the events on a hovered bar', () => {
    const notes = eventNotesAtBar(timeframe(), 300, (OPEN + 55 * MIN) / 1000, null);
    expect(notes.length).toBe(1);
    expect(notes[0]?.title).toBe('5m Uptrend broken');
    expect(notes[0]?.up).toBeFalse();
  });
});
