import { PaperTradeEngine } from '../paper-trade-engine';
import type {
  PaperContract,
  PaperMarketUpdate,
  PaperOrderRequest,
  PaperRetestSignal,
} from '../paper-trade.models';
import { paperStrategyById } from './registry';

/**
 * A backend-driven paper strategy enters and leaves exactly where the backend
 * did, reading only its own backend's signals.
 */

const ELEVEN = Date.UTC(2026, 7, 14, 5, 30);
const MINUTE = 60_000;
const KEY = 'NSE_FO|999';
const at = (minute: number): number => ELEVEN + minute * MINUTE;

const CONTRACT: PaperContract = {
  instrumentKey: KEY,
  tradingsymbol: 'NIFTY 24000 CE',
  underlying: 'NIFTY',
  expiry: '2026-09-29',
  strike: 24000,
  leg: 'CE',
  lotSize: 65,
  tickSize: 0.05,
};

const ID = 'backend:level-breakout';

function order(overrides: Partial<PaperOrderRequest> = {}): PaperOrderRequest {
  return {
    contract: CONTRACT,
    strategyId: ID,
    side: 'BUY',
    investment: 50_000,
    referencePrice: 100,
    lots: 2,
    quantity: 130,
    ...overrides,
  };
}

const session = (count: number): PaperMarketUpdate[] =>
  Array.from({ length: count }, (_, i) => ({
    instrumentKey: KEY,
    timeMs: at(i),
    price: 100 + i,
    open: 100 + i,
    high: 100 + i,
    low: 100 + i,
    volume: 1_000,
    closed: true,
  }));

function entry(
  minute: number,
  exitMinute: number | null,
  source = 'level-breakout',
  side: 'BUY' | 'SELL' = 'BUY',
): PaperRetestSignal {
  return {
    atMs: at(minute),
    bullish: side === 'BUY',
    quality: 1,
    valid: true,
    scenario: 'confirmed',
    source,
    side,
    stopLoss: null,
    exitAtMs: exitMinute === null ? null : at(exitMinute),
    exitReason: exitMinute === null ? null : 'held 60 minutes',
    reason: 'index broke above PDH',
  };
}

describe('backend-driven paper strategies', () => {
  it('are registered for every dashboard strategy, each naming its backend id', () => {
    for (const id of ['level-breakout', 'trend-structure']) {
      const strategy = paperStrategyById(`backend:${id}`);
      expect(strategy).not.toBeNull();
      expect(strategy!.backendStrategyId).toBe(id);
      expect(strategy!.needsRetests).toBeTrue();
    }
  });

  it('enters on the backend’s entry candle and exits on its exit candle', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [entry(5, 12)]);
    engine.place(order());
    engine.replay(session(30));

    const [trade] = engine.snapshot().positions;
    expect(trade!.entryTime).toBe(at(5) + 58_000);
    expect(trade!.exitTime).toBe(at(12) + 58_000);
    expect(trade!.exitNote).toBe('held 60 minutes');
  });

  it('ignores another strategy’s signals and signals on the other side', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [
      entry(3, 6, 'trend-structure'),
      entry(8, 10, 'level-breakout', 'SELL'),
    ]);
    engine.place(order());
    engine.replay(session(30));

    expect(engine.snapshot().positions[0]!.entryTime).toBeNull();
  });

  it('leaves a position the backend still holds to the stop and the square-off', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [entry(5, null)]);
    engine.place(order());
    engine.replay(session(30));

    const [trade] = engine.snapshot().positions;
    expect(trade!.entryTime).toBe(at(5) + 58_000);
    expect(trade!.exitTime).toBeNull();
  });
});
