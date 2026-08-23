import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import type {
  ApiErrorBody,
  ChartSessionSnapshot,
  InstrumentRequest,
  OptionChain,
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

  /** Every underlying this backend synced — the first picker's options. */
  underlyings(): Observable<{ underlyings: string[] }> {
    return this.http
      .get<{ underlyings: string[] }>(`${this.base}/streamer/instruments/underlyings`)
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
