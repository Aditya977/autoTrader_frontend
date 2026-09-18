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
