import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { map } from 'rxjs/operators';
import { UpstoxAuthService } from './upstox-auth.service';

/**
 * Keeps unauthenticated users off the data routes.
 *
 * Not a cosmetic gate: every endpoint those routes call answers `401` without
 * a session, so an ungated route renders a page whose every request fails.
 * Sending the user to `/login` instead states the reason once.
 *
 * On a cold load the session is unknown rather than absent — a page opened
 * directly at `/chart` has not asked the backend anything yet — so this waits
 * for the first `/status` answer instead of bouncing to the login screen and
 * back.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(UpstoxAuthService);
  const router = inject(Router);

  const decide = (authenticated: boolean): boolean | ReturnType<Router['createUrlTree']> =>
    authenticated
      ? true
      : // Remembered so login can return the user where they were headed.
        router.createUrlTree(['/login'], {
          queryParams: { returnTo: state.url },
        });

  if (!auth.isUnknown()) return decide(auth.isAuthenticated());
  return auth.refresh().pipe(map((s) => decide(s.authenticated)));
};

/**
 * The mirror image, for the login route itself: someone who already has a
 * session should not be shown a login screen.
 */
export const loginPageGuard: CanActivateFn = () => {
  const auth = inject(UpstoxAuthService);
  const router = inject(Router);

  const decide = (authenticated: boolean): boolean | ReturnType<Router['createUrlTree']> =>
    authenticated ? router.createUrlTree(['/chart']) : true;

  if (!auth.isUnknown()) return decide(auth.isAuthenticated());
  return auth.refresh().pipe(map((s) => decide(s.authenticated)));
};
