import { PaperTradeEngine } from './paper-trade-engine';
import type {
  PaperContract,
  PaperMarketUpdate,
  PaperOrderRequest,
  PaperPosition,
} from './paper-trade.models';

/** 2026-08-14, 09:15 IST — the session open the bars below count from. */
const OPEN_MS = Date.UTC(2026, 7, 14, 3, 45);
const KEY = 'NSE_FO|12345';

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
    strategyId: 'manual',
    side: 'BUY',
    investment: 20_000,
    referencePrice: 100,
    lots: 2,
    quantity: 150,
    ...overrides,
  };
}

/** One bar. `minute` is minutes from the open, so the times read as a session. */
function bar(minute: number, close: number, extra: Partial<PaperMarketUpdate> = {}) {
  return {
    instrumentKey: KEY,
    timeMs: OPEN_MS + minute * 60_000,
    price: close,
    open: close,
    high: close,
    low: close,
    volume: 1_000,
    closed: true,
    ...extra,
  } satisfies PaperMarketUpdate;
}

function only(engine: PaperTradeEngine): PaperPosition {
  const positions = engine.snapshot().positions;
  expect(positions.length).toBe(1);
  return positions[0]!;
}

describe('PaperTradeEngine lifecycle', () => {
  it('moves CREATED → ACTIVE → EXITED and nowhere else', () => {
    const engine = new PaperTradeEngine();
    const placed = engine.place(order());
    expect('position' in placed).toBe(true);

    // Created, not active: no price has arrived, so nothing has filled.
    expect(only(engine).status).toBe('CREATED');
    expect(only(engine).entryPrice).toBeNull();

    engine.onUpdate(bar(1, 100));
    expect(only(engine).status).toBe('ACTIVE');
    expect(only(engine).entryPrice).toBe(100);
    expect(only(engine).entryTime).toBe(OPEN_MS + 60_000);

    // Manual default is a 25% stop and a 50% target off the fill.
    engine.onUpdate(bar(2, 150));
    const closed = only(engine);
    expect(closed.status).toBe('EXITED');
    expect(closed.exitReason).toBe('TARGET');
  });

  it('fills at the price when the signal came, not at the price it was sized on', () => {
    const engine = new PaperTradeEngine();
    engine.place(order({ referencePrice: 100 }));

    // The market moved between placing and the first bar. Filling at 100 would
    // be the flattering lie; the fill is 112.
    engine.onUpdate(bar(1, 112));

    const position = only(engine);
    expect(position.entryPrice).toBe(112);
    expect(position.capitalUsed).toBeCloseTo(112 * 150, 6);
  });

  it('stamps every event from the market, never from the wall clock', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.onUpdate(bar(1, 100));
    engine.onUpdate(bar(5, 150));

    const events = engine.snapshot().events;
    const taken = events.find((e) => e.kind === 'TRADE_TAKEN')!;
    const target = events.find((e) => e.kind === 'TARGET_HIT')!;

    expect(taken.at).toBe(OPEN_MS + 60_000);
    expect(target.at).toBe(OPEN_MS + 5 * 60_000);
    // A replay of 2026 must not stamp 'now' — that is what makes a backtest
    // reproducible.
    expect(target.at).toBeLessThan(Date.now());
  });
});

describe('PaperTradeEngine exits', () => {
  it('fills a stop at the stop, not at the close that ran past it', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.onUpdate(bar(1, 100));
    // Stop is 75. The bar trades down to 60 and closes at 65: a resting stop
    // filled at 75 on the way through, and settling at 65 would book damage
    // the stop existed to prevent.
    engine.onUpdate(bar(2, 65, { open: 90, high: 92, low: 60 }));

    const position = only(engine);
    expect(position.exitReason).toBe('STOP_LOSS');
    expect(position.exitPrice).toBe(75);
    expect(position.grossPnl).toBeCloseTo((75 - 100) * 150, 6);
  });

  it('fills at the open when the bar gapped straight past the level', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.onUpdate(bar(1, 100));
    // Opened at 50, already through the 75 stop. Nothing traded at 75 — the
    // honest fill is the open.
    engine.onUpdate(bar(2, 48, { open: 50, high: 52, low: 45 }));

    expect(only(engine).exitPrice).toBe(50);
  });

  it('takes the stop when one bar covers both the stop and the target', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.onUpdate(bar(1, 100));
    // Stop 75, target 150, and a bar whose range spans 60 to 160. OHLC cannot
    // say which came first, so the pessimistic read is the only honest one.
    engine.onUpdate(bar(2, 140, { open: 100, high: 160, low: 60 }));

    expect(only(engine).exitReason).toBe('STOP_LOSS');
  });

  it('closes on the strategy signal when neither level was touched', () => {
    const engine = new PaperTradeEngine();
    // Range breakout exits when price closes back inside the range.
    engine.place(order({ strategyId: 'range-breakout', investment: 200_000 }));

    // A flat base, then a breakout, then a collapse back into it.
    for (let i = 0; i < 16; i++) engine.onUpdate(bar(i, 100));
    engine.onUpdate(bar(16, 130));
    expect(only(engine).status).toBe('ACTIVE');

    for (let i = 17; i < 26; i++) engine.onUpdate(bar(i, 128));
    // Back inside the range, but comfortably above the 95 stop the breakout
    // set at the range low — otherwise this would assert the stop, not the
    // strategy's own exit.
    engine.onUpdate(bar(26, 110));

    const position = only(engine);
    expect(position.status).toBe('EXITED');
    expect(position.exitReason).toBe('STRATEGY_EXIT');
    expect(position.exitNote).toBe('closed back inside the range');
  });

  it('exits by hand at the last marked price, and cancels an order that never filled', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.onUpdate(bar(1, 100));
    engine.onUpdate(bar(2, 118));
    engine.closeManually(only(engine).id);

    const closed = only(engine);
    expect(closed.exitReason).toBe('MANUAL_EXIT');
    expect(closed.exitPrice).toBe(118);

    // An unfilled order is cancelled, not "exited at a loss" — nothing was held.
    const second = new PaperTradeEngine();
    second.place(order({ strategyId: 'ema-crossover' }));
    const id = only(second).id;
    second.closeManually(id);
    expect(only(second).status).toBe('EXITED');
    expect(second.snapshot().events.some((e) => e.kind === 'ORDER_CANCELLED')).toBe(true);
  });

  it('squares off at session end under its own reason', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.onUpdate(bar(1, 100));
    engine.onUpdate(bar(2, 105));
    engine.endSession(KEY);

    const position = only(engine);
    expect(position.exitReason).toBe('SESSION_END');
    expect(position.exitPrice).toBe(105);
    // Not a strategy exit: nothing was decided, the day simply ended.
    expect(position.exitReason).not.toBe('STRATEGY_EXIT');
  });

  it('books the exit charge only on the exit', () => {
    const engine = new PaperTradeEngine({ exitCost: 40 });
    engine.place(order());
    engine.onUpdate(bar(1, 100));

    // Open: net is gross. A fresh trade is not ₹40 down before anything moved.
    engine.onUpdate(bar(2, 100));
    expect(only(engine).costs).toBe(0);
    expect(only(engine).netPnl).toBe(0);

    engine.onUpdate(bar(3, 150));
    const closed = only(engine);
    expect(closed.costs).toBe(40);
    expect(closed.grossPnl).toBeCloseTo((150 - 100) * 150, 6);
    expect(closed.netPnl).toBeCloseTo(closed.grossPnl - 40, 6);
    expect(closed.realisedPnl).toBe(closed.netPnl);
    expect(closed.unrealisedPnl).toBe(0);
  });
});

describe('PaperTradeEngine marking', () => {
  it('reports MAE and MFE from the bar range, not from its close', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.onUpdate(bar(1, 100));
    // A bar that went to 88 and 108 before closing flat. A position that was
    // ₹1,800 down inside the minute genuinely was.
    engine.onUpdate(bar(2, 100, { open: 100, high: 108, low: 88 }));

    const position = only(engine);
    expect(position.mae).toBeCloseTo((88 - 100) * 150, 6);
    expect(position.mfe).toBeCloseTo((108 - 100) * 150, 6);
  });

  it('keeps unrealised and realised on opposite sides of the exit', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.onUpdate(bar(1, 100));
    engine.onUpdate(bar(2, 110));

    expect(only(engine).unrealisedPnl).toBeCloseTo(1_500, 6);
    expect(only(engine).realisedPnl).toBe(0);
    expect(engine.snapshot().totals.unrealisedPnl).toBeCloseTo(1_500, 6);

    engine.closeManually(only(engine).id);
    expect(only(engine).unrealisedPnl).toBe(0);
    expect(engine.snapshot().totals.realisedPnl).toBeCloseTo(1_500 - 40, 6);
  });
});

describe('PaperTradeEngine sizing and refusal', () => {
  it('re-sizes against the live price rather than trusting a stale preview', () => {
    const engine = new PaperTradeEngine();
    // The form was rendered at ₹100 (₹20,000 buys two lots), but the feed has
    // since moved to ₹140, where the same money buys one.
    engine.onUpdate(bar(0, 140));
    engine.place(order({ referencePrice: 100 }));

    expect(only(engine).lots).toBe(1);
    expect(only(engine).quantity).toBe(75);
  });

  it('refuses an order the money cannot cover, and books nothing', () => {
    const engine = new PaperTradeEngine();
    const result = engine.place(order({ investment: 500 }));

    expect('error' in result).toBe(true);
    expect(engine.snapshot().positions.length).toBe(0);
  });

  it('refuses an unknown strategy rather than silently picking one', () => {
    const engine = new PaperTradeEngine();
    const result = engine.place(order({ strategyId: 'does-not-exist' }));
    expect('error' in result).toBe(true);
  });
});

describe('PaperTradeEngine multiple positions', () => {
  it('runs several positions at once and routes each update by instrument', () => {
    const engine = new PaperTradeEngine();
    const put: PaperContract = {
      ...CONTRACT,
      instrumentKey: 'NSE_FO|99999',
      tradingsymbol: 'NIFTY 24500 PE',
      leg: 'PE',
    };

    engine.place(order());
    engine.place(order({ contract: put }));

    // Only the call's feed. The put must not move.
    engine.onUpdate(bar(1, 100));
    engine.onUpdate(bar(2, 150));

    const [call, other] = engine.snapshot().positions;
    expect(call!.status).toBe('EXITED');
    expect(other!.status).toBe('CREATED');
    expect(other!.contract.leg).toBe('PE');

    engine.onUpdate({ ...bar(1, 60), instrumentKey: put.instrumentKey });
    expect(engine.snapshot().positions[1]!.status).toBe('ACTIVE');
    expect(engine.snapshot().totals.trades).toBe(2);
  });

  it('totals only what settled, and reports a win rate over settled trades', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.onUpdate(bar(1, 100));
    engine.onUpdate(bar(2, 150)); // target

    engine.place(order());
    engine.onUpdate(bar(3, 100));
    engine.onUpdate(bar(4, 70)); // stop

    const totals = engine.snapshot().totals;
    expect(totals.trades).toBe(2);
    expect(totals.wins).toBe(1);
    expect(totals.losses).toBe(1);
    expect(totals.winRate).toBe(50);
    expect(totals.openTrades).toBe(0);
  });
});

describe('PaperTradeEngine as a backtest driver', () => {
  it('replays a whole series through the same path, with no UI attached', () => {
    // The claim the module's structure rests on: identical code, no chart, no
    // Angular, just bars in and a ledger out.
    const engine = new PaperTradeEngine();
    engine.place(order());

    const series = [100, 104, 109, 118, 131, 152].map((close, i) => bar(i + 1, close));
    engine.replay(series);

    const position = only(engine);
    expect(position.status).toBe('EXITED');
    expect(position.exitReason).toBe('TARGET');
    expect(position.entryPrice).toBe(100);
  });

  it('produces the same ledger from the same bars, twice', () => {
    const run = () => {
      const engine = new PaperTradeEngine({ idFactory: () => 'FIXED' });
      // A bar before the order, so `createdAt` comes from the market rather
      // than from the wall-clock fallback that applies only before the feed has
      // said anything — the one value that legitimately differs between runs.
      engine.onUpdate(bar(0, 100));
      engine.place(order());
      engine.replay([100, 96, 91, 84, 73].map((close, i) => bar(i + 1, close)));
      return engine.snapshot().positions;
    };

    expect(run()).toEqual(run());
  });

  it('re-running a whole session does not double the history a strategy reads', () => {
    // How a trade placed after an instant replay is simulated: the recorded day
    // is fed back through. If the second pass appended instead of replacing,
    // the breakout's 15-bar window would be measuring 30 bars of a day that
    // only had 15, and every level it derived would be wrong.
    const engine = new PaperTradeEngine();
    const day = Array.from({ length: 16 }, (_, i) => bar(i, 100));

    engine.replay(day);
    engine.place(order({ strategyId: 'range-breakout', investment: 200_000 }));
    engine.replay(day);

    // Still exactly the flat base it was, so the breakout has not triggered.
    expect(only(engine).status).toBe('CREATED');

    engine.onUpdate(bar(16, 130));
    expect(only(engine).status).toBe('ACTIVE');
  });

  it('replaces an out-of-order bar of the same instant rather than inserting it', () => {
    const engine = new PaperTradeEngine();
    engine.place(order({ strategyId: 'range-breakout', investment: 200_000 }));

    for (let i = 0; i < 16; i++) engine.onUpdate(bar(i, 100));
    // An older bar arriving behind the newest — a backlog after a reconnect.
    // It is already in history, so it must replace, not lengthen.
    engine.onUpdate(bar(4, 100));
    engine.onUpdate(bar(4, 100));

    engine.onUpdate(bar(16, 130));
    expect(only(engine).status).toBe('ACTIVE');
  });

  it('ignores a duplicate bar from a reconnecting feed', () => {
    const engine = new PaperTradeEngine();
    engine.place(order({ strategyId: 'range-breakout', investment: 200_000 }));

    // The same bar twice must not lengthen the window the strategy measures.
    for (let i = 0; i < 16; i++) {
      engine.onUpdate(bar(i, 100));
      engine.onUpdate(bar(i, 100));
    }
    expect(only(engine).status).toBe('CREATED');

    engine.onUpdate(bar(16, 130));
    expect(only(engine).status).toBe('ACTIVE');
  });
});

describe('PaperTradeEngine activity', () => {
  it('writes one line per thing that happened, and none for a declined bar', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.onUpdate(bar(1, 100));
    for (let i = 2; i < 12; i++) engine.onUpdate(bar(i, 101));
    engine.onUpdate(bar(12, 150));

    const kinds = engine.snapshot().events.map((e) => e.kind);
    // Created, taken, target — and nothing for the ten bars that did nothing.
    expect(kinds).toEqual(['TRADE_CREATED', 'TRADE_TAKEN', 'TARGET_HIT']);
  });

  it('carries the realised P&L on the settling event only', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.onUpdate(bar(1, 100));
    engine.onUpdate(bar(2, 150));

    const events = engine.snapshot().events;
    expect(events.find((e) => e.kind === 'TRADE_TAKEN')!.netPnl).toBeNull();
    expect(events.find((e) => e.kind === 'TARGET_HIT')!.netPnl).toBeCloseTo(7_500 - 40, 6);
  });

  it('publishes a complete snapshot to subscribers on every change', () => {
    const engine = new PaperTradeEngine();
    const seen: number[] = [];
    engine.subscribe((snapshot) => seen.push(snapshot.positions.length));

    // The first call is immediate, so a late subscriber is never left blank.
    expect(seen).toEqual([0]);

    engine.place(order());
    expect(seen.at(-1)).toBe(1);
  });

  it('forgets everything on reset', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.onUpdate(bar(1, 100));
    engine.reset();

    expect(engine.snapshot().positions).toEqual([]);
    expect(engine.snapshot().events).toEqual([]);
    expect(engine.priceOf(KEY)).toBeNull();
  });
});

describe('PaperTradeEngine warm-up', () => {
  it('holds an order in CREATED until the strategy has the bars it needs', () => {
    const engine = new PaperTradeEngine();
    engine.place(order({ strategyId: 'ema-crossover', investment: 200_000 }));

    // 21 warm-up bars. A rising series crosses long before then, and the order
    // must still not fill.
    for (let i = 0; i < 10; i++) engine.onUpdate(bar(i, 100 + i));
    expect(only(engine).status).toBe('CREATED');
    // And no activity line per declined bar.
    expect(engine.snapshot().events.length).toBe(1);
  });
});
