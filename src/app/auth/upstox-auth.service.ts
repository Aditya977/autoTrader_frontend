import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, interval, of } from 'rxjs';
import { catchError, first, map, switchMap, tap, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface AuthStatus {
  authenticated: boolean;
  expiresAt: string | null;
  obtainedAt: string | null;
}

/**
 * The Upstox session the whole app runs on.
 *
 * Every data endpoint on the backend is behind a login — instrument lists,
 * option chains, and streaming all read Upstox with the user's own session,
 * and none of them falls back to public data. So this is not a per-feature
 * concern: it gates the app.
 *
 * The frontend never sees, stores, or forwards an access token. It navigates
 * the browser to `/streamer/auth/login` and asks `/status` whether that
 * worked; the token itself lives only on the backend.
 */
@Injectable({ providedIn: 'root' })
export class UpstoxAuthService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBase;

  /** `null` until the first status call answers — "unknown", not "logged out". */
  private readonly state = signal<AuthStatus | null>(null);

  readonly status = this.state.asReadonly();
  readonly isAuthenticated = computed(() => this.state()?.authenticated ?? false);
  /** True only before the first answer, so a guard can wait instead of bouncing. */
  readonly isUnknown = computed(() => this.state() === null);
  readonly expiresAt = computed(() => this.state()?.expiresAt ?? null);

  /**
   * Asks the backend who we are and remembers the answer.
   *
   * A failed request is treated as logged out rather than surfaced: the only
   * thing a caller can do about "the backend is unreachable" is show the login
   * screen, which is what `authenticated: false` already produces.
   */
  refresh(): Observable<AuthStatus> {
    return this.http.get<AuthStatus>(`${this.base}/streamer/auth/status`).pipe(
      catchError(() =>
        of<AuthStatus>({
          authenticated: false,
          expiresAt: null,
          obtainedAt: null,
        }),
      ),
      tap((status) => this.state.set(status)),
    );
  }

  /**
   * Full-page redirect into Upstox's consent screen.
   *
   * A navigation, not an XHR: `/streamer/auth/login` answers `302` to Upstox,
   * and a `fetch` would follow it into an opaque cross-origin response instead
   * of showing the user the page they have to approve. The backend needs
   * `AUTH_SUCCESS_REDIRECT_URL` pointed back at this app.
   */
  login(): void {
    window.location.href = `${this.base}/streamer/auth/login`;
  }

  /**
   * Popup variant, for a backend with the `*_REDIRECT_URL` vars unset.
   *
   * Emits once, when polling first sees a session. Kept because which flow
   * works depends on backend configuration the frontend cannot see.
   */
  loginViaPopup(): Observable<boolean> {
    window.open(`${this.base}/streamer/auth/login`, 'upstox', 'width=520,height=700');
    return interval(1500).pipe(
      switchMap(() => this.refresh()),
      map((s) => s.authenticated),
      first((authenticated) => authenticated),
      timeout(120_000),
    );
  }

  logout(): Observable<unknown> {
    return this.http.post(`${this.base}/streamer/auth/logout`, {}).pipe(
      catchError(() => of(null)),
      tap(() =>
        this.state.set({
          authenticated: false,
          expiresAt: null,
          obtainedAt: null,
        }),
      ),
    );
  }

  /**
   * Drops the cached session without calling the backend.
   *
   * For the interceptor: a `401` from any endpoint is the backend saying the
   * session is gone, which is more current than whatever `/status` last said.
   */
  markLoggedOut(): void {
    this.state.set({ authenticated: false, expiresAt: null, obtainedAt: null });
  }
}
