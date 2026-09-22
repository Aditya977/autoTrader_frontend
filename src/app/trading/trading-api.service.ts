import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ChartStreamError } from '../chart-stream/chart-stream-api.service';
import type { ApiErrorBody, InstrumentRequest } from '../chart-stream/chart-stream.models';
import type {
  BacktestRunSummary,
  DashboardOverview,
  DashboardPerformance,
  DashboardTrade,
  LiveSessionSnapshot,
  RunBacktestRequest,
  StartLiveTradingRequest,
  StrategyEntries,
  TradeHistoryQuery,
  TradeMode,
} from './trading.models';

/**
 * Live trading, backtests and the dashboard figures — the backend's
 * `/strategy/live`, `/strategy/backtest` and `/strategy/dashboard` routes.
 *
 * Errors are unwrapped into {@link ChartStreamError}, like the rest of the
 * app's API clients, because they arrive in the same envelope.
 */
@Injectable({ providedIn: 'root' })
export class TradingApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBase;

  startLive(request: StartLiveTradingRequest): Observable<LiveSessionSnapshot> {
    return this.http
      .post<LiveSessionSnapshot>(`${this.base}/strategy/live/start`, request)
      .pipe(catchError(this.unwrap));
  }

  stopLive(sessionId: string): Observable<LiveSessionSnapshot> {
    return this.http
      .post<LiveSessionSnapshot>(`${this.base}/strategy/live/${sessionId}/stop`, {})
      .pipe(catchError(this.unwrap));
  }

  /** Takes one instrument out of a running session; the others keep trading. */
  removeInstrument(sessionId: string, instrumentKey: string): Observable<LiveSessionSnapshot> {
    return this.http
      .post<LiveSessionSnapshot>(`${this.base}/strategy/live/${sessionId}/instruments/remove`, {
        instrumentKey,
      })
      .pipe(catchError(this.unwrap));
  }

  /** Deletes backtest history — every run, or one. Live history is never touched. */
  clearBacktests(runId?: string): Observable<{ deleted: number }> {
    const params = runId ? new HttpParams().set('runId', runId) : new HttpParams();
    return this.http
      .delete<{ deleted: number }>(`${this.base}/strategy/backtest/trades`, { params })
      .pipe(catchError(this.unwrap));
  }

  liveSessions(): Observable<{ sessions: LiveSessionSnapshot[] }> {
    return this.http
      .get<{ sessions: LiveSessionSnapshot[] }>(`${this.base}/strategy/live`)
      .pipe(catchError(this.unwrap));
  }

  /**
   * The entries the backend's live engine would take on one instrument on one
   * day — computed from closed bars only, by the Trading Dashboard's code.
   */
  entries(request: {
    strategyId: string;
    instrument: InstrumentRequest;
    date: string;
  }): Observable<StrategyEntries> {
    return this.http
      .post<StrategyEntries>(`${this.base}/strategy/signals/entries`, request)
      .pipe(catchError(this.unwrap));
  }

  runBacktest(request: RunBacktestRequest): Observable<BacktestRunSummary> {
    return this.http
      .post<BacktestRunSummary>(`${this.base}/strategy/backtest/run`, request)
      .pipe(catchError(this.unwrap));
  }

  overview(
    mode: TradeMode,
    capital?: number | null,
    runId?: string,
  ): Observable<DashboardOverview> {
    let params = new HttpParams().set('mode', mode);
    if (capital) params = params.set('capital', String(capital));
    if (runId) params = params.set('runId', runId);
    return this.http
      .get<DashboardOverview>(`${this.base}/strategy/dashboard/overview`, { params })
      .pipe(catchError(this.unwrap));
  }

  performance(
    mode: TradeMode,
    from?: string | null,
    to?: string | null,
    runId?: string,
  ): Observable<DashboardPerformance> {
    let params = new HttpParams().set('mode', mode);
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    if (runId) params = params.set('runId', runId);
    return this.http
      .get<DashboardPerformance>(`${this.base}/strategy/dashboard/performance`, { params })
      .pipe(catchError(this.unwrap));
  }

  trades(query: TradeHistoryQuery): Observable<{ trades: DashboardTrade[] }> {
    let params = new HttpParams().set('mode', query.mode);
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.runId) params = params.set('runId', query.runId);
    if (query.limit) params = params.set('limit', String(query.limit));
    return this.http
      .get<{ trades: DashboardTrade[] }>(`${this.base}/strategy/dashboard/trades`, { params })
      .pipe(catchError(this.unwrap));
  }

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
