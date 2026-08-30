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

@Component({
  standalone: true,
  imports: [ChartStreamComponent],
  template: `<app-chart-stream
    [request]="request()"
    [label]="label()"
    [leg]="leg()"
    [displaySeconds]="displaySeconds()"
  />`,
})
class HostComponent {
  readonly chart = viewChild.required(ChartStreamComponent);
  readonly request = signal<StartStreamRequest | null>(null);
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
  let events: Subject<ChartStreamEvent>;

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
  const stopButton = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('.state button') as HTMLButtonElement;

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

  it('mounts a lightweight-charts canvas into the host element', () => {
    const chartHost = fixture.nativeElement.querySelector('.chart') as HTMLElement;
    expect(chartHost.querySelector('canvas')).toBeTruthy();
  });

  it('shows idle, the label and the leg badge before any session has started', () => {
    expect((fixture.nativeElement.querySelector('.status') as HTMLElement).textContent).toContain(
      'idle',
    );
    expect((fixture.nativeElement.querySelector('.leg') as HTMLElement).textContent).toContain('CE');
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
});
