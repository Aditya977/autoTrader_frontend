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

  it('replays only the session day, and warms the strategy on the days behind it', fakeAsync(() => {
    // Two days recorded. The strategy needs 21 bars, and the session day here
    // is far shorter than that — so it can only trade if the previous day went
    // in as warm-up rather than being replayed at the same pace.
    const previous = Date.UTC(2026, 7, 13, 3, 45);
    for (let i = 0; i < 40; i++) {
      paper.onCandle({ ...candle(i, 100), timestamp: previous + i * 60_000 });
    }
    for (let i = 0; i < 10; i++) paper.onCandle(candle(i, 100));
    paper.endSession(KEY);

    paper.place(order({ strategyId: 'ema-crossover', investment: 200_000 }));

    // The cursor starts at the session day's open, not at the previous day's.
    expect(paper.playbackAt()).toBe(OPEN_MS - 1);

    tick(200_000);
    // Warm enough to have been asked for a signal at all, so it is no longer
    // sitting in CREATED for want of history.
    expect(paper.positions()[0]!.status).toBe('EXITED');
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
