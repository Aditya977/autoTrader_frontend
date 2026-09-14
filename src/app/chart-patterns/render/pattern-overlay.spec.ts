import { createChart, CandlestickSeries, type IChartApi } from 'lightweight-charts';
import type { DetectedPattern } from '../types';
import { LightweightChartsPatternOverlay } from './pattern-overlay';
import { withAlpha } from './styles';

/**
 * The drawing adapter, against a real chart.
 *
 * A mocked chart would prove the adapter calls the methods this test decided
 * it should call, which is a tautology. A real `createChart` in a detached div
 * exercises the actual primitive lifecycle — attach, updateAllViews, renderer
 * — and would catch the library changing that contract under us.
 */

function pattern(over: Partial<DetectedPattern> = {}): DetectedPattern {
  const t = 1_700_000_000;
  return {
    id: 'double_bottom_test',
    type: 'double_bottom',
    direction: 'bullish',
    status: 'forming',
    startTime: t,
    endTime: t + 600,
    pivots: [
      { index: 0, time: t, price: 100, kind: 'low', provisional: false },
      { index: 5, time: t + 300, price: 108, kind: 'high', provisional: false },
      { index: 10, time: t + 600, price: 100, kind: 'low', provisional: false },
    ],
    lines: [
      { from: { time: t, price: 100 }, to: { time: t + 300, price: 108 }, role: 'outline' },
      {
        from: { time: t, price: 108 },
        to: { time: t + 600, price: 108 },
        role: 'neckline',
      },
    ],
    label: {
      text: 'Double bottom · Bullish · Forming',
      anchor: { time: t + 300, price: 100 },
      placement: 'below',
    },
    confidence: 0.72,
    ...over,
  };
}

describe('LightweightChartsPatternOverlay', () => {
  let host: HTMLDivElement;
  let chart: IChartApi;
  let overlay: LightweightChartsPatternOverlay;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.width = '600px';
    host.style.height = '300px';
    document.body.appendChild(host);

    chart = createChart(host, { width: 600, height: 300 });
    const series = chart.addSeries(CandlestickSeries, {});
    series.setData(
      Array.from({ length: 12 }, (_, i) => ({
        time: (1_700_000_000 + i * 60) as never,
        open: 100,
        high: 109,
        low: 99,
        close: 104,
      })),
    );

    overlay = new LightweightChartsPatternOverlay();
    overlay.attach(series);
  });

  afterEach(() => {
    overlay.destroy();
    chart.remove();
    host.remove();
  });

  it('holds a pattern once it is added', () => {
    expect(overlay.size).toBe(0);
    overlay.upsert(pattern());
    expect(overlay.size).toBe(1);
  });

  /**
   * The property the whole diffing scheme rests on. Two upserts under one id
   * must leave one overlay, not two stacked on each other.
   */
  it('updates in place rather than duplicating on a second upsert', () => {
    overlay.upsert(pattern());
    overlay.upsert(pattern({ status: 'confirmed' }));
    expect(overlay.size).toBe(1);
  });

  it('keeps two patterns apart when their ids differ', () => {
    overlay.upsert(pattern({ id: 'a' }));
    overlay.upsert(pattern({ id: 'b' }));
    expect(overlay.size).toBe(2);
  });

  it('removes by id, and ignores an id it does not hold', () => {
    overlay.upsert(pattern({ id: 'a' }));
    overlay.remove('nope');
    expect(overlay.size).toBe(1);
    overlay.remove('a');
    expect(overlay.size).toBe(0);
  });

  it('clears everything at once', () => {
    overlay.upsert(pattern({ id: 'a' }));
    overlay.upsert(pattern({ id: 'b' }));
    overlay.clear();
    expect(overlay.size).toBe(0);
  });

  /**
   * Hiding must not discard. The toggle is a view preference, and re-running
   * detection to get the shapes back would make turning it on cost a scan.
   */
  it('keeps its patterns while hidden', () => {
    overlay.upsert(pattern());
    overlay.setVisible(false);
    expect(overlay.size).toBe(1);
    overlay.setVisible(true);
    expect(overlay.size).toBe(1);
  });

  it('survives a theme re-read', () => {
    overlay.upsert(pattern());
    overlay.setTheme('dark');
    expect(overlay.size).toBe(1);
  });

  it('drops everything on destroy', () => {
    overlay.upsert(pattern());
    overlay.destroy();
    expect(overlay.size).toBe(0);
  });

  /** Attaching twice would stack two primitives drawing the same lines. */
  it('ignores a second attach', () => {
    const series = chart.addSeries(CandlestickSeries, {});
    expect(() => overlay.attach(series)).not.toThrow();
    expect(overlay.size).toBe(0);
  });
});

describe('withAlpha', () => {
  it('turns a hex colour into rgba', () => {
    expect(withAlpha('#26a17b', 0.5)).toBe('rgba(38, 161, 123, 0.5)');
  });

  it('leaves a colour it cannot parse alone rather than corrupting it', () => {
    expect(withAlpha('rebeccapurple', 0.5)).toBe('rebeccapurple');
  });
});
