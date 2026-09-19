import { PaperTradeEngine } from '../paper-trade-engine';
import type {
  PaperContract,
  PaperMarketUpdate,
  PaperOrderRequest,
  PaperPosition,
  PaperRetestSignal,
} from '../paper-trade.models';

/**
 * The rule, as timestamps.
 *
 * A green retest on the 11:14 candle buys at 11:14:58 and sells at 11:17:58,
 * and almost every test here is a way of checking one of those two clocks.
 * They are the whole strategy: the entry price is just the candle's close
 * either way, so if the stamps are wrong the journal is wrong even though the
 * P&L happens to be right — the kind of bug that survives a long time.
 */

/** 11:00 IST on the replayed day, as epoch ms. */
const ELEVEN = Date.UTC(2026, 7, 14, 5, 30);
const MINUTE = 60_000;
const KEY = 'NSE_FO|12345';

/** The candle at 11:MM. */
const at = (minute: number): number => ELEVEN + minute * MINUTE;

const CONTRACT: PaperContract = {
  instrumentKey: KEY,
  tradingsymbol: 'NIFTY 24500 CE',
  underlying: 'NIFTY',
  expiry: '2026-08-27',
  strike: 24500,
  leg: 'CE',
  lotSize: 75,
  tickSize: 0.05,
};

function order(overrides: Partial<PaperOrderRequest> = {}): PaperOrderRequest {
  return {
    contract: CONTRACT,
    strategyId: 'green-retest-3-candle',
    side: 'BUY',
    investment: 20_000,
    referencePrice: 100,
    lots: 2,
    quantity: 150,
    ...overrides,
  };
}

function bar(minute: number, close: number): PaperMarketUpdate {
  return {
    instrumentKey: KEY,
    timeMs: at(minute),
    price: close,
    open: close,
    high: close,
    low: close,
    volume: 1_000,
    closed: true,
  };
}

function signal(minute: number, bullish = true): PaperRetestSignal {
  return { atMs: at(minute), bullish, quality: 0.8, valid: true, scenario: 'exact' };
}

/** A quiet session of `count` one-minute candles from 11:00. */
const session = (count: number, price = 100): PaperMarketUpdate[] =>
  Array.from({ length: count }, (_, i) => bar(i, price));

function settled(engine: PaperTradeEngine): PaperPosition[] {
  return engine.snapshot().positions.filter((p) => p.exitTime !== null);
}

describe('Green Retest 3-Candle Buy — timing', () => {
  it('buys 2 seconds before the signal candle closes', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(14)]);
    engine.place(order());
    engine.replay(session(20));

    const trade = engine.snapshot().positions[0]!;
    // 11:14:58 — the signal candle is 11:14, and the entry belongs to it.
    expect(trade.entryTime).toBe(at(14) + 58_000);
  });

  it('sells 2 seconds before the third candle after it closes', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(14)]);
    engine.place(order());
    engine.replay(session(20));

    const trade = engine.snapshot().positions[0]!;
    // 11:15, 11:16, 11:17 held; out at 11:17:58, before 11:18 begins.
    expect(trade.exitTime).toBe(at(17) + 58_000);
    expect(trade.exitReason).toBe('STRATEGY_EXIT');
    expect(trade.exitNote).toBe('held 3 candles');
  });

  it('computes both stamps for any signal candle', () => {
    for (const minute of [3, 14, 27, 41]) {
      const engine = new PaperTradeEngine();
      engine.setRetests(KEY, [signal(minute)]);
      engine.place(order());
      engine.replay(session(60));

      const trade = engine.snapshot().positions[0]!;
      expect(trade.entryTime).toBe(at(minute) + 58_000);
      expect(trade.exitTime).toBe(at(minute + 3) + 58_000);
    }
  });

  it('fills at the signal candle’s close and exits at the third candle’s', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(2)]);
    engine.place(order());
    // 11:02 closes at 120; 11:05 closes at 150.
    engine.replay([bar(0, 100), bar(1, 110), bar(2, 120), bar(3, 130), bar(4, 140), bar(5, 150)]);

    const trade = engine.snapshot().positions[0]!;
    expect(trade.entryPrice).toBe(120);
    expect(trade.exitPrice).toBe(150);
  });

  it('marks the entry on the signal candle, not the one after it', () => {
    // The 58-second stamp has to stay inside its own bar: at 60,000 the chart
    // would snap the entry arrow onto the following candle.
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(14)]);
    engine.place(order());
    engine.replay(session(20));

    const trade = engine.snapshot().positions[0]!;
    expect(Math.floor(trade.entryTime! / MINUTE) * MINUTE).toBe(at(14));
    expect(Math.floor(trade.exitTime! / MINUTE) * MINUTE).toBe(at(17));
  });

  it('exits on the next candle when the due one never arrives', () => {
    // A gap in the feed must not hold the trade open forever.
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(1)]);
    engine.place(order());
    engine.replay([bar(0, 100), bar(1, 100), bar(2, 100), bar(3, 100), bar(5, 100)]);

    const trade = engine.snapshot().positions[0]!;
    expect(trade.exitTime).toBe(at(5) + 58_000);
  });
});

describe('Green Retest 3-Candle Buy — which signals it takes', () => {
  it('ignores a red retest', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(5, false)]);
    engine.place(order());
    engine.replay(session(20));

    // Long only: a bearish retest is not this strategy's trade.
    expect(engine.snapshot().positions[0]!.status).toBe('CREATED');
  });

  it('takes nothing when no retest was supplied', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.replay(session(20));

    expect(engine.snapshot().positions[0]!.status).toBe('CREATED');
  });

  it('enters only on the signal candle itself', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(10)]);
    engine.place(order());
    engine.replay(session(9));

    // The session stopped at 11:08; the signal candle never closed.
    expect(engine.snapshot().positions[0]!.status).toBe('CREATED');
  });

  it('reads the marked bar the way the overlay does', () => {
    // The overlay marks `approachAt ?? resumptionAt`; a signal carrying a bar
    // time is taken on that bar and on no other.
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(7)]);
    engine.place(order());
    engine.replay(session(20));

    expect(engine.snapshot().positions[0]!.entryTime).toBe(at(7) + 58_000);
  });
});

describe('Green Retest 3-Candle Buy — one trade at a time', () => {
  it('ignores signals while a trade is running', () => {
    const engine = new PaperTradeEngine();
    // 11:05 signals; 11:06 and 11:07 fall inside the hold and must be skipped.
    engine.setRetests(KEY, [signal(5), signal(6), signal(7)]);
    engine.place(order());
    engine.replay(session(20));

    const trades = settled(engine);
    expect(trades.length).toBe(1);
    expect(trades[0]!.entryTime).toBe(at(5) + 58_000);
  });

  it('takes the next signal after the trade has exited', () => {
    const engine = new PaperTradeEngine();
    // 11:05 → out at 11:08:58. 11:12 is clear, so it trades again.
    engine.setRetests(KEY, [signal(5), signal(12)]);
    engine.place(order());
    engine.replay(session(30));

    const trades = settled(engine);
    expect(trades.length).toBe(2);
    expect(trades[0]!.entryTime).toBe(at(5) + 58_000);
    expect(trades[0]!.exitTime).toBe(at(8) + 58_000);
    expect(trades[1]!.entryTime).toBe(at(12) + 58_000);
    expect(trades[1]!.exitTime).toBe(at(15) + 58_000);
  });

  it('keeps trading across a whole session of signals', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(2), signal(9), signal(16), signal(23)]);
    engine.place(order());
    engine.replay(session(40));

    expect(settled(engine).length).toBe(4);
  });

  it('never runs two positions at once', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(2), signal(3), signal(4), signal(9)]);
    engine.place(order());

    for (const update of session(30)) {
      engine.onUpdate(update);
      const open = engine.snapshot().positions.filter((p) => p.status === 'ACTIVE');
      expect(open.length).toBeLessThanOrEqual(1);
    }
  });

  it('stops re-arming once the session ends', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(2)]);
    engine.place(order());
    engine.replay(session(10));
    engine.endSession(KEY);

    expect(engine.snapshot().positions.every((p) => p.status === 'EXITED')).toBe(true);
  });
});

describe('Green Retest 3-Candle Buy — what it records', () => {
  it('books a realised P&L against the entry and exit closes', () => {
    const engine = new PaperTradeEngine({ exitCost: 40 });
    engine.setRetests(KEY, [signal(1)]);
    engine.place(order());
    engine.replay([bar(0, 100), bar(1, 100), bar(2, 105), bar(3, 110), bar(4, 120)]);

    const trade = settled(engine)[0]!;
    expect(trade.entryPrice).toBe(100);
    expect(trade.exitPrice).toBe(120);
    expect(trade.grossPnl).toBeCloseTo((120 - 100) * 150, 6);
    expect(trade.realisedPnl).toBeCloseTo(trade.grossPnl - 40, 6);
  });

  it('carries the contract, quantity and strategy name on every trade', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(1)]);
    engine.place(order());
    engine.replay(session(10));

    const trade = settled(engine)[0]!;
    expect(trade.strategyName).toBe('Green Retest 3-Candle Buy');
    expect(trade.contract.tradingsymbol).toBe('NIFTY 24500 CE');
    expect(trade.contract.strike).toBe(24500);
    expect(trade.contract.leg).toBe('CE');
    expect(trade.contract.expiry).toBe('2026-08-27');
    expect(trade.quantity).toBe(150);
    expect(trade.lotSize).toBe(75);
    expect(trade.side).toBe('BUY');
  });

  it('writes an activity trail per trade', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(2), signal(9)]);
    engine.place(order());
    engine.replay(session(20));

    const kinds = engine.snapshot().events.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'TRADE_TAKEN').length).toBe(2);
    expect(kinds.filter((k) => k === 'STRATEGY_EXIT').length).toBe(2);
  });

  it('sets no stop and no target — the clock is the exit', () => {
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(1)]);
    engine.place(order());
    engine.replay(session(10));

    const trade = settled(engine)[0]!;
    expect(trade.stopLoss).toBeNull();
    expect(trade.target).toBeNull();
  });

  it('holds the full three candles through a sharp drawdown', () => {
    // No stop means no early exit. The rule is three candles, whatever they do.
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signal(1)]);
    engine.place(order());
    engine.replay([bar(0, 100), bar(1, 100), bar(2, 40), bar(3, 30), bar(4, 90)]);

    const trade = settled(engine)[0]!;
    expect(trade.exitTime).toBe(at(4) + 58_000);
    expect(trade.exitPrice).toBe(90);
  });
});

describe('Green Retest 3-Candle Buy — replay and live agree', () => {
  it('reaches the same ledger fed bar-by-bar as fed in one burst', () => {
    // The spec's requirement that the timing rule is the same live as in a
    // backtest. It holds because the rule is arithmetic on bar times, not a
    // wall-clock timer that a fast replay would outrun.
    const bars = session(30);
    const signals = [signal(4), signal(14)];

    const burst = new PaperTradeEngine({ idFactory: () => 'FIXED' });
    burst.setRetests(KEY, signals);
    burst.place(order());
    burst.replay(bars);

    const live = new PaperTradeEngine({ idFactory: () => 'FIXED' });
    live.setRetests(KEY, signals);
    live.place(order());
    for (const update of bars) live.onUpdate(update);

    expect(live.snapshot().positions).toEqual(burst.snapshot().positions);
  });
});
