import { Component, viewChild } from '@angular/core';
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
  template: `<app-chart-stream />`,
})
class HostComponent {
  readonly chart = viewChild.required(ChartStreamComponent);
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

const candle = (timestamp: number, close: number): ChartStreamEvent => ({
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
  isSyntheticGap: false,
});

describe('ChartStreamComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let http: HttpTestingController;
  let events: Subject<ChartStreamEvent>;

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

  it('shows idle before any session has started', () => {
    expect((fixture.nativeElement.querySelector('.status') as HTMLElement).textContent).toContain(
      'idle',
    );
  });

  it('renders the session snapshot returned by start and disables Stop when terminal', () => {
    host.chart().start(REQUEST);
    http.expectOne(`${environment.apiBase}/streamer/stream/start`).flush(SNAPSHOT);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(fixture.nativeElement.textContent).toContain('RUNNING');
    expect(fixture.nativeElement.textContent).toContain('NSE_FO|54321');
    expect(button.disabled).toBeFalse();

    events.next({ type: 'SESSION_COMPLETED', sessionId: 'sess-1', timestamp: 1 });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('COMPLETED');
    expect(button.disabled).toBeTrue();
  });

  it('counts each distinct bar once even when the backlog replays', () => {
    host.chart().start(REQUEST);
    http.expectOne(`${environment.apiBase}/streamer/stream/start`).flush(SNAPSHOT);

    events.next(candle(1_755_000_000_000, 100));
    events.next(candle(1_755_000_060_000, 101));
    // Reconnect: the whole series is re-sent before any new bar.
    events.next(candle(1_755_000_000_000, 100));
    events.next(candle(1_755_000_060_000, 101));
    events.next(candle(1_755_000_120_000, 102));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('3 bars');
  });

  it('surfaces a SESSION_ERROR message to the user', () => {
    host.chart().start(REQUEST);
    http.expectOne(`${environment.apiBase}/streamer/stream/start`).flush(SNAPSHOT);

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
    host.chart().start(REQUEST);
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

  it('clears the previous series and error when a new session starts', () => {
    host.chart().start(REQUEST);
    http.expectOne(`${environment.apiBase}/streamer/stream/start`).flush(SNAPSHOT);
    events.next(candle(1_755_000_000_000, 100));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1 bars');

    host.chart().start(REQUEST);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('0 bars');
    http.expectOne(`${environment.apiBase}/streamer/stream/start`).flush(SNAPSHOT);
  });

  it('posts to the stop endpoint with the running session id', () => {
    host.chart().start(REQUEST);
    http.expectOne(`${environment.apiBase}/streamer/stream/start`).flush(SNAPSHOT);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();

    const req = http.expectOne(`${environment.apiBase}/streamer/stream/sess-1/stop`);
    expect(req.request.method).toBe('POST');
    req.flush({ ...SNAPSHOT, status: 'STOPPED' });
  });
});
