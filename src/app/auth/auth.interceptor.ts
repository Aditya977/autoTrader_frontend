import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { UpstoxAuthService } from './upstox-auth.service';

/**
 * Turns a `401` from any endpoint into a trip back to the login screen.
 *
 * A session can end mid-visit — Upstox tokens expire daily at 03:30 IST, and a
 * logout elsewhere revokes them sooner — and the first thing that notices is
 * whichever request happens next. Without this, that request just fails and
 * the page shows a data error for what is really an expired login.
 *
 * `/streamer/auth/*` is exempt: `status` answering "not logged in" and
 * `callback` reporting a declined consent are both normal outcomes of asking,
 * not sessions that just expired, and redirecting on them would loop.
 *
 * The error is rethrown either way, so callers still see the failure and can
 * render their own message; this only adds the navigation.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(UpstoxAuthService);
  const router = inject(Router);

  return next(request).pipe(
    catchError((error: unknown) => {
      const isAuthRoute = request.url.includes('/streamer/auth/');
      if (error instanceof HttpErrorResponse && error.status === 401 && !isAuthRoute) {
        auth.markLoggedOut();
        void router.navigate(['/login'], {
          queryParams: { returnTo: router.url, reason: 'session-expired' },
        });
      }
      return throwError(() => error);
    }),
  );
};
