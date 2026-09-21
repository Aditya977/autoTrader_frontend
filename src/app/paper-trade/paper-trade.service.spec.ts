import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { PaperTradeService } from './paper-trade.service';
import type { ChartCandleEvent } from '../chart-stream/chart-stream.models';
import type { PaperContract, PaperOrderRequest } from './paper-trade.models';

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

function candle(minute: number, close: number): ChartCandleEvent {
  return {
    type: 'CANDLE',
    sessionId: 'session-1',
    timestamp: OPEN_MS + minute * 60_000,
    emittedAt: OPEN_MS + minute * 60_000,
    instrumentKey: KEY,
    timeframe: '1minute',
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
    openInterest: null,
    vwap: null,
    isSyntheticGap: false,
  };
}

/** A candle with real OHLC, for a shape the bar-reading strategy can judge. */
function ohlc(minute: number, o: number, h: number, l: number, c: number): ChartCandleEvent {
  return { ...candle(minute, c), open: o, high: h, low: l, close: c };
}

/**
 * A session containing one textbook 21-EMA reclaim.
 *
 * 30 flat bars pin the 21 EMA at 100, then: a breakout closing 103, a push to
 * a 105.5 high, a pullback to 101, and a close at 106 above that high.
 */
function sessionWithReclaim(): ChartCandleEvent[] {
  const bars: ChartCandleEvent[] = [];
  for (let i = 0; i < 30; i++) bars.push(ohlc(i, 100, 100.2, 99.8, 100));
  bars.push(ohlc(30, 99.5, 103.2, 99.4, 103));
  bars.push(ohlc(31, 103, 105.5, 102.8, 105));
  bars.push(ohlc(32, 105, 105.1, 101.0, 102));
  bars.push(ohlc(33, 102, 106.5, 101.9, 106));
  for (let i = 34; i < 40; i++) bars.push(ohlc(i, 106, 106.5, 105.5, 106));
  return bars;
}

/** The whole of an instant replay: every bar, then the session ends. */
function streamWholeDay(paper: PaperTradeService, closes: number[]): void {
  closes.forEach((close, i) => paper.onCandle(candle(i, close)));
  paper.endSession(KEY);
}

describe('PaperTradeService', () => {
  let paper: PaperTradeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    paper = TestBed.inject(PaperTradeService);
  });

  afterEach(() => paper.reset());

  it('drives a trade placed after an instant replay to completion', fakeAsync(() => {
    // The bug this exists for: at the default "Instant" replay speed the whole
    // day arrives before the user has typed an amount, so a trade placed
    // afterwards used to sit on CREATED forever with no activity.
    streamWholeDay(paper, [100, 102, 108, 121, 140, 160]);

    const placed = paper.place(order());
    expect('position' in placed).toBe(true);
    expect(paper.simulating()).toBe(true);

    // Paced, not instantaneous — nothing has filled on the same turn.
    expect(paper.positions()[0]!.status).toBe('CREATED');

    tick(200_000);

    const position = paper.positions()[0]!;
    expect(position.status).toBe('EXITED');
    // Manual's default target is +50% off the fill of 100.
    expect(position.exitReason).toBe('TARGET');
    expect(paper.simulating()).toBe(false);
  }));

  it('completes the re-run within about three minutes', fakeAsync(() => {
    streamWholeDay(
      paper,
      Array.from({ length: 375 }, (_, i) => 100 + i * 0.1),
    );
    paper.place(order());

    // A full trading day of one-minute bars, which is the realistic case.
    tick(181_000);
    expect(paper.simulating()).toBe(false);

    paper.reset();
  }));

  it('reports progress as the re-run advances', fakeAsync(() => {
    streamWholeDay(
      paper,
      Array.from({ length: 100 }, () => 100),
    );
    paper.place(order());

    expect(paper.progress()).toBe(0);
    tick(90_000);
    const midway = paper.progress();
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);

    tick(120_000);
    expect(paper.progress()).toBe(1);
  }));

  it('writes the full activity trail during the re-run', fakeAsync(() => {
    streamWholeDay(paper, [100, 102, 108, 121, 140, 160]);
    paper.place(order());
    tick(200_000);

    const kinds = paper.events().map((e) => e.kind);
    expect(kinds).toContain('TRADE_CREATED');
    expect(kinds).toContain('TRADE_TAKEN');
    expect(kinds).toContain('TARGET_HIT');
  }));

  it('squares off at the end of the recording when nothing else closed it', fakeAsync(() => {
    // A flat day: no stop, no target, and Manual never exits on its own.
    streamWholeDay(
      paper,
      Array.from({ length: 30 }, () => 100),
    );
    paper.place(order());
    tick(200_000);

    const position = paper.positions()[0]!;
    expect(position.status).toBe('EXITED');
    expect(position.exitReason).toBe('SESSION_END');
  }));

  it('does not re-run a feed that is still live', fakeAsync(() => {
    // No endSession: bars are still coming, so the order waits for the next one
    // rather than re-simulating the morning underneath the afternoon.
    paper.onCandle(candle(0, 100));
    paper.place(order());

    expect(paper.simulating()).toBe(false);
    expect(paper.positions()[0]!.status).toBe('CREATED');

    paper.onCandle(candle(1, 100));
    expect(paper.positions()[0]!.status).toBe('ACTIVE');
  }));

  it('refuses an order on a finished feed it never recorded', () => {
    // Nothing was streamed, so there is nothing to simulate against. Accepting
    // it would create a position that can never move — the silent failure.
    paper.endSession(KEY);
    const result = paper.place(order());

    expect('error' in result).toBe(true);
    expect(paper.positions().length).toBe(0);
  });

  it('does not let the recording grow by re-running it', fakeAsync(() => {
    streamWholeDay(paper, [100, 102, 108, 121, 140, 160]);
    paper.place(order());
    tick(200_000);

    // A second trade must re-run the same six bars, not twelve. If the playback
    // recorded itself, the day would double on every trade placed.
    paper.place(order());
    tick(200_000);

    const second = paper.positions()[1]!;
    expect(second.status).toBe('EXITED');
    expect(second.entryPrice).toBe(100);
  }));

  it('rewinds the charts to the open and advances them bar by bar', fakeAsync(() => {
    streamWholeDay(paper, [100, 102, 108, 121, 140, 160]);
    expect(paper.playbackAt()).toBeNull();

    paper.place(order());

    // Rewound: just before the first bar of the day, so the charts draw none
    // of the session and whatever history sat behind it.
    expect(paper.playbackAt()).toBe(OPEN_MS - 1);

    tick(31_000);
    const early = paper.playbackAt()!;
    expect(early).toBeGreaterThanOrEqual(OPEN_MS);

    tick(60_000);
    expect(paper.playbackAt()!).toBeGreaterThan(early);

    // Finished: the cursor clears, which is what puts the charts back to the
    // whole session.
    tick(200_000);
    expect(paper.playbackAt()).toBeNull();
  }));

  it('never advances the cursor past the session', fakeAsync(() => {
    const closes = [100, 102, 108, 121, 140, 160];
    streamWholeDay(paper, closes);
    paper.place(order());

    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
      tick(5_000);
      const at = paper.playbackAt();
      if (at !== null) seen.push(at);
    }

    const lastBar = OPEN_MS + (closes.length - 1) * 60_000;
    expect(Math.max(...seen)).toBeLessThanOrEqual(lastBar);
    // And it only ever moves forwards while running.
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  }));

  it('restores the charts and closes the position when stopped early', fakeAsync(() => {
    streamWholeDay(
      paper,
      Array.from({ length: 60 }, (_, i) => 100 + i * 0.2),
    );
    paper.place(order());

    tick(60_000);
    expect(paper.simulating()).toBe(true);
    expect(paper.playbackAt()).not.toBeNull();

    paper.stopSimulation();

    // The chart goes back to the full session — the cursor is the entire undo.
    expect(paper.playbackAt()).toBeNull();
    expect(paper.simulating()).toBe(false);
    // Nothing is left looking live on a chart that has stopped advancing.
    expect(paper.positions().every((p) => p.status === 'EXITED')).toBe(true);

    // And the timer really is gone.
    tick(200_000);
    expect(paper.playbackAt()).toBeNull();
  }));

  it('replays only the session day, with the days behind it already in place', fakeAsync(() => {
    // Two days recorded. Only the newer one is paced: the previous day is
    // context, and spending the three minutes replaying bars nobody asked to
    // watch would leave almost none for the day being studied.
    const previous = Date.UTC(2026, 7, 13, 3, 45);
    for (let i = 0; i < 40; i++) {
      paper.onCandle({ ...candle(i, 100), timestamp: previous + i * 60_000 });
    }
    for (let i = 0; i < 10; i++) paper.onCandle(candle(i, 100));
    paper.endSession(KEY);

    paper.place(order());

    // The cursor starts at the session day's open, not at the previous day's —
    // which is the whole proof that the previous day was not put in the paced
    // set.
    expect(paper.playbackAt()).toBe(OPEN_MS - 1);

    tick(200_000);
    expect(paper.playbackAt()).toBeNull();
    expect(paper.positions()[0]!.status).toBe('EXITED');
  }));

  it('rewinds the bar history so a re-run cannot see the end of the day', fakeAsync(() => {
    // The bug this exists for. The engine has already seen the whole session
    // live by the time a trade is placed, and replaying it on top of that
    // history handed any strategy reading `ctx.bars` all 375 bars on the
    // first bar of the re-run — so it evaluated the close of the day, every
    // tick, and took nothing all session.
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    streamWholeDay(paper, closes);

    // Live pass complete: the engine has the lot.
    expect(paper.barsSeen(KEY)).toBe(40);

    paper.place(order());

    // The moment the re-run starts, history is back to nothing and rebuilds
    // as the replay advances.
    expect(paper.barsSeen(KEY)).toBeLessThan(40);

    tick(45_000);
    const midway = paper.barsSeen(KEY);
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(40);

    tick(200_000);
    expect(paper.barsSeen(KEY)).toBe(40);
  }));

  it('never shows a strategy a bar from after the one being replayed', fakeAsync(() => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    streamWholeDay(paper, closes);
    paper.place(order());

    // At every point of the re-run, the newest bar the engine holds must be
    // the bar the cursor has reached — never one from later in the day.
    for (let i = 0; i < 40; i++) {
      tick(5_000);
      const at = paper.playbackAt();
      const newest = paper.newestBarTime(KEY);
      if (at === null || newest === null) continue;
      expect(newest).toBeLessThanOrEqual(at);
    }
  }));

  it('lets a history-reading strategy trade a session it already streamed', fakeAsync(() => {
    // The end-to-end shape of the reported bug: the whole day streams first
    // (an instant replay finishes before anyone can press the button), then a
    // 21-EMA order is placed against it. With the engine's history left full,
    // the strategy evaluated the *last* bar of the day on every tick of the
    // re-run and took nothing all session.
    for (const bar of sessionWithReclaim()) paper.onCandle(bar);
    paper.endSession(KEY);

    const placed = paper.place(order({ strategyId: 'ema-retest-reclaim' }));
    expect('position' in placed).toBe(true);

    tick(200_000);

    const position = paper.positions()[0]!;
    expect(position.status).not.toBe('CREATED');
    expect(position.entryPrice).toBe(106);
    // Just under the entry candle's open of 102, not the breakout candle's.
    expect(position.stopLoss!).toBeCloseTo(102 * 0.999, 6);
  }));

  it('tracks the last price per instrument for the sizing form', () => {
    expect(paper.priceOf(KEY)).toBeNull();
    paper.onCandle(candle(0, 137.5));
    expect(paper.priceOf(KEY)).toBe(137.5);
  });

  it('clears everything on reset, including a run in flight', fakeAsync(() => {
    streamWholeDay(paper, [100, 102, 108]);
    paper.place(order());
    expect(paper.simulating()).toBe(true);

    paper.reset();

    expect(paper.simulating()).toBe(false);
    expect(paper.positions()).toEqual([]);
    expect(paper.priceOf(KEY)).toBeNull();
    // And the timer is genuinely gone — no further work happens.
    tick(200_000);
    expect(paper.positions()).toEqual([]);
  }));
});
