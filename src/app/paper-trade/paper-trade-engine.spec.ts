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

/** The backend-driven strategy these tests use when they need a signal-driven one. */
const SIGNAL_STRATEGY = 'backend:level-breakout';

/**
 * A backend Level Breakout entry on the bar `minute` minutes after the open,
 * exiting two bars later — no stop, no target, so only its exit ends it.
 */
function signalAt(minute: number) {
  return {
    atMs: OPEN_MS + minute * 60_000,
    bullish: true,
    quality: 1,
    valid: true,
    scenario: 'confirmed',
    source: 'level-breakout',
    side: 'BUY' as const,
    stopLoss: null,
    exitAtMs: OPEN_MS + (minute + 2) * 60_000,
    exitReason: 'held 60 minutes',
    reason: 'index broke above PDH',
  };
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
    // The backend-driven entry here sets no stop and no target, so its exit is the
    // only thing that can end the trade — which is exactly the branch under
    // test here.
    const engine = new PaperTradeEngine();
    engine.setRetests(KEY, [signalAt(1)]);
    engine.place(order({ strategyId: SIGNAL_STRATEGY }));

    engine.replay([bar(0, 100), bar(1, 100)]);
    expect(engine.snapshot().positions[0]!.status).toBe('ACTIVE');

    engine.replay([bar(2, 104), bar(3, 108), bar(4, 112)]);

    // Not `only`: this strategy is continuous, so a fresh order is standing
    // behind the settled one by now.
    const position = engine.snapshot().positions[0]!;
    expect(position.status).toBe('EXITED');
    expect(position.exitReason).toBe('STRATEGY_EXIT');
    expect(position.exitNote).toContain('held');
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
    // A signal-driven strategy with no signal supplied never fills, which is
    // the cheapest way to get an order stuck in CREATED.
    const second = new PaperTradeEngine();
    second.place(order({ strategyId: SIGNAL_STRATEGY }));
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

  it('keeps the lots the user asked for when the price moves', () => {
    const engine = new PaperTradeEngine();
    // Sized at ₹100 in the form; the feed has since moved to ₹140. Somebody
    // who asked for two lots still wants two — the cost is what gives, not the
    // size they already decided on.
    engine.onUpdate(bar(0, 140));
    engine.place(order({ sizing: 'LOTS', lots: 2, referencePrice: 100 }));

    const position = only(engine);
    expect(position.lots).toBe(2);
    expect(position.quantity).toBe(150);
    // And the committed figure is what that size actually costs now.
    expect(position.investment).toBeCloseTo(140 * 150, 6);
  });

  it('still trims the lots when sizing by amount', () => {
    // The complement of the test above, and the reason the two modes cannot
    // share one behaviour: here the budget is fixed and the size gives way.
    const engine = new PaperTradeEngine();
    engine.onUpdate(bar(0, 140));
    engine.place(order({ sizing: 'AMOUNT', investment: 20_000 }));

    expect(only(engine).lots).toBe(1);
  });

  it('sizes by amount when the request does not say', () => {
    // The default, so an older caller that predates the mode keeps working.
    const engine = new PaperTradeEngine();
    engine.onUpdate(bar(0, 100));
    engine.place(order({ investment: 20_000 }));
    expect(only(engine).lots).toBe(2);
  });

  it('refuses a lots order that names no lots', () => {
    const engine = new PaperTradeEngine();
    engine.onUpdate(bar(0, 100));
    const result = engine.place(order({ sizing: 'LOTS', lots: 0 }));

    expect('error' in result).toBe(true);
    expect(engine.snapshot().positions.length).toBe(0);
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
    engine.replay(day);

    // Sixteen bars happened, so the engine holds sixteen — not thirty-two.
    expect(engine.barsOf(KEY).length).toBe(16);
    expect(engine.barsOf(KEY).map((b) => b.timeMs)).toEqual(day.map((u) => u.timeMs));
  });

  it('replaces an out-of-order bar of the same instant rather than inserting it', () => {
    const engine = new PaperTradeEngine();
    for (let i = 0; i < 16; i++) engine.onUpdate(bar(i, 100));

    // An older bar arriving behind the newest — a backlog after a reconnect.
    // It is already in history, so it must replace, not lengthen.
    engine.onUpdate(bar(4, 111));
    engine.onUpdate(bar(4, 112));

    expect(engine.barsOf(KEY).length).toBe(16);
    // And the replacement is the value that arrived last, in its own slot.
    expect(engine.barsOf(KEY)[4]!.close).toBe(112);
  });

  it('inserts a genuinely missing bar where it belongs', () => {
    // The other half of the out-of-order path: a bar the engine has *not*
    // seen still has to land in time order, or every window a strategy reads
    // is scrambled.
    const engine = new PaperTradeEngine();
    engine.onUpdate(bar(0, 100));
    engine.onUpdate(bar(3, 103));
    engine.onUpdate(bar(1, 101));

    expect(engine.barsOf(KEY).map((b) => b.close)).toEqual([100, 101, 103]);
  });

  it('ignores a duplicate bar from a reconnecting feed', () => {
    const engine = new PaperTradeEngine();

    // The same bar twice must not lengthen the window a strategy measures.
    for (let i = 0; i < 16; i++) {
      engine.onUpdate(bar(i, 100));
      engine.onUpdate(bar(i, 100));
    }

    expect(engine.barsOf(KEY).length).toBe(16);
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

describe('PaperTradeEngine declining to enter', () => {
  it('waits in CREATED, quietly, while the strategy has no signal', () => {
    const engine = new PaperTradeEngine();
    // No retests supplied, so the strategy declines every bar.
    engine.place(order({ strategyId: SIGNAL_STRATEGY }));

    for (let i = 0; i < 10; i++) engine.onUpdate(bar(i, 100 + i));

    expect(only(engine).status).toBe('CREATED');
    // One line for the order itself and nothing else: an activity feed with a
    // row per declined bar would bury the entry it is waiting for.
    expect(engine.snapshot().events.length).toBe(1);
  });
});
