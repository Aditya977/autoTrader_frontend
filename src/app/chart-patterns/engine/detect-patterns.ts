import { defaultPatternConfig, type PatternConfig } from '../config';
import type { Candle, DetectedPattern, Pivot } from '../types';
import { atr } from './atr';
import { detectDoubleTopsAndBottoms } from './detectors/double-top-bottom';
import { detectHeadAndShoulders } from './detectors/head-and-shoulders';
import { detectTriangles } from './detectors/triangles';
import type { DetectorContext } from './detectors/shared';
import { findPivots } from './pivots';

export interface DetectionResult {
  patterns: DetectedPattern[];
  /** Published for tests and for drawing the swing points. */
  pivots: Pivot[];
  /** Milliseconds the pass took, for the performance budget. */
  elapsedMs: number;
}

/** Families that describe the same kind of formation. */
const FAMILY: Readonly<Record<DetectedPattern['type'], string>> = {
  double_top: 'double',
  double_bottom: 'double',
  head_and_shoulders: 'hs',
  inverse_head_and_shoulders: 'hs',
  ascending_triangle: 'triangle',
  descending_triangle: 'triangle',
  symmetrical_triangle: 'triangle',
};

/**
 * Every pattern in a series, filtered, deduplicated and ranked.
 *
 * Pure: same candles in, same patterns out, no clock and no chart. That is
 * what lets the whole engine be tested against synthetic fixtures and, later,
 * lifted onto a worker or a server without changing a line of it.
 *
 * ## Why the output is capped
 *
 * A busy chart offers far more shapes than a reader can use, and drawing forty
 * overlapping outlines communicates less than drawing the best six. The cap is
 * applied last, after ranking, so what survives is the most convincing rather
 * than the most recent.
 */
export function detectPatterns(
  candles: readonly Candle[],
  overrides: Partial<PatternConfig> = {},
): DetectionResult {
  const config: PatternConfig = { ...defaultPatternConfig, ...overrides };
  const startedAt = now();

  if (candles.length < config.minBars + config.atrPeriod) {
    return { patterns: [], pivots: [], elapsedMs: now() - startedAt };
  }

  const atrs = atr(candles, config.atrPeriod);

  // Once per swing scale. A chart holds shapes at several sizes at once,
  // and a single ZigZag threshold can only ever present one of them: the
  // detectors read *consecutive* pivots, so a structure the coarse pass
  // sees as three turns is, to the fine pass, thirty turns and no pattern
  // at all. Measured on a real session, the fine pass alone found only the
  // smallest shapes on the chart and missed every large one.
  const found: DetectedPattern[] = [];
  const pivotsByScale: Pivot[][] = [];
  for (const scale of config.swingScales) {
    const pivots = findPivots(candles, atrs, scale);
    if (pivots.length < 3) continue;
    pivotsByScale.push(pivots);
    const context: DetectorContext = { candles, atrs, pivots, config };
    found.push(
      ...detectDoubleTopsAndBottoms(context),
      ...detectHeadAndShoulders(context),
      ...detectTriangles(context),
    );
  }

  const kept = found.filter((p) => p.confidence >= config.minConfidence);

  const patterns = rank(deduplicate(kept)).slice(0, config.maxRenderedPatterns);
  // The finest pass, for anyone drawing the swing points themselves.
  const pivots = pivotsByScale[0] ?? [];
  return { patterns, pivots, elapsedMs: now() - startedAt };
}

/**
 * Drops patterns that substantially overlap a better one.
 *
 * "Substantially" is more than half the shorter pattern's span. Two formations
 * sharing most of their bars are two readings of one piece of price action,
 * and showing both leaves the reader to work out which the chart meant.
 *
 * The exception is deliberate: two *different families* that both score well
 * are kept. A triangle inside the right shoulder of a head and shoulders is
 * two genuine observations about the same bars, and suppressing the second
 * would hide information rather than tidy it.
 */
function deduplicate(patterns: readonly DetectedPattern[]): DetectedPattern[] {
  const kept: DetectedPattern[] = [];

  for (const candidate of [...patterns].sort((a, b) => b.confidence - a.confidence)) {
    const shadowed = kept.some((existing) => {
      if (overlapRatio(existing, candidate) <= 0.5) return false;
      const sameFamily = FAMILY[existing.type] === FAMILY[candidate.type];
      if (sameFamily) return true;
      // Different families both need to be convincing to coexist; otherwise
      // the weaker one is noise sitting on top of a real pattern.
      return !(existing.confidence >= 0.7 && candidate.confidence >= 0.7);
    });
    if (!shadowed) kept.push(candidate);
  }

  return kept;
}

/** Shared span over the shorter of the two spans, 0..1. */
function overlapRatio(a: DetectedPattern, b: DetectedPattern): number {
  const start = Math.max(a.startTime, b.startTime);
  const end = Math.min(a.endTime, b.endTime);
  const shared = end - start;
  if (shared <= 0) return 0;
  const shortest = Math.min(a.endTime - a.startTime, b.endTime - b.startTime);
  if (shortest <= 0) return 1;
  return shared / shortest;
}

/**
 * Confidence first, then recency, then id.
 *
 * The final tie-break on id is not cosmetic: without it two equally scored
 * patterns could swap places between recomputations, and the cap would admit
 * one on this pass and the other on the next — an overlay flickering in and
 * out with nothing on the chart having changed.
 */
function rank(patterns: readonly DetectedPattern[]): DetectedPattern[] {
  return [...patterns].sort(
    (a, b) => b.confidence - a.confidence || b.endTime - a.endTime || a.id.localeCompare(b.id),
  );
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
