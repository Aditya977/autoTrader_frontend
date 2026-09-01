import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ChartStreamError } from '../chart-stream/chart-stream-api.service';
import type { ApiErrorBody } from '../chart-stream/chart-stream.models';
import type {
  BacktestComparison,
  BacktestDetail,
  BacktestSummary,
  CaptureDatasetRequest,
  DatasetInstrument,
  JournalDataset,
  RunBacktestRequest,
} from './backtest.models';

/**
 * Datasets and backtest runs.
 *
 * Two halves of one workflow — capture a month, then run strategies over it —
 * so they share a service rather than being split by which controller happens
 * to serve them.
 *
 * Errors unwrap into {@link ChartStreamError}, like every other call in this
 * app, because they arrive in the same envelope.
 */
@Injectable({ providedIn: 'root' })
export class BacktestApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBase;

  /* --- datasets --------------------------------------------------------- */

  /**
   * Captures a body of real market data to develop against.
   *
   * Minutes of upstream requests, not milliseconds: the backend fetches a
   * month of bars per instrument and answers when it is done. The caller is
   * expected to show that it is working.
   */
  captureDataset(request: CaptureDatasetRequest): Observable<JournalDataset> {
    return this.http
      .post<JournalDataset>(`${this.base}/streamer/journal/datasets`, request)
      .pipe(catchError(this.unwrap));
  }

  /** A bare array, not a wrapper — the journal controller returns it directly. */
  datasets(limit = 50): Observable<JournalDataset[]> {
    return this.http
      .get<JournalDataset[]>(`${this.base}/streamer/journal/datasets`, {
        params: { limit },
      })
      .pipe(catchError(this.unwrap));
  }

  /**
   * What a capture actually holds, and how much of each.
   *
   * Derived on the backend from the stored bars rather than from the capture's
   * report: the report says what was attempted, this says what is there.
   */
  instruments(datasetId: number): Observable<{ instruments: DatasetInstrument[] }> {
    return this.http
      .get<{ instruments: DatasetInstrument[] }>(
        `${this.base}/strategy/backtest/datasets/${datasetId}/instruments`,
      )
      .pipe(catchError(this.unwrap));
  }

  /* --- runs ------------------------------------------------------------- */

  /** Runs a strategy over a captured month and returns the whole result. */
  run(request: RunBacktestRequest): Observable<BacktestDetail> {
    return this.http
      .post<BacktestDetail>(`${this.base}/strategy/backtest/run`, request)
      .pipe(catchError(this.unwrap));
  }

  /** Newest first, without the per-day and per-trade bulk. */
  list(limit = 50): Observable<{ runs: BacktestSummary[] }> {
    return this.http
      .get<{ runs: BacktestSummary[] }>(`${this.base}/strategy/backtest`, {
        params: { limit },
      })
      .pipe(catchError(this.unwrap));
  }

  detail(id: number): Observable<BacktestDetail> {
    return this.http
      .get<BacktestDetail>(`${this.base}/strategy/backtest/${id}`)
      .pipe(catchError(this.unwrap));
  }

  /**
   * Two runs, metric by metric.
   *
   * Diffed on the backend rather than here: this is what says whether a change
   * helped, and it has to be readable by an analysis as well as by a table.
   */
  compare(baseline: number, candidate: number): Observable<BacktestComparison> {
    return this.http
      .get<BacktestComparison>(`${this.base}/strategy/backtest/compare`, {
        params: { baseline, candidate },
      })
      .pipe(catchError(this.unwrap));
  }

  remove(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.base}/strategy/backtest/${id}`)
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
