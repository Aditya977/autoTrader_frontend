import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import { THEME, fade } from '../chart-stream/chart-theme';
import { bucketStartMs } from '../chart-stream/chart-time';
import type { MarkNote } from '../market-engine/market-engine-glossary';
import type {
  BreakState,
  CompactReading,
  SwingLabel,
  TimeframeTrend,
  TrendDirection,
  TrendEvent,
  TrendEventKind,
  TrendPhase,
  TrendTimeframe,
  WireTrendline,
} from './trend.models';

/**
 * Trend readings → what the chart draws for them.
 *
 * Pure, like `market-engine-overlay.ts`: no chart, no DOM, no Angular, so what
 * is drawn can be asserted without a canvas.
 *
 * ## One timeframe on the chart, all of them in the panel
 *
 * The candles are one bar size; the chart carries one trend timeframe — one
 * step up from the bar on screen (see {@link chartTimeframe}). Every
 * timeframe is still summarised in the panel.
 *
 * ## Only what matters, unless asked
 *
 * A clean chart (the default) carries the active trendlines, the lines that
 * broke on screen, the current swing labels, the protected level and the events
 * that change the trend. Everything else — every swing, false breaks, retests,
 * support and resistance zones — is in the panel, on hover, or in the
 * detailed mode.
 *
 * ## Nothing before it was known
 *
 * Every function takes `knownAtMs` — the close of the newest bar on screen
 * while a replay is running, `null` otherwise. A swing is drawn only once it
 * was **confirmed** (not merely printed), an event only once its bar closed, and
 * the lines read off the newest reading only once the replay has reached it. A
 * replay therefore shows exactly what the engine knew at that moment, never
 * the afternoon it is about to walk into.
 */

const MINUTES: Readonly<Record<TrendTimeframe, number>> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '75m': 75,
  '1h': 60,
  '125m': 125,
  '4h': 240,
  '1D': 1440,
};

export const DIRECTION_LABELS: Readonly<Record<TrendDirection, string>> = {
  BULLISH: 'Bullish',
  BEARISH: 'Bearish',
  NEUTRAL: 'Neutral',
};

export const PHASE_LABELS: Readonly<Record<TrendPhase, string>> = {
  EMERGING: 'Emerging',
  ESTABLISHED: 'Established',
  WEAKENING: 'Weakening',
  TRANSITIONING: 'Transitioning',
  RANGE: 'Range',
};

export const PHASE_HELP: Readonly<Record<TrendPhase, string>> = {
  EMERGING:
    'A new directional structure is starting: too few aligned swings yet to call it established.',
  ESTABLISHED:
    'Persistent structure — higher highs and higher lows (or lower highs and lower lows).',
  WEAKENING:
    'The trend still stands, but several pieces of evidence are deteriorating. A warning, not a reversal.',
  TRANSITIONING:
    'The protected swing broke on a close. The old trend is broken; the opposite one is not confirmed yet.',
  RANGE: 'No persistent structure either way. Price is moving between recent swing highs and lows.',
};

export const BREAK_LABELS: Readonly<Record<BreakState, string>> = {
  NONE: '—',
  BULLISH_STRUCTURE_BREAK: 'Uptrend broken',
  BEARISH_STRUCTURE_BREAK: 'Downtrend broken',
  FALSE_BREAK: 'False break',
  CONFIRMED_REVERSAL: 'Reversal confirmed',
  BULLISH_BREAKOUT: 'Breakout up',
  BEARISH_BREAKOUT: 'Breakout down',
};

/** One line on the chart per event — short, because a marker has one line. */
export const EVENT_TAGS: Readonly<Record<TrendEventKind, string>> = {
  BULLISH_STRUCTURE_BREAK: 'HL broken',
  BEARISH_STRUCTURE_BREAK: 'LH broken',
  FALSE_BREAK: 'false break',
  CONFIRMED_REVERSAL: 'reversal',
  BULLISH_BREAKOUT: 'breakout',
  BEARISH_BREAKOUT: 'breakdown',
  RETEST_REJECTED: 'retest held',
  TREND_ESTABLISHED: 'trend',
  RANGE_ENTERED: 'range',
  TRENDLINE_BREAK: 'TL break',
};

export const EVENT_HELP: Readonly<Record<TrendEventKind, string>> = {
  BULLISH_STRUCTURE_BREAK:
    'A close below the latest higher low. The uptrend is broken — but a break is not a reversal until lower highs and lower lows form.',
  BEARISH_STRUCTURE_BREAK:
    'A close above the latest lower high. The downtrend is broken — but a break is not a reversal until higher lows and higher highs form.',
  FALSE_BREAK: 'Price closed back through the broken level within a few bars: the break failed.',
  CONFIRMED_REVERSAL:
    'After the break, an opposite swing formed and price took out the low (or high) before it. A new trend has begun.',
  BULLISH_BREAKOUT:
    'A close above the range high by a meaningful distance: the range resolved upward.',
  BEARISH_BREAKOUT:
    'A close below the range low by a meaningful distance: the range resolved downward.',
  RETEST_REJECTED:
    'Price came back to the broken level and was turned away from it — the break is holding.',
  TREND_ESTABLISHED: 'Higher highs and higher lows (or the mirror) took the market out of a range.',
  RANGE_ENTERED:
    'The break found no opposite structure in time, or was reclaimed late: the market is now ranging.',
  TRENDLINE_BREAK:
    'A close through a trendline drawn through three or more swings. Evidence that the move is changing — the trend itself changes only when the structure does.',
};

export const WEAKENING_LABELS: Readonly<Partial<Record<string, string>>> = {
  SHRINKING_EXTENSION: 'Each push is shorter than the last',
  DEEP_PULLBACK: 'The last pullback retraced most of the leg',
  MOMENTUM_DIVERGENCE: 'New extreme without RSI confirmation',
  FADING_PARTICIPATION: 'The newer push on lower volume',
  EMA_SLOPE_FADING: 'EMA 20 slope flattening',
  EMA_CONVERGING: 'EMA 20 and 50 converging',
  COUNTER_TREND_CANDLES: 'Counter-trend candles now larger',
  FAILING_AT_EXTREME: 'Repeated failures at the last extreme',
  TRENDLINE_BREAK: 'Closed through the trendline',
};

export const RANGE_EVIDENCE_LABELS: Readonly<Partial<Record<string, string>>> = {
  MIXED_STRUCTURE: 'Mixed structure',
  LOW_ADX: 'Low ADX',
  LOW_EFFICIENCY: 'Choppy (low efficiency)',
  CONTAINED: 'Inside the range',
};

export const COMPONENT_LABELS: Readonly<Partial<Record<string, string>>> = {
  structure: 'Structure',
  higherTimeframe: 'Higher timeframes',
  ema: 'EMA',
  momentum: 'Momentum',
  adx: 'ADX',
  efficiency: 'Efficiency',
  volume: 'Volume',
};

export function timeframeMinutes(timeframe: TrendTimeframe): number {
  return MINUTES[timeframe];
}

/**
 * The trend timeframe drawn on the candles: **one step up** from the bar on
 * screen — 5m structure on a 1-minute chart, 15m on a 5-minute one, 1h on 15m.
 *
 * A trader drawing on a 1-minute chart connects the swings that stand out on
 * it, and those are the 5-minute turns, not every 1-minute wiggle. Reading the
 * candles' own size buried the chart in labels. On the largest timeframe
 * there is no step up, so it reads itself.
 */
export function chartTimeframe(
  displaySeconds: number,
  available: readonly TrendTimeframe[],
): TrendTimeframe | null {
  const minutes = displaySeconds / 60;
  const sorted = [...available].sort((a, b) => MINUTES[a] - MINUTES[b]);
  return sorted.find((tf) => MINUTES[tf] > minutes) ?? sorted.at(-1) ?? null;
}

const known = (ms: number, knownAtMs: number | null): boolean =>
  knownAtMs === null || ms <= knownAtMs;

/** The reading this timeframe had at `knownAtMs` — the newest one, off replay. */
export function readingAt(
  timeframe: TimeframeTrend,
  knownAtMs: number | null,
): CompactReading | null {
  const readings = timeframe.readings;
  if (knownAtMs === null) return readings.at(-1) ?? null;
  for (let i = readings.length - 1; i >= 0; i--) {
    const reading = readings[i] as CompactReading;
    if (reading.at <= knownAtMs) return reading;
  }
  return null;
}

/** The full newest reading, only when the replay has reached it. */
export function latestKnown(
  timeframe: TimeframeTrend | null,
  knownAtMs: number | null,
): TimeframeTrend['latest'] {
  const latest = timeframe?.latest ?? null;
  return latest && known(latest.at, knownAtMs) ? latest : null;
}

/**
 * How much the chart carries. `clean` (the default) is the current structure
 * and the events that change it; `detailed` is everything, for study.
 */
export type TrendDetail = 'clean' | 'detailed';

/** Events that change what the trend is — the only ones a clean chart marks. */
const MAJOR_EVENTS: readonly TrendEventKind[] = [
  'CONFIRMED_REVERSAL',
  'BULLISH_STRUCTURE_BREAK',
  'BEARISH_STRUCTURE_BREAK',
  'BULLISH_BREAKOUT',
  'BEARISH_BREAKOUT',
  'TRENDLINE_BREAK',
];

/** Broken trendlines a clean chart keeps, newest first. */
const CLEAN_BROKEN_LINES = 3;

const SWING_COLOURS: Readonly<Record<SwingLabel, string>> = {
  HH: THEME.up,
  HL: THEME.up,
  LH: THEME.down,
  LL: THEME.down,
  EQH: THEME.text,
  EQL: THEME.text,
  FIRST: THEME.text,
};

const TRENDLINE_COLOUR = '#7fa6e6';

const at = (ms: number, displaySeconds: number): UTCTimestamp =>
  Math.floor(bucketStartMs(ms, displaySeconds) / 1000) as UTCTimestamp;

/**
 * HH / HL / LH / LL, on the minute of the wick, and only once confirmed.
 * A clean chart labels the current structure only — the newest two highs and
 * two lows — which is what "HH_HL" in the panel is made of.
 */
export function swingMarkers(
  timeframe: TimeframeTrend,
  displaySeconds: number,
  knownAtMs: number | null,
  detail: TrendDetail = 'clean',
): SeriesMarker<UTCTimestamp>[] {
  const confirmed = timeframe.swings.filter(
    (s) => s.significant && s.label && s.label !== 'FIRST' && known(s.confirmedTs, knownAtMs),
  );
  const shown =
    detail === 'detailed'
      ? confirmed
      : [
          ...confirmed.filter((s) => s.kind === 'HIGH').slice(-2),
          ...confirmed.filter((s) => s.kind === 'LOW').slice(-2),
        ];
  return shown.map((s) => ({
    time: at(s.exactTs, displaySeconds),
    position: s.kind === 'HIGH' ? ('aboveBar' as const) : ('belowBar' as const),
    shape: 'circle' as const,
    size: 0.4,
    color: fade(SWING_COLOURS[s.label as SwingLabel], 0.85),
    text: s.label as string,
  }));
}

/**
 * Events on the bar they closed on. Clean: only those that change the trend,
 * and a trendline break only when its line is drawn — `drawnLines`, the ids
 * {@link trendlineSegments} returned — so no mark points at a line that is
 * not there.
 */
export function eventMarkers(
  timeframe: TimeframeTrend,
  displaySeconds: number,
  knownAtMs: number | null,
  detail: TrendDetail = 'clean',
  drawnLines: ReadonlySet<number> | null = null,
): SeriesMarker<UTCTimestamp>[] {
  return timeframe.events
    .filter((e) => known(e.at, knownAtMs))
    .filter((e) => detail === 'detailed' || MAJOR_EVENTS.includes(e.kind))
    .filter(
      (e) =>
        detail === 'detailed' ||
        e.kind !== 'TRENDLINE_BREAK' ||
        drawnLines === null ||
        (e.trendlineId !== undefined && drawnLines.has(e.trendlineId)),
    )
    .map((e) => {
      const up = e.direction === 'UP';
      const minor = e.kind === 'RETEST_REJECTED' || e.kind === 'RANGE_ENTERED';
      const tag = EVENT_TAGS[e.kind];
      return {
        // `at` is the bar's close; step back inside the bar it describes.
        time: at(e.at - 1, displaySeconds),
        position: up ? ('belowBar' as const) : ('aboveBar' as const),
        shape: minor ? ('square' as const) : up ? ('arrowUp' as const) : ('arrowDown' as const),
        color:
          e.kind === 'TRENDLINE_BREAK'
            ? TRENDLINE_COLOUR
            : e.kind === 'FALSE_BREAK' || minor
              ? '#e9b44c'
              : fade(up ? THEME.up : THEME.down, 0.95),
        text:
          e.kind === 'CONFIRMED_REVERSAL' || e.kind === 'TREND_ESTABLISHED'
            ? `${tag} ${up ? '↑' : '↓'}`
            : tag,
      };
    });
}

/** Swings and events together, time-ordered, as the marker plugin wants them. */
export function trendMarkers(
  timeframe: TimeframeTrend | null,
  displaySeconds: number,
  knownAtMs: number | null,
  detail: TrendDetail = 'clean',
  drawnLines: ReadonlySet<number> | null = null,
): SeriesMarker<UTCTimestamp>[] {
  if (!timeframe) return [];
  return [
    ...swingMarkers(timeframe, displaySeconds, knownAtMs, detail),
    ...eventMarkers(timeframe, displaySeconds, knownAtMs, detail, drawnLines),
  ].sort((a, b) => (a.time as number) - (b.time as number));
}

export interface TrendLine {
  price: number;
  title: string;
  color: string;
  style: 'solid' | 'dashed' | 'dotted';
  width: 1 | 2;
  axisLabel: boolean;
}

/**
 * The horizontal prices the chart timeframe's trend turns on: the protected
 * swing (a close through it breaks the trend), the broken level while
 * transitioning, and a range's edges. The nearest support and resistance
 * zones only in detail.
 */
export function trendLines(
  timeframe: TimeframeTrend | null,
  knownAtMs: number | null,
  detail: TrendDetail = 'clean',
): TrendLine[] {
  const latest = latestKnown(timeframe, knownAtMs);
  if (!timeframe || !latest) return [];
  const tf = timeframe.timeframe;
  const lines: TrendLine[] = [];
  const bullish = latest.direction === 'BULLISH';

  if (latest.protectedLevel !== null) {
    lines.push({
      price: latest.protectedLevel,
      title: `${tf} protected ${bullish ? 'HL' : 'LH'}`,
      color: fade(bullish ? THEME.up : THEME.down, 0.6),
      style: 'dashed',
      width: 1,
      axisLabel: true,
    });
  }
  if (latest.transition) {
    lines.push({
      price: latest.transition.brokenLevel,
      title: `${tf} broken ${latest.transition.from === 'BULLISH' ? 'HL' : 'LH'}`,
      color: '#e9b44c',
      style: 'dashed',
      width: 1,
      axisLabel: true,
    });
  }
  if (latest.range) {
    for (const [price, edge] of [
      [latest.range.high, 'high'],
      [latest.range.low, 'low'],
    ] as const) {
      lines.push({
        price,
        title: `${tf} range ${edge}`,
        color: fade(THEME.text, 0.6),
        style: 'dotted',
        width: 1,
        axisLabel: true,
      });
    }
  }
  if (detail === 'detailed') {
    const levels = latest.levels;
    for (const zone of [levels?.nearestSupport, levels?.nearestResistance]) {
      if (!zone) continue;
      const support = zone.kind === 'SUPPORT';
      const price = support ? zone.high : zone.low;
      if (lines.some((l) => Math.abs(l.price - price) < 1e-9)) continue;
      lines.push({
        price,
        title: `${support ? 'S' : 'R'} ×${zone.touches}`,
        color: fade(support ? THEME.up : THEME.down, 0.35 + 0.5 * zone.strength),
        style: 'dotted',
        width: 1,
        axisLabel: false,
      });
    }
  }
  return lines;
}

/** The drawn bars, as a trendline needs them: where a time falls, in bar positions. */
export interface ChartAxis {
  /** Open time (s) of the first and last drawn bar. */
  firstSec: number;
  lastSec: number;
  /** Position of the drawn bar containing `sec` — the newest at or before it. */
  indexOf(sec: number): number;
}

export interface TrendlineSegment {
  id: number;
  kind: WireTrendline['kind'];
  broken: boolean;
  points: [{ time: UTCTimestamp; value: number }, { time: UTCTimestamp; value: number }];
}

/**
 * Trendlines as two-point segments on the drawn axis.
 *
 * Each is what was known at `knownAtMs`: not before it formed, only the
 * touches confirmed by then, ended where it broke if it had broken by then —
 * otherwise running to the newest bar, exactly as a live chart would draw it.
 *
 * Clean keeps the active support and resistance (touched or formed on screen)
 * and the newest few lines that broke on screen. Superseded lines are never
 * drawn: price moved on from them, they were not broken.
 *
 * Drawn in bar positions, because the chart spaces bars evenly: the slope per
 * bar of the trend's timeframe is scaled to the drawn bar size, from a touch
 * on screen — so a line whose first anchor was yesterday still lands on today's
 * touches.
 */
export function trendlineSegments(
  timeframe: TimeframeTrend | null,
  displaySeconds: number,
  knownAtMs: number | null,
  detail: TrendDetail,
  axis: ChartAxis | null,
): TrendlineSegment[] {
  if (!timeframe || !axis) return [];
  const knownAt = knownAtMs ?? Number.POSITIVE_INFINITY;
  const firstMs = axis.firstSec * 1000;
  const perDrawnBar = displaySeconds / (MINUTES[timeframe.timeframe] * 60);

  const active: TrendlineSegment[] = [];
  const broken: { endAt: number; segment: TrendlineSegment }[] = [];

  for (const line of timeframe.trendlines) {
    if (line.formedAt > knownAt) continue;
    const ended = line.endAt !== null && line.endAt <= knownAt ? line.end : null;
    if (ended === 'SUPERSEDED') continue;
    if (ended === 'EXPIRED' && detail === 'clean') continue;
    const endMs = ended ? (line.endAt as number) : null;

    const touches = line.touches.filter((t) => t.confirmedTs <= knownAt);
    const onScreen = ended
      ? (endMs as number) >= firstMs
      : line.formedAt >= firstMs || touches.some((t) => t.confirmedTs >= firstMs);
    if (!onScreen) continue;

    // A reference on screen: the newest known touch there, else the first anchor.
    const ref =
      [...touches].reverse().find((t) => t.ts >= firstMs) ??
      (line.a.ts >= firstMs ? { ts: line.a.ts, value: line.a.price } : null);
    if (!ref) continue;

    const slope = line.slopePerBar * perDrawnBar;
    const refIdx = axis.indexOf(at(ref.ts, displaySeconds));
    const startSec = at(Math.max(line.a.ts, firstMs), displaySeconds);
    const endSec =
      endMs === null ? axis.lastSec : Math.min(at(endMs - 1, displaySeconds), axis.lastSec);
    if (endSec <= startSec) continue;
    const valueAt = (sec: number) => ref.value + slope * (axis.indexOf(sec) - refIdx);

    const segment: TrendlineSegment = {
      id: line.id,
      kind: line.kind,
      broken: ended === 'BROKEN',
      points: [
        { time: startSec as UTCTimestamp, value: valueAt(startSec) },
        { time: endSec as UTCTimestamp, value: valueAt(endSec) },
      ],
    };
    if (ended) broken.push({ endAt: endMs as number, segment });
    else active.push(segment);
  }

  broken.sort((a, b) => b.endAt - a.endAt);
  const keptBroken = detail === 'clean' ? broken.slice(0, CLEAN_BROKEN_LINES) : broken;
  return [...active, ...keptBroken.map((b) => b.segment)];
}

/** What the hover card says about the events on one drawn bar. */
export function eventNotesAtBar(
  timeframe: TimeframeTrend | null,
  displaySeconds: number,
  barTime: number,
  knownAtMs: number | null,
): MarkNote[] {
  if (!timeframe) return [];
  return timeframe.events
    .filter((e) => known(e.at, knownAtMs) && at(e.at - 1, displaySeconds) === barTime)
    .map((e) => explainEvent(timeframe.timeframe, e));
}

export function explainEvent(timeframe: TrendTimeframe, event: TrendEvent): MarkNote {
  const lines = [EVENT_HELP[event.kind], event.note];
  if (event.level !== null) {
    lines.push(
      `Level ${event.level}${event.beyondAtr !== null ? `, closed ${event.beyondAtr} ATR beyond it` : ''}.`,
    );
  }
  if (event.barsToReclaim !== null) lines.push(`Reclaimed after ${event.barsToReclaim} bar(s).`);
  if (event.breakQuality !== null) {
    lines.push(`Break quality ${Math.round(event.breakQuality * 100)}%.`);
  }
  const title =
    event.kind in BREAK_LABELS ? BREAK_LABELS[event.kind as BreakState] : EVENT_TAGS[event.kind];
  return { title: `${timeframe} ${title}`, up: event.direction === 'UP', lines };
}
