import type { PatternDirection, PatternStatus } from '../types';

/**
 * How a pattern is painted.
 *
 * Colours are read from the app's own CSS custom properties rather than
 * written here, so an overlay drawn on canvas matches the DOM around it. The
 * app ships one dark theme deliberately (see `styles.scss`), and the fallbacks
 * below are that theme's values — they matter only when the primitive is
 * constructed before styles have applied, or in a unit test with no document.
 */

/** Reads a `--token`, falling back when there is no document to read from. */
function token(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export interface PatternPalette {
  bullish: string;
  bearish: string;
  neutral: string;
  /** Necklines, boundaries at the break level, and targets. */
  level: string;
  /** Text drawn on a tinted plate. */
  labelText: string;
  labelPlate: string;
}

export function readPalette(): PatternPalette {
  return {
    bullish: token('--pattern-bullish', '#22d3ee'),
    bearish: token('--pattern-bearish', '#c084fc'),
    neutral: token('--pattern-neutral', '#8b9bad'),
    level: token('--text-muted', '#8b9bad'),
    labelText: token('--text', '#e6edf3'),
    labelPlate: token('--surface-2', '#161f2a'),
  };
}

export const colorFor = (palette: PatternPalette, direction: PatternDirection): string =>
  direction === 'bullish'
    ? palette.bullish
    : direction === 'bearish'
      ? palette.bearish
      : palette.neutral;

/**
 * A shape that has not broken its level is drawn faintly and dashed.
 *
 * The distinction has to survive a glance. A forming pattern is a description
 * of what price is doing; a confirmed one is a description of what it did, and
 * a reader who cannot tell them apart at a glance will act on the wrong one.
 */
export const OPACITY: Readonly<Record<PatternStatus, number>> = {
  forming: 0.6,
  confirmed: 1,
  invalidated: 0.35,
};

export const LINE_WIDTH = { outline: 2, level: 1.5, target: 1 } as const;
export const DASH = { level: [5, 4], target: [2, 3], forming: [6, 4] } as const;
export const PIVOT_DOT_RADIUS = 3;

export const LABEL = {
  font: '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  paddingX: 6,
  paddingY: 3,
  radius: 4,
  /** Gap between the anchor point and the plate. */
  offset: 10,
  /** Minimum vertical gap between two plates before one is pushed away. */
  minGap: 18,
} as const;

/** `rgba()` from a hex or an existing colour string, for the tinted plate. */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return color;
  const value = parseInt(match[1] as string, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
