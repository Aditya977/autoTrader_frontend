import type { Candle, DetectedPattern } from '../types';

export interface OverlayDiff {
  added: DetectedPattern[];
  updated: DetectedPattern[];
  removedIds: string[];
}

/**
 * What to redraw, and when it is worth recomputing at all.
 *
 * Two jobs, both about not doing work: deciding that a redraw represents a
 * *closed bar* rather than another update to the one still forming, and
 * turning a fresh detection pass into the smallest set of overlay changes that
 * gets to the same picture.
 *
 * ## The forming bar is deliberately excluded
 *
 * `barsToScan` hands back every bar **except the newest**. That bar is the only
 * one that can still change: in Live mode it is rewritten on every tick, and
 * nothing on the wire says whether it has closed. Feeding it to the engine
 * would let a pattern confirm on a half-formed close and un-confirm on the next
 * tick, which is exactly the flicker the spec forbids.
 *
 * Excluding it buys a stronger property than "no flicker": **detection runs
 * only over bars that can no longer change**, so a pattern once reported never
 * silently revises because a bar underneath it moved. The price is one bar of
 * latency on a confirmation, and that is the honest cost of deciding status on
 * closes.
 */
export class LiveTracker {
  private lastClosedTime: number | null = null;
  private drawn = new Map<string, DetectedPattern>();

  /**
   * Whether a closed bar has appeared since the last time this said yes.
   *
   * A new *newest* bar time means the bar before it is final. That is the only
   * signal available — `ChartCandleEvent` carries no closed flag — and it is
   * reliable, because the buffer keys bars by time and never moves one.
   */
  hasBarClosed(bars: readonly Candle[]): boolean {
    const closed = bars[bars.length - 2];
    if (!closed) return false;
    if (this.lastClosedTime === closed.time) return false;
    this.lastClosedTime = closed.time;
    return true;
  }

  /**
   * The bars a detection pass may read: everything except the forming one,
   * capped to the rolling window.
   *
   * The window is a cost control rather than a correctness one. A live session
   * accumulates bars all day and re-scanning five thousand of them on every
   * close would spend most of the budget re-deriving pivots that have not
   * moved since the morning.
   */
  barsToScan(bars: readonly Candle[], windowBars: number): Candle[] {
    const closed = bars.slice(0, -1);
    return windowBars > 0 && closed.length > windowBars ? closed.slice(-windowBars) : closed;
  }

  /**
   * The smallest set of overlay changes that reaches this result.
   *
   * A pattern keeps its id across recomputations, so the common case on a
   * closed bar is that every id is already drawn and nothing has changed —
   * which produces an empty diff and no repaint at all.
   */
  diff(patterns: readonly DetectedPattern[]): OverlayDiff {
    const next = new Map(patterns.map((pattern) => [pattern.id, pattern]));

    const removedIds: string[] = [];
    for (const id of this.drawn.keys()) {
      if (!next.has(id)) removedIds.push(id);
    }

    const added: DetectedPattern[] = [];
    const updated: DetectedPattern[] = [];
    for (const pattern of patterns) {
      const existing = this.drawn.get(pattern.id);
      if (!existing) added.push(pattern);
      else if (differs(existing, pattern)) updated.push(pattern);
    }

    this.drawn = next;
    return { added, updated, removedIds };
  }

  /** Everything currently believed to be drawn. */
  get current(): DetectedPattern[] {
    return [...this.drawn.values()];
  }

  reset(): void {
    this.lastClosedTime = null;
    this.drawn = new Map();
  }
}

/**
 * Whether a pattern that kept its id has anything new about it.
 *
 * The anchors cannot have moved — they are what the id is built from — so only
 * the status, the drawn geometry, the end time and the confidence on the label
 * can differ.
 */
export function differs(a: DetectedPattern, b: DetectedPattern): boolean {
  if (a.status !== b.status) return true;
  if (a.direction !== b.direction) return true;
  if (a.endTime !== b.endTime) return true;
  if (a.confidence !== b.confidence) return true;
  if (a.lines.length !== b.lines.length) return true;
  return a.lines.some((line, i) => {
    const other = b.lines[i];
    return (
      !other ||
      line.role !== other.role ||
      line.from.time !== other.from.time ||
      line.from.price !== other.from.price ||
      line.to.time !== other.to.time ||
      line.to.price !== other.to.price
    );
  });
}
