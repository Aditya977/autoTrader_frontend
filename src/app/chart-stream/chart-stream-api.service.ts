import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import type {
  ChartRetests,
  ApiErrorBody,
  ChartLevels,
  ChartSessionSnapshot,
  InstrumentRequest,
  LevelsRequest,
  OptionChain,
  PreviousDayRangeRequest,
  PreviousDayRangeResponse,
  ResolvedInstrument,
  RetestsRequest,
  SessionLevelsQuery,
  SessionRetestsQuery,
  StartStreamRequest,
} from './chart-stream.models';
import type {
  EventLogIngestResult,
  MarketEngineRequest,
  MarketEngineResearchRequest,
  MarketEngineResult,
  ParityCheckResult,
  SessionMarketEngineQuery,
  ValidationResult,
} from '../market-engine/market-engine.models';

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

  /**
   * The two symbol lists this backend synced, kept apart.
   *
   * `underlyings` is what can be charted and traded — an index with a chain
   * behind it, which is what the picker beside the expiry and strike fields
   * needs. `equities` is research data: a stock has no expiry and no strikes,
   * so it can only be *captured*, and it belongs to the backtest tab's capture
   * form rather than to this one.
   */
  underlyings(): Observable<{ underlyings: string[]; equities: string[] }> {
    return this.http
      .get<{ underlyings: string[]; equities: string[] }>(
        `${this.base}/streamer/instruments/underlyings`,
      )
      .pipe(catchError(this.unwrap));
  }

  /**
   * The call and put ladders for one underlying/expiry.
   *
   * Both legs come back in one request on purpose: the strike pickers sit side
   * by side, and two requests could straddle two instrument-master syncs.
   */
  chain(underlying: string, expiry: string, pricedOn?: string): Observable<OptionChain> {
    return this.http
      .get<OptionChain>(`${this.base}/streamer/instruments/chain`, {
        // `date` is what turns on pricing. Omitted, the ladder comes back
        // instantly; supplied, the backend prices the near-the-money strikes,
        // which costs it one upstream request per contract.
        params: pricedOn ? { underlying, expiry, date: pricedOn } : { underlying, expiry },
      })
      .pipe(catchError(this.unwrap));
  }

  expiries(underlying: string): Observable<{ underlying: string; expiries: string[] }> {
    return this.http
      .get<{
        underlying: string;
        expiries: string[];
      }>(`${this.base}/streamer/instruments/expiries`, { params: { underlying } })
      .pipe(catchError(this.unwrap));
  }

  resolve(instrument: InstrumentRequest): Observable<ResolvedInstrument> {
    return this.http
      .post<ResolvedInstrument>(`${this.base}/streamer/instruments/resolve`, instrument)
      .pipe(catchError(this.unwrap));
  }

  start(request: StartStreamRequest): Observable<ChartSessionSnapshot> {
    return this.http
      .post<ChartSessionSnapshot>(`${this.base}/streamer/stream/start`, request)
      .pipe(catchError(this.unwrap));
  }

  stop(sessionId: string): Observable<ChartSessionSnapshot> {
    return this.http
      .post<ChartSessionSnapshot>(`${this.base}/streamer/stream/${sessionId}/stop`, {})
      .pipe(catchError(this.unwrap));
  }

  status(sessionId: string): Observable<ChartSessionSnapshot> {
    return this.http
      .get<ChartSessionSnapshot>(`${this.base}/streamer/stream/${sessionId}`)
      .pipe(catchError(this.unwrap));
  }

  /**
   * Support and resistance for an instrument, in one call — no session needed.
   *
   * For annotating a chart that is not streaming, or for asking about an
   * instrument before charting it at all.
   */
  levels(request: LevelsRequest): Observable<ChartLevels> {
    return this.http
      .post<ChartLevels>(`${this.base}/streamer/stream/levels`, request)
      .pipe(catchError(this.unwrap));
  }

  /**
   * The same, found in the bars **this session has published** — the series
   * actually on screen — with prior sessions folded in behind them.
   *
   * Works on any session, including one started without `levels` and one that
   * has already finished, so a user who decides mid-replay that they want the
   * lines does not have to restart it.
   */
  sessionLevels(sessionId: string, query: SessionLevelsQuery = {}): Observable<ChartLevels> {
    // Only the fields actually set: every one has a backend default, and an
    // `undefined` serialised as the string "undefined" is a 400.
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params[key] = String(value);
    }

    return this.http
      .get<ChartLevels>(`${this.base}/streamer/stream/${sessionId}/levels`, { params })
      .pipe(catchError(this.unwrap));
  }

  /**
   * Every retest of every level found for one instrument.
   *
   * The companion to {@link levels}: levels say where the lines are, retests
   * say what happened when price came back to them.
   */
  retests(request: RetestsRequest): Observable<ChartRetests> {
    return this.http
      .post<ChartRetests>(`${this.base}/streamer/stream/retests`, request)
      .pipe(catchError(this.unwrap));
  }

  /**
   * The same, found in the bars **this session has published**.
   *
   * Works on any session, including one that has already finished — which is
   * exactly when someone who has watched a replay through wants to know which
   * of its levels actually held.
   */
  sessionRetests(sessionId: string, query: SessionRetestsQuery = {}): Observable<ChartRetests> {
    // Only the fields actually set, for the same reason as `sessionLevels`:
    // every one has a backend default, and an `undefined` serialised as the
    // string "undefined" is a 400.
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params[key] = String(value);
    }

    return this.http
      .get<ChartRetests>(`${this.base}/streamer/stream/${sessionId}/retests`, { params })
      .pipe(catchError(this.unwrap));
  }

  /**
   * The multi-timeframe engine's reading of an instrument.
   *
   * The third member of the {@link levels}/{@link retests} family and asked the
   * same way, with one difference worth noticing: no `interval`. Levels and
   * retests are found *on* the bar size the chart is drawing; the engine reads
   * five timeframes at once by definition, and `chartSet` picks which five.
   */
  marketEngine(request: MarketEngineRequest): Observable<MarketEngineResult> {
    return this.http
      .post<MarketEngineResult>(`${this.base}/streamer/stream/market-engine`, request)
      .pipe(catchError(this.unwrap));
  }

  /**
   * The same reading, over the bars **this session has published**.
   *
   * Bounded by the session's own clock server-side, which for this endpoint is
   * the whole guarantee rather than a nicety: a replay half way through a day
   * must be read as of that moment, not with the afternoon it has not reached.
   */
  sessionMarketEngine(
    sessionId: string,
    query: SessionMarketEngineQuery = {},
  ): Observable<MarketEngineResult> {
    // Only the fields actually set, for the same reason as `sessionLevels`:
    // every one has a backend default, and an `undefined` serialised as the
    // string "undefined" is a 400.
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params[key] = String(value);
    }

    return this.http
      .get<MarketEngineResult>(`${this.base}/streamer/stream/${sessionId}/market-engine`, {
        params,
      })
      .pipe(catchError(this.unwrap));
  }

  /**
   * Walks a window and appends its engine events to the stored log.
   *
   * Idempotent server-side: event ids are content hashes, so pressing this
   * twice on the same session writes nothing the second time.
   */
  ingestEngineEvents(request: MarketEngineResearchRequest): Observable<EventLogIngestResult> {
    return this.http
      .post<EventLogIngestResult>(`${this.base}/streamer/stream/market-engine/log`, request)
      .pipe(catchError(this.unwrap));
  }

  /**
   * Replays one session and diffs it against the stored log.
   *
   * `date` is required: parity is a statement about one session, and the
   * backend refuses to default it rather than pass silently on an empty day.
   */
  checkEngineParity(
    request: MarketEngineResearchRequest & { date: string },
  ): Observable<ParityCheckResult> {
    return this.http
      .post<ParityCheckResult>(`${this.base}/streamer/stream/market-engine/parity`, request)
      .pipe(catchError(this.unwrap));
  }

  /**
   * Forward behaviour of every engine label against a time-of-day matched
   * baseline. Slow on purpose — it walks a long window.
   */
  validateEngine(
    request: MarketEngineResearchRequest & { seed?: number },
  ): Observable<ValidationResult> {
    return this.http
      .post<ValidationResult>(`${this.base}/streamer/stream/market-engine/validate`, request)
      .pipe(catchError(this.unwrap));
  }

  /**
   * PDH/PDL/mid per trading day, from each day's actual 1D candle.
   *
   * Session-independent like {@link levels}, and fetched once rather than
   * watched: the numbers come from days that have already closed, so nothing
   * about them can change while the chart is open.
   */
  previousDayRange(request: PreviousDayRangeRequest): Observable<PreviousDayRangeResponse> {
    return this.http
      .post<PreviousDayRangeResponse>(`${this.base}/streamer/stream/previous-day-range`, request)
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
