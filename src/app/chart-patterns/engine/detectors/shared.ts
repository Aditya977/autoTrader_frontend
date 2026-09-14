import type { PatternConfig } from '../../config';
import type {
  Candle,
  DetectedPattern,
  PatternDirection,
  PatternStatus,
  PatternType,
  Pivot,
} from '../../types';
import { labelText } from '../../types';

/** Everything a detector reads. Assembled once, shared by all of them. */
export interface DetectorContext {
  candles: readonly Candle[];
  /** ATR per bar, aligned to `candles`. `null` inside the warm-up window. */
  atrs: readonly (number | null)[];
  /** Alternating swing highs and lows; the last may be provisional. */
  pivots: readonly Pivot[];
  config: PatternConfig;
}

/**
 * A stable id for a pattern, from its type and its anchor pivots' times.
 *
 * FNV-1a over the string, base-36. Not a cryptographic hash and not trying to
 * be: the requirement is that the same shape yields the same id on every
 * recomputation, so the live tracker can update an overlay in place rather
 * than tearing it down and building it again. An id built from an array
 * position or a counter would change on every recompute and the chart would
 * flicker once per bar.
 *
 * Times, not indices — indices shift when older history is prepended and the
 * same pattern would be handed a new id for standing still.
 */
export function patternId(type: PatternType, anchors: readonly Pivot[]): string {
  const seed = `${type}:${anchors.map((p) => p.time).join(',')}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    // The FNV prime, by shifts, so this stays in 32-bit integer arithmetic.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return `${type}_${hash.toString(36)}`;
}

/** Time of a bar, clamped so a lookup past the end still lands on the series. */
export function timeAt(candles: readonly Candle[], index: number): number {
  const clamped = Math.max(0, Math.min(index, candles.length - 1));
  return (candles[clamped] as Candle).time;
}

/**
 * Whether a pattern may be reported as anything other than `forming`.
 *
 * A shape resting on a provisional pivot has not finished happening. It can be
 * drawn — that is the point of `forming` — but it must never be called
 * confirmed, because the pivot holding it up is still the running extreme and
 * may yet move.
 */
export const restsOnProvisional = (pivots: readonly Pivot[]): boolean =>
  pivots.some((p) => p.provisional);

/**
 * Ratio of the smaller half of a pattern to the larger, 0..1.
 *
 * 1 is perfect symmetry. Used both to reject lopsided shapes and to score the
 * ones that survive.
 */
export function symmetry(leftBars: number, rightBars: number): number {
  if (leftBars <= 0 || rightBars <= 0) return 0;
  return Math.min(leftBars, rightBars) / Math.max(leftBars, rightBars);
}

/** Weighted mean of scores already in 0..1, clamped back into 0..1. */
export function blend(parts: readonly { value: number; weight: number }[]): number {
  let total = 0;
  let weights = 0;
  for (const part of parts) {
    total += Math.max(0, Math.min(1, part.value)) * part.weight;
    weights += part.weight;
  }
  if (weights === 0) return 0;
  return Math.max(0, Math.min(1, total / weights));
}

/** The common tail of building a pattern, so every detector labels alike. */
export function buildPattern(input: {
  type: PatternType;
  direction: PatternDirection;
  status: PatternStatus;
  anchors: Pivot[];
  lines: DetectedPattern['lines'];
  labelAnchor: DetectedPattern['label']['anchor'];
  placement: 'above' | 'below';
  startTime: number;
  endTime: number;
  breakout?: DetectedPattern['breakout'];
  target?: number;
  confidence: number;
}): DetectedPattern {
  return {
    id: patternId(input.type, input.anchors),
    type: input.type,
    direction: input.direction,
    status: input.status,
    startTime: input.startTime,
    endTime: input.endTime,
    pivots: input.anchors,
    lines: input.lines,
    label: {
      text: labelText(input.type, input.direction, input.status),
      anchor: input.labelAnchor,
      placement: input.placement,
    },
    ...(input.breakout ? { breakout: input.breakout } : {}),
    ...(input.target !== undefined ? { target: input.target } : {}),
    confidence: input.confidence,
  };
}
