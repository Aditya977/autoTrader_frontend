import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import { THEME, fade } from '../chart-stream/chart-theme';
import { bucketStartMs } from '../chart-stream/chart-time';
import type {
  Grade,
  MarketReading,
  TimeframeReading,
  TimeframeState,
} from './market-engine.models';

/**
 * Engine readings → what a chart draws for them.
 *
 * Pure, and shaped like `retest-overlay.ts` deliberately: no chart, no DOM, no
 * Angular, so the decisions that matter are testable without a canvas and the
 * component stays "call this, hand the result to the series".
 *
 * The hard part here is restraint. The engine emits a reading at **every**
 * setup-timeframe bar close — twenty-five a day at 15 minutes, and a chart
 * showing ten days would carry two hundred and fifty annotations describing,
 * for the most part, nothing having changed. So:
 *
 * 1. **Only transitions are marked.** A reading whose setup state is the same
 *    as the previous reading's is not drawn. What a trader wants marked is the
 *    bar the market *became* something, and the read-out panel carries the
 *    current state continuously anyway.
 * 2. **RANGE and UNKNOWN are not transitions worth a mark.** They are where
 *    the market spends about half its time, and marking every lapse into them
 *    buries the marks that mean something. They still show in the panel.
 * 3. **One mark per bar.** Several readings can land on one bar once snapped to
 *    a coarser display interval, and the marker plugin stacks their labels
 *    straight on top of each other.
 *
 * Protected levels are drawn as lines rather than marks, because they are
 * *levels* — the whole point of one is the price, and a mark cannot say a
 * price. There are at most three (context, structure, setup), which is few
 * enough to stay legible.
 */

/** How a trader would read each state out loud. */
export const STATE_LABELS: Readonly<Record<TimeframeState, string>> = {
  UNKNOWN: 'Not enough structure',
  RANGE: 'Range',
  TREND_UP: 'Uptrend',
  TREND_DOWN: 'Downtrend',
  PULLBACK_DOWN: 'Pullback in uptrend',
  PULLBACK_UP: 'Pullback in downtrend',
  AT_RISK_UP: 'Uptrend at risk',
  AT_RISK_DOWN: 'Downtrend at risk',
  RESUMPTION_UP: 'Resuming up',
  RESUMPTION_DOWN: 'Resuming down',
  BREAKOUT_UP: 'Breakout up',
  BREAKOUT_DOWN: 'Breakout down',
  REVERSAL_UP: 'Reversal up',
  REVERSAL_DOWN: 'Reversal down',
  EXHAUSTION: 'Exhaustion',
};

/** Compact forms for the marks, where space is one line. */
export const STATE_TAGS: Readonly<Record<TimeframeState, string>> = {
  UNKNOWN: '?',
  RANGE: 'range',
  TREND_UP: 'trend↑',
  TREND_DOWN: 'trend↓',
  PULLBACK_DOWN: 'pullback',
  PULLBACK_UP: 'pullback',
  AT_RISK_UP: 'at risk',
  AT_RISK_DOWN: 'at risk',
  RESUMPTION_UP: 'resume↑',
  RESUMPTION_DOWN: 'resume↓',
  BREAKOUT_UP: 'BOS↑',
  BREAKOUT_DOWN: 'BOS↓',
  REVERSAL_UP: 'reversal↑',
  REVERSAL_DOWN: 'reversal↓',
  EXHAUSTION: 'exhaustion',
};

/** The checklist items, as a person would read them. */
export const CHECKLIST_LABELS: Readonly<Record<string, string>> = {
  htf_bias: 'Higher-timeframe bias agrees',
  structure_agrees: 'Structure timeframe is with it',
  location: 'At a key level or range extreme',
  liquidity_taken: 'Liquidity taken first',
  displacement: 'Shift was displacement',
  volume_pattern: 'Volume expanded on the shift',
  day_type: 'Day type favourable',
};

/** States not worth a mark of their own — see the module doc. */
const UNMARKED: readonly TimeframeState[] = ['RANGE', 'UNKNOWN'];

/**
 * Readings where the setup state changed — the only ones worth an annotation.
 *
 * The first reading is never a transition: there is nothing before it for it to
 * have changed from, and marking it puts a spurious annotation on the left edge
 * of every chart.
 */
export function transitions(readings: readonly MarketReading[]): MarketReading[] {
  const out: MarketReading[] = [];
  let previous: TimeframeState | null = null;

  for (const reading of readings) {
    const state = reading.setup.state;
    if (previous !== null && state !== previous && !UNMARKED.includes(state)) {
      out.push(reading);
    }
    previous = state;
  }

  return out;
}

/** Opacity from grade: an A reading is worth looking at, a C barely. */
export function opacityFor(grade: Grade | null): number {
  if (grade === 'A') return 0.95;
  if (grade === 'B') return 0.7;
  return 0.45;
}

/**
 * The label one mark carries.
 *
 * The state, its grade, and — only when it is the thing that actually happened
 * — the named event behind it. A sweep or a displacement is why a trader looks
 * at the bar at all, so it earns the extra characters; an ordinary break does
 * not, because the state already says so.
 */
export function labelFor(readings: readonly MarketReading[]): string {
  const tags: string[] = [];
  for (const reading of readings) {
    const tag = STATE_TAGS[reading.setup.state];
    if (!tags.includes(tag)) tags.push(tag);
  }

  const parts = [tags.slice(0, 2).join('/')];
  if (tags.length > 2) parts.push(`+${tags.length - 2}`);

  const only = readings.length === 1 ? readings[0] : null;
  if (only?.grade) parts.push(only.grade.value);
  if (only?.setup.event?.kind === 'SWEEP') parts.push('sweep');
  if (only?.setup.event?.kind === 'BOS_DISPLACEMENT') parts.push('disp');
  if (only?.transition) parts.push('transition');

  return parts.join(' ');
}

/**
 * One mark per state transition, snapped to the drawn interval and merged
 * where several land together.
 *
 * `displaySeconds` is the interval the chart is *currently* drawing, not the
 * one the engine read: a reading confirmed at 10:42 has to mark the 10:40 bar
 * on a five-minute chart or it marks nothing at all. Same rule and the same
 * `bucketStartMs` as the trade and retest markers.
 */
export function marketStateMarkers(
  readings: readonly MarketReading[],
  displaySeconds: number,
): SeriesMarker<UTCTimestamp>[] {
  const byBar = new Map<string, { time: UTCTimestamp; bullish: boolean; at: MarketReading[] }>();

  for (const reading of transitions(readings)) {
    const bullish = reading.direction !== 'DOWN';
    // `at` is a bar CLOSE, so it sits at the very start of the next bucket;
    // nudged back inside the bar it describes, exactly as a trade fill is.
    const time = Math.floor(bucketStartMs(reading.at - 1, displaySeconds) / 1000) as UTCTimestamp;
    const key = `${time}|${bullish}`;

    const bucket = byBar.get(key);
    if (bucket) bucket.at.push(reading);
    else byBar.set(key, { time, bullish, at: [reading] });
  }

  const markers: SeriesMarker<UTCTimestamp>[] = [];
  for (const { time, bullish, at } of byBar.values()) {
    // Best grade first, so a merged mark is coloured and named by the reading
    // most worth looking at rather than by whichever arrived first.
    at.sort((a, b) => gradeRank(a.grade?.value ?? null) - gradeRank(b.grade?.value ?? null));
    const best = at[0];

    markers.push({
      time,
      position: bullish ? 'belowBar' : 'aboveBar',
      shape: bullish ? 'arrowUp' : 'arrowDown',
      color: fade(bullish ? THEME.up : THEME.down, opacityFor(best?.grade?.value ?? null)),
      text: labelFor(at),
    });
  }

  return markers.sort((a, b) => (a.time as number) - (b.time as number));
}

function gradeRank(grade: Grade | null): number {
  return grade === 'A' ? 0 : grade === 'B' ? 1 : grade === 'C' ? 2 : 3;
}

/** One protected level, ready to be drawn as a price line. */
export interface ProtectedLine {
  price: number;
  /** `4h protected low` — the timeframe is the point, so it leads. */
  title: string;
  bullish: boolean;
}

/**
 * The protected levels of the newest reading — at most one per timeframe.
 *
 * These are the prices whose close-through changes each timeframe's structure,
 * so they are the lines a trader would actually have on the chart. Duplicates
 * are collapsed: when the 1H and the 15M protect the same swing, that is one
 * line and two labels would be noise.
 */
export function protectedLines(reading: MarketReading | null): ProtectedLine[] {
  if (!reading) return [];

  const rows: { view: TimeframeReading; label: string }[] = [
    { view: reading.context, label: 'context' },
    { view: reading.structure, label: 'structure' },
    { view: reading.setup, label: 'setup' },
  ];

  const seen = new Set<number>();
  const lines: ProtectedLine[] = [];

  for (const { view } of rows) {
    const price = view.protectedLevel;
    if (price === null || seen.has(price)) continue;
    seen.add(price);
    lines.push({
      price,
      title: `${view.timeframe} protected ${view.protectedFrom === 'LOWER_LOW' ? 'high' : 'low'}`,
      bullish: view.protectedFrom !== 'LOWER_LOW',
    });
  }

  return lines;
}

/**
 * The tooltip: everything the mark cannot say.
 *
 * Ordered the way the cascade is read — context down to reaction — then the
 * grade with its reasons, then what would invalidate it. `capReason` is
 * included even for an A (where it is null and omitted) because on a B or C it
 * is the single line that explains the letter.
 */
export function describeReading(reading: MarketReading): string {
  const lines = [
    `${reading.context.timeframe} ${STATE_LABELS[reading.context.state]}`,
    `${reading.structure.timeframe} ${STATE_LABELS[reading.structure.state]}`,
    `${reading.setup.timeframe} ${STATE_LABELS[reading.setup.state]} (${reading.setup.barsInState} bars)`,
  ];

  if (reading.transition) lines.push('Timeframes disagree — market in transition');
  if (reading.reaction !== 'ASLEEP') lines.push(`1m ${reading.reaction.toLowerCase()}`);
  if (reading.sequence.length) lines.push(reading.sequence.join(' then '));

  if (reading.location.positionInRangePct !== null) {
    lines.push(`${Math.round(reading.location.positionInRangePct)}% up the dealing range`);
  }
  if (reading.location.confluence.length) {
    lines.push(`At ${reading.location.confluence.map((l) => l.name).join(', ')}`);
  }

  if (reading.grade) {
    lines.push(`Grade ${reading.grade.value}`);
    if (reading.grade.capReason) lines.push(`  capped: ${reading.grade.capReason}`);
    for (const item of reading.grade.present) {
      lines.push(`  + ${CHECKLIST_LABELS[item] ?? item}`);
    }
    for (const item of reading.grade.missing) {
      lines.push(`  − ${CHECKLIST_LABELS[item] ?? item}`);
    }
    for (const item of reading.grade.unavailable) {
      lines.push(`  · ${CHECKLIST_LABELS[item] ?? item} — no data on this feed`);
    }
  }

  if (reading.setup.invalidatedBy) lines.push(`Invalidated by ${reading.setup.invalidatedBy}`);
  return lines.join('\n');
}

/** The developing higher-timeframe bar, as one line of text or `null`. */
export function describeDeveloping(reading: MarketReading | null): string | null {
  const developing = reading?.context.developing;
  if (!reading || !developing || developing.barsSoFar === 0) return null;

  const range =
    developing.low === null || developing.high === null
      ? 'no range yet'
      : `${developing.low} – ${developing.high}`;
  const testing = developing.testingProtectedLevel ? ' · testing the protected level' : '';
  return `${reading.context.timeframe} so far ${range} (${developing.barsSoFar} bars)${testing}`;
}

/** One edge of a live zone, ready to be drawn as a thin price line. */
export interface ZoneEdgeLine {
  price: number;
  /** Only the far edge carries a title, so a zone is labelled once. */
  title: string;
  bullish: boolean;
  /** Mitigated zones are drawn fainter — spent, not gone. */
  spent: boolean;
}

/**
 * The edges of the nearest live zones, capped.
 *
 * Capped at a couple of zones because each is two lines, and the protected
 * levels are already on the chart: past four or five horizontal lines the
 * levels that matter stop being findable. The panel lists the rest.
 *
 * Invalid zones are never drawn. They are gone, and a line for a zone price has
 * already closed through is a level that no longer exists.
 */
export function zoneLines(reading: MarketReading | null, maxZones = 2): ZoneEdgeLine[] {
  if (!reading) return [];

  const lines: ZoneEdgeLine[] = [];
  for (const zone of reading.zones.filter((z) => z.status !== 'INVALID').slice(0, maxZones)) {
    const bullish = zone.direction === 'BULLISH';
    const spent = zone.status === 'MITIGATED';
    const tag = zone.kind === 'ORDER_BLOCK' ? 'OB' : 'FVG';
    // The far edge — the one price has to get through — carries the label.
    lines.push(
      {
        price: bullish ? zone.low : zone.high,
        title: `${tag} ${zone.status.toLowerCase()}`,
        bullish,
        spent,
      },
      { price: bullish ? zone.high : zone.low, title: '', bullish, spent },
    );
  }
  return lines;
}
