import {
  MARK_STATE_KEY,
  STATE_HELP,
  explainGrade,
  explainMark,
} from './market-engine-glossary';
import { STATE_TAGS } from './market-engine-overlay';
import type {
  EngineGrade,
  MarketReading,
  TimeframeReading,
  TimeframeState,
} from './market-engine.models';

/**
 * The words behind the labels.
 *
 * What is worth pinning is that each explanation is *about this reading*: a
 * partial higher-timeframe tick has to say the higher timeframe is ranging, not
 * that it "sort of agrees", and a C has to name the checks that failed.
 */

const OPEN = Date.parse('2026-08-14T03:45:00.000Z');

function tf(timeframe: TimeframeReading['timeframe'], state: TimeframeState): TimeframeReading {
  return {
    timeframe,
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
  };
}

function reading(grade: EngineGrade, overrides: Partial<MarketReading> = {}): MarketReading {
  return {
    at: OPEN + 15 * 60_000,
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
    context: { ...tf('4h', 'RANGE'), developing: null },
    structure: tf('1h', 'TREND_DOWN'),
    setup: { ...tf('15m', 'BREAKOUT_DOWN'), invalidatedBy: 'close back above 224.80 (range low)' },
    trigger: tf('5m', 'RANGE'),
    reaction: 'ASLEEP',
    location: { positionInRangePct: 52, confluence: [], atrToNextOpposingLevel: null },
    volume: { rvol: 1.8, effortResult: null, unavailable: false },
    liquidity: { tookPool: null, resting: [] },
    zones: [],
    sequence: [],
    transition: false,
    direction: 'DOWN',
    grade,
    ...overrides,
  };
}

/** The grade from the screenshot that prompted this: a C with two fails. */
const C_TWO_MISSING: EngineGrade = {
  value: 'C',
  present: ['structure_agrees', 'volume_pattern', 'day_type'],
  partial: ['htf_bias', 'displacement'],
  missing: ['location', 'liquidity_taken'],
  unavailable: [],
  capReason: '2 checklist items missing',
};

describe('explainGrade', () => {
  it('says what is being graded and scores it in words', () => {
    const g = explainGrade(reading(C_TWO_MISSING));
    expect(g.verdict).toBe('Weak setup');
    expect(g.subject).toBe('for a move down on 15m');
    expect(g.score).toBe('3 of 7 checks pass · 2 partial · 2 fail');
  });

  it('names the failed checks when two failures cap the grade', () => {
    const why = explainGrade(reading(C_TWO_MISSING)).whyNotHigher ?? '';
    expect(why).toContain('At a key level or range extreme');
    expect(why).toContain('Liquidity taken first');
    expect(why).toContain('Two or more failures always means C');
  });

  it('explains a partial higher-timeframe tick as neutral, not as half-agreeing', () => {
    const row = explainGrade(reading(C_TWO_MISSING)).rows.find((r) => r.item === 'htf_bias');
    expect(row?.status).toBe('partial');
    expect(row?.detail).toContain('4h is range');
    expect(row?.detail).toContain('neutral rather than against');
  });

  it('gives the numbers behind location', () => {
    const row = explainGrade(reading(C_TWO_MISSING)).rows.find((r) => r.item === 'location');
    expect(row?.detail).toContain('52% up the 4h range');
    expect(row?.detail).toContain('top 30%');
    expect(row?.detail).toContain('no reference levels');
  });

  it('shows an unavailable item as not checkable, never as a fail', () => {
    const grade: EngineGrade = {
      ...C_TWO_MISSING,
      present: ['structure_agrees', 'day_type'],
      unavailable: ['volume_pattern'],
    };
    const g = explainGrade(reading(grade, { volume: { rvol: null, effortResult: null, unavailable: true } }));
    const row = g.rows.find((r) => r.item === 'volume_pattern');
    expect(row?.status).toBe('na');
    expect(row?.detail).toContain('reports no traded volume');
    expect(g.score).toBe("2 of 6 checks pass · 2 partial · 2 fail · 1 can't be checked");
  });

  it('lists what an A still needs', () => {
    const needs = explainGrade(reading(C_TWO_MISSING)).toReachA;
    expect(needs).toContain('Higher-timeframe bias agrees');
    expect(needs).toContain('Shift was displacement');
    expect(needs).not.toContain('Structure timeframe is with it');
  });

  it('spells out the transition cap with both timeframes', () => {
    const grade: EngineGrade = {
      ...C_TWO_MISSING,
      capReason: 'context and structure disagree — market in transition',
    };
    const why = explainGrade(reading(grade, { transition: true })).whyNotHigher ?? '';
    expect(why).toContain('4h is range');
    expect(why).toContain('1h is downtrend');
  });

  it('has nothing to excuse on an A', () => {
    const grade: EngineGrade = {
      value: 'A',
      present: ['htf_bias', 'structure_agrees', 'location', 'liquidity_taken', 'displacement'],
      partial: [],
      missing: [],
      unavailable: [],
      capReason: null,
    };
    const g = explainGrade(reading(grade));
    expect(g.whyNotHigher).toBeNull();
    expect(g.toReachA).toEqual([]);
  });
});

describe('explainMark', () => {
  it('explains the state, the grade and what cancels it', () => {
    const note = explainMark(reading(C_TWO_MISSING));
    expect(note.title).toBe('15m Breakout down · grade C');
    expect(note.up).toBeFalse();
    expect(note.lines[0]).toBe(STATE_HELP.BREAKOUT_DOWN);
    expect(note.lines.some((l) => l.startsWith('Grade C: 3 of 7 checks pass'))).toBeTrue();
    expect(note.lines.at(-1)).toBe('Cancelled by a close back above 224.80 (range low).');
  });
});

describe('the mark key', () => {
  it('describes tags the chart actually prints', () => {
    const printed = Object.values(STATE_TAGS);
    for (const row of MARK_STATE_KEY) {
      const base = row.sample.replace('↑/↓', '↑');
      expect(printed).toContain(base);
    }
  });
});
