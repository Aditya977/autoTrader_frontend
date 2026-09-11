import type { PatternConfig } from '../config';
import type { Candle, DetectedPattern } from '../types';
import { detectPatterns } from './detect-patterns';

/** The bar sizes the table reports on, and what to call each one. */
export const SCAN_TIMEFRAMES: readonly { seconds: number; label: string; name: string }[] = [
  { seconds: 60, label: '1m', name: '1 minute' },
  { seconds: 300, label: '5m', name: '5 minutes' },
  { seconds: 1800, label: '30m', name: '30 minutes' },
  { seconds: 3600, label: '1h', name: '1 hour' },
  { seconds: 86400, label: '1d', name: '1 day' },
];

export interface TimeframeRow {
  seconds: number;
  /** Short form, for a badge: `30m`. */
  label: string;
  /** Spoken form, for a heading: `30 minutes`. */
  name: string;
  /** Bars available at this size. Small numbers explain an empty row. */
  bars: number;
  patterns: DetectedPattern[];
}

/**
 * The same series read at every bar size.
 *
 * Cheap for one reason worth stating: the chart's buffer holds the one-minute
 * wire series and resamples on demand, so scanning six timeframes costs six
 * passes over data already in memory and not a single extra request. A design
 * that asked the backend for each timeframe would make this table expensive
 * enough not to build.
 *
 * A timeframe with too few bars yields no patterns rather than bad ones — the
 * engine already refuses a series shorter than its own warm-up — and the row is
 * still returned, carrying its bar count, because "nothing here yet" and "not
 * enough data to say" are different answers and the table should show which.
 */
export function scanTimeframes(
  resample: (seconds: number) => Candle[],
  overrides: Partial<PatternConfig> = {},
  timeframes: readonly { seconds: number; label: string; name: string }[] = SCAN_TIMEFRAMES,
): TimeframeRow[] {
  return timeframes.map(({ seconds, label, name }) => {
    const bars = resample(seconds);
    // The forming bar is excluded here too, for the reason `LiveTracker` gives:
    // a table that flickered between two readings of the same minute would be
    // harder to trust than one that lags by a bar.
    const closed = bars.slice(0, -1);
    const { patterns } = detectPatterns(closed, overrides);
    return { seconds, label, name, bars: closed.length, patterns };
  });
}
