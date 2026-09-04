import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ChartStreamError } from '../chart-stream/chart-stream-api.service';
import type { ApiErrorBody } from '../chart-stream/chart-stream.models';
import type { DayShapeModel, DayShapeModelSummary } from './day-shapes.models';

/**
 * The `/strategy/day-shapes` half of the backend.
 *
 * Both endpoints are static — the taxonomies are compiled into the build, not
 * fitted per request — so there is nothing here to poll and no run to start.
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
   * `k` omitted asks for the one the stability rule selected, which is what a
   * caller with no opinion should get.
   */
  categories(k?: number): Observable<DayShapeModel> {
    const query = k === undefined ? '' : `?k=${k}`;
    return this.http
      .get<DayShapeModel>(`${this.base}/strategy/day-shapes/categories${query}`)
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
