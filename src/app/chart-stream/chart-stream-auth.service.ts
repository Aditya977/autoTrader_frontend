import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, interval, map } from 'rxjs';
import { first, switchMap, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/**
 * Upstox OAuth, required for `mode: 'LIVE'` only.
 *
 * TEST mode needs no login at all — the historical endpoint the backend reads
 * is public, including for option contracts.
 *
 * The frontend never sees, stores or forwards an access token.
 */
@Injectable({ providedIn: 'root' })
export class ChartStreamAuthService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBase;

  /** Tokens expire daily at 03:30 IST, so re-check rather than caching. */
  status(): Observable<{ authenticated: boolean }> {
    return this.http.get<{ authenticated: boolean }>(`${this.base}/streamer/auth/status`);
  }

  /**
   * Full-page redirect. `GET /streamer/auth/login` is a browser navigation, not
   * an XHR — it 302s to Upstox. The backend must have AUTH_SUCCESS_REDIRECT_URL
   * set so the user lands back on your route.
   */
  login(): void {
    window.location.href = `${this.base}/streamer/auth/login`;
  }

  /** Popup + poll. Leave the backend's *_REDIRECT_URL vars unset for this one. */
  loginViaPopup(): Observable<boolean> {
    window.open(`${this.base}/streamer/auth/login`, 'upstox', 'width=520,height=700');
    return interval(1500).pipe(
      switchMap(() => this.status()),
      map((s) => s.authenticated),
      first((authenticated) => authenticated),
      timeout(120_000),
    );
  }
}
