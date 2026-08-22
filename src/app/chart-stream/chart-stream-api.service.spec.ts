import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChartStreamApiService, ChartStreamError } from './chart-stream-api.service';
import { environment } from '../../environments/environment';
import type { ApiErrorBody, StartStreamRequest } from './chart-stream.models';

describe('ChartStreamApiService', () => {
  let api: ChartStreamApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ChartStreamApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts a start request to /streamer/stream/start', () => {
    const request: StartStreamRequest = {
      mode: 'TEST',
      instrument: { type: 'CE', underlying: 'NIFTY', strike: 24350, expiry: '2026-08-25' },
      interval: '1minute',
      date: '2026-08-14',
      replaySpeed: 30,
    };
    api.start(request).subscribe();

    const req = http.expectOne(`${environment.apiBase}/streamer/stream/start`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    req.flush({});
  });

  it('sends the underlying as a query param when listing expiries', () => {
    api.expiries('NIFTY').subscribe();

    const req = http.expectOne(
      (r) => r.url === `${environment.apiBase}/streamer/instruments/expiries`,
    );
    expect(req.request.params.get('underlying')).toBe('NIFTY');
    req.flush({ underlying: 'NIFTY', expiries: [] });
  });

  it('unwraps the { error: {...} } envelope into a ChartStreamError', () => {
    let caught: ChartStreamError | undefined;
    api.stop('abc').subscribe({ error: (e: ChartStreamError) => (caught = e) });

    const body: ApiErrorBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        issues: [{ path: 'instrument.strike', message: 'Required for CE / PE' }],
      },
    };
    http
      .expectOne(`${environment.apiBase}/streamer/stream/abc/stop`)
      .flush(body, { status: 400, statusText: 'Bad Request' });

    expect(caught).toBeInstanceOf(ChartStreamError);
    expect(caught!.code).toBe('VALIDATION_ERROR');
    expect(caught!.message).toBe('Invalid request');
    expect(caught!.status).toBe(400);
    expect(caught!.byField).toEqual({ 'instrument.strike': 'Required for CE / PE' });
  });

  it('falls back to NETWORK_ERROR when the body carries no envelope', () => {
    let caught: ChartStreamError | undefined;
    api.status('abc').subscribe({ error: (e: ChartStreamError) => (caught = e) });

    http
      .expectOne(`${environment.apiBase}/streamer/stream/abc`)
      .error(new ProgressEvent('network error'));

    expect(caught!.code).toBe('NETWORK_ERROR');
    expect(caught!.issues).toEqual([]);
  });
});
