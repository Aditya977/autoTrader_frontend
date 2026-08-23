import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UpstoxAuthService } from './upstox-auth.service';
import { environment } from '../../environments/environment';

const base = environment.apiBase;

describe('UpstoxAuthService', () => {
  let auth: UpstoxAuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(UpstoxAuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // "Unknown" and "logged out" are different: a guard that confuses them
  // bounces a signed-in user to the login screen on every cold load.
  it('starts unknown rather than logged out', () => {
    expect(auth.isUnknown()).toBeTrue();
    expect(auth.isAuthenticated()).toBeFalse();
  });

  it('remembers a session after refresh', () => {
    auth.refresh().subscribe();
    http.expectOne(`${base}/streamer/auth/status`).flush({
      authenticated: true,
      expiresAt: '2026-08-24T03:30:00.000Z',
      obtainedAt: '2026-08-23T09:00:00.000Z',
    });

    expect(auth.isUnknown()).toBeFalse();
    expect(auth.isAuthenticated()).toBeTrue();
    expect(auth.expiresAt()).toBe('2026-08-24T03:30:00.000Z');
  });

  // The only thing a caller can do about an unreachable backend is show the
  // login screen, which is what `authenticated: false` already produces.
  it('treats an unreachable backend as logged out rather than erroring', () => {
    let errored = false;
    auth.refresh().subscribe({ error: () => (errored = true) });
    http
      .expectOne(`${base}/streamer/auth/status`)
      .flush('down', { status: 500, statusText: 'Server Error' });

    expect(errored).toBeFalse();
    expect(auth.isAuthenticated()).toBeFalse();
    expect(auth.isUnknown()).toBeFalse();
  });

  it('clears the session on logout', () => {
    auth.refresh().subscribe();
    http
      .expectOne(`${base}/streamer/auth/status`)
      .flush({ authenticated: true, expiresAt: null, obtainedAt: null });

    auth.logout().subscribe();
    const req = http.expectOne(`${base}/streamer/auth/logout`);
    expect(req.request.method).toBe('POST');
    req.flush({ authenticated: false });

    expect(auth.isAuthenticated()).toBeFalse();
  });

  it('marks logged out without calling the backend', () => {
    auth.markLoggedOut();
    expect(auth.isAuthenticated()).toBeFalse();
    expect(auth.isUnknown()).toBeFalse();
  });

  // A token would be the one thing worth leaking; the service must never hold
  // a field that could carry one.
  it('never exposes anything token-shaped', () => {
    auth.refresh().subscribe();
    http.expectOne(`${base}/streamer/auth/status`).flush({
      authenticated: true,
      expiresAt: null,
      obtainedAt: null,
    });

    expect(Object.keys(auth.status() ?? {})).toEqual(['authenticated', 'expiresAt', 'obtainedAt']);
  });
});
