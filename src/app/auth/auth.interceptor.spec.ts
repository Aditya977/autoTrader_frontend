import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { UpstoxAuthService } from './upstox-auth.service';
import { environment } from '../../environments/environment';

const base = environment.apiBase;

describe('authInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let auth: UpstoxAuthService;
  let navigate: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    auth = TestBed.inject(UpstoxAuthService);
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
  });

  afterEach(() => http.verify());

  function fail(url: string, status: number): void {
    client.get(url).subscribe({ next: () => {}, error: () => {} });
    http.expectOne(url).flush('nope', { status, statusText: 'Error' });
  }

  // A session can end mid-visit — tokens expire daily at 03:30 IST — and the
  // first thing that notices is whichever request happens next.
  it('sends a 401 back to the login screen', () => {
    fail(`${base}/streamer/instruments/underlyings`, 401);

    expect(navigate).toHaveBeenCalled();
    expect(navigate.calls.mostRecent().args[0]).toEqual(['/login']);
    expect(auth.isAuthenticated()).toBeFalse();
  });

  it('tags the redirect so the login screen can explain itself', () => {
    fail(`${base}/streamer/instruments/underlyings`, 401);

    expect(navigate.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ reason: 'session-expired' }),
      }),
    );
  });

  // `/status` answering "not logged in" is a normal outcome of asking, not a
  // session that just expired — redirecting on it would loop.
  it('ignores a 401 from the auth routes themselves', () => {
    fail(`${base}/streamer/auth/status`, 401);

    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves other failures alone', () => {
    fail(`${base}/streamer/instruments/chain`, 422);

    expect(navigate).not.toHaveBeenCalled();
  });

  // Callers still need to render their own message; this only adds the
  // navigation on top.
  it('rethrows so the caller still sees the failure', () => {
    let status = 0;
    const url = `${base}/streamer/instruments/underlyings`;
    client.get(url).subscribe({
      next: () => {},
      error: (e: { status: number }) => (status = e.status),
    });
    http.expectOne(url).flush('nope', { status: 401, statusText: 'Error' });

    expect(status).toBe(401);
  });
});
