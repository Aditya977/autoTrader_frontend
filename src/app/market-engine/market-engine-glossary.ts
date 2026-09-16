import { CHECKLIST_LABELS, STATE_LABELS, STATE_TAGS } from './market-engine-overlay';
import type {
  EngineZone,
  Grade,
  MarketReading,
  ReactionReading,
  TimeframeReading,
  TimeframeState,
} from './market-engine.models';

/**
 * What every word the engine prints means, in the words a trader would use.
 *
 * Pure and separate from the overlay: the overlay decides *what* is drawn, this
 * decides how it is *explained*, and both the chart's hover card and the panel's
 * tooltips read from here so the two can never describe one label differently.
 *
 * Nothing in here invents a fact. Every sentence either restates a rule from the
 * backend's rulebook or reads a field the reading already carries — a
 * explanation that guessed would be worse than the bare label it replaced.
 */

/** What each state means, one or two plain sentences. */
export const STATE_HELP: Readonly<Record<TimeframeState, string>> = {
  UNKNOWN: 'Not enough confirmed swings yet to say anything about this timeframe.',
  RANGE:
    'No trend. Price is moving sideways between a high and a low, and no protected level is in force.',
  TREND_UP: 'Higher highs and higher lows. The last higher low is the protected level.',
  TREND_DOWN: 'Lower highs and lower lows. The last lower high is the protected level.',
  PULLBACK_DOWN:
    'An uptrend is dipping but the protected low still holds. This is where a long setup is looked for.',
  PULLBACK_UP:
    'A downtrend is bouncing but the protected high still holds. This is where a short setup is looked for.',
  AT_RISK_UP:
    'The uptrend is weakening — the dip went too deep or broke a level weakly. Not reversed yet, but no longer healthy.',
  AT_RISK_DOWN:
    'The downtrend is weakening — the bounce went too deep or broke a level weakly. Not reversed yet, but no longer healthy.',
  RESUMPTION_UP: 'A pullback in an uptrend has ended and price is moving up again.',
  RESUMPTION_DOWN: 'A bounce in a downtrend has ended and price is moving down again.',
  BREAKOUT_UP: 'Price closed above the range high and the next bar accepted it (break of structure up).',
  BREAKOUT_DOWN:
    'Price closed below the range low and the next bar accepted it (break of structure down).',
  REVERSAL_UP:
    'The downtrend has flipped: price closed through the protected high with a strong, wide candle behind it.',
  REVERSAL_DOWN:
    'The uptrend has flipped: price closed through the protected low with a strong, wide candle behind it.',
  EXHAUSTION:
    'Big effort, little progress — the trend is spending volume or range without moving on. Often comes before a range or a turn.',
};

/** The five kinds of break the engine names, and what each one says about a level. */
export const EVENT_HELP: Readonly<Record<string, string>> = {
  SWEEP:
    'Liquidity sweep — price traded through a level (where stops sit) and closed back inside. Stops were taken; the level was not broken.',
  WEAK_BREAK: 'Weak break — a close just beyond the level on a small candle. It needs the next bar to confirm it.',
  FAILED_BREAK: 'Failed break — price closed beyond the level, then the next bar closed straight back inside.',
  BOS: 'Break of structure — a close beyond the level that the next bar accepted.',
  BOS_DISPLACEMENT:
    'Displacement break — a break of structure made by a wide candle closing near its extreme. The strongest kind of break.',
};

/** What each of the five rows of the cascade is responsible for. */
export const ROLE_HELP: Readonly<Record<string, string>> = {
  context:
    'The highest timeframe. Sets the overall bias and the dealing range. Lower timeframes are read in its light.',
  structure:
    'Decides whether a move against the trend is a pullback or a reversal, using the protected level.',
  setup: 'Where setups form: price at a level, a sweep, a shift. The chart marks come from this row.',
  trigger: 'The entry timeframe: a break with acceptance inside a short time window.',
  reaction:
    'One-minute behaviour at the trigger level only. Asleep most of the session by design.',
};

export const REACTION_HELP: Readonly<Record<ReactionReading, string>> = {
  ASLEEP: 'Price is not at the trigger level, so there is nothing for the one-minute chart to judge.',
  RETEST_HOLD: 'Price came back to the broken level and it held.',
  RETEST_FAIL: 'Price came back to the broken level and closed through it — the break is in doubt.',
  RETEST_SWEEP: 'Price poked through the broken level and closed back — stops taken, level held.',
};

/** What the checklist item checks, independent of any one reading. */
export const CHECK_HELP: Readonly<Record<string, string>> = {
  htf_bias:
    'Does the highest timeframe trend the same way? A ranging higher timeframe counts as partial — neutral, not against.',
  structure_agrees:
    'Is the structure timeframe trending, pulling back or resuming in this direction? "At risk" counts as partial.',
  location:
    'Is price near the edge of the dealing range (bottom 30% for longs, top 30% for shorts) and near at least two reference levels? One of the two is partial.',
  liquidity_taken:
    'Were stops run first — a sweep of a high or low before the move? It is what gives a move fuel.',
  displacement:
    'Was the shift a wide, decisive candle? A plain break of structure is partial; no clean break fails.',
  volume_pattern:
    'Was volume at least 1.5× normal on the shift? Normal volume (1–1.5×) is partial. Indices report no volume, so it cannot be checked.',
  day_type:
    'Is the day behaving normally? A confirmed day type passes, an unconfirmed one is partial, and an expiry or event day fails.',
};

export const GRADE_HELP: Readonly<Record<Grade, string>> = {
  A: 'A — every key check passes: bias, structure, location, displacement and liquidity, with nothing failing.',
  B: 'B — nothing badly wrong, but at least one key check is only partial or missing.',
  C: 'C — two or more checks fail, or a hard cap applies (higher timeframe against it, structure reversing, or timeframes disagreeing).',
};

export const GRADE_SCALE_HELP =
  'How good the current setup is, from a seven-item checklist. ' +
  `${GRADE_HELP.A} ${GRADE_HELP.B} ${GRADE_HELP.C} ` +
  'A grade describes the setup, not the chance of a profit.';

const DAY_TYPE_HELP: Readonly<Record<string, string>> = {
  UNDETERMINED: 'Not enough of the day has traded to classify it.',
  TREND_DAY_UP: 'Trend day up — price has travelled efficiently in one direction.',
  TREND_DAY_DOWN: 'Trend day down — price has travelled efficiently in one direction.',
  RANGE_DAY: 'Range day — price has rotated back and forth without getting far.',
  GAP_AND_GO: 'Gap and go — the opening gap has kept extending.',
  GAP_FILL: 'Gap fill — price has moved back to close the opening gap.',
};

const GAP_HELP: Readonly<Record<string, string>> = {
  FLAT: 'Opened roughly where it closed yesterday.',
  GAP_UP_INSIDE: "Opened higher, but still inside yesterday's range.",
  GAP_UP_ABOVE_PDH: "Opened above yesterday's high.",
  GAP_DOWN_INSIDE: "Opened lower, but still inside yesterday's range.",
  GAP_DOWN_BELOW_PDL: "Opened below yesterday's low.",
};

const FLAG_HELP: Readonly<Record<string, string>> = {
  EXPIRY_DAY: 'Expiry day — option positioning distorts price. The day-type check fails.',
  DAY_BEFORE_EXPIRY: 'The day before expiry — positioning starts to distort price. The day-type check fails.',
  EVENT_DAY: 'A scheduled event (policy, data) is on this date. The day-type check fails.',
  EVENT_WINDOW: 'Inside the window around a scheduled event, when readings are least reliable.',
};

const POOL_HELP: Readonly<Record<string, string>> = {
  EQUAL_HIGHS: 'Several highs at the same price — stops cluster just above.',
  EQUAL_LOWS: 'Several lows at the same price — stops cluster just below.',
  SWING_HIGH: 'A confirmed swing high — stops sit just above it.',
  SWING_LOW: 'A confirmed swing low — stops sit just below it.',
  OPENING_RANGE_HIGH: "The top of the day's opening range.",
  OPENING_RANGE_LOW: "The bottom of the day's opening range.",
  PDH: "Yesterday's high.",
  PDL: "Yesterday's low.",
};

const ZONE_STATUS_HELP: Readonly<Record<EngineZone['status'], string>> = {
  FRESH: 'Price has not come back to it yet.',
  TESTED: 'Price has come back into it and it held.',
  MITIGATED: 'Price has traded through most of it — mostly used up.',
  INVALID: 'Price closed through it — the zone no longer exists.',
};

export function dayTypeHelp(dayType: string): string {
  return DAY_TYPE_HELP[dayType] ?? 'How the day is behaving so far.';
}

export function gapHelp(gapKind: string): string {
  return `Opening gap. ${GAP_HELP[gapKind] ?? ''}`.trim();
}

export function cprHelp(band: string): string {
  const meaning =
    band === 'narrow'
      ? 'A narrow pivot range often comes before a trending day.'
      : band === 'wide'
        ? 'A wide pivot range often comes before a sideways day.'
        : 'An ordinary width — no strong hint either way.';
  return `Central pivot range width, from yesterday's high, low and close. ${meaning}`;
}

export function flagHelp(flag: string): string {
  return FLAG_HELP[flag] ?? 'A calendar flag — readings on flagged days are treated with suspicion.';
}

export function poolHelp(source: string, side: string): string {
  const where =
    side === 'BUY_SIDE'
      ? 'Buy-side liquidity: stops from short sellers above price.'
      : 'Sell-side liquidity: stops from buyers below price.';
  return `${POOL_HELP[source] ?? 'A level where stop orders cluster.'} ${where} Price is often drawn to these.`;
}

export function zoneHelp(zone: EngineZone): string {
  const kind =
    zone.kind === 'ORDER_BLOCK'
      ? 'Order block — the last opposite candle before a strong move. Price often reacts when it returns.'
      : 'Fair value gap — a price gap left by a fast move, where little traded. Price often returns to fill it.';
  const side = zone.direction === 'BULLISH' ? 'Bullish: expected to act as support.' : 'Bearish: expected to act as resistance.';
  return `${kind} ${side} ${ZONE_STATUS_HELP[zone.status]}`;
}

/* --- The chart's marks ----------------------------------------------------- */

/** One row of the key that explains the chart's marks. */
export interface MarkKeyRow {
  /** Exactly as it appears on the chart. */
  sample: string;
  meaning: string;
}

/**
 * Every tag a mark can carry, in the order a trader meets them.
 *
 * Built from {@link STATE_TAGS} so a tag renamed in the overlay can never leave
 * the key describing a word the chart no longer prints. `range` and `?` are left
 * out because the chart never marks them.
 */
export const MARK_STATE_KEY: readonly MarkKeyRow[] = (
  [
    ['PULLBACK_DOWN', 'Pullback — a dip in an uptrend (↑ green) or a bounce in a downtrend (↓ red). The protected level still holds.'],
    ['RESUMPTION_UP', 'The pullback is over and the trend is moving again in the arrow’s direction.'],
    ['BREAKOUT_UP', 'Break of structure — a close through the range edge that the next bar accepted.'],
    ['AT_RISK_UP', 'The trend is weakening: too deep a pullback or a weak break. Not reversed yet.'],
    ['REVERSAL_UP', 'The trend flipped: a close through the protected level with a strong candle.'],
    ['TREND_UP', 'A trend has been established in the arrow’s direction.'],
    ['EXHAUSTION', 'Effort without progress — the trend is running out of steam.'],
  ] as const
).map(([state, meaning]) => ({ sample: STATE_TAGS[state].replace('↑', '↑/↓'), meaning }));

export const MARK_MODIFIER_KEY: readonly MarkKeyRow[] = [
  { sample: '↑ green below the bar', meaning: 'A reading about an upward move.' },
  { sample: '↓ red above the bar', meaning: 'A reading about a downward move.' },
  { sample: 'A / B / C', meaning: 'The setup grade. Faint marks are C, solid marks are A.' },
  { sample: 'sweep', meaning: 'Stops were run through a level first.' },
  { sample: 'disp', meaning: 'The break was a wide, decisive candle (displacement).' },
  { sample: 'transition', meaning: 'Higher timeframes disagree, so the grade is capped at C.' },
  { sample: '+2', meaning: 'More readings landed on this bar than fit — hover for all of them.' },
];

/** One reading, as the chart's hover card prints it. */
export interface MarkNote {
  title: string;
  up: boolean;
  lines: string[];
}

/**
 * The hover card for one mark: what the state means, what happened, how it
 * graded and what would cancel it.
 */
export function explainMark(reading: MarketReading): MarkNote {
  const setup = reading.setup;
  const grade = reading.grade?.value;
  const lines = [STATE_HELP[setup.state]];

  const event = setup.event?.kind;
  if (event && EVENT_HELP[event]) lines.push(EVENT_HELP[event]);

  lines.push(
    `Higher timeframes: ${reading.context.timeframe} ${STATE_LABELS[reading.context.state].toLowerCase()}, ` +
      `${reading.structure.timeframe} ${STATE_LABELS[reading.structure.state].toLowerCase()}.`,
  );

  if (reading.grade) {
    const explained = explainGrade(reading);
    lines.push(`Grade ${reading.grade.value}: ${explained.score}. ${explained.whyNotHigher ?? ''}`.trim());
  }
  if (setup.invalidatedBy) lines.push(`Cancelled by a ${setup.invalidatedBy}.`);

  return {
    title: `${setup.timeframe} ${STATE_LABELS[setup.state]}${grade ? ` · grade ${grade}` : ''}`,
    up: reading.direction !== 'DOWN',
    lines,
  };
}

/* --- The grade --------------------------------------------------------------- */

export type CheckStatus = 'pass' | 'partial' | 'fail' | 'na';

export interface CheckRow {
  item: string;
  label: string;
  status: CheckStatus;
  /** Why this item landed where it did, for *this* reading. */
  detail: string;
  /** What the item checks in general — the tooltip. */
  help: string;
}

export interface GradeExplanation {
  grade: Grade;
  verdict: string;
  /** `for a move down on 15m`, or `null` when the reading has no direction. */
  subject: string | null;
  /** `3 of 7 checks pass · 2 partial · 2 fail`. */
  score: string;
  rows: CheckRow[];
  /** Why the letter is not higher, as a sentence. `null` for an A. */
  whyNotHigher: string | null;
  /** Items still short of what an A requires, labelled. Empty for an A. */
  toReachA: string[];
}

/** The five items an A needs present — the backend's `aGrade` rule. */
const A_REQUIRES = ['htf_bias', 'structure_agrees', 'location', 'displacement', 'liquidity_taken'];

const VERDICTS: Readonly<Record<Grade, string>> = {
  A: 'Strong setup',
  B: 'Decent setup',
  C: 'Weak setup',
};

/**
 * The grade, taken apart into sentences a person can act on.
 *
 * The backend sends the letter, four lists of item keys and a terse cap reason.
 * Each is correct and none of them, on its own, says what happened: a `~`
 * beside "Higher-timeframe bias agrees" reads as "sort of agrees", when the
 * truth is "the higher timeframe is ranging, so it is neither for nor against".
 * This joins each item to the fields of the reading that decided it.
 */
export function explainGrade(reading: MarketReading): GradeExplanation {
  const grade = reading.grade;
  if (!grade) {
    throw new Error('explainGrade needs a graded reading');
  }

  const rows: CheckRow[] = [
    ...grade.present.map((item) => row(reading, item, 'pass')),
    ...grade.partial.map((item) => row(reading, item, 'partial')),
    ...grade.missing.map((item) => row(reading, item, 'fail')),
    ...grade.unavailable.map((item) => row(reading, item, 'na')),
  ];

  const checked = grade.present.length + grade.partial.length + grade.missing.length;
  const parts = [`${grade.present.length} of ${checked} checks pass`];
  if (grade.partial.length) parts.push(`${grade.partial.length} partial`);
  if (grade.missing.length) parts.push(`${grade.missing.length} fail`);
  if (grade.unavailable.length) parts.push(`${grade.unavailable.length} can't be checked`);

  const direction =
    reading.direction === 'UP' ? 'up' : reading.direction === 'DOWN' ? 'down' : null;

  return {
    grade: grade.value,
    verdict: VERDICTS[grade.value],
    subject: direction ? `for a move ${direction} on ${reading.setup.timeframe}` : null,
    score: parts.join(' · '),
    rows,
    whyNotHigher: whyNotHigher(reading),
    toReachA:
      grade.value === 'A'
        ? []
        : A_REQUIRES.filter((item) => !grade.present.includes(item)).map(label),
  };
}

function label(item: string): string {
  return CHECKLIST_LABELS[item] ?? item.replace(/_/g, ' ');
}

function row(reading: MarketReading, item: string, status: CheckStatus): CheckRow {
  return {
    item,
    label: label(item),
    status,
    detail: detailFor(reading, item, status),
    help: CHECK_HELP[item] ?? '',
  };
}

function stateText(view: TimeframeReading): string {
  return `${view.timeframe} is ${STATE_LABELS[view.state].toLowerCase()}`;
}

/**
 * The fields of the reading that put one item where it is.
 *
 * Mirrors `gradeReading` on the backend branch by branch, reading the same
 * inputs from the wire shape.
 */
function detailFor(reading: MarketReading, item: string, status: CheckStatus): string {
  const up = reading.direction !== 'DOWN';
  const way = up ? 'up' : 'down';

  switch (item) {
    case 'htf_bias':
      if (status === 'pass') return `${stateText(reading.context)} — same way as this move.`;
      if (status === 'partial')
        return `${stateText(reading.context)} — no confirmed trend, so neutral rather than against.`;
      return `${stateText(reading.context)} — against a move ${way}.`;

    case 'structure_agrees':
      if (status === 'pass') return `${stateText(reading.structure)} — supports a move ${way}.`;
      if (status === 'partial') return `${stateText(reading.structure)} — weakened or unclear.`;
      return `${stateText(reading.structure)} — turning against a move ${way}.`;

    case 'location': {
      const pct = reading.location.positionInRangePct;
      const levels = reading.location.confluence;
      const edge = up ? 'bottom 30%' : 'top 30%';
      const where =
        pct === null
          ? 'Position in the range is unknown'
          : `Price is ${Math.round(pct)}% up the ${reading.context.timeframe} range (an edge means the ${edge})`;
      const near = levels.length
        ? `near ${levels.map((l) => l.name).join(', ')}`
        : 'no reference levels within ¼ ATR';
      const needs = status === 'pass' ? '' : ' Passing needs both the range edge and two levels.';
      return `${where}; ${near}.${needs}`;
    }

    case 'liquidity_taken': {
      const took = reading.liquidity.tookPool;
      if (status === 'pass') {
        return took
          ? `Took ${took.source.replace(/_/g, ' ').toLowerCase()} at ${took.price} before the move.`
          : 'A sweep came before the move.';
      }
      return 'No stops were run (no sweep of a high or low) before the move.';
    }

    case 'displacement': {
      const kind = reading.setup.event?.kind;
      if (status === 'pass') return 'The break was a wide candle closing near its extreme.';
      if (status === 'partial') return 'A clean break of structure, but not a wide, decisive candle.';
      const what =
        kind === 'SWEEP'
          ? 'a sweep'
          : kind === 'WEAK_BREAK'
            ? 'only a weak break'
            : kind === 'FAILED_BREAK'
              ? 'a failed break'
              : 'no break';
      return `The ${reading.setup.timeframe} shift was ${what}, not a break of structure.`;
    }

    case 'volume_pattern': {
      if (status === 'na') return 'This instrument reports no traded volume (NSE indices never do).';
      const rvol = reading.volume.rvol;
      const x = rvol === null ? '' : `${rvol.toFixed(1)}× normal volume`;
      if (status === 'pass') return `${x} — expanding.`;
      if (status === 'partial') return `${x} — average, not expanding (needs 1.5×).`;
      return `${x} — below average.`;
    }

    case 'day_type': {
      const session = reading.session;
      if (status === 'fail') {
        const flags = session.flags.map((f) => f.replace(/_/g, ' ').toLowerCase());
        return `Flagged day: ${flags.join(', ') || 'calendar event'}.`;
      }
      const type = session.dayType.replace(/_/g, ' ').toLowerCase();
      if (status === 'pass') return `Day type confirmed after the first hour: ${type}.`;
      return `Day type not confirmed yet (${type}).`;
    }

    default:
      return '';
  }
}

/** The backend's `capReason`, said in full. */
function whyNotHigher(reading: MarketReading): string | null {
  const grade = reading.grade;
  if (!grade || grade.value === 'A') return null;
  const reason = grade.capReason ?? '';

  if (reason.startsWith('context and structure disagree')) {
    return `Capped at C: ${stateText(reading.context)} but ${stateText(reading.structure)} — the timeframes disagree, so the market is between trends.`;
  }
  if (reason.startsWith('confirmed higher-timeframe bias')) {
    return `Capped at C: ${stateText(reading.context)}, which is against this move.`;
  }
  if (reason.startsWith('structure timeframe is reversing')) {
    return `Capped at C: ${stateText(reading.structure)}, turning against this move.`;
  }
  if (/checklist items missing$/.test(reason)) {
    const failed = grade.missing.map(label).join(' and ');
    return `Capped at C: ${grade.missing.length} checks fail (${failed}). Two or more failures always means C.`;
  }
  if (grade.value === 'B') {
    const short = grade.missing[0] ?? A_REQUIRES.find((item) => grade.partial.includes(item));
    return short
      ? `Not an A: "${label(short)}" is ${grade.missing.includes(short) ? 'failing' : 'only partial'}.`
      : 'Not an A: the checklist as a whole falls short.';
  }
  return reason ? `Capped: ${reason}.` : null;
}
