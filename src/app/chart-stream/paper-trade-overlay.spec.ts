import {
  fromOpenBook,
  paperMarkers,
  paperPriceLines,
  type ChartPaperTrade,
} from './paper-trade-overlay';
import type { PaperBook } from '../trading/trading.models';

/** 10:00 IST on 14 Aug 2026 — a bar close, as a fill is stamped. */
const T = Date.parse('2026-08-14T04:30:00Z');
const MINUTE = 60_000;

const trade = (overrides: Partial<ChartPaperTrade> = {}): ChartPaperTrade => ({
  tradeId: 't1',
  strategyName: 'FibMo v2 (opening swing)',
  side: 'BUY',
  lots: 1,
  entryAt: T,
  entryPrice: 100,
  stopLoss: 92,
  exitAt: T + 10 * MINUTE,
  exitPrice: 110,
  netPnl: 710,
  exitReason: 'TARGET',
  ...overrides,
});

describe('paper-trade overlay', () => {
  it('marks the entry on the bar that decided it, named by strategy', () => {
    const [entry] = paperMarkers([trade()], 60);
    // A fill at the 10:00 close belongs to the 09:59 bar.
    expect(entry.time as number).toBe((T - MINUTE) / 1000);
    expect(entry.text).toBe('B FibMo');
    expect(entry.shape).toBe('arrowUp');
  });

  it('labels the exit with its reason and P&L, coloured by outcome', () => {
    const exits = paperMarkers(
      [trade(), trade({ tradeId: 't2', exitReason: 'STOP', netPnl: -1317.5 })],
      60,
    ).filter((m) => m.shape === 'arrowDown');
    expect(exits.map((m) => m.text)).toEqual(['TP +710', 'SL −1,317']);
    expect(exits[0].color).not.toBe(exits[1].color);
  });

  it('returns markers in ascending time, as the chart requires', () => {
    const marks = paperMarkers(
      [trade({ entryAt: T + 30 * MINUTE, exitAt: T + 40 * MINUTE }), trade()],
      300,
    );
    const times = marks.map((m) => m.time as number);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('draws entry and stop lines only while a position is open', () => {
    expect(paperPriceLines([trade()])).toEqual([]);
    const lines = paperPriceLines([trade({ exitAt: null, exitPrice: null, netPnl: null })]);
    expect(lines.map((l) => [l.price, l.title])).toEqual([
      [100, 'FibMo entry'],
      [92, 'FibMo SL'],
    ]);
  });

  it('turns a flat book into nothing and an open one into an open trade', () => {
    const book: PaperBook = {
      strategyId: 'fib-momentum',
      strategyName: 'FibMo v2',
      instrument: 'NIFTY',
      capital: 20000,
      maxLots: 1,
      availableBalance: 20000,
      realisedPnl: 0,
      unrealisedPnl: 0,
      tradeCount: 0,
      openTrade: null,
      lastRejection: null,
      error: null,
    };
    expect(fromOpenBook(book)).toBeNull();
    const open = fromOpenBook({
      ...book,
      openTrade: {
        tradeKey: 'k#1',
        instrumentKey: 'NSE_FO|1',
        tradingsymbol: 'NIFTY 24500 CE',
        side: 'BUY',
        lots: 1,
        lotSize: 75,
        quantity: 75,
        entryTime: T,
        entryPrice: 100,
        stopLoss: 92,
        target: null,
      },
    });
    expect(open).toEqual(jasmine.objectContaining({ exitAt: null, stopLoss: 92, lots: 1 }));
  });
});
