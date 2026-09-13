import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ChartStreamError } from '../chart-stream/chart-stream-api.service';
import type { ApiErrorBody } from '../chart-stream/chart-stream.models';
import type { CandlePatternsRequest, CandlePatternsResponse } from './candle-patterns.models';

/**
 * The one call this feature makes.
 *
 * Its own service rather than another method on `ChartStreamApiService`
 * because the shape of the dependency is different: everything there is about
 * a *session* — starting one, stopping it, asking what it holds — and this is
 * a pure function over bars that happens to run on the server. It needs no
 * session id and works identically whether one is running.
 *
 * ## Why the route is `/strategy` and not `/streamer/stream`
 *
 * It annotates a chart, so it looks like it belongs beside support/resistance
 * and the previous day's range. It cannot be: the detection reuses the
 * backend's candle taxonomy, which lives in the strategy layer, and that
 * codebase forbids the streamer from importing it — the market-data pipeline
 * has to build and deploy without the engine. So the endpoint sits on the side
 * of the boundary its engine is already on.
 *
 * `ChartStreamError` is reused rather than reinvented, because the backend
 * returns one error envelope for the whole API and a second error class would
 * make a caller handle the same failure two ways.
 */
@Injectable({ providedIn: 'root' })
export class CandlePatternsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBase;

  /**
   * Candlestick patterns in the bars given.
   *
   * The caller owns two things this cannot check for it: that the bars are
   * strictly ascending, and that the **forming bar is not among them**. The
   * backend rejects the first with a 400. It cannot detect the second at all —
   * a forming bar looks like any other — so a caller that sends one gets
   * patterns that appear and vanish under the user as the bar's close moves.
   */
  detect(request: CandlePatternsRequest): Observable<CandlePatternsResponse> {
    return this.http
      .post<CandlePatternsResponse>(`${this.base}/strategy/candle-patterns`, request)
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
