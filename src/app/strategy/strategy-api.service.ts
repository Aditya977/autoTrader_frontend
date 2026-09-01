import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ChartStreamError } from '../chart-stream/chart-stream-api.service';
import type { ApiErrorBody } from '../chart-stream/chart-stream.models';
import type {
  SimulationRunSnapshot,
  StartSimulationRequest,
  StrategyDescriptor,
} from './strategy.models';

/**
 * The `/strategy` half of the backend.
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

  /**
   * Starts the chart sessions *and* the books that trade them, in one call.
   *
   * The returned snapshot's `charts[].sessionId` are ordinary chart sessions:
   * the chart panels adopt them rather than starting their own, so what the
   * strategies decided from and what the user is watching are the same bars.
   */
  start(request: StartSimulationRequest): Observable<SimulationRunSnapshot> {
    return this.http
      .post<SimulationRunSnapshot>(`${this.base}/strategy/simulation/start`, request)
      .pipe(catchError(this.unwrap));
  }

  /** Stops the run and every chart session behind it. */
  stop(runId: string): Observable<SimulationRunSnapshot> {
    return this.http
      .post<SimulationRunSnapshot>(`${this.base}/strategy/simulation/${runId}/stop`, {})
      .pipe(catchError(this.unwrap));
  }

  status(runId: string): Observable<SimulationRunSnapshot> {
    return this.http
      .get<SimulationRunSnapshot>(`${this.base}/strategy/simulation/${runId}`)
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
