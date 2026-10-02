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

  it('switches a strategy on for paper trading with only the flag — no capital, no size', () => {
    api.setStrategyEnabled('fib-momentum', true).subscribe();
    const req = http.expectOne(`${base}/strategy/paper/strategies/fib-momentum`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ enabled: true });
    req.flush({});
  });

  it('asks for the paper report with only the filters that are set', () => {
    api.paperTrades({ from: '2026-09-01', instrument: 'BANKNIFTY' }).subscribe();
    const req = http.expectOne((r) => r.url === `${base}/strategy/paper/trades`);
    expect(req.request.params.get('from')).toBe('2026-09-01');
    expect(req.request.params.get('instrument')).toBe('BANKNIFTY');
    expect(req.request.params.has('to')).toBeFalse();
    req.flush({ trades: [] });
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
    api.setStrategyEnabled('nope', true).subscribe({ error: (e: unknown) => (caught = e) });
    http
      .expectOne(`${base}/strategy/paper/strategies/nope`)
      .flush(
        { error: { code: 'NOT_FOUND', message: 'no strategy nope' } },
        { status: 404, statusText: 'Not Found' },
      );
    expect(caught instanceof ChartStreamError).toBeTrue();
    expect((caught as ChartStreamError).message).toBe('no strategy nope');
  });
});
