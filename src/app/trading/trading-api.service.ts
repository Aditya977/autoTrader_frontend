import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ChartStreamError } from '../chart-stream/chart-stream-api.service';
import type { ApiErrorBody } from '../chart-stream/chart-stream.models';
import type {
  BacktestRunSummary,
  DashboardOverview,
  DashboardPerformance,
  DashboardTrade,
  PaperInstrument,
  PaperTradeRecord,
  PaperTradingStatus,
  RunBacktestRequest,
  StrategyDeployment,
  TradeHistoryQuery,
  TradeMode,
} from './trading.models';

/**
 * Paper trading, backtests and the dashboard figures — the backend's
 * `/strategy/paper`, `/strategy/backtest` and `/strategy/dashboard` routes.
 *
 * Errors are unwrapped into {@link ChartStreamError}, like the rest of the
 * app's API clients, because they arrive in the same envelope.
 */
@Injectable({ providedIn: 'root' })
export class TradingApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBase;

  // --- paper trading --------------------------------------------------------

  paperStatus(): Observable<PaperTradingStatus> {
    return this.http
      .get<PaperTradingStatus>(`${this.base}/strategy/paper/status`)
      .pipe(catchError(this.unwrap));
  }

  /** Stops today's session (squaring off) and keeps it stopped until resumed. */
  pausePaper(): Observable<PaperTradingStatus> {
    return this.http
      .post<PaperTradingStatus>(`${this.base}/strategy/paper/pause`, {})
      .pipe(catchError(this.unwrap));
  }

  resumePaper(): Observable<PaperTradingStatus> {
    return this.http
      .post<PaperTradingStatus>(`${this.base}/strategy/paper/resume`, {})
      .pipe(catchError(this.unwrap));
  }

  deployments(): Observable<{ strategies: StrategyDeployment[] }> {
    return this.http
      .get<{ strategies: StrategyDeployment[] }>(`${this.base}/strategy/paper/strategies`)
      .pipe(catchError(this.unwrap));
  }

  setStrategyEnabled(strategyId: string, enabled: boolean): Observable<StrategyDeployment> {
    return this.http
      .put<StrategyDeployment>(
        `${this.base}/strategy/paper/strategies/${encodeURIComponent(strategyId)}`,
        { enabled },
      )
      .pipe(catchError(this.unwrap));
  }

  /** The paper-trading report, newest entry first. */
  paperTrades(query: {
    from?: string;
    to?: string;
    strategy?: string;
    instrument?: PaperInstrument;
    limit?: number;
  }): Observable<{ trades: PaperTradeRecord[] }> {
    let params = new HttpParams();
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.strategy) params = params.set('strategy', query.strategy);
    if (query.instrument) params = params.set('instrument', query.instrument);
    if (query.limit) params = params.set('limit', String(query.limit));
    return this.http
      .get<{ trades: PaperTradeRecord[] }>(`${this.base}/strategy/paper/trades`, { params })
      .pipe(catchError(this.unwrap));
  }

  // --- backtests -----------------------------------------------------------

  runBacktest(request: RunBacktestRequest): Observable<BacktestRunSummary> {
    return this.http
      .post<BacktestRunSummary>(`${this.base}/strategy/backtest/run`, request)
      .pipe(catchError(this.unwrap));
  }

  /** Deletes backtest history — every run, or one. Paper trades are never touched. */
  clearBacktests(runId?: string): Observable<{ deleted: number }> {
    const params = runId ? new HttpParams().set('runId', runId) : new HttpParams();
    return this.http
      .delete<{ deleted: number }>(`${this.base}/strategy/backtest/trades`, { params })
      .pipe(catchError(this.unwrap));
  }

  // --- dashboard figures, for either mode ---------------------------------

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
