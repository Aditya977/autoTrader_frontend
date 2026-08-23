import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChartStreamPageComponent } from './chart-stream-page.component';
import { environment } from '../../environments/environment';
import type { OptionChain } from './chart-stream.models';

const CHAIN: OptionChain = {
  underlying: 'NIFTY',
  expiry: '2026-08-25',
  pricedOn: null,
  underlyingPrice: null,
  calls: [
    {
      instrumentKey: 'NSE_FO|CE-24000',
      tradingsymbol: 'NIFTY 24000 CE',
      strike: 24000,
      lotSize: 65,
      tickSize: 5,
      ltp: null,
      close: null,
      openInterest: null,
      volume: null,
      iv: null,
    },
    {
      instrumentKey: 'NSE_FO|CE-24500',
      tradingsymbol: 'NIFTY 24500 CE',
      strike: 24500,
      lotSize: 65,
      tickSize: 5,
      ltp: null,
      close: null,
      openInterest: null,
      volume: null,
      iv: null,
    },
  ],
  puts: [
    {
      instrumentKey: 'NSE_FO|PE-24000',
      tradingsymbol: 'NIFTY 24000 PE',
      strike: 24000,
      lotSize: 65,
      tickSize: 5,
      ltp: null,
      close: null,
      openInterest: null,
      volume: null,
      iv: null,
    },
  ],
};

const base = environment.apiBase;

describe('ChartStreamPageComponent pickers', () => {
  let fixture: ComponentFixture<ChartStreamPageComponent>;
  let http: HttpTestingController;

  /** The component's own signals, reached the way the template reaches them. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = (): any => fixture.componentInstance as any;

  /** underlyings → expiries → chain, the cascade the page runs on load. */
  function flushCascade(): void {
    http
      .expectOne(`${base}/streamer/instruments/underlyings`)
      .flush({ underlyings: ['BANKNIFTY', 'NIFTY'] });

    http
      .expectOne((r) => r.url === `${base}/streamer/instruments/expiries`)
      .flush({ underlying: 'BANKNIFTY', expiries: ['2026-08-25', '2026-09-01'] });

    http.expectOne((r) => r.url === `${base}/streamer/instruments/chain`).flush(CHAIN);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ChartStreamPageComponent],
      // The page injects Router for sign-out; the guard, not this component,
      // is what decides whether it renders at all.
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(ChartStreamPageComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('populates every picker from the backend, never from a hardcoded list', () => {
    flushCascade();

    expect(state().underlyings()).toEqual(['BANKNIFTY', 'NIFTY']);
    expect(state().expiries()).toEqual(['2026-08-25', '2026-09-01']);
    expect(state().calls().length).toBe(2);
    expect(state().puts().length).toBe(1);
  });

  it('selects the first underlying and defaults the expiry to the nearest one', () => {
    flushCascade();

    expect(state().underlying()).toBe('BANKNIFTY');
    expect(state().expiry()).toBe('2026-08-25');
    expect(state().nextExpiry()).toBe('2026-08-25');
  });

  it('picking a call sets the CE leg and its strike together', () => {
    flushCascade();

    state().pickCall(24500);

    expect(state().instrumentType()).toBe('CE');
    expect(state().strike()).toBe(24500);
    expect(state().selectedContract()?.tradingsymbol).toBe('NIFTY 24500 CE');
  });

  it('picking a put switches the leg to PE, so the two ladders are one choice', () => {
    flushCascade();

    state().pickCall(24000);
    state().pickPut(24000);

    expect(state().instrumentType()).toBe('PE');
    expect(state().strike()).toBe(24000);
    expect(state().selectedContract()?.tradingsymbol).toBe('NIFTY 24000 PE');
  });

  // A strike is only meaningful for one underlying/expiry; carrying it across a
  // change would send a contract that may not exist.
  it('clears the strike when the underlying changes and reloads the chain', () => {
    flushCascade();
    state().pickCall(24500);

    state().underlying.set('NIFTY');
    state().onUnderlyingChange();

    expect(state().strike()).toBeNull();
    expect(state().calls()).toEqual([]);

    http
      .expectOne((r) => r.url === `${base}/streamer/instruments/expiries`)
      .flush({ underlying: 'NIFTY', expiries: ['2026-08-25'] });
    http.expectOne((r) => r.url === `${base}/streamer/instruments/chain`).flush(CHAIN);

    expect(state().calls().length).toBe(2);
  });

  it('does not fetch a chain for INDEX, which has no strikes', () => {
    flushCascade();

    state().instrumentType.set('INDEX');
    state().onTypeChange();

    expect(state().isOption()).toBeFalse();
    expect(state().needsExpiry()).toBeFalse();
    http.expectNone((r) => r.url === `${base}/streamer/instruments/chain`);
  });

  it('refuses to start an option with no strike picked', () => {
    flushCascade();

    state().start();

    expect(state().formError()).toContain('Pick a strike');
  });

  it('labels a contract with its strike and close, dashing an unpriced one', () => {
    flushCascade();

    expect(state().label({ ...CHAIN.calls[0], ltp: 99.65 })).toBe(
      '24000 · ₹99.65 — NIFTY 24000 CE',
    );
    expect(state().label(CHAIN.calls[0])).toBe('24000 · — — NIFTY 24000 CE');
  });

  it('asks for prices as of the replay date in TEST mode', () => {
    flushCascade();

    state().date.set('2026-08-21');
    state().onDateChange();

    const req = http.expectOne((r) => r.url === `${base}/streamer/instruments/chain`);
    expect(req.request.params.get('date')).toBe('2026-08-21');
    req.flush({ ...CHAIN, pricedOn: '2026-08-21', underlyingPrice: 24252 });

    expect(state().pricedOn()).toBe('2026-08-21');
    expect(state().underlyingClose()).toBe(24252);
  });

  // Live prices come from the authenticated chain endpoint, which speaks only
  // about now — so LIVE sends no date and gets last-traded premiums.
  it('asks for live prices, not a dated close, in LIVE mode', () => {
    flushCascade();

    state().mode.set('LIVE');
    state().date.set('2026-08-21');
    state().onExpiryChange();

    const req = http.expectOne((r) => r.url === `${base}/streamer/instruments/chain`);
    expect(req.request.params.get('date')).toBeNull();
    req.flush({ ...CHAIN, pricedOn: null, underlyingPrice: 24310 });

    expect(state().pricedOn()).toBe('');
    expect(state().underlyingClose()).toBe(24310);
  });

  it('sends historyDays only when prior days were asked for', () => {
    flushCascade();
    state().pickCall(24500);

    const started: unknown[] = [];
    state().chart = () => ({ start: (r: unknown) => started.push(r) });

    state().historyDays.set(0);
    state().start();
    expect((started[0] as { historyDays?: number }).historyDays).toBeUndefined();

    state().historyDays.set(2);
    state().start();
    expect((started[1] as { historyDays?: number }).historyDays).toBe(2);
  });

  it('defaults the replay speed to instant', () => {
    flushCascade();

    expect(state().replaySpeed()).toBe(0);
  });
});
