import type { UTCTimestamp } from 'lightweight-charts';

/**
 * Everything that knows what time a bar is at, in one place.
 *
 * Two conversions live here and nothing else in the app should repeat them:
 *
 * 1. **ms → s.** `timestamp` on the wire is epoch milliseconds; Lightweight
 *    Charts' `UTCTimestamp` is epoch seconds. Passing ms straight through puts
 *    bars somewhere around the year 58,000 — the chart renders, it is simply
 *    empty where you are looking.
 * 2. **UTC → IST for display only.** The series keeps real UTC instants; every
 *    label the user reads is formatted in `Asia/Kolkata`. The alternative —
 *    shifting the data by +5:30 so the chart's built-in UTC formatting happens
 *    to read as IST — makes every timestamp in the app a lie the moment anyone
 *    compares a bar to an API response, so the offset is applied at the label
 *    and nowhere else.
 */

/** Epoch ms → the epoch-seconds value Lightweight Charts plots against. */
export const toChartTime = (epochMs: number): UTCTimestamp =>
  Math.floor(epochMs / 1000) as UTCTimestamp;

const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/**
 * NSE's 09:15 open, as milliseconds into the IST day.
 *
 * This is the anchor every intraday bucket is aligned to, and it is why
 * resampling cannot simply floor against the epoch: an Indian 5-minute chart
 * runs 09:15, 09:20, 09:25…, whereas epoch-aligned buckets would run 09:15,
 * 09:20 only by luck and 09:10, 09:15 in the general case — half a bar out of
 * step with every other chart the user has open, which is exactly the kind of
 * mismatch that makes a replay impossible to trust.
 */
const SESSION_OPEN_INTO_DAY_MS = (9 * 60 + 15) * 60_000;

/** Display intervals the chart can resample the 1-minute wire series into. */
export const DISPLAY_INTERVALS = [
  { seconds: 60, label: '1m' },
  { seconds: 180, label: '3m' },
  { seconds: 300, label: '5m' },
  { seconds: 900, label: '15m' },
  { seconds: 1800, label: '30m' },
  { seconds: 3600, label: '1h' },
  { seconds: 86_400, label: '1D' },
] as const;

/**
 * The start of the bucket `epochMs` falls in, for a bar of `seconds`.
 *
 * Daily and coarser buckets are the IST *calendar day*, not a 24-hour window
 * from the open — a daily bar belongs to its trading date.
 */
export function bucketStartMs(epochMs: number, seconds: number): number {
  const size = seconds * 1000;
  if (size >= DAY_MS) {
    const ist = epochMs + IST_OFFSET_MS;
    return Math.floor(ist / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  }
  const fromOpen = epochMs + IST_OFFSET_MS - SESSION_OPEN_INTO_DAY_MS;
  return Math.floor(fromOpen / size) * size - IST_OFFSET_MS + SESSION_OPEN_INTO_DAY_MS;
}

/**
 * `Intl` formatters are expensive to construct and are rebuilt on every
 * crosshair move if they are not cached — several hundred times a second while
 * the pointer sweeps a chart.
 */
const IST = 'Asia/Kolkata';

const timeOnly = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dayOnly = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
});

const dayAndTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `09:15` — the ordinary tick label along the time axis. */
export const formatIstTime = (epochSeconds: number): string =>
  timeOnly.format(epochSeconds * 1000);

/** `14 Aug` — for a daily series, and for the first bar of each new day. */
export const formatIstDay = (epochSeconds: number): string =>
  dayOnly.format(epochSeconds * 1000);

/** `14 Aug 2026, 09:15 IST` — the tooltip's headline and the header readout. */
export const formatIstStamp = (epochSeconds: number): string =>
  `${dayAndTime.format(epochSeconds * 1000)} IST`;

/**
 * `14 Aug · 09:15` — the crosshair's label on the time axis.
 *
 * Shorter than {@link formatIstStamp} because it is drawn *into* the axis,
 * between two tick labels: the full stamp is wide enough to cover its
 * neighbours, so the axis reads as though ticks had gone missing. The year and
 * the timezone are the parts a reader already knows by the time they are
 * hovering, and the tooltip beside the cursor still carries both.
 */
export const formatIstAxisStamp = (epochSeconds: number): string =>
  `${dayOnly.format(epochSeconds * 1000)} · ${timeOnly.format(epochSeconds * 1000)}`;

/**
 * A price, at the precision the number itself asks for.
 *
 * Index levels run to two decimals and option premiums to two, but a premium
 * of `0.05` must not render as `0.05` on one bar and `0` on the next, so the
 * floor is two decimals rather than a significant-figure rule.
 */
export function formatPrice(value: number): string {
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** `12.4k`, `1.2M` — volume, which is read as a magnitude, not a count. */
export function formatVolume(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}
