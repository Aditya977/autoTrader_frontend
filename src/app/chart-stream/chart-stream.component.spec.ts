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
  SupportResistanceLevel,
} from './chart-stream.models';
import type { SimTrade } from '../strategy/strategy.models';

@Component({
  standalone: true,
  imports: [ChartStreamComponent],
  template: `<app-chart-stream
    [request]="request()"
    [sessionId]="sessionId()"
    [trades]="trades()"
    [label]="label()"
    [leg]="leg()"
    [displaySeconds]="displaySeconds()"
  />`,
})
class HostComponent {
  readonly chart = viewChild.required(ChartStreamComponent);
  readonly request = signal<StartStreamRequest | null>(null);
  readonly sessionId = signal<string | null>(null);
  readonly trades = signal<readonly SimTrade[]>([]);
  readonly label = signal('NIFTY 24350 CE');
  readonly leg = signal<'CE' | 'PE' | null>('CE');
  readonly displaySeconds = signal(60);
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

/** 09:15 IST on the replayed day. */
const OPEN_MS = Date.parse('2026-08-14T03:45:00.000Z');
const MINUTE = 60_000;

const candle = (timestamp: number, close: number, volume = 1200): ChartStreamEvent => ({
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
  volume,
  openInterest: 45_000,
  isSyntheticGap: false,
});

describe('ChartStreamComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let http: HttpTestingController;
  /** `sess-1`'s stream — the session every test here starts on. */
  let events: Subject<ChartStreamEvent>;
  /**
   * One stream per session id, so a test can push to a session the component
   * has moved *off*. A single shared subject cannot show that: the buffer keys
   * bars by time, so a stale subscription re-adding the same bar is idempotent
   * and a leak looks exactly like correct behaviour.
   */
  let streams: Map<string, Subject<ChartStreamEvent>>;

  /**
   * Runs the session and settles the batched redraw.
   *
   * Candle frames are coalesced into one redraw per microtask, so a test that
   * asserts straight after `events.next` reads the state from before the
   * redraw — the same reason the component batches at all: an instant replay
   * arrives as one burst of hundreds of frames.
   */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function startSession(): void {
    host.request.set(REQUEST);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBase}/streamer/stream/start`).flush(SNAPSHOT);
    fixture.detectChanges();
  }

  const text = (): string => fixture.nativeElement.textContent as string;
  // Named, not positional: the header holds two buttons now (Stop and the S/R
  // toggle), and `.state button` would silently start meaning whichever
  // happens to be first in the template.
  const stopButton = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('.state button.stop') as HTMLButtonElement;

  beforeEach(async () => {
    streams = new Map<string, Subject<ChartStreamEvent>>();
    const streamFor = (sessionId: string): Subject<ChartStreamEvent> => {
      let stream = streams.get(sessionId);
      if (!stream) {
        stream = new Subject<ChartStreamEvent>();
        streams.set(sessionId, stream);
      }
      return stream;
    };
    events = streamFor('sess-1');

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ChartStreamSocketService,
          useValue: { connect: (id: string) => streamFor(id).asObservable() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  it('mounts a lightweight-charts canvas into the host element', () => {
    const chartHost = fixture.nativeElement.querySelector('.chart') as HTMLElement;
    expect(chartHost.querySelector('canvas')).toBeTruthy();
  });

  it('shows idle, the label and the leg badge before any session has started', () => {
    expect((fixture.nativeElement.querySelector('.status') as HTMLElement).textContent).toContain(
      'idle',
    );
    expect((fixture.nativeElement.querySelector('.leg') as HTMLElement).textContent).toContain(
      'CE',
    );
    expect(text()).toContain('NIFTY 24350 CE');
  });

  it('starts itself when the request input arrives, with no call from the parent', () => {
    // The parent renders panels from a list; a panel that appears because a
    // second leg was selected has to start without being reached into.
    host.request.set(REQUEST);
    fixture.detectChanges();

    const request = http.expectOne(`${environment.apiBase}/streamer/stream/start`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(REQUEST);
    request.flush(SNAPSHOT);
  });

  it('renders the session snapshot and disables Stop once terminal', () => {
    startSession();

    expect(text()).toContain('running');
    expect(text()).toContain('NSE_FO|54321');
    expect(stopButton().disabled).toBeFalse();

    events.next({ type: 'SESSION_COMPLETED', sessionId: 'sess-1', timestamp: 1 });
    fixture.detectChanges();

    expect(text()).toContain('completed');
    expect(stopButton().disabled).toBeTrue();
  });

  it('counts each distinct bar once even when the backlog replays', async () => {
    startSession();

    events.next(candle(OPEN_MS, 100));
    events.next(candle(OPEN_MS + MINUTE, 101));
    // Reconnect: the whole series is re-sent before any new bar.
    events.next(candle(OPEN_MS, 100));
    events.next(candle(OPEN_MS + MINUTE, 101));
    events.next(candle(OPEN_MS + 2 * MINUTE, 102));
    await settle();

    expect(text()).toContain('3 bars');
  });

  it('re-buckets on screen when the display interval changes, without a new session', async () => {
    startSession();
    for (let i = 0; i < 5; i++) events.next(candle(OPEN_MS + i * MINUTE, 100 + i));
    await settle();
    expect(text()).toContain('5 bars');

    host.displaySeconds.set(300);
    fixture.detectChanges();
    await settle();

    // One five-minute bar, and — the point of resampling client-side — no
    // second call to the backend.
    expect(text()).toContain('1 bars');
    http.expectNone(`${environment.apiBase}/streamer/stream/start`);
  });

  it('reads out the newest bar with its IST time when nothing is hovered', async () => {
    startSession();
    events.next(candle(OPEN_MS, 100));
    events.next(candle(OPEN_MS + MINUTE, 104));
    await settle();

    const readout = fixture.nativeElement.querySelector('.readout') as HTMLElement;
    // 09:16 IST, not the 03:46 UTC the timestamp literally is.
    expect(readout.textContent).toContain('09:16');
    expect(readout.textContent).toContain('14 Aug 2026');
    // O/H/L/C of that bar: close 104 → open 103, high 106, low 102.
    expect(readout.textContent).toContain('103.00');
    expect(readout.textContent).toContain('106.00');
    expect(readout.textContent).toContain('102.00');
    expect(readout.textContent).toContain('104.00');
  });

  it('shows no floating tooltip until a bar is actually hovered', async () => {
    startSession();
    events.next(candle(OPEN_MS, 100));
    await settle();

    expect(fixture.nativeElement.querySelector('.tooltip')).toBeNull();
  });

  it('surfaces a SESSION_ERROR message to the user', () => {
    startSession();

    events.next({
      type: 'SESSION_ERROR',
      sessionId: 'sess-1',
      timestamp: 1,
      message: 'Upstream feed disconnected',
    });
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('.error') as HTMLElement).textContent).toContain(
      'Upstream feed disconnected',
    );
  });

  it('flattens validation issues from a failed start into one message', () => {
    host.request.set(REQUEST);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBase}/streamer/stream/start`).flush(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          issues: [{ path: 'interval', message: 'LIVE accepts 1minute only' }],
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('.error') as HTMLElement).textContent).toContain(
      'interval: LIVE accepts 1minute only',
    );
  });

  it('clears the previous series when the same instrument is started again', async () => {
    startSession();
    events.next(candle(OPEN_MS, 100));
    await settle();
    expect(text()).toContain('1 bars');

    // A new object identity for the same instrument: pressing Start again is a
    // deliberate restart, not a no-op.
    host.request.set({ ...REQUEST });
    fixture.detectChanges();
    await settle();

    expect(text()).toContain('0 bars');
    http.expectOne(`${environment.apiBase}/streamer/stream/start`).flush(SNAPSHOT);
  });

  it('posts to the stop endpoint with the running session id', () => {
    startSession();

    stopButton().click();

    const req = http.expectOne(`${environment.apiBase}/streamer/stream/sess-1/stop`);
    expect(req.request.method).toBe('POST');
    req.flush({ ...SNAPSHOT, status: 'STOPPED' });
  });

  /**
   * Attaching to a session somebody else started.
   *
   * This is how a strategy simulation and the chart under it end up on the same
   * bars: the simulation has to start the session itself (it must be subscribed
   * before the replay publishes anything), so the panel is handed the id rather
   * than starting a second session over the same instrument.
   */
  describe('adopting an existing session', () => {
    it('does not start a session of its own', () => {
      host.sessionId.set('sess-1');
      fixture.detectChanges();

      http.expectNone(`${environment.apiBase}/streamer/stream/start`);
      http.expectOne(`${environment.apiBase}/streamer/stream/sess-1`).flush(SNAPSHOT);
    });

    it('draws the bars that arrive on the adopted session', async () => {
      host.sessionId.set('sess-1');
      fixture.detectChanges();
      http.expectOne(`${environment.apiBase}/streamer/stream/sess-1`).flush(SNAPSHOT);

      events.next(candle(OPEN_MS, 100));
      events.next(candle(OPEN_MS + MINUTE, 101));
      await settle();

      expect(host.chart().barCount()).toBe(2);
    });

    // The socket is opened before the status call returns, deliberately: the
    // backend replays the whole candle backlog to every connection, and waiting
    // on a round trip first is a window in which live bars are missed.
    it('still charts the session when the status call fails', async () => {
      host.sessionId.set('sess-1');
      fixture.detectChanges();
      http
        .expectOne(`${environment.apiBase}/streamer/stream/sess-1`)
        .flush({}, { status: 500, statusText: 'Server Error' });

      events.next(candle(OPEN_MS, 100));
      await settle();

      expect(host.chart().barCount()).toBe(1);
      expect(host.chart().error()).toBeNull();
    });

    it('takes the status from the socket, which is the authority', async () => {
      host.sessionId.set('sess-1');
      fixture.detectChanges();
      http.expectOne(`${environment.apiBase}/streamer/stream/sess-1`).flush(SNAPSHOT);

      events.next({ type: 'SESSION_STATUS', ...SNAPSHOT, status: 'COMPLETED' } as never);
      await settle();

      expect(text()).toContain('completed');
    });

    it('ignores a repeat of the id it is already showing', () => {
      host.sessionId.set('sess-1');
      fixture.detectChanges();
      http.expectOne(`${environment.apiBase}/streamer/stream/sess-1`).flush(SNAPSHOT);

      // A parent re-rendering must not tear the chart down and refetch.
      host.sessionId.set('sess-1');
      fixture.detectChanges();
      http.expectNone(`${environment.apiBase}/streamer/stream/sess-1`);
    });

    it('drops the previous session stream when it moves to another one', async () => {
      // A still-open socket from the last session would keep filling the buffer
      // the new one just emptied — two instruments interleaved on one chart.
      // Invisible for a finished replay, whose socket completes on its own; the
      // cases that break are a paced replay restarted mid-flight, and LIVE.
      host.sessionId.set('sess-1');
      fixture.detectChanges();
      http.expectOne(`${environment.apiBase}/streamer/stream/sess-1`).flush(SNAPSHOT);

      events.next(candle(OPEN_MS, 100));
      await settle();
      expect(host.chart().barCount()).toBe(1);

      host.sessionId.set('sess-2');
      fixture.detectChanges();
      http
        .expectOne(`${environment.apiBase}/streamer/stream/sess-2`)
        .flush({ ...SNAPSHOT, sessionId: 'sess-2' });

      // Pushed onto the session the panel has left. If its subscription is
      // still alive this bar lands in the buffer the new session owns.
      events.next(candle(OPEN_MS + 5 * MINUTE, 200));
      await settle();

      // `sess-2` has published nothing, so the chart is empty — and stays empty
      // however loudly `sess-1` keeps talking.
      expect(host.chart().barCount()).toBe(0);

      const current = streams.get('sess-2');
      current?.next({ ...(candle(OPEN_MS, 300) as object), sessionId: 'sess-2' } as never);
      await settle();
      expect(host.chart().barCount()).toBe(1);
    });

    it('takes the adopted session over a request, never both', () => {
      host.request.set(REQUEST);
      host.sessionId.set('sess-1');
      fixture.detectChanges();

      // Starting one as well would put a second replay of the same instrument
      // beside marks that belong to the first.
      http.expectNone(`${environment.apiBase}/streamer/stream/start`);
      http.expectOne(`${environment.apiBase}/streamer/stream/sess-1`).flush(SNAPSHOT);
    });
  });
});

describe('ChartStreamComponent — support & resistance', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let http: HttpTestingController;
  let events: Subject<ChartStreamEvent>;

  /** A request that asks the backend to plot levels along with the chart. */
  const REQUEST_WITH_LEVELS: StartStreamRequest = {
    ...REQUEST,
    levels: { method: 'swing', interval: '1minute', maxLevels: 6, minTouches: 2 },
  };

  const LEVELS: SupportResistanceLevel[] = [
    {
      price: 98,
      kind: 'SUPPORT',
      source: 'SWING',
      label: '',
      touches: 3,
      strength: 0.72,
      bandLow: 97.9,
      bandHigh: 98.1,
      firstTouchMs: OPEN_MS,
      lastTouchMs: OPEN_MS + 10 * MINUTE,
    },
    {
      price: 104,
      kind: 'RESISTANCE',
      source: 'SWING',
      label: '',
      touches: 2,
      strength: 0.5,
      bandLow: 103.9,
      bandHigh: 104.1,
      firstTouchMs: OPEN_MS,
      lastTouchMs: OPEN_MS + 8 * MINUTE,
    },
  ];

  const levelsEvent = (interval = '1minute'): ChartStreamEvent => ({
    type: 'LEVELS',
    sessionId: 'sess-1',
    timestamp: OPEN_MS,
    instrumentKey: 'NSE_FO|54321',
    tradingsymbol: 'NIFTY24AUG24350CE',
    interval: interval as StartStreamRequest['interval'],
    referencePrice: 101,
    barsAnalysed: 500,
    from: '2026-08-13T03:45:00.000Z',
    to: '2026-08-14T09:59:00.000Z',
    levels: LEVELS,
    pivotBasis: null,
  });

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function startSession(request: StartStreamRequest): void {
    host.request.set(request);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBase}/streamer/stream/start`).flush(SNAPSHOT);
    fixture.detectChanges();
  }

  const text = (): string => fixture.nativeElement.textContent as string;
  const levelsButton = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('.state button.sr') as HTMLButtonElement;
  const levelsBar = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('.levels') as HTMLElement | null;

  beforeEach(async () => {
    events = new Subject<ChartStreamEvent>();

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ChartStreamSocketService, useValue: { connect: () => events.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  it('draws the levels a session pushes, with no request of its own', async () => {
    startSession(REQUEST_WITH_LEVELS);
    events.next(levelsEvent());
    await settle();

    // Nearest resistance above and nearest support below — the pair that
    // matters right now, not a list of everything already on the chart.
    expect(levelsBar()).toBeTruthy();
    expect(text()).toContain('104.00');
    expect(text()).toContain('98.00');
    expect(text()).toContain('2 levels on 1m');
  });

  it('ignores a set found on an interval the chart is not drawing', async () => {
    // The backend keeps publishing at the interval the session was started
    // with; drawn over 15-minute bars, one-minute levels describe turns that
    // are not on screen.
    startSession(REQUEST_WITH_LEVELS);
    events.next(levelsEvent('15minute'));
    await settle();

    expect(levelsBar()).toBeNull();
  });

  it('leaves a chart that did not ask for levels un-annotated', async () => {
    startSession(REQUEST);
    events.next(candle(OPEN_MS, 100));
    await settle();

    expect(levelsBar()).toBeNull();
  });

  it('fetches this session own levels when S/R is pressed', async () => {
    startSession(REQUEST);

    levelsButton().click();
    fixture.detectChanges();

    // The session endpoint, not the standalone one: the lines have to describe
    // the series this chart is drawing.
    const request = http.expectOne(
      (r) => r.url === `${environment.apiBase}/streamer/stream/sess-1/levels`,
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('interval')).toBe('1minute');
    request.flush({
      instrumentKey: 'NSE_FO|54321',
      tradingsymbol: 'NIFTY24AUG24350CE',
      interval: '1minute',
      referencePrice: 101,
      barsAnalysed: 500,
      from: null,
      to: null,
      levels: LEVELS,
      pivotBasis: null,
    });
    await settle();

    expect(text()).toContain('2 levels on 1m');
  });

  it('reuses the tuning the session was started with for an on-demand fetch', async () => {
    // Otherwise a chart configured for pivots would quietly fall back to the
    // defaults the moment it had to re-ask, and show a different set of lines
    // than the one that was asked for.
    startSession({
      ...REQUEST,
      levels: { method: 'both', maxLevels: 4, swingLookback: 6, refreshEveryBars: 20 },
    });
    // A session started with `levels` is pushed them over the socket, so
    // nothing is fetched until the chart needs a set it does not hold — here,
    // because the displayed interval changed.
    host.displaySeconds.set(300);
    fixture.detectChanges();

    const request = http.expectOne(
      (r) => r.url === `${environment.apiBase}/streamer/stream/sess-1/levels`,
    );
    expect(request.request.params.get('method')).toBe('both');
    expect(request.request.params.get('maxLevels')).toBe('4');
    expect(request.request.params.get('swingLookback')).toBe('6');
    // Session-only fields never belong on this query.
    expect(request.request.params.has('refreshEveryBars')).toBeFalse();
    // …and `interval` is the displayed one, not the one the session was
    // started with.
    expect(request.request.params.get('interval')).toBe('5minute');
    request.flush({
      instrumentKey: 'NSE_FO|54321',
      tradingsymbol: 'NIFTY24AUG24350CE',
      interval: '5minute',
      referencePrice: 101,
      barsAnalysed: 10,
      from: null,
      to: null,
      levels: [],
      pivotBasis: null,
    });
    await settle();
  });

  it('hides the lines again without another request, then restores them', async () => {
    startSession(REQUEST_WITH_LEVELS);
    events.next(levelsEvent());
    await settle();
    expect(levelsBar()).toBeTruthy();

    levelsButton().click();
    await settle();
    expect(levelsBar()).toBeNull();

    // Back on: the held set is still current for this interval, so nothing is
    // fetched — `http.verify()` in afterEach is what proves it.
    levelsButton().click();
    await settle();
    expect(levelsBar()).toBeTruthy();
  });

  it('re-asks for levels when the display interval changes', async () => {
    startSession(REQUEST_WITH_LEVELS);
    events.next(levelsEvent());
    await settle();

    host.displaySeconds.set(300);
    fixture.detectChanges();

    const request = http.expectOne(
      (r) => r.url === `${environment.apiBase}/streamer/stream/sess-1/levels`,
    );
    expect(request.request.params.get('interval')).toBe('5minute');
    request.flush({
      instrumentKey: 'NSE_FO|54321',
      tradingsymbol: 'NIFTY24AUG24350CE',
      interval: '5minute',
      referencePrice: 101,
      barsAnalysed: 100,
      from: null,
      to: null,
      levels: LEVELS,
      pivotBasis: { date: '2026-08-13', high: 110, low: 90, close: 100 },
    });
    await settle();

    expect(text()).toContain('2 levels on 5m');
    expect(text()).toContain('pivots from 2026-08-13');
  });

  it('reports a levels failure without claiming the chart itself failed', async () => {
    startSession(REQUEST);

    levelsButton().click();
    fixture.detectChanges();

    http
      .expectOne((r) => r.url === `${environment.apiBase}/streamer/stream/sess-1/levels`)
      .flush(
        { error: { code: 'UPSTREAM_ERROR', message: 'historical data unavailable' } },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await settle();

    expect(text()).toContain('Support/resistance unavailable');
    // The bars are fine, so the session must not read as failed.
    expect(text()).toContain('running');
  });
});
