import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { ChartStreamError } from '../chart-stream/chart-stream-api.service';
import { TradingApiService } from './trading-api.service';

describe('TradingApiService', () => {
  let api: TradingApiService;
  let http: HttpTestingController;
  const base = environment.apiBase;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(TradingApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts a live session with every instrument in one request', () => {
    const request = {
      strategyId: 'two-candle-retest',
      capital: 100_000,
      instruments: [
        {
          instrument: {
            type: 'CE' as const,
            underlying: 'NIFTY',
            expiry: '2026-09-25',
            strike: 24500,
          },
        },
        {
          instrument: {
            type: 'PE' as const,
            underlying: 'NIFTY',
            expiry: '2026-09-25',
            strike: 24500,
          },
        },
      ],
    };
    api.startLive(request).subscribe();
    const req = http.expectOne(`${base}/strategy/live/start`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    req.flush({});
  });

  it('asks for one mode’s figures, with the range only when set', () => {
    api.performance('BACKTEST', '2026-09-01', null).subscribe();
    const req = http.expectOne((r) => r.url === `${base}/strategy/dashboard/performance`);
    expect(req.request.params.get('mode')).toBe('BACKTEST');
    expect(req.request.params.get('from')).toBe('2026-09-01');
    expect(req.request.params.has('to')).toBeFalse();
    req.flush({});
  });

  it('unwraps the backend error envelope', () => {
    let caught: unknown;
    api.stopLive('nope').subscribe({ error: (e: unknown) => (caught = e) });
    http
      .expectOne(`${base}/strategy/live/nope/stop`)
      .flush(
        { error: { code: 'NOT_FOUND', message: 'no live session nope' } },
        { status: 404, statusText: 'Not Found' },
      );
    expect(caught instanceof ChartStreamError).toBeTrue();
    expect((caught as ChartStreamError).message).toBe('no live session nope');
  });
});
