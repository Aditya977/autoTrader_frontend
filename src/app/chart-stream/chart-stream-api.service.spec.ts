import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChartStreamApiService, ChartStreamError } from './chart-stream-api.service';
import { environment } from '../../environments/environment';
import type { ApiErrorBody, ChartRetests, StartStreamRequest } from './chart-stream.models';

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

  it('lists underlyings and research equities separately', () => {
    let received: { underlyings: string[]; equities: string[] } | undefined;
    api.underlyings().subscribe((r) => (received = r));

    const req = http.expectOne(`${environment.apiBase}/streamer/instruments/underlyings`);
    expect(req.request.method).toBe('GET');
    req.flush({ underlyings: ['BANKNIFTY', 'NIFTY'], equities: ['RELIANCE'] });

    // Two lists, because only the first has a chain behind it to chart.
    expect(received!.underlyings).toEqual(['BANKNIFTY', 'NIFTY']);
    expect(received!.equities).toEqual(['RELIANCE']);
  });

  it('sends underlying and expiry as query params when fetching a chain', () => {
    api.chain('NIFTY', '2026-08-25').subscribe();

    const req = http.expectOne(
      (r) => r.url === `${environment.apiBase}/streamer/instruments/chain`,
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('underlying')).toBe('NIFTY');
    expect(req.request.params.get('expiry')).toBe('2026-08-25');
    req.flush({ underlying: 'NIFTY', expiry: '2026-08-25', calls: [], puts: [] });
  });

  it('unwraps a chain error into ChartStreamError like every other endpoint', () => {
    let error: ChartStreamError | undefined;
    api.chain('NIFTY', '2030-01-01').subscribe({ error: (e: ChartStreamError) => (error = e) });

    const body: ApiErrorBody = {
      error: { code: 'InstrumentMasterError', message: 'no contracts found' },
    };
    http
      .expectOne((r) => r.url === `${environment.apiBase}/streamer/instruments/chain`)
      .flush(body, { status: 422, statusText: 'Unprocessable Entity' });

    expect(error?.code).toBe('InstrumentMasterError');
    expect(error?.status).toBe(422);
  });
});

describe('ChartStreamApiService retests', () => {
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

  const RESPONSE: ChartRetests = {
    instrumentKey: 'NSE_INDEX|Nifty 50',
    tradingsymbol: 'NIFTY',
    interval: '5minute',
    barsAnalysed: 120,
    from: '2026-08-17T03:45:00.000Z',
    to: '2026-08-17T09:59:00.000Z',
    zoneVersion: 1,
    detected: 1,
    retests: [
      {
        zoneLow: 101.5,
        zoneHigh: 102,
        zoneOrigin: 'RANGE_BOUNDARY',
        direction: 'BULLISH',
        breakoutAt: 1_755_000_000_000,
        approachAt: 1_755_000_180_000,
        resumptionAt: 1_755_000_240_000,
        scenario: 'exact',
        scenarios: ['exact', 'range_boundary'],
        valid: true,
        unresolved: false,
        invalidation: null,
        gapAtr: -0.08,
        touchedZone: true,
        closeSide: 1,
        touchCount: 1,
        opposingBars: 0,
        levelConsumed: true,
        barsToResolve: 1,
        confluenceCount: 2,
        levelStrength: 144_000,
        quality: 0.61,
        htfOnly: false,
      },
    ],
  };

  it('posts the instrument body to the standalone retests endpoint', () => {
    let received: ChartRetests | undefined;
    api
      .retests({
        instrument: { type: 'INDEX', underlying: 'NIFTY' },
        interval: '5minute',
        minQuality: 0.4,
      })
      .subscribe((response) => (received = response));

    const req = http.expectOne(`${environment.apiBase}/streamer/stream/retests`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.instrument.underlying).toBe('NIFTY');
    expect(req.request.body.minQuality).toBe(0.4);

    req.flush(RESPONSE);
    expect(received?.retests.length).toBe(1);
    // 0 opposing bars is a real value the UI must carry, not missing data.
    expect(received?.retests[0].opposingBars).toBe(0);
  });

  it('sends session tuning as query parameters', () => {
    api
      .sessionRetests('sess-1', { contextDays: 3, includeUnresolved: true, maxGapAtr: 1.2 })
      .subscribe();

    const req = http.expectOne(
      (candidate) => candidate.url === `${environment.apiBase}/streamer/stream/sess-1/retests`,
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('contextDays')).toBe('3');
    expect(req.request.params.get('includeUnresolved')).toBe('true');
    expect(req.request.params.get('maxGapAtr')).toBe('1.2');

    req.flush(RESPONSE);
  });

  it('omits unset knobs so the backend default applies', () => {
    api.sessionRetests('sess-1', { contextDays: undefined, minQuality: 0 }).subscribe();

    const req = http.expectOne(
      (candidate) => candidate.url === `${environment.apiBase}/streamer/stream/sess-1/retests`,
    );
    expect(req.request.params.has('contextDays')).toBeFalse();
    // 0 is a real value and must survive the filter that drops undefined.
    expect(req.request.params.get('minQuality')).toBe('0');

    req.flush(RESPONSE);
  });

  it('unwraps a retest error into the same ChartStreamError shape', () => {
    let error: ChartStreamError | undefined;
    api.retests({ instrument: { type: 'INDEX', underlying: 'NIFTY' } }).subscribe({
      error: (e: ChartStreamError) => (error = e),
    });

    http.expectOne(`${environment.apiBase}/streamer/stream/retests`).flush(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          issues: [{ path: 'maxGapAtr', message: 'expected <= 5' }],
        },
      } satisfies ApiErrorBody,
      { status: 400, statusText: 'Bad Request' },
    );

    expect(error?.code).toBe('VALIDATION_ERROR');
    expect(error?.byField['maxGapAtr']).toBe('expected <= 5');
  });
});
