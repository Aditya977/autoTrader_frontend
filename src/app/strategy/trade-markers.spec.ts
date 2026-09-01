import { markersFor } from './trade-markers';
import { bucketStartMs } from '../chart-stream/chart-time';
import type { SimTrade } from './strategy.models';

/** 2026-08-14, 09:15 IST — the session open every intraday bucket anchors to. */
const OPEN_MS = Date.UTC(2026, 7, 14, 3, 45);

function trade(overrides: Partial<SimTrade> = {}): SimTrade {
  return {
    id: 1,
    strategyId: 'vwap-ema-trend',
    instrumentKey: 'NSE_FO|CE',
    tradingsymbol: 'NIFTY 24500 CE',
    side: 'BUY',
    status: 'CLOSED',
    quantity: 150,
    lots: 2,
    lotSize: 75,
    entryTime: OPEN_MS + 30 * 60_000,
    entryPrice: 100,
    entryReason: 'crossed above VWAP',
    stopPrice: 75,
    targetPrice: 140,
    exitTime: OPEN_MS + 60 * 60_000,
    exitPrice: 120,
    exitReason: 'target hit',
    exitReasonKind: 'TARGET',
    grossPnl: 3000,
    costs: 40,
    netPnl: 2960,
    netPnlPct: 19.7,
    mae: -200,
    mfe: 3100,
    barsHeld: 3,
    features: {},
    ...overrides,
  };
}

describe('markersFor', () => {
  it('draws an entry and an exit for a closed trade', () => {
    const markers = markersFor([trade()], 60);

    expect(markers.length).toBe(2);
    expect(markers[0]).toEqual(
      jasmine.objectContaining({ position: 'belowBar', shape: 'arrowUp' }),
    );
    expect(markers[1]).toEqual(
      jasmine.objectContaining({ position: 'aboveBar', shape: 'arrowDown' }),
    );
  });

  it('draws only the entry while a trade is open', () => {
    const markers = markersFor(
      [trade({ status: 'OPEN', exitTime: null, exitPrice: null, exitReasonKind: null })],
      60,
    );
    expect(markers.length).toBe(1);
    expect(markers[0]?.shape).toBe('arrowUp');
  });

  it('lands a fill on the bar it closed, not on the one after it', () => {
    // A fill is stamped with a bar's *close*, which is the next bar's open.
    // Snapping the raw value would draw every mark one bar to the right — a
    // chart that looks right and is consistently, invisibly late.
    const closeOfFirstFiveMinuteBar = OPEN_MS + 5 * 60_000;
    const [marker] = markersFor(
      [trade({ status: 'OPEN', entryTime: closeOfFirstFiveMinuteBar, exitTime: null })],
      300,
    );

    expect((marker?.time as number) * 1000).toBe(OPEN_MS);
  });

  it('snaps to whatever interval the chart is drawing', () => {
    // A marker whose time falls between two bars is dropped silently by
    // Lightweight Charts, so this is what keeps marks visible across a
    // timeframe change.
    const at = OPEN_MS + 37 * 60_000;
    for (const seconds of [60, 300, 900, 3600]) {
      const [marker] = markersFor(
        [trade({ status: 'OPEN', entryTime: at, exitTime: null })],
        seconds,
      );
      expect((marker?.time as number) * 1000).toBe(bucketStartMs(at - 1, seconds));
    }
  });

  it('returns markers in ascending time, as setMarkers requires', () => {
    const markers = markersFor(
      [
        trade({ id: 2, entryTime: OPEN_MS + 120 * 60_000, exitTime: OPEN_MS + 150 * 60_000 }),
        trade({ id: 1, entryTime: OPEN_MS + 10 * 60_000, exitTime: OPEN_MS + 20 * 60_000 }),
      ],
      60,
    );

    const times = markers.map((m) => m.time as number);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('names the exit reason and colours by outcome, not by direction', () => {
    const [, win] = markersFor([trade()], 60);
    expect(win?.text).toContain('TP');
    expect(win?.text).toContain('+');

    const [, loss] = markersFor(
      [trade({ exitReasonKind: 'STOP', netPnl: -1_540, exitPrice: 80 })],
      60,
    );
    expect(loss?.text).toContain('SL');
    expect(loss?.color).not.toBe(win?.color);
  });

  it('is empty for no trades', () => {
    expect(markersFor([], 60)).toEqual([]);
  });
});
