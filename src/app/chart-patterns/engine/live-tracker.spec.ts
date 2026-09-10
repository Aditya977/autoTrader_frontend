import type { Candle, DetectedPattern } from '../types';
import { detectPatterns } from './detect-patterns';
import { fromKeypoints, type Keypoint } from './fixtures';
import { LiveTracker } from './live-tracker';

const bar = (time: number, close = 100): Candle => ({
  time,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1,
});

const pattern = (over: Partial<DetectedPattern> = {}): DetectedPattern => ({
  id: 'p1',
  type: 'double_bottom',
  direction: 'bullish',
  status: 'forming',
  startTime: 1,
  endTime: 10,
  pivots: [],
  lines: [{ from: { time: 1, price: 1 }, to: { time: 2, price: 2 }, role: 'outline' }],
  label: { text: 'x', anchor: { time: 1, price: 1 }, placement: 'below' },
  confidence: 0.6,
  ...over,
});

describe('LiveTracker', () => {
  describe('hasBarClosed', () => {
    /**
     * The signal the whole live path rests on. `ChartCandleEvent` carries no
     * closed flag, so a bar is known to be final only once a later one exists.
     */
    it('fires when a new bar appears behind the forming one', () => {
      const tracker = new LiveTracker();
      expect(tracker.hasBarClosed([bar(1), bar(2)])).toBe(true);
      expect(tracker.hasBarClosed([bar(1), bar(2), bar(3)])).toBe(true);
    });

    /**
     * The requirement the spec states outright: detection must never run per
     * tick. A tick rewrites the forming bar and leaves the closed one alone.
     */
    it('stays silent while only the forming bar is being rewritten', () => {
      const tracker = new LiveTracker();
      expect(tracker.hasBarClosed([bar(1), bar(2, 100)])).toBe(true);
      expect(tracker.hasBarClosed([bar(1), bar(2, 101)])).toBe(false);
      expect(tracker.hasBarClosed([bar(1), bar(2, 102)])).toBe(false);
      expect(tracker.hasBarClosed([bar(1), bar(2, 103)])).toBe(false);
    });

    it('has nothing to report from a series with no closed bar', () => {
      const tracker = new LiveTracker();
      expect(tracker.hasBarClosed([])).toBe(false);
      expect(tracker.hasBarClosed([bar(1)])).toBe(false);
    });

    it('forgets what it has seen once reset', () => {
      const tracker = new LiveTracker();
      tracker.hasBarClosed([bar(1), bar(2)]);
      expect(tracker.hasBarClosed([bar(1), bar(2)])).toBe(false);
      tracker.reset();
      expect(tracker.hasBarClosed([bar(1), bar(2)])).toBe(true);
    });
  });

  describe('barsToScan', () => {
    /**
     * The forming bar is excluded so detection reads only bars that can no
     * longer change — which is what makes a reported pattern stable rather
     * than something that revises under a bar that had not closed.
     */
    it('drops the newest bar', () => {
      const tracker = new LiveTracker();
      const bars = [bar(1), bar(2), bar(3)];
      expect(tracker.barsToScan(bars, 500).map((b) => b.time)).toEqual([1, 2]);
    });

    it('keeps only the rolling window', () => {
      const tracker = new LiveTracker();
      const bars = Array.from({ length: 100 }, (_, i) => bar(i));
      const scanned = tracker.barsToScan(bars, 10);
      expect(scanned.length).toBe(10);
      // The newest ten of the closed bars: 89 through 98, since 99 is forming.
      expect(scanned[0]?.time).toBe(89);
      expect(scanned[9]?.time).toBe(98);
    });

    it('returns everything closed when the window is larger than the series', () => {
      const tracker = new LiveTracker();
      expect(tracker.barsToScan([bar(1), bar(2)], 500).length).toBe(1);
    });
  });

  describe('diff', () => {
    it('reports the first pass as all added', () => {
      const tracker = new LiveTracker();
      const out = tracker.diff([pattern({ id: 'a' }), pattern({ id: 'b' })]);
      expect(out.added.map((p) => p.id)).toEqual(['a', 'b']);
      expect(out.updated).toEqual([]);
      expect(out.removedIds).toEqual([]);
    });

    /**
     * The property that keeps the chart still. An unchanged pattern must
     * produce no work at all, or every closed bar repaints the same lines.
     */
    it('reports nothing when the same patterns come back unchanged', () => {
      const tracker = new LiveTracker();
      tracker.diff([pattern()]);
      const out = tracker.diff([pattern()]);
      expect(out.added).toEqual([]);
      expect(out.updated).toEqual([]);
      expect(out.removedIds).toEqual([]);
    });

    it('reports an update when the status moves on', () => {
      const tracker = new LiveTracker();
      tracker.diff([pattern({ status: 'forming' })]);
      const out = tracker.diff([pattern({ status: 'confirmed' })]);
      expect(out.updated.map((p) => p.status)).toEqual(['confirmed']);
      expect(out.added).toEqual([]);
    });

    it('reports an update when the drawn geometry moves', () => {
      const tracker = new LiveTracker();
      tracker.diff([pattern()]);
      const out = tracker.diff([
        pattern({
          lines: [{ from: { time: 1, price: 1 }, to: { time: 9, price: 2 }, role: 'outline' }],
        }),
      ]);
      expect(out.updated.length).toBe(1);
    });

    it('reports a removal when a pattern stops being detected', () => {
      const tracker = new LiveTracker();
      tracker.diff([pattern({ id: 'a' }), pattern({ id: 'b' })]);
      const out = tracker.diff([pattern({ id: 'a' })]);
      expect(out.removedIds).toEqual(['b']);
    });
  });

  /**
   * The end-to-end transition, bar by bar.
   *
   * Fed one bar at a time the way a live session arrives, a forming double
   * bottom must become confirmed exactly once, keep its id throughout, and
   * never be added twice.
   */
  describe('feeding a session bar by bar', () => {
    const SHAPE: Keypoint[] = [
      { at: 0, price: 112 },
      { at: 40, price: 100 },
      { at: 60, price: 108 },
      { at: 85, price: 100 },
      { at: 110, price: 114 },
    ];

    it('moves forming to confirmed once, with a stable id and no duplicates', () => {
      const candles = fromKeypoints(SHAPE, { noise: 0.25, seed: 11 });
      const tracker = new LiveTracker();

      const seen = new Map<string, string[]>();
      let addedCount = 0;

      for (let i = 2; i <= candles.length; i++) {
        const visible = candles.slice(0, i);
        if (!tracker.hasBarClosed(visible)) continue;
        const { patterns } = detectPatterns(tracker.barsToScan(visible, 500));
        const out = tracker.diff(patterns);
        addedCount += out.added.length;
        for (const p of [...out.added, ...out.updated]) {
          if (p.type !== 'double_bottom') continue;
          const history = seen.get(p.id) ?? [];
          if (history[history.length - 1] !== p.status) history.push(p.status);
          seen.set(p.id, history);
        }
      }

      const bottoms = [...seen.entries()];
      expect(bottoms.length).toBeGreaterThan(0);

      const [, statuses] = bottoms[bottoms.length - 1] as [string, string[]];
      expect(statuses[0]).toBe('forming');
      expect(statuses[statuses.length - 1]).toBe('confirmed');
      // Once, not back and forth: a status that oscillated would show up here
      // as more than two entries.
      expect(statuses.length).toBe(2);

      // Every add was a genuinely new id, never the same shape re-added.
      expect(addedCount).toBe(tracker.current.length + countRemoved(candles));
    });
  });
});

/**
 * Patterns that were added and later dropped during the walk above.
 *
 * Computed rather than hardcoded so the assertion stays honest if the fixture
 * changes: adds minus what is still held is what must have been removed.
 */
function countRemoved(candles: readonly Candle[]): number {
  const tracker = new LiveTracker();
  let removed = 0;
  for (let i = 2; i <= candles.length; i++) {
    const visible = candles.slice(0, i);
    if (!tracker.hasBarClosed(visible)) continue;
    const { patterns } = detectPatterns(tracker.barsToScan(visible, 500));
    removed += tracker.diff(patterns).removedIds.length;
  }
  return removed;
}
