import type { ConfirmationStatus, ReversalBias } from '../candle-patterns.models';

/**
 * How a candlestick pattern is painted.
 *
 * Read from the app's own CSS custom properties rather than written here, so
 * an overlay drawn on canvas matches the DOM around it. The app ships one dark
 * theme deliberately, and the fallbacks are that theme's values — they matter
 * only when the primitive is built before styles apply, or in a unit test with
 * no document.
 */

function token(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export interface CandlePalette {
  bullish: string;
  bearish: string;
  neutral: string;
  labelText: string;
  plate: string;
}

/**
 * Deliberately not the `chart-patterns` palette.
 *
 * The two overlays can be on at once, and if a candlestick box and a double
 * top outline were the same cyan a reader could not tell which feature was
 * telling them what. These are the chart's own up/down colours — a bullish
 * reversal marked in the green the candles already use reads immediately,
 * without a legend.
 */
export function readCandlePalette(): CandlePalette {
  return {
    bullish: token('--up', '#26a17b'),
    bearish: token('--down', '#ef5350'),
    neutral: token('--text-muted', '#8b9bad'),
    labelText: token('--text', '#e6edf3'),
    plate: token('--surface-2', '#161f2a'),
  };
}

export const colorForBias = (palette: CandlePalette, bias: ReversalBias): string =>
  bias === 'BULLISH' ? palette.bullish : bias === 'BEARISH' ? palette.bearish : palette.neutral;

/**
 * How solidly a pattern is drawn, by what price did next.
 *
 * `pending` sits between the two on purpose. It is not a weaker finding than a
 * confirmed one — it is a newer one, and on a live chart it is the only kind
 * there is for the newest bar. Drawing it as faintly as a failed pattern would
 * hide every setup a reader could still act on.
 */
export const STATUS_ALPHA: Readonly<Record<ConfirmationStatus, number>> = {
  confirmed: 1,
  pending: 0.8,
  none: 0.65,
  failed: 0.3,
};

/** A pattern that has not resolved is outlined dashed, as its sibling overlay does. */
export const STATUS_DASH: Readonly<Record<ConfirmationStatus, readonly number[] | null>> = {
  confirmed: null,
  pending: [5, 3],
  none: [2, 3],
  failed: [2, 4],
};

export const BOX = {
  /** Pixels of clearance between the bars and the box around them. */
  padX: 4,
  padY: 5,
  lineWidth: 1.5,
  radius: 2,
  /** Half-width used when a single bar's own width cannot be measured. */
  fallbackHalfWidth: 4,
} as const;

export const ARROW = {
  /** Length of the stem, from the box edge outward. */
  length: 18,
  headLength: 6,
  headWidth: 5,
  lineWidth: 1.5,
  /** Lean, in pixels, so the arrow points into the move rather than straight up. */
  lean: 7,
} as const;

export const LABEL = {
  font: '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  smallFont: '10px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  paddingX: 5,
  paddingY: 3,
  radius: 3,
  height: 15,
  /** Gap between the arrow tip and the plate. */
  offset: 4,
  /** Least vertical room between two plates before one is pushed away. */
  minGap: 17,
} as const;

/** `rgba()` from a hex colour, for a tinted plate or fill. */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;
  const value = parseInt(match[1] as string, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
