import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ChartStreamError } from '../chart-stream/chart-stream-api.service';
import type { ApiErrorBody } from '../chart-stream/chart-stream.models';
import type { StrategyDescriptor } from './strategy.models';

/**
 * The strategy catalogue — `GET /strategy/catalogue`.
 *
 * Errors are unwrapped into {@link ChartStreamError}, the same class the chart
 * API throws, because they arrive in the same `{ error: { code, message } }`
 * envelope and a component that shows one should not need a second branch to
 * show the other.
 */
@Injectable({ providedIn: 'root' })
export class StrategyApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBase;

  /**
   * Every strategy this build can run.
   *
   * There is deliberately no endpoint to create one — strategies are authored
   * in the backend's registry, so this list is the picker's entire universe.
   */
  catalogue(): Observable<{ strategies: StrategyDescriptor[] }> {
    return this.http
      .get<{ strategies: StrategyDescriptor[] }>(`${this.base}/strategy/catalogue`)
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
