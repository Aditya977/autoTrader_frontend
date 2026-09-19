import { paperMarkers, paperPriceLines } from './paper-trade-overlay';
import { bucketStartMs } from '../chart-stream/chart-time';
import type { PaperPosition } from './paper-trade.models';

/** 2026-08-14, 09:15 IST. */
const OPEN_MS = Date.UTC(2026, 7, 14, 3, 45);

function position(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    id: 'PT-0001',
    strategyId: 'manual',
    strategyName: 'Manual',
    contract: {
      instrumentKey: 'NSE_FO|12345',
      tradingsymbol: 'NIFTY 24500 CE',
      underlying: 'NIFTY',
      expiry: '2026-08-27',
      strike: 24500,
      leg: 'CE',
      lotSize: 75,
      tickSize: 0.05,
    },
    side: 'BUY',
    status: 'ACTIVE',
    investment: 20_000,
    lots: 2,
    lotSize: 75,
    quantity: 150,
    capitalUsed: 15_000,
    referencePrice: 100,
    createdAt: OPEN_MS,
    entryPrice: 100,
    entryTime: OPEN_MS + 30 * 60_000,
    entryReason: 'manual entry at market',
    stopLoss: 75,
    target: 150,
    exitPrice: null,
    exitTime: null,
    exitReason: null,
    exitNote: null,
    currentPrice: 110,
    lastMarkedAt: OPEN_MS + 31 * 60_000,
    grossPnl: 1_500,
    costs: 0,
    netPnl: 1_500,
    netPnlPct: 10,
    realisedPnl: 0,
    unrealisedPnl: 1_500,
    mae: -300,
    mfe: 1_800,
    marksHeld: 1,
    ...overrides,
  };
}

describe('paperMarkers', () => {
  it('snaps an entry to the bar it happened on, at every displayed interval', () => {
    // A fill is stamped with the bar's *open* time, so it must snap to the same
    // bucket the chart draws — not one bar to either side of it.
    for (const seconds of [60, 300, 900]) {
      const [entry] = paperMarkers([position()], seconds);
      const expected = Math.floor(bucketStartMs(OPEN_MS + 30 * 60_000, seconds) / 1000);
      expect(entry!.time).toBe(expected as never);
    }
  });

  it('marks nothing for an order that has not filled', () => {
    // There is no bar it was taken on, and drawing one at the moment it was
    // placed would put an entry arrow where no trade exists.
    expect(
      paperMarkers([position({ status: 'CREATED', entryPrice: null, entryTime: null })], 60),
    ).toEqual([]);
  });

  it('draws one mark while open and two once exited', () => {
    expect(paperMarkers([position()], 60).length).toBe(1);

    const closed = position({
      status: 'EXITED',
      exitTime: OPEN_MS + 45 * 60_000,
      exitPrice: 150,
      exitReason: 'TARGET',
      netPnl: 7_460,
    });
    const marks = paperMarkers([closed], 60);
    expect(marks.length).toBe(2);
    expect(marks[1]!.shape).toBe('arrowDown');
  });

  it('labels an exit with its reason, and colours it by outcome', () => {
    const stopped = paperMarkers(
      [
        position({
          status: 'EXITED',
          exitTime: OPEN_MS + 45 * 60_000,
          exitPrice: 75,
          exitReason: 'STOP_LOSS',
          netPnl: -3_790,
        }),
      ],
      60,
    );
    // The reason is the useful thing: four `SL` in a row says the stop is too
    // tight, whereas four red arrows say nothing.
    expect(stopped[1]!.text).toContain('SL');
    expect(stopped[1]!.text).toContain('−3,790');
    expect(stopped[1]!.color).toBe('#ef5350');

    const won = paperMarkers(
      [
        position({
          status: 'EXITED',
          exitTime: OPEN_MS + 45 * 60_000,
          exitPrice: 150,
          exitReason: 'TARGET',
          netPnl: 7_460,
        }),
      ],
      60,
    );
    expect(won[1]!.text).toContain('TGT');
    expect(won[1]!.color).toBe('#26a17b');
  });

  it('returns marks in ascending time, as setMarkers requires', () => {
    // An exit and a later entry can land in one bucket at 15m, so the order the
    // positions arrive in is not the order the chart needs.
    const marks = paperMarkers(
      [
        position({
          id: 'PT-0002',
          entryTime: OPEN_MS + 90 * 60_000,
        }),
        position({
          status: 'EXITED',
          exitTime: OPEN_MS + 45 * 60_000,
          exitPrice: 150,
          exitReason: 'TARGET',
          netPnl: 7_460,
        }),
      ],
      60,
    );

    const times = marks.map((m) => m.time as number);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('paperPriceLines', () => {
  it('draws entry, stop and target for a live position', () => {
    const lines = paperPriceLines([position()]);
    expect(lines.map((l) => l.price)).toEqual([100, 75, 150]);
    expect(lines.map((l) => l.id)).toEqual(['PT-0001:entry', 'PT-0001:stop', 'PT-0001:target']);
  });

  it('draws nothing for a closed position', () => {
    // Its levels are history; the exit arrow is the record. Drawing every
    // trade's levels would bury the chart in lines nobody holds.
    expect(
      paperPriceLines([
        position({ status: 'EXITED', exitPrice: 150, exitReason: 'TARGET', exitTime: OPEN_MS }),
      ]),
    ).toEqual([]);
  });

  it('shows an unfilled order as a plan — dashed, at the reference price', () => {
    const lines = paperPriceLines([
      position({ status: 'CREATED', entryPrice: null, entryTime: null, referencePrice: 104 }),
    ]);
    const entry = lines.find((l) => l.id.endsWith(':entry'))!;
    expect(entry.price).toBe(104);
    expect(entry.dashed).toBe(true);
    expect(entry.title).toContain('Planned');
  });

  it('omits a level the position does not have', () => {
    const lines = paperPriceLines([position({ stopLoss: null, target: null })]);
    expect(lines.length).toBe(1);
    expect(lines[0]!.id).toBe('PT-0001:entry');
  });

  it('keeps several positions apart by id', () => {
    const lines = paperPriceLines([position(), position({ id: 'PT-0002' })]);
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
  });
});
