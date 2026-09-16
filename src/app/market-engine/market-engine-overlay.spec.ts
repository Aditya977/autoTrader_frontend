import {
  describeDeveloping,
  describeReading,
  labelFor,
  marketStateMarkers,
  opacityFor,
  protectedLines,
  transitions,
  zoneLines,
} from './market-engine-overlay';
import type {
  Grade,
  MarketReading,
  TimeframeReading,
  TimeframeState,
} from './market-engine.models';

/**
 * What the chart draws for an engine reading.
 *
 * The behaviour worth pinning is the restraint: the engine emits a reading at
 * every setup-timeframe bar close, and drawing all of them buries the handful
 * that mean something under two hundred that say "still the same".
 */

/** 09:15 IST = 03:45 UTC. */
const OPEN = Date.parse('2026-08-14T03:45:00.000Z');

function timeframe(
  tf: TimeframeReading['timeframe'],
  state: TimeframeState,
  overrides: Partial<TimeframeReading> = {},
): TimeframeReading {
  return {
    timeframe: tf,
    state,
    confirmedAt: OPEN,
    barsInState: 0,
    expiresAfterBars: null,
    protectedLevel: null,
    protectedFrom: null,
    rangeHigh: null,
    rangeLow: null,
    pullbackDepth: null,
    leg: null,
    event: null,
    invalidationLevel: null,
    invalidatedBy: null,
    ...overrides,
  };
}

function reading(
  at: number,
  setupState: TimeframeState,
  overrides: Partial<MarketReading> = {},
): MarketReading {
  return {
    at,
    session: {
      date: '2026-08-14',
      gapKind: 'FLAT',
      gapPoints: 0,
      cprBand: 'normal',
      openingRange: null,
      dayType: 'UNDETERMINED',
      efficiencyRatio: null,
      flags: [],
      events: [],
    },
    context: { ...timeframe('4h', 'TREND_UP'), developing: null },
    structure: timeframe('1h', 'PULLBACK_DOWN'),
    setup: timeframe('15m', setupState),
    trigger: timeframe('5m', 'RANGE'),
    reaction: 'ASLEEP',
    location: { positionInRangePct: null, confluence: [], atrToNextOpposingLevel: null },
    volume: { rvol: null, effortResult: null, unavailable: true },
    liquidity: { tookPool: null, resting: [] },
    zones: [],
    sequence: [],
    transition: false,
    direction: setupState.endsWith('_DOWN') ? 'DOWN' : 'UP',
    grade: null,
    ...overrides,
  };
}

/** Bar close times 15 minutes apart. */
const at = (i: number): number => OPEN + (i + 1) * 15 * 60_000;

describe('transitions', () => {
  it('keeps only the readings where the setup state changed', () => {
    const readings = [
      reading(at(0), 'RANGE'),
      reading(at(1), 'PULLBACK_DOWN'),
      reading(at(2), 'PULLBACK_DOWN'),
      reading(at(3), 'RESUMPTION_UP'),
    ];
    expect(transitions(readings).map((r) => r.at)).toEqual([at(1), at(3)]);
  });

  it('never marks the first reading', () => {
    // There is nothing before it for it to have changed from, and marking it
    // puts a spurious annotation on the left edge of every chart.
    expect(transitions([reading(at(0), 'BREAKOUT_UP')])).toEqual([]);
  });

  it('does not mark a lapse into RANGE or UNKNOWN', () => {
    // Together they are about half of all readings; marking every lapse into
    // them buries the marks that mean something.
    const readings = [
      reading(at(0), 'BREAKOUT_UP'),
      reading(at(1), 'RANGE'),
      reading(at(2), 'UNKNOWN'),
      reading(at(3), 'PULLBACK_UP'),
    ];
    expect(transitions(readings).map((r) => r.setup.state)).toEqual(['PULLBACK_UP']);
  });
});

describe('marketStateMarkers', () => {
  const readings = [
    reading(at(0), 'RANGE'),
    reading(at(1), 'BREAKOUT_UP'),
    reading(at(2), 'RESUMPTION_UP'),
  ];

  it('marks a transition on the bar it describes, not the one after it', () => {
    // `at` is a bar CLOSE, which sits at the very start of the next bucket. A
    // mark placed there would sit one candle to the right of the move.
    const [first] = marketStateMarkers(readings, 900);
    expect((first?.time as number) * 1000).toBe(at(1) - 15 * 60_000);
  });

  it('snaps to the interval the chart is currently drawing', () => {
    // A reading confirmed at 10:00 has to mark the 09:15 bar on a 4H chart, or
    // it marks nothing at all.
    const [first] = marketStateMarkers(readings, 4 * 3_600);
    expect((first?.time as number) * 1000).toBe(OPEN);
  });

  it('merges readings that land on the same bar into one mark', () => {
    const markers = marketStateMarkers(readings, 4 * 3_600);
    // Both transitions run the same way and fall in the same 4H bucket, so the
    // plugin would otherwise stack two labels on the same pixel.
    expect(markers.length).toBe(1);
    expect(markers[0]?.text).toContain('BOS↑');
    expect(markers[0]?.text).toContain('resume↑');
  });

  it('returns marks in ascending time, as the plugin requires', () => {
    const markers = marketStateMarkers(readings, 900);
    for (let i = 1; i < markers.length; i += 1) {
      expect(markers[i]?.time as number).toBeGreaterThanOrEqual(markers[i - 1]?.time as number);
    }
  });

  it('draws nothing when nothing transitioned', () => {
    expect(marketStateMarkers([reading(at(0), 'RANGE')], 900)).toEqual([]);
  });
});

describe('labelFor', () => {
  it('names the state, its grade, and the event only when it is the point', () => {
    const swept = reading(at(1), 'RESUMPTION_UP', {
      grade: grade('A'),
      setup: timeframe('15m', 'RESUMPTION_UP', {
        event: {
          kind: 'SWEEP',
          direction: 'DOWN',
          level: 100,
          barAt: OPEN,
          confirmedAt: at(1),
          beyondAtr: -0.2,
          bodyAtr: 0.4,
          leftFvg: false,
          fvg: null,
        },
      }),
    });
    expect(labelFor([swept])).toBe('resume↑ A sweep');
  });

  it('says nothing extra about an ordinary break — the state already did', () => {
    expect(labelFor([reading(at(1), 'BREAKOUT_UP', { grade: grade('B') })])).toBe('BOS↑ B');
  });

  it('counts the rest rather than spelling out four tags', () => {
    const merged = [
      reading(at(1), 'BREAKOUT_UP'),
      reading(at(1), 'PULLBACK_DOWN'),
      reading(at(1), 'RESUMPTION_UP'),
    ];
    expect(labelFor(merged)).toBe('BOS↑/pullback +1');
  });
});

describe('opacityFor', () => {
  it('ranks A above B above C, and never reaches zero', () => {
    expect(opacityFor('A')).toBeGreaterThan(opacityFor('B'));
    expect(opacityFor('B')).toBeGreaterThan(opacityFor('C'));
    // A mark that was asked for and drawn invisibly reads as a broken chart.
    expect(opacityFor(null)).toBeGreaterThan(0.3);
  });
});

describe('protectedLines', () => {
  it('draws one line per timeframe that has a protected level', () => {
    const lines = protectedLines(
      reading(at(1), 'PULLBACK_DOWN', {
        context: {
          ...timeframe('4h', 'TREND_UP', { protectedLevel: 24_640, protectedFrom: 'HIGHER_HIGH' }),
          developing: null,
        },
        structure: timeframe('1h', 'PULLBACK_DOWN', {
          protectedLevel: 24_772,
          protectedFrom: 'HIGHER_HIGH',
        }),
      }),
    );
    expect(lines.map((line) => line.price)).toEqual([24_640, 24_772]);
    expect(lines[0]?.title).toBe('4h protected low');
    expect(lines.every((line) => line.bullish)).toBe(true);
  });

  it('collapses timeframes that protect the same swing', () => {
    // Two labels on one price is noise, not information.
    const lines = protectedLines(
      reading(at(1), 'PULLBACK_DOWN', {
        structure: timeframe('1h', 'PULLBACK_DOWN', {
          protectedLevel: 100,
          protectedFrom: 'HIGHER_HIGH',
        }),
        setup: timeframe('15m', 'PULLBACK_DOWN', {
          protectedLevel: 100,
          protectedFrom: 'HIGHER_HIGH',
        }),
      }),
    );
    expect(lines.length).toBe(1);
  });

  it('draws nothing for a market with no protected level', () => {
    expect(protectedLines(reading(at(1), 'RANGE'))).toEqual([]);
    expect(protectedLines(null)).toEqual([]);
  });

  it('names a downtrend level a protected high', () => {
    const [line] = protectedLines(
      reading(at(1), 'PULLBACK_UP', {
        structure: timeframe('1h', 'PULLBACK_UP', {
          protectedLevel: 200,
          protectedFrom: 'LOWER_LOW',
        }),
      }),
    );
    expect(line?.title).toBe('1h protected high');
    expect(line?.bullish).toBe(false);
  });
});

describe('describeReading', () => {
  it('reads the cascade top down and spells out the grade', () => {
    const text = describeReading(
      reading(at(1), 'RESUMPTION_UP', { grade: grade('B'), sequence: ['SWEEP_LOW 100'] }),
    );
    expect(text).toContain('4h Uptrend');
    expect(text).toContain('1h Pullback in uptrend');
    expect(text).toContain('15m Resuming up');
    expect(text).toContain('Grade B');
    expect(text).toContain('SWEEP_LOW 100');
  });

  /**
   * The index case. A checklist item the feed cannot answer must not read as a
   * failed check — that tells a user their setup was weak when the truth is
   * that there is no volume on an NSE index at all.
   */
  it('marks an unavailable item as missing data, not as a failure', () => {
    const text = describeReading(reading(at(1), 'BREAKOUT_UP', { grade: grade('B') }));
    expect(text).toContain('Volume expanded on the shift — no data on this feed');
    // Never under the "missing" bullet, which is what a failed check reads as.
    expect(text).not.toContain('− Volume');
  });

  it('says outright when the timeframes disagree', () => {
    const text = describeReading(reading(at(1), 'BREAKOUT_UP', { transition: true }));
    expect(text).toContain('transition');
  });
});

describe('describeDeveloping', () => {
  it('reports the forming bar as a running range, never as a close', () => {
    const text = describeDeveloping(
      reading(at(1), 'PULLBACK_DOWN', {
        context: {
          ...timeframe('4h', 'TREND_UP'),
          developing: { high: 24_868, low: 24_801, barsSoFar: 2, testingProtectedLevel: false },
        },
      }),
    );
    expect(text).toBe('4h so far 24801 – 24868 (2 bars)');
  });

  it('says when price is testing the protected level — the one live question', () => {
    const text = describeDeveloping(
      reading(at(1), 'PULLBACK_DOWN', {
        context: {
          ...timeframe('4h', 'TREND_UP'),
          developing: { high: 24_868, low: 24_640, barsSoFar: 5, testingProtectedLevel: true },
        },
      }),
    );
    expect(text).toContain('testing the protected level');
  });

  it('is null before any finer bar has closed inside it', () => {
    expect(describeDeveloping(reading(at(1), 'RANGE'))).toBeNull();
  });
});

function grade(value: Grade): MarketReading['grade'] {
  return {
    value,
    present: ['htf_bias'],
    partial: [],
    missing: [],
    unavailable: ['volume_pattern'],
    capReason: value === 'A' ? null : 'at a key level or higher-timeframe extreme — partial',
  };
}

describe('zoneLines', () => {
  const zone = (
    status: 'FRESH' | 'TESTED' | 'MITIGATED' | 'INVALID',
    low: number,
    direction: 'BULLISH' | 'BEARISH' = 'BULLISH',
  ) => ({
    kind: 'ORDER_BLOCK' as const,
    direction,
    low,
    high: low + 10,
    status,
    tests: 0,
    createdAt: OPEN,
    originAt: OPEN - 900_000,
    sweptLiquidity: false,
    leftFvg: false,
  });

  it('draws two edges per zone and labels only the far one', () => {
    const lines = zoneLines(reading(at(1), 'RANGE', { zones: [zone('FRESH', 100)] }));
    expect(lines.length).toBe(2);
    // Bullish: price comes down into it, so the low is the edge to get through.
    expect(lines[0]?.price).toBe(100);
    expect(lines[0]?.title).toBe('OB fresh');
    expect(lines[1]?.title).toBe('');
  });

  it('never draws an invalid zone — it no longer exists', () => {
    const lines = zoneLines(reading(at(1), 'RANGE', { zones: [zone('INVALID', 100)] }));
    expect(lines).toEqual([]);
  });

  it('caps the number of zones so the protected levels stay findable', () => {
    const zones = [zone('FRESH', 100), zone('TESTED', 120), zone('FRESH', 140)];
    expect(zoneLines(reading(at(1), 'RANGE', { zones })).length).toBe(4);
  });

  it('marks a mitigated zone as spent rather than hiding it', () => {
    const [edge] = zoneLines(reading(at(1), 'RANGE', { zones: [zone('MITIGATED', 100)] }));
    expect(edge?.spent).toBeTrue();
  });
});
