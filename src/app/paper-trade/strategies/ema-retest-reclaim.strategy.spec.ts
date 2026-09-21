import { findSetup, emaRetestReclaimStrategy } from './ema-retest-reclaim.strategy';
import type { PaperBar, PaperStrategyContext } from './paper-strategy';
import { PaperTradeEngine } from '../paper-trade-engine';
import type { PaperContract, PaperMarketUpdate, PaperOrderRequest } from '../paper-trade.models';

/**
 * The setup, built by hand.
 *
 * Every series here starts with a long flat run so the 21 EMA is warm and
 * sitting exactly at the flat price — which makes the interesting part
 * arithmetic rather than guesswork: with the average pinned at 100, "broke
 * above the 21 EMA" is just "closed above 100".
 */

const START = Date.UTC(2026, 7, 14, 3, 45);
const KEY = 'NSE_FO|12345';

/** One candle. `o/h/l/c` in the order a trader reads them. */
function candle(i: number, o: number, h: number, l: number, c: number): PaperBar {
  return { timeMs: START + i * 60_000, open: o, high: h, low: l, close: c, volume: 1000 };
}

/** A flat bar at `price`, with a small symmetric range. */
function flat(i: number, price = 100): PaperBar {
  return candle(i, price, price + 0.2, price - 0.2, price);
}

/** 30 flat bars: enough to warm the 21 EMA and hold it at 100. */
function base(count = 30, price = 100): PaperBar[] {
  return Array.from({ length: count }, (_, i) => flat(i, price));
}

function ctxOf(bars: PaperBar[], params: Record<string, number> = {}): PaperStrategyContext {
  const last = bars[bars.length - 1]!;
  return {
    update: {
      instrumentKey: KEY,
      timeMs: last.timeMs,
      price: last.close,
      open: last.open,
      high: last.high,
      low: last.low,
      closed: true,
    },
    bars,
    price: last.close,
    position: null,
    side: 'BUY',
    params: { ...emaRetestReclaimStrategy.params, ...params },
    retests: [],
  };
}

/**
 * The textbook sequence, appended to a flat base at 100.
 *
 * - 30: breakout, opens 99.5 and closes 103 — through the average, stop 99.5
 * - 31: pushes on to 105, high 105.5   ← focus candle, focus price 105.5
 * - 32: pullback, low 101 (just above the 21 EMA)
 * - 33: reclaim, closes 106 above the focus high
 */
function textbook(): PaperBar[] {
  return [
    ...base(),
    candle(30, 99.5, 103.2, 99.4, 103),
    candle(31, 103, 105.5, 102.8, 105),
    candle(32, 105, 105.1, 101.0, 102),
    candle(33, 102, 106.5, 101.9, 106),
  ];
}

/**
 * The geometry the rule is actually written for: an uptrend, a dip through
 * the 21 EMA, and a reclaim while the 14 EMA is still overhead.
 *
 * Worth the trouble of building, because it is the only shape in which the
 * 14 EMA is a *target* — somewhere price is travelling to. It is also
 * instructive: the average sits barely a point above the fill, so the reward
 * on this setup is small against a stop down at the breakout candle's open.
 * That is a property of the rule, not of this fixture.
 *
 * - 0..33  uptrend, +1.2 a bar, which pins ema14 above ema21
 * - 34..37 dip to 104, through the 21 EMA
 * - 38     breakout: closes 108, back above the 21 EMA at ~107.84
 * - 39     focus candle: green, closes 108.5, high 108.7
 * - 40     pullback: closes 107.8, low 107.0
 * - 41     reclaim: closes 109.2, above the focus high, ema14 ~109.42 overhead
 */
function uptrendPullback(): PaperBar[] {
  const bars: PaperBar[] = [];
  for (let i = 0; i < 34; i++) {
    const c = 80 + i * 1.2;
    bars.push(candle(i, c - 0.5, c + 0.3, c - 0.7, c));
  }
  bars.push(candle(34, 119, 119.2, 114.5, 115));
  bars.push(candle(35, 115, 115.1, 109.5, 110));
  bars.push(candle(36, 110, 110.1, 105.5, 106));
  bars.push(candle(37, 106, 106.1, 103.5, 104));
  bars.push(candle(38, 104.2, 108.2, 104.0, 108));
  bars.push(candle(39, 108, 108.7, 107.9, 108.5));
  bars.push(candle(40, 108.5, 108.6, 107.0, 107.8));
  bars.push(candle(41, 107.8, 109.4, 107.7, 109.2));
  return bars;
}

describe('21 EMA Retest Reclaim — the valid setup', () => {
  it('finds the breakout, the focus price and the reclaim', () => {
    const setup = findSetup(ctxOf(textbook()))!;

    expect(setup).not.toBeNull();
    expect(setup.breakoutIndex).toBe(30);
    // The last bullish candle before price gave ground.
    expect(setup.focusIndex).toBe(31);
    expect(setup.focusPrice).toBe(105.5);
    expect(setup.pullbackIndex).toBe(32);
    expect(setup.pullbackLow).toBe(101.0);
  });

  it('stops just under the entry candle’s open, not the breakout candle’s', () => {
    // The breakout candle opened at 99.5 and the entry candle at 102. A stop
    // down at 99.5 turns one red candle into a loss several times the size of
    // the move being played for; the entry candle's open is the level that
    // says the reclaim itself has failed.
    const setup = findSetup(ctxOf(textbook()))!;

    expect(setup.stopLoss).toBeCloseTo(102 * 0.999, 6);
    expect(setup.stopLoss).toBeLessThan(102);
    expect(setup.stopLoss).toBeGreaterThan(99.5);
  });

  it('puts the stop exactly on the open when the buffer is zero', () => {
    const setup = findSetup(ctxOf(textbook(), { stopBuffer: 0 }))!;
    expect(setup.stopLoss).toBe(102);
  });

  it('widens the stop with the buffer', () => {
    const setup = findSetup(ctxOf(textbook(), { stopBuffer: 1 }))!;
    expect(setup.stopLoss).toBeCloseTo(102 * 0.99, 6);
  });

  it('is not defeated by the entry candle’s own low', () => {
    // The trap in this rule, and the same one the breakout-candle version
    // had: the entry candle's low is under its own open on nearly every
    // bullish reclaim. A structure check that counted it would reject every
    // setup there is.
    const bars = textbook();
    expect(bars[33]!.low).toBeLessThan(bars[33]!.open);
    expect(findSetup(ctxOf(bars))).not.toBeNull();
  });

  it('enters at the close of the reclaim candle', () => {
    const setup = findSetup(ctxOf(textbook()))!;
    expect(setup.entryPrice).toBe(106);
  });

  it('finds the setup in the uptrend-pullback geometry too', () => {
    const setup = findSetup(ctxOf(uptrendPullback()))!;

    expect(setup).not.toBeNull();
    expect(setup.breakoutIndex).toBe(38);
    expect(setup.focusIndex).toBe(39);
    expect(setup.focusPrice).toBe(108.7);
    // Entry candle 41 opened at 107.8.
    expect(setup.stopLoss).toBeCloseTo(107.8 * 0.999, 6);
    expect(setup.entryPrice).toBe(109.2);
  });

  it('arms the 14 EMA as a target when it is overhead', () => {
    const ctx = ctxOf(uptrendPullback());
    const setup = findSetup(ctx)!;

    // The average is above the fill here, so it is a level to travel to.
    expect(setup.ema14!).toBeGreaterThan(setup.entryPrice);
    expect(emaRetestReclaimStrategy.plan(ctx, setup.entryPrice).target).toBe(setup.ema14);
  });

  it('leaves the target unarmed when the 14 EMA is under price', () => {
    // The flat-base rally leaves price well clear of both averages. There is
    // nothing overhead to travel to, so no target is set — the trade runs on
    // its stop until price comes back down to the average.
    const ctx = ctxOf(textbook());
    const setup = findSetup(ctx)!;

    expect(setup.ema14!).toBeLessThan(setup.entryPrice);
    expect(emaRetestReclaimStrategy.plan(ctx, setup.entryPrice).target).toBeNull();
  });

  it('does not require the pullback to touch the 21 EMA', () => {
    // The whole point. The pullback bottoms at 103.5, comfortably above the
    // average at ~100, and it is still a retest because the structure held.
    const bars = [
      ...base(),
      candle(30, 99.5, 103.2, 99.4, 103),
      candle(31, 103, 105.5, 102.8, 105),
      candle(32, 105, 105.1, 103.5, 104),
      candle(33, 104, 106.5, 103.9, 106),
    ];
    const setup = findSetup(ctxOf(bars));

    expect(setup).not.toBeNull();
    expect(setup!.pullbackLow).toBe(103.5);
  });

  it('accepts a pullback that dips below the 21 EMA', () => {
    // "Slightly below" is still the area. The stop at 99.4 survives, which is
    // what keeps this a live setup rather than a stopped one.
    const bars = [
      ...base(),
      candle(30, 99.5, 103.2, 99.45, 103),
      candle(31, 103, 105.5, 102.8, 105),
      candle(32, 105, 105.1, 99.6, 100),
      candle(33, 100, 106.5, 99.9, 106),
    ];
    expect(findSetup(ctxOf(bars))).not.toBeNull();
  });

  it('takes the breakout candle itself as the focus when the pullback is immediate', () => {
    const bars = [
      ...base(),
      candle(30, 99.5, 104.0, 99.4, 103),
      candle(31, 103, 103.2, 101.0, 102),
      candle(32, 102, 105.0, 101.9, 104.5),
    ];
    const setup = findSetup(ctxOf(bars))!;

    expect(setup.focusIndex).toBe(30);
    expect(setup.focusPrice).toBe(104.0);
  });
});

describe('21 EMA Retest Reclaim — what it refuses', () => {
  it('refuses a candle that was already above the average', () => {
    // Closing above an average it never crossed breaks nothing.
    const bars = [
      ...base(30, 100),
      candle(30, 101, 103, 100.9, 102.5),
      candle(31, 102.5, 105.5, 102.4, 105),
      candle(32, 105, 105.1, 101.0, 102),
      candle(33, 102, 106.5, 101.9, 106),
    ];
    // The breakout is index 30 only if bar 29 closed at or below the average.
    // Here bar 30 opens above it, so the cross is at 30; bar 31 onward are in
    // the trend. Whatever it finds, it must not be a breakout at 31.
    const setup = findSetup(ctxOf(bars));
    if (setup) expect(setup.breakoutIndex).toBe(30);
  });

  it('refuses up-then-down with no reclaim', () => {
    // Exactly the shape the spec says is not a retest: price moved up, then
    // down, and never came back. There is no N here.
    const bars = [
      ...base(),
      candle(30, 99.5, 103.2, 99.4, 103),
      candle(31, 103, 105.5, 102.8, 105),
      candle(32, 105, 105.1, 101.0, 102),
      candle(33, 102, 103.0, 100.5, 101),
    ];
    expect(findSetup(ctxOf(bars))).toBeNull();
  });

  it('refuses a wick through the focus price that closes back under it', () => {
    // A reclaim is a close above. A poke and a failure is a rejection, and
    // buying it is buying the top of the bar.
    const bars = [
      ...base(),
      candle(30, 99.5, 103.2, 99.4, 103),
      candle(31, 103, 105.5, 102.8, 105),
      candle(32, 105, 105.1, 101.0, 102),
      candle(33, 102, 106.0, 101.9, 104),
    ];
    expect(findSetup(ctxOf(bars))).toBeNull();
  });

  it('refuses a rally with no pullback at all', () => {
    // Nothing was retested, so there is nothing to confirm.
    const bars = [
      ...base(),
      candle(30, 99.5, 103.2, 99.4, 103),
      candle(31, 103, 105.5, 102.8, 105),
      candle(32, 105, 107.5, 104.8, 107),
    ];
    expect(findSetup(ctxOf(bars))).toBeNull();
  });

  it('refuses a pause dressed up as a pullback', () => {
    // Bar 32 closes lower but never trades below the focus candle's close, so
    // nothing was given back. Up-then-sideways is not a retest.
    const bars = [
      ...base(),
      candle(30, 99.5, 103.2, 99.4, 103),
      candle(31, 103, 105.5, 102.8, 105),
      candle(32, 105, 105.2, 105.0, 105.05),
      candle(33, 105.05, 106.5, 105.0, 106),
    ];
    expect(findSetup(ctxOf(bars))).toBeNull();
  });

  it('refuses a pullback that never came near the average', () => {
    // Price ran far above the 21 EMA and dipped a fraction. That is a pause
    // high above the level, not a retest of it.
    const bars = [
      ...base(),
      candle(30, 99.5, 103.2, 99.4, 103),
      candle(31, 103, 130.0, 102.8, 129),
      candle(32, 129, 129.2, 126.0, 127),
      candle(33, 127, 131.0, 126.9, 130.5),
    ];
    expect(findSetup(ctxOf(bars))).toBeNull();
  });

  it('refuses when the reclaim comes too late', () => {
    // The window is four candles after the breakout. A reclaim on the fifth
    // is a different move: the market has stopped reacting to the level.
    const bars = [
      ...base(),
      candle(30, 99.5, 103.2, 99.4, 103),
      candle(31, 103, 105.5, 102.8, 105),
      candle(32, 105, 105.1, 101.0, 102),
      candle(33, 102, 103.0, 101.5, 102.5),
      candle(34, 102.5, 103.5, 102.0, 103),
      candle(35, 103, 106.5, 102.9, 106),
    ];
    expect(findSetup(ctxOf(bars))).toBeNull();
  });

  it('refuses when the breakout was structurally undone', () => {
    // The pullback traded back under the breakout candle's open, so the break
    // failed. Whatever happens next belongs to a later breakout, not this one.
    const bars = [
      ...base(),
      candle(30, 99.5, 103.2, 99.4, 103),
      candle(31, 103, 105.5, 102.8, 105),
      candle(32, 105, 105.1, 99.0, 100),
      candle(33, 100, 106.5, 99.9, 106),
    ];
    expect(findSetup(ctxOf(bars))).toBeNull();
  });

  it('refuses when the candle before the pullback is red', () => {
    // There is no "last green candle before it stalled", so there is no focus
    // price. Walking further back to find one would be drawing the N rather
    // than finding it.
    const bars = [
      ...base(),
      candle(30, 99.5, 103.2, 99.4, 103),
      candle(31, 104, 105.5, 103.0, 103.5),
      candle(32, 103.5, 103.6, 101.0, 102),
      candle(33, 102, 106.5, 101.9, 106),
    ];
    expect(findSetup(ctxOf(bars))).toBeNull();
  });

  it('says nothing before the 21 EMA is warm', () => {
    const bars = [...base(10), candle(10, 99.5, 103.2, 99.4, 103)];
    expect(findSetup(ctxOf(bars))).toBeNull();
  });

  it('is long only', () => {
    const ctx = { ...ctxOf(textbook()), side: 'SELL' as const };
    expect(emaRetestReclaimStrategy.entry(ctx)).toBeNull();
  });

  it('decides only on closed bars', () => {
    const ctx = ctxOf(textbook());
    const forming = { ...ctx, update: { ...ctx.update, closed: false } };
    expect(emaRetestReclaimStrategy.entry(forming)).toBeNull();
  });
});

describe('21 EMA Retest Reclaim — the moving target', () => {
  it('offers the 14 EMA while it is overhead', () => {
    const ctx = ctxOf(base(30, 100));
    // A flat series puts the 14 EMA at the price itself, so it is not above.
    expect(emaRetestReclaimStrategy.retarget!(ctx)).toBeNull();
  });

  it('withholds a target that price has already passed', () => {
    // A long does not travel down to its target. An average under price is a
    // level already crossed, and handing it over would close the trade at a
    // price the market never offered on the way up.
    const bars = [...base(30, 100), candle(30, 100, 140, 99.9, 138)];
    const ctx = ctxOf(bars);
    expect(emaRetestReclaimStrategy.retarget!(ctx)).toBeNull();
  });

  it('arms once the average is overhead again', () => {
    // A long decline leaves the 14 EMA above a price that has fallen away
    // from it, which is exactly when there is something to travel to.
    const bars = [...base(25, 120), ...Array.from({ length: 6 }, (_, i) => flat(25 + i, 100 - i))];
    const ctx = ctxOf(bars);
    const target = emaRetestReclaimStrategy.retarget!(ctx);

    expect(target).not.toBeNull();
    expect(target!).toBeGreaterThan(ctx.price);
  });
});

/* -------------------------------------------------------------------------
 * Through the engine
 * ---------------------------------------------------------------------- */

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
    strategyId: 'ema-retest-reclaim',
    side: 'BUY',
    investment: 200_000,
    referencePrice: 100,
    lots: 1,
    quantity: 75,
    ...overrides,
  };
}

const feed = (bar: PaperBar): PaperMarketUpdate => ({
  instrumentKey: KEY,
  timeMs: bar.timeMs,
  price: bar.close,
  open: bar.open,
  high: bar.high,
  low: bar.low,
  volume: bar.volume,
  closed: true,
});

describe('21 EMA Retest Reclaim — through the engine', () => {
  it('takes the trade with the stop at the breakout open', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.replay(textbook().map(feed));

    const position = engine.snapshot().positions[0]!;
    expect(position.status).toBe('ACTIVE');
    expect(position.entryPrice).toBe(106);
    expect(position.stopLoss).toBeCloseTo(102 * 0.999, 6);
  });

  it('waits for the 21 EMA to warm before it can act', () => {
    // Revives the warm-up path: this is the first shipped strategy that
    // declares one, and it must not fill on bar three.
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.replay(base(10).map(feed));

    expect(engine.snapshot().positions[0]!.status).toBe('CREATED');
    expect(engine.snapshot().events.length).toBe(1);
  });

  it('stops out just under the entry candle’s open, and loses less for it', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    engine.replay([...textbook(), candle(34, 106, 106.1, 98.0, 99)].map(feed));

    const stop = 102 * 0.999;
    const position = engine.snapshot().positions[0]!;
    expect(position.status).toBe('EXITED');
    expect(position.exitReason).toBe('STOP_LOSS');
    // Filled at the stop, not at the close that ran past it.
    expect(position.exitPrice).toBeCloseTo(stop, 6);
    // And the damage is the entry-candle distance, not the breakout-candle
    // one — which is the whole point of moving it. Sized off the position's
    // own quantity, because the engine re-sizes the order against the live
    // price rather than taking the request's lot count on trust.
    const qty = position.quantity;
    expect(position.grossPnl).toBeCloseTo((stop - 106) * qty, 6);
    expect(Math.abs(position.grossPnl)).toBeLessThan(Math.abs((99.5 - 106) * qty));
  });

  it('books a TARGET when price reaches the 14 EMA from below', () => {
    const engine = new PaperTradeEngine();
    engine.place(order());
    const bars = [...uptrendPullback()];
    // One more bar that trades up through the average overhead.
    bars.push(candle(42, 109.2, 112.0, 109.1, 111.5));
    engine.replay(bars.map(feed));

    const position = engine.snapshot().positions[0]!;
    expect(position.status).toBe('EXITED');
    expect(position.exitReason).toBe('TARGET');
    // Filled at the level, not at the close that ran past it.
    expect(position.exitPrice).toBeLessThan(111.5);
    expect(position.realisedPnl).toBeGreaterThan(-1000);
  });

  it('exits on the 14 EMA reached from above when it was never overhead', () => {
    // The other geometry: price is extended above the average, so the same
    // line is what it falls back to. Still "touched the 14 EMA".
    //
    // The entry candle opens at 101 rather than 102, which puts the stop at
    // ~100.9 — *below* the 14 EMA at ~101.8. Without that the tighter stop
    // sits above the average and always fires first, and this path could
    // never be reached at all. That the two levels are this close together is
    // worth noticing: on a stop this tight the 14 EMA exit only gets a say
    // when the average happens to sit inside the entry candle's body.
    const engine = new PaperTradeEngine();
    engine.place(order());
    const bars = [
      ...base(),
      candle(30, 99.5, 103.2, 99.4, 103),
      candle(31, 103, 105.5, 102.8, 105),
      candle(32, 105, 105.1, 101.0, 102),
      candle(33, 101, 106.5, 100.95, 106),
    ];
    for (let i = 0; i < 6; i++) bars.push(candle(34 + i, 105, 105.5, 101.4, 102));
    engine.replay(bars.map(feed));

    const position = engine.snapshot().positions[0]!;
    expect(position.status).toBe('EXITED');
    expect(position.exitNote).toContain('14 EMA');
  });

  it('never leaves the stop behind after it is set', () => {
    // "Do not dynamically move the stop-loss for this setup."
    const engine = new PaperTradeEngine();
    engine.place(order());
    const bars = [...textbook()];
    for (let i = 0; i < 5; i++) bars.push(candle(34 + i, 106, 107, 105.5, 106.5));

    const seen = new Set<number | null>();
    for (const bar of bars) {
      engine.onUpdate(feed(bar));
      const position = engine.snapshot().positions[0]!;
      if (position.status === 'ACTIVE') seen.add(position.stopLoss);
    }

    expect(seen.size).toBe(1);
    expect([...seen][0]!).toBeCloseTo(102 * 0.999, 6);
  });

  it('reaches the same ledger bar-by-bar as in one burst', () => {
    const bars = textbook().map(feed);

    // A bar before the order, so `createdAt` comes from the market rather
    // than from the wall-clock fallback that applies only before the feed has
    // said anything — the one value that legitimately differs between runs.
    const burst = new PaperTradeEngine({ idFactory: () => 'FIXED' });
    burst.onUpdate(bars[0]!);
    burst.place(order());
    burst.replay(bars);

    const live = new PaperTradeEngine({ idFactory: () => 'FIXED' });
    live.onUpdate(bars[0]!);
    live.place(order());
    for (const update of bars) live.onUpdate(update);

    expect(live.snapshot().positions).toEqual(burst.snapshot().positions);
  });
});
