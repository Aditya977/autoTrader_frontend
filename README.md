# autoTrader frontend

Angular 20 frontend for the autoTrader chart-streaming backend. Implements the
integration described in
[`docs/FRONTEND_ANGULAR_INTEGRATION.md`](./docs/FRONTEND_ANGULAR_INTEGRATION.md).

## Quick start

```bash
npm install
npm start          # http://localhost:4200 → redirects to /chart
```

The backend must be running on the origin configured in
`src/environments/environment.development.ts` (default `http://localhost:3000`),
and must be started with `API_ENABLED=true` — it is headless by default, and a
connection-refused on every call usually means this rather than a URL typo.

## Layout

| Path                                                  | What it is                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `src/app/chart-stream/chart-stream.models.ts`         | Wire types, mirroring the backend contract exactly.         |
| `src/app/chart-stream/chart-stream-api.service.ts`    | REST surface; unwraps the `{ error: {...} }` envelope once. |
| `src/app/chart-stream/chart-stream-socket.service.ts` | The session WebSocket, with capped-backoff reconnect.       |
| `src/app/auth/`                                       | Upstox OAuth: login page, route guards, `401` interceptor.  |
| `src/app/chart-stream/chart-time.ts`                  | ms → s, IST labels, and the bucket anchor for resampling.   |
| `src/app/chart-stream/candle-series-buffer.ts`        | The time-keyed bar buffer, and resampling to any timeframe. |
| `src/app/chart-stream/chart-stream.component.ts`      | One chart panel; it starts itself from its `request` input. |
| `src/app/chart-stream/chart-stream-page.component.ts` | The instrument form, and the panels it lays out.            |

## Three details that fail silently

**Timestamps are milliseconds; Lightweight Charts wants seconds.** All of that
conversion lives in `toChartTime()`. Pass ms straight through and bars land
around the year 58,000 — the chart renders, it is simply empty where you are
looking.

**Bars repeat.** The socket re-sends every candle the session has produced so
far on each connect _and_ each reconnect, so `CandleSeriesBuffer` keys bars by
time and the component calls `setData()` with the sorted values.
`series.update()` throws when a bar's time goes backwards, so a reconnect would
crash an append-only implementation.

**A terminal `SESSION_STATUS` is not the end of the stream.** It is the first
frame on the socket, ahead of the candle backlog, and for an instant replay
(`replaySpeed: 0`) it already reads `COMPLETED` because the session really has
finished. `ChartStreamSocketService` completes only on an explicit
`SESSION_COMPLETED` / `SESSION_STOPPED` / `SESSION_ERROR`, which the backend
sends _after_ the backlog. Completing on the status frame closed the socket
before a single bar arrived, and the symptom was the worst kind: a chart that
drew nothing, looking exactly like a backend that had sent nothing.

## Auth

**Every data endpoint needs a login — `TEST` mode included.** Instrument lists,
option chains and both stream modes are read from Upstox with the signed-in
user's own session; there is no anonymous mode and no public-data fallback, so
an unauthenticated app renders a page whose every request `401`s. An earlier
backend did serve historical data publicly — `UpstoxSessionGuard` closed that
in `debb67e`.

`authGuard` keeps `/chart` behind a session and `authInterceptor` turns a `401`
from anywhere into a trip back to `/login`: tokens expire daily at 03:30 IST, so
a session can end mid-visit, long after the guard has passed. The frontend never
sees, stores or forwards an access token — it navigates the browser to
`/streamer/auth/login` and asks `/streamer/auth/status` whether that worked.

The backend needs `UPSTOX_CLIENT_ID`, `UPSTOX_CLIENT_SECRET`,
`UPSTOX_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` and `AUTH_SUCCESS_REDIRECT_URL`
set for this to work; `GET /streamer/auth/login` answers `500 ConfigError`
naming the missing ones until they are.

## Modes

`LIVE` accepts `interval: '1minute'` only and rejects `date` / `replaySpeed`
with a `400` rather than ignoring them; `TEST` requires `date`.
`ChartStreamPageComponent` shapes the request accordingly.

Expiry pickers are always populated from `GET /streamer/instruments/expiries`;
never hardcode them, as the instrument master refreshes and contracts expire.

## Timeframes are a display concern

The wire timeframe is **always `1minute`** in both modes. The chart resamples
that series on screen (`CandleSeriesBuffer.resampled`), so the interval buttons
re-bucket the bars already in memory instead of restarting the session — and
`LIVE` gets every interval for free, despite the backend's live candle builder
only ever producing one-minute bars.

Buckets are anchored to the 09:15 IST open, not to the epoch, so a 5-minute
chart runs 09:15 / 09:20 / 09:25 the way every other Indian chart does. Bars
stay real UTC instants; only their labels are IST. Both rules live in
`chart-time.ts`.

## Two legs at once

Picking a call **and** a put runs two sessions side by side, off the same date,
speed and history — the point being to watch both legs of a strategy unfold
together. They are two independent backend sessions rather than one: a session
streams a single instrument key anyway, and keeping them separate means one leg
failing to resolve leaves the other charting. In `LIVE` mode each also opens
its own upstream Upstox socket, so this is not free — two is fine, twenty is
not.

## Scripts

```bash
npm start          # dev server
npm run build      # production bundle into dist/
npm test           # unit tests, watch mode
npm run test:ci    # unit tests, headless, single run
```

Karma launches headless Chromium with `--no-sandbox` (see `karma.conf.js`),
which containers generally need. Point `CHROME_BIN` at a Chromium binary if the
launcher cannot find one:

```bash
CHROME_BIN=/path/to/chromium npm run test:ci
```
