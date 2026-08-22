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
| `src/app/chart-stream/chart-stream-auth.service.ts`   | Upstox OAuth — needed for `LIVE` only.                      |
| `src/app/chart-stream/candle-series-buffer.ts`        | ms → s conversion and the time-keyed bar buffer.            |
| `src/app/chart-stream/chart-stream.component.ts`      | The chart itself; `start(request)` is its entry point.      |
| `src/app/chart-stream/chart-stream-page.component.ts` | The instrument/interval form that drives it.                |

## Two details that fail silently

**Timestamps are milliseconds; Lightweight Charts wants seconds.** All of that
conversion lives in `toChartTime()`. Pass ms straight through and bars land
around the year 58,000 — the chart renders, it is simply empty where you are
looking.

**Bars repeat.** The socket re-sends every candle the session has produced so
far on each connect _and_ each reconnect, so `CandleSeriesBuffer` keys bars by
time and the component calls `setData()` with the sorted values.
`series.update()` throws when a bar's time goes backwards, so a reconnect would
crash an append-only implementation.

## Modes

`TEST` needs no login — the historical endpoint the backend reads is public,
including for option contracts. Only `LIVE` requires Upstox OAuth, accepts
`interval: '1minute'` only, and rejects `date` / `replaySpeed` with a `400`
rather than ignoring them. `ChartStreamPageComponent` shapes the request
accordingly.

Expiry pickers are always populated from `GET /streamer/instruments/expiries`;
never hardcode them, as the instrument master refreshes and contracts expire.

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
