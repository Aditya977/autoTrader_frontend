import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ChartStreamError } from '../chart-stream/chart-stream-api.service';
import type { ApiErrorBody } from '../chart-stream/chart-stream.models';
import type {
  DayShapeModel,
  DayShapeModelSummary,
  SessionBarsView,
  SessionShapeError,
  SessionShapeView,
  SimilarSessionsView,
} from './day-shapes.models';

/**
 * The `/strategy/day-shapes` half of the backend.
 *
 * The catalogue endpoints are static — the taxonomies are compiled into the
 * build, not fitted per request — so there is nothing to poll and no run to
 * start. The session lookup is not: it reads bars, and it can legitimately have
 * no answer for a date, which arrives as `{ error }` rather than as a failed
 * request.
 *
 * Errors unwrap into {@link ChartStreamError} like every other service here,
 * because they arrive in the same envelope and a component showing one should
 * not need a second branch to show the other.
 */
@Injectable({ providedIn: 'root' })
export class DayShapesApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBase;

  /** Every taxonomy this build carries, summarised. */
  models(): Observable<{ models: DayShapeModelSummary[] }> {
    return this.http
      .get<{ models: DayShapeModelSummary[] }>(`${this.base}/strategy/day-shapes`)
      .pipe(catchError(this.unwrap));
  }

  /**
   * One taxonomy in full.
   *
   * Both arguments omitted asks for the pair the stability rule selected, which
   * is what a caller with no opinion should get.
   */
  categories(k?: number, timeframe?: number): Observable<DayShapeModel> {
    const query = new URLSearchParams();
    if (k !== undefined) query.set('k', String(k));
    if (timeframe !== undefined) query.set('timeframe', String(timeframe));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.http
      .get<DayShapeModel>(`${this.base}/strategy/day-shapes/categories${suffix}`)
      .pipe(catchError(this.unwrap));
  }

  /** Instruments with enough captured history to be shaped. */
  symbols(): Observable<{ symbols: string[] }> {
    return this.http
      .get<{ symbols: string[] }>(`${this.base}/strategy/day-shapes/symbols`)
      .pipe(catchError(this.unwrap));
  }

  /** Dates this instrument can be asked about, newest first. */
  dates(symbol: string): Observable<{ dates: string[] }> {
    const query = new URLSearchParams({ symbol });
    return this.http
      .get<{ dates: string[] }>(`${this.base}/strategy/day-shapes/dates?${query.toString()}`)
      .pipe(catchError(this.unwrap));
  }

  /**
   * One session, classified, with the context needed to read the answer.
   *
   * Resolves rather than errors when the question has no answer — a date the
   * instrument did not trade, or one without fourteen sessions of history
   * behind it to scale by. Those belong on the page as sentences, not as a
   * failed request, so the caller narrows the result rather than catching it.
   */
  session(
    symbol: string,
    date: string,
    timeframe: number,
    k: number,
    window = 90,
  ): Observable<SessionShapeView | SessionShapeError> {
    const query = new URLSearchParams({
      symbol,
      date,
      timeframe: String(timeframe),
      k: String(k),
      window: String(window),
    });
    return this.http
      .get<SessionShapeView | SessionShapeError>(
        `${this.base}/strategy/day-shapes/session?${query.toString()}`,
      )
      .pipe(catchError(this.unwrap));
  }

  /**
   * Past sessions whose chart looks like this one, best match first.
   *
   * `matchCount` is the figure the panel shows collapsed and `matches` is
   * what it reveals when expanded; the backend counts before it caps, so the
   * two never disagree.
   *
   * `minScore` is a real gate. Below it the endpoint returns an empty list
   * rather than the closest few, which is why the panel shows nothing at all
   * when a day has no lookalikes instead of a weak best-of.
   */
  similar(
    symbol: string,
    date: string,
    timeframe: number,
    minScore: number,
    window = 375,
    limit = 30,
  ): Observable<SimilarSessionsView | SessionShapeError> {
    const query = new URLSearchParams({
      symbol,
      date,
      timeframe: String(timeframe),
      window: String(window),
      minScore: String(minScore),
      limit: String(limit),
    });
    return this.http
      .get<SimilarSessionsView | SessionShapeError>(
        `${this.base}/strategy/day-shapes/similar?${query.toString()}`,
      )
      .pipe(catchError(this.unwrap));
  }

  /**
   * One session's candles, each carrying its taxonomy label.
   *
   * The shape endpoints cannot serve this. A trajectory keeps twenty-five
   * closes and discards every open, high and low, so it draws as a line and
   * never as a candlestick.
   *
   * Note the timeframe list differs from the shape endpoints: this accepts
   * 1, 5, 15, 60, 240 and 1440 minutes and **not** 3, because the taxonomy
   * publishes a block per timeframe and three minutes is not one of them.
   */
  bars(
    symbol: string,
    date: string,
    timeframe: number,
  ): Observable<SessionBarsView | SessionShapeError> {
    const query = new URLSearchParams({
      symbol,
      date,
      timeframe: String(timeframe),
    });
    return this.http
      .get<SessionBarsView | SessionShapeError>(
        `${this.base}/strategy/day-shapes/bars?${query.toString()}`,
      )
      .pipe(catchError(this.unwrap));
  }
  private readonly unwrap = (error: HttpErrorResponse) => {
    const body = error.error as ApiErrorBody | undefined;
    return throwError(
      () =>
        new ChartStreamError(
          body?.error?.code ?? 'UNKNOWN',
          body?.error?.message ?? 'The day-shape catalogue could not be read.',
          body?.error?.issues ?? [],
          error.status,
        ),
    );
  };
}
