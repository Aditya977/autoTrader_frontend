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
  SessionShapeError,
  SessionShapeView,
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
  ): Observable<SessionShapeView | SessionShapeError> {
    const query = new URLSearchParams({
      symbol,
      date,
      timeframe: String(timeframe),
      k: String(k),
    });
    return this.http
      .get<SessionShapeView | SessionShapeError>(
        `${this.base}/strategy/day-shapes/session?${query.toString()}`,
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
