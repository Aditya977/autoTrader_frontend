# Angular integration guide — chart-streaming API

Practical companion to [`FRONTEND_INTEGRATION.md`](./FRONTEND_INTEGRATION.md).

That document is the **contract**: every endpoint, every field, every status
code. This one is the **implementation** — copy-pasteable Angular services,
the chart wiring, and the handful of details that will cost you an afternoon
if you meet them by surprise.

Written for the existing app's conventions: one API service per backend
surface, models mirroring the backend, TradingView Lightweight Charts for
rendering.

## Contents

1. [The mental model](#1-the-mental-model)
2. [Models](#2-models)
3. [REST service](#3-rest-service)
4. [WebSocket service](#4-websocket-service)
5. [Chart wiring](#5-chart-wiring)
6. [A complete component](#6-a-complete-component)
7. [Auth (Live mode only)](#7-auth-live-mode-only)
8. [Gotchas that will bite](#8-gotchas-that-will-bite)

---

## 1. The mental model

Four steps, always the same for both modes:

```
POST /streamer/stream/start   ──►  { sessionId, status: 'RUNNING', ... }
        │
        ▼
WS   /streamer/stream/{sessionId}/ws
        │
        ├──►  SESSION_STATUS   (once, on connect — current state)
        ├──►  CANDLE × N       (the whole series so far, then live as produced)
        └──►  SESSION_COMPLETED | SESSION_STOPPED | SESSION_ERROR
        │
        ▼
POST /streamer/stream/{sessionId}/stop   (optional for TEST — it ends itself)
```

The single most important property: **the WebSocket sends every candle the
session has produced so far, in order, before any new one.** You are never
required to connect "in time". Connect whenever, reconnect whenever — you
always get the complete series. The cost is that a reconnect re-sends bars
you already have, which is why [§5](#5-chart-wiring) insists you key bars by
time rather than appending them.

`LIVE` and `TEST` emit the identical `CANDLE` shape. One chart component
serves both; nothing downstream of the socket needs to know the mode.

---

## 2. Models

Mirror the backend exactly. `src/app/chart-stream/chart-stream.models.ts`:

```ts
export type ChartSessionMode = 'LIVE' | 'TEST';

export type ChartSessionStatus =
  'STARTING' | 'RUNNING' | 'COMPLETED' | 'STOPPED' | 'ERROR';

export type ChartInterval =
  | '1minute'
  | '3minute'
  | '5minute'
  | '15minute'
  | '30minute'
  | '1hour'
  | '1day';

export type InstrumentType = 'INDEX' | 'EQUITY' | 'FUTURE' | 'CE' | 'PE';

export interface InstrumentRequest {
  type: InstrumentType;
  underlying: string;
  /** Required for CE / PE. */
  strike?: number;
  /** Required for FUTURE / CE / PE. `YYYY-MM-DD`. */
  expiry?: string;
}

export interface ResolvedInstrument {
  instrumentKey: string;
  tradingsymbol: string;
  instrumentType: string;
  underlyingSymbol: string;
  strike: number | null;
  expiryDate: string | null;
  lotSize: number;
  tickSize: number;
}

export interface StartStreamRequest {
  mode: ChartSessionMode;
  instrument: InstrumentRequest;
  interval: ChartInterval;
  /** TEST only. `YYYY-MM-DD`. */
  date?: string;
  /** TEST only. 0 = as fast as possible, 1 = real recorded pace. */
  replaySpeed?: number;
}

export interface ChartSessionSnapshot {
  sessionId: string;
  mode: ChartSessionMode;
  status: ChartSessionStatus;
  instrumentKey: string;
  interval: ChartInterval;
  date: string | null;
  startedAt: string;
  error: string | null;
}

export interface ChartCandleEvent {
  type: 'CANDLE';
  sessionId: string;
  /** Bar OPEN time, epoch MILLISECONDS UTC. This is the x-axis value. */
  timestamp: number;
  /** Wall-clock instant the event was published. Rarely needed. */
  emittedAt: number;
  instrumentKey: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number | null;
  isSyntheticGap: boolean;
}

/** Sent once, immediately on connect. Carries the snapshot, not a timestamp. */
export interface ChartSessionStatusEvent extends ChartSessionSnapshot {
  type: 'SESSION_STATUS';
}

export interface ChartLifecycleEvent {
  type: 'SESSION_STARTED' | 'SESSION_COMPLETED' | 'SESSION_STOPPED';
  sessionId: string;
  timestamp: number;
}

export interface ChartErrorEvent {
  type: 'SESSION_ERROR';
  sessionId: string;
  timestamp: number;
  message: string;
}

export type ChartStreamEvent =
  | ChartCandleEvent
  | ChartSessionStatusEvent
  | ChartLifecycleEvent
  | ChartErrorEvent;

/** Shape of every non-2xx response body. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Present only for VALIDATION_ERROR (HTTP 400). */
    issues?: { path: string; message: string }[];
  };
}

export const TERMINAL_STATUSES: readonly ChartSessionStatus[] = [
  'COMPLETED',
  'STOPPED',
  'ERROR',
];
```

---

## 3. REST service

`src/app/chart-stream/chart-stream-api.service.ts`:

```ts
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import type {
  ApiErrorBody,
  ChartSessionSnapshot,
  InstrumentRequest,
  ResolvedInstrument,
  StartStreamRequest,
} from './chart-stream.models';

/** A backend error, already unwrapped from the `{ error: {...} }` envelope. */
export class ChartStreamError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
    readonly status = 0,
  ) {
    super(message);
    this.name = 'ChartStreamError';
  }

  /** Validation messages keyed by field path, for form highlighting. */
  get byField(): Record<string, string> {
    return Object.fromEntries(this.issues.map((i) => [i.path, i.message]));
  }
}

@Injectable({ providedIn: 'root' })
export class ChartStreamApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBase; // e.g. 'http://localhost:3000'

  expiries(
    underlying: string,
  ): Observable<{ underlying: string; expiries: string[] }> {
    return this.http
      .get<{ underlying: string; expiries: string[] }>(
        `${this.base}/streamer/instruments/expiries`,
        { params: { underlying } },
      )
      .pipe(catchError(this.unwrap));
  }

  resolve(instrument: InstrumentRequest): Observable<ResolvedInstrument> {
    return this.http
      .post<ResolvedInstrument>(
        `${this.base}/streamer/instruments/resolve`,
        instrument,
      )
      .pipe(catchError(this.unwrap));
  }

  start(request: StartStreamRequest): Observable<ChartSessionSnapshot> {
    return this.http
      .post<ChartSessionSnapshot>(`${this.base}/streamer/stream/start`, request)
      .pipe(catchError(this.unwrap));
  }

  stop(sessionId: string): Observable<ChartSessionSnapshot> {
    return this.http
      .post<ChartSessionSnapshot>(
        `${this.base}/streamer/stream/${sessionId}/stop`,
        {},
      )
      .pipe(catchError(this.unwrap));
  }

  status(sessionId: string): Observable<ChartSessionSnapshot> {
    return this.http
      .get<ChartSessionSnapshot>(`${this.base}/streamer/stream/${sessionId}`)
      .pipe(catchError(this.unwrap));
  }

  /** Every endpoint above returns the same error envelope; unwrap it once, here. */
  private readonly unwrap = (response: HttpErrorResponse) => {
    const body = response.error as ApiErrorBody | null;
    const error = body?.error;
    return throwError(
      () =>
        new ChartStreamError(
          error?.code ?? 'NETWORK_ERROR',
          error?.message ?? response.message,
          error?.issues ?? [],
          response.status,
        ),
    );
  };
}
```

Every `message` the backend returns is safe to show a user — no token,
secret or credential is ever included in an error body.

---

## 4. WebSocket service

Plain `WebSocket` — the backend speaks RFC 6455, so no Socket.IO or other
client library is involved.

`src/app/chart-stream/chart-stream-socket.service.ts`:

```ts
import { Injectable, NgZone, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  TERMINAL_STATUSES,
  type ChartStreamEvent,
} from './chart-stream.models';

@Injectable({ providedIn: 'root' })
export class ChartStreamSocketService {
  private readonly zone = inject(NgZone);

  /**
   * Events for one session, with automatic reconnect.
   *
   * Completes on a terminal event (COMPLETED / STOPPED / ERROR) and on
   * unsubscribe. Reconnects on an unexpected drop — the backend re-sends the
   * full candle backlog each time, so no bar is lost, but see §5: the
   * consumer must key bars by time rather than appending them.
   */
  connect(sessionId: string): Observable<ChartStreamEvent> {
    return new Observable<ChartStreamEvent>((subscriber) => {
      let socket: WebSocket | null = null;
      let closedByUs = false;
      let attempt = 0;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;

      const url =
        `${environment.apiBase.replace(/^http/, 'ws')}` +
        `/streamer/stream/${sessionId}/ws`;

      const open = () => {
        socket = new WebSocket(url);

        socket.onopen = () => {
          attempt = 0;
        };

        socket.onmessage = (message) => {
          let event: ChartStreamEvent;
          try {
            event = JSON.parse(message.data as string) as ChartStreamEvent;
          } catch {
            return; // never let a malformed frame kill the stream
          }

          // Angular change detection: WebSocket callbacks are outside the zone.
          this.zone.run(() => subscriber.next(event));

          const done =
            event.type === 'SESSION_COMPLETED' ||
            event.type === 'SESSION_STOPPED' ||
            event.type === 'SESSION_ERROR' ||
            (event.type === 'SESSION_STATUS' &&
              TERMINAL_STATUSES.includes(event.status));

          if (done) {
            closedByUs = true;
            socket?.close(1000, 'session finished');
            this.zone.run(() => subscriber.complete());
          }
        };

        socket.onclose = () => {
          if (closedByUs) return;
          // Capped exponential backoff: 1s, 2s, 4s, 8s, 10s, 10s…
          const delay = Math.min(1000 * 2 ** attempt++, 10_000);
          retryTimer = setTimeout(open, delay);
        };

        socket.onerror = () => {
          // `onclose` always follows; reconnect is handled there so the two
          // paths cannot both fire a retry.
          socket?.close();
        };
      };

      open();

      return () => {
        closedByUs = true;
        clearTimeout(retryTimer);
        socket?.close(1000, 'unsubscribed');
      };
    });
  }
}
```

Closing the socket does **not** stop the session — that is deliberate, so a
transient network blip does not destroy a running replay. Call
`api.stop(sessionId)` when you actually mean it.

---

## 5. Chart wiring

Two conversions stand between the event and a drawn candle. Both are silent
failures if you skip them.

**Time is milliseconds; Lightweight Charts wants seconds.** `timestamp` is
epoch ms (it lines up with `Date`, `Intl`, and every other JS time API).
Lightweight Charts' `UTCTimestamp` is epoch **seconds**. Pass ms straight in
and your bars land somewhere around the year 58,000 — the chart renders, it
is simply empty where you are looking.

**Bars repeat; do not append.** The backlog replays on every connect and
reconnect. `series.update()` throws if a bar's time goes backwards relative
to the last one, so a reconnect would crash a naive implementation. Keep a
`Map` keyed by time and `setData()` the sorted values.

```ts
import {
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { ChartCandleEvent } from './chart-stream.models';

/** The whole ms → s conversion, in one place. */
export const toChartTime = (epochMs: number): UTCTimestamp =>
  Math.floor(epochMs / 1000) as UTCTimestamp;

export class CandleSeriesBuffer {
  private readonly bars = new Map<number, CandlestickData<UTCTimestamp>>();

  /** Idempotent: the same bar arriving twice replaces, never duplicates. */
  add(event: ChartCandleEvent): void {
    const time = toChartTime(event.timestamp);
    this.bars.set(time, {
      time,
      open: event.open,
      high: event.high,
      low: event.low,
      close: event.close,
    });
  }

  /** Ascending by time — what `setData` requires. */
  snapshot(): CandlestickData<UTCTimestamp>[] {
    return [...this.bars.values()].sort(
      (a, b) => (a.time as number) - (b.time as number),
    );
  }

  clear(): void {
    this.bars.clear();
  }
}
```

Then, on each event:

```ts
buffer.add(candle);
series.setData(buffer.snapshot());
```

`setData` on every bar is fine for a trading day — 375 one-minute bars is
nothing. If you later stream something far longer, switch to `update()` for
bars newer than the last drawn one and keep `setData` for the initial
backlog; the `Map` already gives you the information to tell them apart.

**Series creation differs by major version.** Lightweight Charts v5 replaced
the per-type helpers with a single `addSeries`:

```ts
// v4
const series = chart.addCandlestickSeries();

// v5
import { CandlestickSeries } from 'lightweight-charts';
const series = chart.addSeries(CandlestickSeries);
```

Check the version in `package.json` rather than guessing — the v4 call
simply does not exist in v5, and vice versa.

---

## 6. A complete component

Standalone component, signals, `takeUntilDestroyed` — the modern Angular
idiom. Trim to taste.

```ts
import {
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
  effect,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import {
  ChartStreamApiService,
  ChartStreamError,
} from './chart-stream-api.service';
import { ChartStreamSocketService } from './chart-stream-socket.service';
import { CandleSeriesBuffer } from './candle-series-buffer';
import type {
  ChartSessionSnapshot,
  StartStreamRequest,
} from './chart-stream.models';

@Component({
  selector: 'app-chart-stream',
  standalone: true,
  template: `
    <div class="toolbar">
      <span>{{ session()?.status ?? 'idle' }}</span>
      <span>{{ session()?.instrumentKey }}</span>
      <button (click)="stop()" [disabled]="!canStop()">Stop</button>
    </div>
    @if (error(); as message) {
      <div class="error">{{ message }}</div>
    }
    <div #chartHost class="chart"></div>
  `,
})
export class ChartStreamComponent {
  private readonly api = inject(ChartStreamApiService);
  private readonly socket = inject(ChartStreamSocketService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly chartHost =
    viewChild.required<ElementRef<HTMLDivElement>>('chartHost');
  private chart?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;
  private readonly buffer = new CandleSeriesBuffer();

  readonly session = signal<ChartSessionSnapshot | null>(null);
  readonly error = signal<string | null>(null);
  readonly canStop = () =>
    this.session()?.status === 'RUNNING' ||
    this.session()?.status === 'STARTING';

  constructor() {
    effect(() => {
      if (this.chart) return;
      this.chart = createChart(this.chartHost().nativeElement, {
        autoSize: true,
      });
      this.series = this.chart.addCandlestickSeries(); // v5: addSeries(CandlestickSeries)
    });
  }

  start(request: StartStreamRequest): void {
    this.error.set(null);
    this.buffer.clear();
    this.series?.setData([]);

    this.api
      .start(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          this.session.set(snapshot);
          this.listen(snapshot.sessionId);
        },
        error: (e: ChartStreamError) => this.error.set(this.describe(e)),
      });
  }

  stop(): void {
    const id = this.session()?.sessionId;
    if (!id) return;
    this.api
      .stop(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (snapshot) => this.session.set(snapshot) });
  }

  private listen(sessionId: string): void {
    this.socket
      .connect(sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        switch (event.type) {
          case 'CANDLE':
            this.buffer.add(event);
            this.series?.setData(this.buffer.snapshot());
            break;
          case 'SESSION_STATUS':
            this.session.set(event);
            break;
          case 'SESSION_ERROR':
            this.error.set(event.message);
            break;
          case 'SESSION_COMPLETED':
          case 'SESSION_STOPPED':
            this.session.update((s) =>
              s
                ? {
                    ...s,
                    status:
                      event.type === 'SESSION_COMPLETED'
                        ? 'COMPLETED'
                        : 'STOPPED',
                  }
                : s,
            );
            break;
        }
      });
  }

  private describe(e: ChartStreamError): string {
    return e.issues.length
      ? e.issues.map((i) => `${i.path}: ${i.message}`).join('; ')
      : e.message;
  }
}
```

Starting a historical option chart is then:

```ts
this.start({
  mode: 'TEST',
  instrument: {
    type: 'CE',
    underlying: 'NIFTY',
    strike: 24350,
    expiry: '2026-08-25',
  },
  interval: '1minute',
  date: '2026-08-14',
  replaySpeed: 30,
});
```

---

## 7. Auth (Live mode only)

**Test Mode needs no login at all** — the historical endpoint the backend
reads is public, including for option contracts. Build and ship the entire
historical-charting feature before anyone obtains Upstox credentials.

Only `mode: 'LIVE'` requires OAuth. A `LIVE` start without a session returns
`401` with code `AuthError`.

`GET /streamer/auth/login` is a **browser navigation**, not an XHR — it
`302`s to Upstox. Two workable shapes:

```ts
// Full-page redirect. Backend must have AUTH_SUCCESS_REDIRECT_URL set so
// the user lands back on your route.
login(): void {
  window.location.href = `${environment.apiBase}/streamer/auth/login`;
}

// Popup + poll. Leave the backend's *_REDIRECT_URL vars unset.
loginViaPopup(): Observable<boolean> {
  window.open(`${environment.apiBase}/streamer/auth/login`, 'upstox', 'width=520,height=700');
  return interval(1500).pipe(
    switchMap(() => this.http.get<{ authenticated: boolean }>(
      `${environment.apiBase}/streamer/auth/status`)),
    map((s) => s.authenticated),
    first((authenticated) => authenticated),
    timeout(120_000),
  );
}
```

Check `GET /streamer/auth/status` before offering Live mode. Tokens expire
daily at 03:30 IST, so a session that worked yesterday will not work today —
handle `AuthError` by re-prompting the login rather than treating it as
fatal.

The frontend never sees, stores or forwards an access token.

---

## 8. Gotchas that will bite

|                                                         |                                                                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`timestamp` is milliseconds**                         | Lightweight Charts wants seconds. Divide by 1000. Your chart will look empty, not broken.                                                                                            |
| **Bars repeat on reconnect**                            | The full backlog re-sends. Key by time and `setData`; never blind-`update()`, which throws on a backwards time.                                                                      |
| **`SESSION_STARTED` may already have fired**            | It is not replayed. Drive your UI from `SESSION_STATUS` (sent on every connect) and the REST snapshot.                                                                               |
| **Index volume is always 0**                            | An index carries no traded volume on the wire. A volume histogram is meaningful for options and futures, flat for `INDEX`.                                                           |
| **`openInterest` is `null` for an index**               | Null means "this instrument has none", not "missing". Do not render it as 0.                                                                                                         |
| **`isSyntheticGap: true`**                              | A minute with no trades, synthesised flat at the previous close so the series has no holes. Render it; consider styling it differently.                                              |
| **`LIVE` only accepts `interval: '1minute'`**           | Anything else is a `400`. Aggregate coarser bars client-side from the 1-minute stream.                                                                                               |
| **Expiries roll**                                       | Always populate pickers from `GET /streamer/instruments/expiries`. Never hardcode — the instrument master refreshes and contracts expire.                                            |
| **`date` is `TEST`-only, `replaySpeed` is `TEST`-only** | Sending either with `LIVE` is a `400`, not an ignored field.                                                                                                                         |
| **`EQUITY` always fails**                               | Accepted by the schema, rejected at resolution (`422`) — this deployment's instrument master syncs only the configured index/derivative underlyings. Show the message; do not retry. |
| **`404` on the WebSocket upgrade**                      | The `sessionId` is unknown or was pruned (terminal sessions are dropped after ~30 min). Start a new session.                                                                         |
| **Backend must be started with `API_ENABLED=true`**     | It is headless by default. A connection-refused on every call usually means this, not a URL typo.                                                                                    |

---

## Related

- [`FRONTEND_INTEGRATION.md`](./FRONTEND_INTEGRATION.md) — the full contract:
  every endpoint, request/response shape, error format, and an explicit list
  of what this backend does not do.
- [`.env.example`](./.env.example) — the backend configuration these
  endpoints depend on.
