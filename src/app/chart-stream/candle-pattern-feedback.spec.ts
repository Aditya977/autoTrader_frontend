import { Component, signal, viewChild } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { ChartStreamComponent } from './chart-stream.component';
import { ChartStreamSocketService } from './chart-stream-socket.service';
import { environment } from '../../environments/environment';
import type {
  ChartSessionSnapshot,
  ChartStreamEvent,
  StartStreamRequest,
} from './chart-stream.models';

/**
 * Switching the candlestick overlay on must never be silent.
 *
 * The bug this pins: a chart with no boxes on it looks exactly the same
 * whether the request is still out, came back with nothing above the
 * confidence floor, or failed outright. A reader who presses the toggle and
 * sees an unchanged chart has no way to tell which — and the first report of
 * it was exactly that, "no candlestick is visible despite selection", with no
 * way from the screen to find out why.
 *
 * So the toggle reports its own outcome, and these tests are what keep it
 * reporting. They also cover the wiring end to end, which nothing else did:
 * the menu row, the request, and the answer reaching the chart.
 */

@Component({
  standalone: true,
  imports: [ChartStreamComponent],
  template: `
    <app-chart-stream
      [request]="request()"
      [sessionId]="sessionId()"
      [label]="'NIFTY 24350 CE'"
      [leg]="null"
      [displaySeconds]="60"
    />
  `,
})
class HostComponent {
  readonly chart = viewChild.required(ChartStreamComponent);
  readonly request = signal<StartStreamRequest | null>(null);
  readonly sessionId = signal<string | null>(null);
}

const REQUEST: StartStreamRequest = {
  mode: 'TEST',
  instrument: { type: 'CE', underlying: 'NIFTY', strike: 24350, expiry: '2026-08-25' },
  interval: '1minute',
  date: '2026-08-14',
  replaySpeed: 30,
};

const SNAPSHOT: ChartSessionSnapshot = {
  sessionId: 'sess-1',
  mode: 'TEST',
  status: 'RUNNING',
  instrumentKey: 'NSE_FO|54321',
  interval: '1minute',
  date: '2026-08-14',
  startedAt: '2026-08-14T03:45:00.000Z',
  error: null,
};

const OPEN_MS = Date.parse('2026-08-14T03:45:00.000Z');

const candle = (timestamp: number, close: number): ChartStreamEvent =>
  ({
    type: 'CANDLE',
    sessionId: 'sess-1',
    timestamp,
    emittedAt: timestamp,
    instrumentKey: 'NSE_FO|54321',
    timeframe: '1minute',
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1200,
    openInterest: 45_000,
    vwap: null,
    isSyntheticGap: false,
  }) as ChartStreamEvent;

/** An answer with `count` hits, all anchored to bars the chart is drawing. */
function answer(count: number) {
  const at = (i: number) => OPEN_MS + (10 + i) * 60_000;
  return {
    interval: '1minute',
    timeframe: '1m',
    barsAnalysed: 39,
    from: OPEN_MS,
    to: OPEN_MS + 38 * 60_000,
    patternsFound: count,
    issues: 0,
    labels: { bullish_engulfing: 'Bullish engulfing' },
    hits: Array.from({ length: count }, (_, i) => ({
      id: `bullish_engulfing@${at(i)}`,
      primary: 'bullish_engulfing',
      patterns: ['bullish_engulfing'],
      startTime: at(i) - 60_000,
      endTime: at(i),
      barCount: 2,
      candleType: 'full_body',
      candleTypeId: 11,
      direction: 1,
      sizeClass: 'normal',
      trendState: 'down',
      directionContext: 'BEARISH',
      reversalBias: 'BULLISH',
      confidence: 85,
      breakdown: { base: 50, context: 20, extreme: 15, geometry: 0, followThrough: 0 },
      status: 'pending',
      confirmationTime: null,
      confirmationLevel: 120,
      patternHigh: 120,
      patternLow: 110,
      atLocalExtreme: true,
    })),
  };
}

describe('candlestick overlay feedback', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let http: HttpTestingController;
  let events: Subject<ChartStreamEvent>;

  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** Opens the overlay menu and clicks the candlestick row. */
  async function pressCandles(): Promise<void> {
    if (!root().querySelector('.menu')) {
      (root().querySelector('.ind > button') as HTMLButtonElement).click();
      fixture.detectChanges();
    }
    const rows = [...root().querySelectorAll('.menu .opt')] as HTMLElement[];
    const row = rows.find((r) => (r.textContent ?? '').includes('Candlesticks'));
    (row?.querySelector('input') as HTMLInputElement).click();
    await settle();
  }

  /** The candlestick row's own note: a count, an ellipsis, or a failure mark. */
  const rowNote = (): string => {
    const rows = [...root().querySelectorAll('.menu .opt')] as HTMLElement[];
    const row = rows.find((r) => (r.textContent ?? '').includes('Candlesticks'));
    return (row?.querySelector('.opt-note')?.textContent ?? '').trim();
  };

  beforeEach(async () => {
    // The toggle is persisted per browser, so without this one test switching
    // it on decides the starting state of the next.
    window.localStorage.removeItem('autotrader.chart.showCandlePatterns');
    events = new Subject<ChartStreamEvent>();
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ChartStreamSocketService,
          useValue: { connect: () => events.asObservable() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    host.request.set(REQUEST);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBase}/streamer/stream/start`).flush(SNAPSHOT);
    fixture.detectChanges();

    for (let i = 0; i < 40; i++) events.next(candle(OPEN_MS + i * 60_000, 100 + i));
    await settle();
  });

  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    window.localStorage.removeItem('autotrader.chart.showCandlePatterns');
  });

  const pending = () => http.match((r) => r.url.includes('candle-patterns'));

  it('asks the candlestick endpoint for the bars on screen', async () => {
    await pressCandles();

    const requests = pending();
    expect(requests.length).toBe(1);

    const body = requests[0]!.request.body as Record<string, unknown>;
    expect(requests[0]!.request.url).toBe(`${environment.apiBase}/strategy/candle-patterns`);
    expect(body['interval']).toBe('1minute');
    // The forming bar is never sent: forty arrived, thirty-nine have closed.
    expect((body['bars'] as unknown[]).length).toBe(39);
    // The instrument rides along so the backend can warm up behind the first bar.
    expect(body['instrument']).toEqual(jasmine.objectContaining({ underlying: 'NIFTY' }));

    requests[0]!.flush(answer(0));
  });

  it('shows what it found when it finds something', async () => {
    await pressCandles();
    pending()[0]!.flush(answer(3));
    await settle();

    expect(host.chart().candlePatterns().length).toBe(3);
    expect(rowNote()).toBe('3');
  });

  /**
   * The state that used to be indistinguishable from a broken feature.
   *
   * Nothing cleared the confidence floor, which is a real answer about a quiet
   * stretch of chart — and it has to read as one rather than as an unmarked
   * chart.
   */
  it('says it found nothing rather than saying nothing', async () => {
    await pressCandles();
    pending()[0]!.flush(answer(0));
    await settle();

    expect(rowNote()).toBe('0');
    expect(host.chart().candlePatternsError()).toBeNull();
  });

  it('says so when the request fails, without hiding it in a tooltip', async () => {
    await pressCandles();
    pending()[0]!.flush(
      { error: { code: 'VALIDATION_ERROR', message: 'bars must be strictly ascending by time' } },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle();

    expect(host.chart().candlePatternsError()).toContain('ascending');
    expect(rowNote()).toBe('!');
    // And on the closed control, so a failure is visible without opening it.
    const badge = root().querySelector('.ind > button .badge') as HTMLElement;
    expect(badge.textContent?.trim()).toBe('!');
    expect(badge.classList).toContain('bad');
  });

  /* --- the band above the chart, which is where a reader is looking ---- */

  /** The candlestick summary band's text, or null when it is not drawn. */
  const band = (): string | null => {
    const el = root().querySelector('.candle-band') as HTMLElement | null;
    return el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
  };

  it('draws no band while the overlay is off', () => {
    // An unmarked chart explains itself here: nothing was asked for.
    expect(band()).toBeNull();
  });

  it('says it is working while the answer is out', async () => {
    await pressCandles();
    expect(band()).toContain('reading the bars');
    pending()[0]!.flush(answer(0));
  });

  /**
   * The defect, stated as the sentence that fixes it.
   *
   * A chart with no boxes and no explanation is indistinguishable from a
   * broken feature. Naming the floor and the number of bars turns it into an
   * answer a reader can act on — by lowering the floor, or by believing it.
   */
  it('explains an empty chart instead of leaving it silent', async () => {
    await pressCandles();
    pending()[0]!.flush(answer(0));
    await settle();

    const text = band();
    expect(text).toContain('nothing scored');
    // The two facts that make it actionable rather than merely reassuring.
    expect(text).toContain('75');
    expect(text).toContain('39 bars');
  });

  it('summarises what it found, split by direction', async () => {
    await pressCandles();
    pending()[0]!.flush(answer(3));
    await settle();

    const text = band();
    expect(text).toContain('3 patterns');
    // Every hit in the fixture is bullish.
    expect(text).toContain('▲ 3');
    expect(text).not.toContain('▼');
  });

  it('shows the failure above the chart, as the other overlays do', async () => {
    await pressCandles();
    pending()[0]!.flush(
      { error: { code: 'NOT_FOUND', message: 'Cannot POST /strategy/candle-patterns' } },
      { status: 404, statusText: 'Not Found' },
    );
    await settle();

    // The band steps aside: the banner states it more plainly.
    expect(band()).toBeNull();
    const banners = [...root().querySelectorAll('.error')].map((e) => e.textContent ?? '');
    expect(banners.some((t) => t.includes('Cannot POST'))).toBe(true);
  });

  it('reports nothing at all while the overlay is off', async () => {
    // Never switched on: an unmarked chart explains itself here.
    (root().querySelector('.ind > button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(rowNote()).toBe('');
  });

  /**
   * The bug that made the overlay look broken, as the scenario that caused it.
   *
   * Every closed bar is a new question, so on a live chart or a paced replay a
   * bar reliably arrives before the answer to the last one does. The first
   * design cancelled the in-flight request each time a new one was due, which
   * meant that under any real feed no request ever landed and the chart stayed
   * unmarked for the whole session.
   *
   * The request in flight must therefore survive bars closing underneath it.
   */
  it('lets a request land while bars keep closing under it', async () => {
    await pressCandles();
    const first = pending();
    expect(first.length).toBe(1);

    // Twenty more bars close while the answer is still out.
    for (let i = 40; i < 60; i++) events.next(candle(OPEN_MS + i * 60_000, 100 + i));
    await settle();

    // Not cancelled, and not joined by a pile of rivals.
    expect(first[0]!.cancelled).toBe(false);
    expect(pending().length).toBe(0);

    first[0]!.flush(answer(2));
    await settle();

    // The answer reached the chart.
    expect(host.chart().candlePatterns().length).toBe(2);

    // And exactly one follow-up covers everything that closed meanwhile —
    // one pass over the current window describes all twenty bars.
    const followUp = pending();
    expect(followUp.length).toBe(1);
    expect((followUp[0]!.request.body as { bars: unknown[] }).bars.length).toBe(59);

    // While that is out the row honestly reads as busy rather than as a count
    // that is already stale.
    expect(rowNote()).toBe('…');

    followUp[0]!.flush(answer(2));
    await settle();
    expect(rowNote()).toBe('2');
    // It settles: the follow-up does not spawn a follow-up of its own.
    expect(pending().length).toBe(0);
  });

  it('retries after a failure rather than staying silent', async () => {
    await pressCandles();
    pending()[0]!.flush(
      { error: { code: 'INTERNAL', message: 'boom' } },
      { status: 500, statusText: 'Server Error' },
    );
    await settle();

    // A new closed bar is a new question, and the failed key was forgotten.
    events.next(candle(OPEN_MS + 40 * 60_000, 141));
    await settle();

    expect(pending().length).toBe(1);
  });
});
