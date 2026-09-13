import { createChart, CandlestickSeries, type IChartApi } from 'lightweight-charts';
import {
  LightweightChartsCandlePatternOverlay,
  type RenderedCandlePattern,
} from './candle-pattern-overlay';
import { STATUS_ALPHA, colorForBias, readCandlePalette, withAlpha } from './styles';

/**
 * The drawing adapter, against a real chart.
 *
 * A mocked chart would prove the adapter calls the methods this test decided
 * it should call, which is a tautology. A real `createChart` in a detached div
 * exercises the actual primitive lifecycle — attach, `updateAllViews`,
 * renderer — and would catch the library changing that contract under us.
 */

/** Bar open times in **milliseconds**, as the backend sends them. */
const T0_MS = 1_700_000_000_000;

function hit(over: Partial<RenderedCandlePattern> = {}): RenderedCandlePattern {
  return {
    id: 'bullish_engulfing@1700000600000',
    primary: 'bullish_engulfing',
    patterns: ['bullish_engulfing', 'inside_bar'],
    startTime: T0_MS + 4 * 60_000,
    endTime: T0_MS + 5 * 60_000,
    barCount: 2,
    candleType: 'full_body',
    candleTypeId: 11,
    direction: 1,
    sizeClass: 'normal',
    trendState: 'down',
    directionContext: 'BEARISH',
    reversalBias: 'BULLISH',
    confidence: 85,
    breakdown: { base: 50, context: 20, extreme: 15, geometry: 0, followThrough: 0 },
    status: 'confirmed',
    confirmationTime: T0_MS + 6 * 60_000,
    confirmationLevel: 109,
    patternHigh: 109,
    patternLow: 99,
    atLocalExtreme: true,
    label: 'Bullish engulfing',
    ...over,
  };
}

describe('LightweightChartsCandlePatternOverlay', () => {
  let host: HTMLDivElement;
  let chart: IChartApi;
  let overlay: LightweightChartsCandlePatternOverlay;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.width = '600px';
    host.style.height = '300px';
    document.body.appendChild(host);

    chart = createChart(host, { width: 600, height: 300 });
    const series = chart.addSeries(CandlestickSeries, {});
    // Seconds on the chart's axis, against milliseconds in a hit. The overlay
    // converts, and these bars are what it has to land on.
    series.setData(
      Array.from({ length: 12 }, (_, i) => ({
        time: (T0_MS / 1000 + i * 60) as never,
        open: 100,
        high: 109,
        low: 99,
        close: 104,
      })),
    );

    overlay = new LightweightChartsCandlePatternOverlay();
    overlay.attach(series);
  });

  afterEach(() => {
    overlay.destroy();
    chart.remove();
    host.remove();
  });

  it('holds a hit once it is added', () => {
    expect(overlay.size).toBe(0);
    overlay.upsert(hit());
    expect(overlay.size).toBe(1);
  });

  /**
   * The property the diffing scheme rests on. Two upserts under one id must
   * leave one box, not two stacked on each other.
   */
  it('updates in place rather than duplicating on a second upsert', () => {
    overlay.upsert(hit());
    overlay.upsert(hit({ status: 'failed' }));
    expect(overlay.size).toBe(1);
  });

  it('keeps two hits apart when their ids differ', () => {
    overlay.upsert(hit({ id: 'a' }));
    overlay.upsert(hit({ id: 'b' }));
    expect(overlay.size).toBe(2);
  });

  it('removes by id, and ignores an id it does not hold', () => {
    overlay.upsert(hit({ id: 'a' }));
    overlay.remove('nope');
    expect(overlay.size).toBe(1);
    overlay.remove('a');
    expect(overlay.size).toBe(0);
  });

  it('clears everything at once', () => {
    overlay.upsert(hit({ id: 'a' }));
    overlay.upsert(hit({ id: 'b' }));
    overlay.clear();
    expect(overlay.size).toBe(0);
  });

  /**
   * Hiding must not discard. The toggle is a view preference, and re-asking
   * the backend to get the boxes back would make turning it on cost a request.
   */
  it('keeps its hits while hidden', () => {
    overlay.upsert(hit());
    overlay.setVisible(false);
    expect(overlay.size).toBe(1);
    overlay.setVisible(true);
    expect(overlay.size).toBe(1);
  });

  it('survives a theme re-read', () => {
    overlay.upsert(hit());
    overlay.setTheme('dark');
    expect(overlay.size).toBe(1);
  });

  it('drops everything on destroy', () => {
    overlay.upsert(hit());
    overlay.destroy();
    expect(overlay.size).toBe(0);
  });

  /** Attaching twice would stack two primitives drawing the same boxes. */
  it('ignores a second attach', () => {
    const series = chart.addSeries(CandlestickSeries, {});
    expect(() => overlay.attach(series)).not.toThrow();
    expect(overlay.size).toBe(0);
  });

  /* --- the cases that would throw while building a frame -------------- */

  it('draws a single-bar pattern, where start and end are the same bar', () => {
    overlay.upsert(
      hit({
        id: 'doji',
        primary: 'doji',
        patterns: ['doji'],
        barCount: 1,
        startTime: T0_MS + 3 * 60_000,
        endTime: T0_MS + 3 * 60_000,
        reversalBias: 'NEUTRAL',
        status: 'none',
        confirmationTime: null,
        confirmationLevel: null,
        label: 'Doji',
      }),
    );
    expect(overlay.size).toBe(1);
  });

  it('accepts every confirmation status', () => {
    for (const status of ['confirmed', 'pending', 'failed', 'none'] as const) {
      overlay.upsert(hit({ id: status, status }));
    }
    expect(overlay.size).toBe(4);
  });

  it('accepts every bias, including the one with no arrow', () => {
    for (const bias of ['BULLISH', 'BEARISH', 'NEUTRAL'] as const) {
      overlay.upsert(hit({ id: bias, reversalBias: bias }));
    }
    expect(overlay.size).toBe(3);
  });

  it('holds a hit anchored outside the drawn series without failing', () => {
    // `timeToCoordinate` answers null for a time not in the data, so the box
    // is skipped while building the frame. It must still be held, because
    // panning or a longer series could bring it back into range.
    overlay.upsert(hit({ id: 'far', startTime: 1, endTime: 2 }));
    expect(overlay.size).toBe(1);
  });

  it('holds hits that would overlap, so the plate spreading runs', () => {
    // Same bar, several patterns, both sides — the path that pushes labels
    // apart, which only executes when two plates land in one column.
    overlay.upsert(hit({ id: 'a' }));
    overlay.upsert(hit({ id: 'b', reversalBias: 'BEARISH' }));
    overlay.upsert(hit({ id: 'c' }));
    expect(overlay.size).toBe(3);
  });
});

describe('styles', () => {
  it('turns a hex colour into rgba', () => {
    expect(withAlpha('#26a17b', 0.5)).toBe('rgba(38, 161, 123, 0.5)');
  });

  it('leaves a colour it cannot parse alone rather than corrupting it', () => {
    expect(withAlpha('rebeccapurple', 0.5)).toBe('rebeccapurple');
  });

  it('colours a pattern by its bias', () => {
    const palette = readCandlePalette();
    expect(colorForBias(palette, 'BULLISH')).toBe(palette.bullish);
    expect(colorForBias(palette, 'BEARISH')).toBe(palette.bearish);
    expect(colorForBias(palette, 'NEUTRAL')).toBe(palette.neutral);
  });

  /**
   * `pending` is not a weaker finding than `confirmed` — it is a newer one,
   * and on a live chart the newest bar is always pending. Drawing it as
   * faintly as a failed pattern would hide every setup a reader could act on.
   */
  it('draws an unresolved pattern more strongly than a failed one', () => {
    expect(STATUS_ALPHA.pending).toBeGreaterThan(STATUS_ALPHA.failed);
    expect(STATUS_ALPHA.confirmed).toBeGreaterThanOrEqual(STATUS_ALPHA.pending);
  });
});
