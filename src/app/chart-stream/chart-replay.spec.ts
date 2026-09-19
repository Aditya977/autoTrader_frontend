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
 * The replay cursor: drawing a session that has already arrived, one bar at a
 * time, and putting it back exactly as it was.
 *
 * This is what makes a paper trade watchable rather than a foregone
 * conclusion — at the default replay speed the whole day is on screen within a
 * second of pressing Start, so a simulation running over it would be animating
 * numbers beside a chart that has already shown the ending.
 *
 * The property worth protecting is that truncation is **non-destructive**: the
 * buffer is never touched, so clearing the cursor restores the full session
 * without refetching anything. Every test below is a way of saying that.
 */
@Component({
  standalone: true,
  imports: [ChartStreamComponent],
  template: `<app-chart-stream
    [request]="request()"
    [displaySeconds]="displaySeconds()"
    [playbackUntilMs]="playbackUntilMs()"
  />`,
})
class HostComponent {
  readonly chart = viewChild.required(ChartStreamComponent);
  readonly request = signal<StartStreamRequest | null>(null);
  readonly displaySeconds = signal(60);
  readonly playbackUntilMs = signal<number | null>(null);
}

const REQUEST: StartStreamRequest = {
  mode: 'TEST',
  instrument: { type: 'CE', underlying: 'NIFTY', strike: 24350, expiry: '2026-08-25' },
  interval: '1minute',
  date: '2026-08-14',
  replaySpeed: 0,
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
const BARS = 30;

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
  vwap: null,
  isSyntheticGap: false,
});

describe('ChartStreamComponent replay cursor', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let http: HttpTestingController;
  let events: Subject<ChartStreamEvent>;

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The whole day, delivered at once — the instant replay this exists for. */
  async function streamWholeDay(): Promise<void> {
    host.request.set(REQUEST);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBase}/streamer/stream/start`).flush(SNAPSHOT);
    fixture.detectChanges();

    for (let i = 0; i < BARS; i++) events.next(candle(OPEN_MS + i * MINUTE, 100 + i));
    await settle();
  }

  const drawnBars = (): number => host.chart().barCount();

  async function setCursor(at: number | null): Promise<void> {
    host.playbackUntilMs.set(at);
    await settle();
  }

  beforeEach(async () => {
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
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  it('draws the whole session when there is no cursor', async () => {
    await streamWholeDay();
    expect(drawnBars()).toBe(BARS);
  });

  it('rewinds to the open, so the day has not happened yet', async () => {
    await streamWholeDay();
    await setCursor(OPEN_MS - 1);

    // Nothing of the session is drawn — the chart is back at 09:15 with the
    // ending no longer on screen.
    expect(drawnBars()).toBe(0);
  });

  it('advances one bar at a time as the cursor moves', async () => {
    await streamWholeDay();

    await setCursor(OPEN_MS);
    expect(drawnBars()).toBe(1);

    await setCursor(OPEN_MS + 9 * MINUTE);
    expect(drawnBars()).toBe(10);

    await setCursor(OPEN_MS + 19 * MINUTE);
    expect(drawnBars()).toBe(20);
  });

  it('restores the full session when the cursor is cleared', async () => {
    await streamWholeDay();
    await setCursor(OPEN_MS + 5 * MINUTE);
    expect(drawnBars()).toBe(6);

    await setCursor(null);

    // The whole point: stopping costs nothing and refetches nothing, because
    // the buffer behind the chart was never touched.
    expect(drawnBars()).toBe(BARS);
    http.verify();
  });

  it('survives being rewound repeatedly', async () => {
    await streamWholeDay();

    for (const bar of [10, 3, 25, 1]) {
      await setCursor(OPEN_MS + (bar - 1) * MINUTE);
      expect(drawnBars()).toBe(bar);
    }

    await setCursor(null);
    expect(drawnBars()).toBe(BARS);
  });

  it('cuts at the same instant after a timeframe change, not the same bar count', async () => {
    await streamWholeDay();
    // Ten one-minute bars from the open.
    await setCursor(OPEN_MS + 9 * MINUTE);
    expect(drawnBars()).toBe(10);

    // The same ten minutes is two five-minute bars. A cursor applied as a bar
    // *count* would keep ten of them and show fifty minutes of a day the
    // replay has not reached.
    host.displaySeconds.set(300);
    await settle();
    expect(drawnBars()).toBe(2);
  });

  it('draws nothing at all for a cursor before the session', async () => {
    await streamWholeDay();
    await setCursor(OPEN_MS - 60 * MINUTE);
    expect(drawnBars()).toBe(0);
    expect(host.chart().empty()).toBe(true);
  });

  it('keeps bars arriving after the cursor out of the drawn series', async () => {
    await streamWholeDay();
    await setCursor(OPEN_MS + 4 * MINUTE);
    expect(drawnBars()).toBe(5);

    // A late bar lands in the buffer while the replay is mid-session. It must
    // not appear on screen ahead of the cursor.
    events.next(candle(OPEN_MS + BARS * MINUTE, 200));
    await settle();
    expect(drawnBars()).toBe(5);

    // And it is genuinely in the buffer, not dropped.
    await setCursor(null);
    expect(drawnBars()).toBe(BARS + 1);
  });
});
