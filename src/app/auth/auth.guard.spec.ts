import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  Router,
  UrlTree,
  provideRouter,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { isObservable, firstValueFrom } from 'rxjs';
import { authGuard, loginPageGuard } from './auth.guard';
import { UpstoxAuthService } from './upstox-auth.service';
import { environment } from '../../environments/environment';

const base = environment.apiBase;

/** Runs a `CanActivateFn` in an injection context and normalises its result. */
async function run(guard: typeof authGuard, url = '/chart'): Promise<boolean | UrlTree> {
  const result = TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  );
  const resolved = isObservable(result) ? await firstValueFrom(result) : await result;
  return resolved as boolean | UrlTree;
}

describe('authGuard', () => {
  let http: HttpTestingController;
  let auth: UpstoxAuthService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(UpstoxAuthService);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  // A page opened directly at /chart has asked the backend nothing yet. If the
  // guard read that as "logged out" it would bounce every signed-in user.
  it('asks the backend when the session is still unknown', async () => {
    const decision = run(authGuard);
    http
      .expectOne(`${base}/streamer/auth/status`)
      .flush({ authenticated: true, expiresAt: null, obtainedAt: null });

    expect(await decision).toBeTrue();
  });

  it('lets a known session through without asking again', async () => {
    auth.refresh().subscribe();
    http
      .expectOne(`${base}/streamer/auth/status`)
      .flush({ authenticated: true, expiresAt: null, obtainedAt: null });

    expect(await run(authGuard)).toBeTrue();
    http.expectNone(`${base}/streamer/auth/status`);
  });

  it('redirects a logged-out visitor to the login screen', async () => {
    auth.markLoggedOut();
    const decision = await run(authGuard);

    expect(decision instanceof UrlTree).toBeTrue();
    expect(router.serializeUrl(decision as UrlTree)).toContain('/login');
  });

  // So signing in lands the user where they were going, not on a generic page.
  it('remembers where the visitor was headed', async () => {
    auth.markLoggedOut();
    const decision = await run(authGuard, '/chart?mode=LIVE');

    expect(router.serializeUrl(decision as UrlTree)).toContain('returnTo=%2Fchart%3Fmode%3DLIVE');
  });
});

describe('loginPageGuard', () => {
  let http: HttpTestingController;
  let auth: UpstoxAuthService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(UpstoxAuthService);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  it('shows the login screen to a logged-out visitor', async () => {
    auth.markLoggedOut();
    expect(await run(loginPageGuard, '/login')).toBeTrue();
  });

  it('sends an already-signed-in visitor to the chart', async () => {
    auth.refresh().subscribe();
    http
      .expectOne(`${base}/streamer/auth/status`)
      .flush({ authenticated: true, expiresAt: null, obtainedAt: null });

    const decision = await run(loginPageGuard, '/login');
    expect(router.serializeUrl(decision as UrlTree)).toContain('/chart');
  });
});
