import type { Bar } from '../chart-stream/candle-series-buffer';
import type { ChartInterval } from '../chart-stream/chart-stream.models';
import type { CandlePatternBar, CandlePatternHit } from './candle-patterns.models';
import type { RenderedCandlePattern } from './render/candle-pattern-overlay';

/**
 * When to ask the backend, and what to redraw when it answers.
 *
 * Detection is a network call, and the chart redraws on every candle event —
 * including the repeated rewrites of the bar still forming. A live session
 * produces a few of those per second, so the naive wiring would issue a
 * request per tick, each one describing a bar that had not closed. Two jobs
 * here prevent that: deciding that a redraw represents a **closed bar**, and
 * turning an answer into the smallest set of overlay changes.
 *
 * Deliberately free of Angular and of the charting library, so the rules can
 * be tested without a DOM or a socket.
 *
 * ## The forming bar is excluded
 *
 * {@link closedBars} hands back every bar **except the newest**. That bar is
 * the only one that can still change: in a live session it is rewritten on
 * every tick, and nothing on the wire says whether it has closed. Sending it
 * would let a pattern appear on a half-formed close and vanish on the next
 * tick.
 *
 * Excluding it buys something stronger than "no flicker": detection runs only
 * over bars that can no longer change, so a pattern once drawn never silently
 * revises because a bar underneath it moved. The price is one bar of latency,
 * and that is the honest cost of deciding a shape on closes.
 */
export class CandlePatternSync {
  private lastKey: string | null = null;
  private drawn = new Map<string, RenderedCandlePattern>();

  /**
   * The bars a request may carry: everything but the forming one.
   *
   * Capped to `windowBars` from the end. That is a cost control rather than a
   * correctness one — a live session accumulates bars all day, and the payload
   * is the series — but it has a correctness consequence worth stating: the
   * oldest bars in the window have no ATR and no trend behind them, exactly as
   * they would in a shorter chart, so the window's start is a warm-up either
   * way.
   */
  static closedBars(bars: readonly Bar[], windowBars: number): Bar[] {
    const closed = bars.slice(0, -1);
    return windowBars > 0 && closed.length > windowBars ? closed.slice(-windowBars) : closed;
  }

  /**
   * The bars in the wire's compact shape.
   *
   * Seconds to **milliseconds** here, and this is the only place the
   * conversion happens. The chart's x axis is in seconds and the whole backend
   * is in milliseconds; a factor of a thousand either way puts every box in
   * 1970 or in the year 57000, and in both cases `timeToCoordinate` answers
   * `null` and the overlay simply does not appear — a silent failure, which is
   * why it is isolated to one function with one test.
   */
  static toWire(bars: readonly Bar[]): CandlePatternBar[] {
    return bars.map((bar) => ({
      t: bar.time * 1000,
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      v: bar.volume,
    }));
  }

  /**
   * What identifies this question, so the same one is not asked twice.
   *
   * Every part earns its place:
   *
   * - `seriesKey` — the instrument. Two instruments charted on the same day
   *   have the *same bar times*, so without it a panel moved from a call to a
   *   put would reuse the call's patterns.
   * - `interval` — the bar size, which the chart resamples locally.
   * - the newest closed bar's time — the only thing that changes as a session
   *   runs, and the signal that there is a new question at all.
   * - the oldest bar's time and the count — these move when history is
   *   prepended or the window slides, which changes the warm-up and so can
   *   change the answer for bars that were already there.
   * - `tuning` — the thresholds, so changing one re-asks.
   */
  static key(input: {
    seriesKey: string;
    interval: ChartInterval;
    bars: readonly Bar[];
    tuning: string;
  }): string | null {
    const { bars } = input;
    const first = bars[0];
    const last = bars[bars.length - 1];
    if (!first || !last) return null;
    return [input.seriesKey, input.interval, input.tuning, first.time, last.time, bars.length].join(
      '|',
    );
  }

  /**
   * Whether this question is worth asking, remembering it if so.
   *
   * Returns `false` for a repeat, which is the common case: a live chart
   * redraws many times between two bar closes, and every one of those redraws
   * produces the same key.
   */
  shouldRequest(key: string | null): boolean {
    if (key === null) return false;
    if (this.lastKey === key) return false;
    this.lastKey = key;
    return true;
  }

  /**
   * The smallest set of overlay changes that reaches this result.
   *
   * A hit keeps its id across recomputations — the id is its name and its bar
   * — so the common case on a new closed bar is that every existing box is
   * unchanged and only the newest is added. Republishing the whole set would
   * redraw identical boxes and read as a flicker.
   */
  diff(hits: readonly RenderedCandlePattern[]): CandlePatternDiff {
    const next = new Map(hits.map((hit) => [hit.id, hit]));

    const removedIds: string[] = [];
    for (const id of this.drawn.keys()) {
      if (!next.has(id)) removedIds.push(id);
    }

    const changed: RenderedCandlePattern[] = [];
    for (const hit of hits) {
      const existing = this.drawn.get(hit.id);
      if (!existing || differs(existing, hit)) changed.push(hit);
    }

    this.drawn = next;
    return { changed, removedIds };
  }

  /** Everything currently believed to be drawn. */
  get current(): RenderedCandlePattern[] {
    return [...this.drawn.values()];
  }

  /**
   * Forgets both the last question and what is drawn.
   *
   * Called when the panel moves to another session. Keeping either would let
   * one instrument's boxes survive onto another's bars, or suppress the first
   * request for the new series because the old key happened to match.
   */
  reset(): void {
    this.lastKey = null;
    this.drawn = new Map();
  }
}

export interface CandlePatternDiff {
  /** Added, or already drawn and now different. */
  changed: RenderedCandlePattern[];
  removedIds: string[];
}

/**
 * Whether a hit that kept its id has anything new about it.
 *
 * The name and the bar cannot have moved — they are what the id is built from
 * — so what can differ is the part that depends on later bars: the
 * confirmation, and the confidence that counts it. `label` is included because
 * it is resolved outside the engine and a caller could change it.
 */
export function differs(a: RenderedCandlePattern, b: RenderedCandlePattern): boolean {
  return (
    a.status !== b.status ||
    a.confidence !== b.confidence ||
    a.confirmationTime !== b.confirmationTime ||
    a.patternHigh !== b.patternHigh ||
    a.patternLow !== b.patternLow ||
    a.label !== b.label
  );
}

/**
 * A hit with its display name attached, ready to draw.
 *
 * The backend ships names in a `labels` map keyed by pattern rather than
 * repeating a long string on every hit. A name it did not ship falls back to
 * the pattern's own key: an unfamiliar label is a small puzzle for the reader,
 * while an empty plate is a bug nobody can see.
 */
export function withLabels(
  hits: readonly CandlePatternHit[],
  labels: Record<string, string>,
): RenderedCandlePattern[] {
  return hits.map((hit) => ({ ...hit, label: labels[hit.primary] ?? hit.primary }));
}
