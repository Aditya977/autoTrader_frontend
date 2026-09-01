import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EMPTY } from 'rxjs';
import { ChartStreamPageComponent } from './chart-stream-page.component';
import { ChartStreamSocketService } from './chart-stream-socket.service';
import { environment } from '../../environments/environment';
import type { OptionChain, PricedOptionContract, StartStreamRequest } from './chart-stream.models';

const contract = (
  leg: 'CE' | 'PE',
  strike: number,
  overrides: Partial<PricedOptionContract> = {},
): PricedOptionContract => ({
  instrumentKey: `NSE_FO|${leg}-${strike}`,
  tradingsymbol: `NIFTY ${strike} ${leg}`,
  strike,
  lotSize: 65,
  tickSize: 5,
  ltp: null,
  close: null,
  openInterest: null,
  volume: null,
  iv: null,
  ...overrides,
});

const CHAIN: OptionChain = {
  underlying: 'NIFTY',
  expiry: '2026-08-25',
  pricedOn: null,
  underlyingPrice: null,
  calls: [contract('CE', 24000), contract('CE', 24500)],
  puts: [contract('PE', 24000), contract('PE', 24500)],
};

const base = environment.apiBase;

describe('ChartStreamPageComponent', () => {
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

  /** The requests the page would hand to its chart panels. */
  const requests = (): StartStreamRequest[] =>
    state()
      .panels()
      .map((p: { request: StartStreamRequest }) => p.request);

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ChartStreamPageComponent],
      // The page injects Router for sign-out; the guard, not this component,
      // is what decides whether it renders at all.
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // A rendered panel would otherwise open a real WebSocket to a backend
        // that is not running, and retry it on a backoff for the rest of the
        // suite. What the panels do with their session is the chart
        // component's spec, not this one's.
        { provide: ChartStreamSocketService, useValue: { connect: () => EMPTY } },
      ],
    });
    fixture = TestBed.createComponent(ChartStreamPageComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    // The strategy catalogue is fetched on construction and is not what any test
    // in this file asserts on — answering it here keeps `verify` about the
    // requests that are. Emptied on purpose: with no strategy selected the page
    // behaves exactly as it did before the picker existed, which is what the
    // rest of this spec describes.
    for (const request of http.match(`${base}/strategy/catalogue`)) {
      request.flush({ strategies: [] });
    }

    // A panel that rendered starts its own session. Answering those here keeps
    // `verify` about the requests this spec actually asserts on.
    for (const request of http.match(`${base}/streamer/stream/start`)) {
      request.flush({
        sessionId: 's',
        mode: 'TEST',
        status: 'RUNNING',
        instrumentKey: 'k',
        interval: '1minute',
        date: '2026-08-14',
        startedAt: '2026-08-14T03:45:00.000Z',
        error: null,
      });
    }
    http.verify();
  });

  describe('pickers', () => {
    it('populates every picker from the backend, never from a hardcoded list', () => {
      flushCascade();

      expect(state().underlyings()).toEqual(['BANKNIFTY', 'NIFTY']);
      expect(state().expiries()).toEqual(['2026-08-25', '2026-09-01']);
      expect(state().calls().length).toBe(2);
      expect(state().puts().length).toBe(2);
    });

    it('selects the first underlying and defaults the expiry to the nearest one', () => {
      flushCascade();

      expect(state().underlying()).toBe('BANKNIFTY');
      expect(state().expiry()).toBe('2026-08-25');
      expect(state().nextExpiry()).toBe('2026-08-25');
    });

    // A strike is only meaningful for one underlying/expiry; carrying it across
    // a change would name a contract that may not exist.
    it('clears both legs when the underlying changes and reloads the chain', () => {
      flushCascade();
      state().callStrike.set(24500);
      state().putStrike.set(24000);

      state().underlying.set('NIFTY');
      state().onUnderlyingChange();

      expect(state().callStrike()).toBeNull();
      expect(state().putStrike()).toBeNull();
      expect(state().calls()).toEqual([]);

      http
        .expectOne((r) => r.url === `${base}/streamer/instruments/expiries`)
        .flush({ underlying: 'NIFTY', expiries: ['2026-08-25'] });
      http.expectOne((r) => r.url === `${base}/streamer/instruments/chain`).flush(CHAIN);

      expect(state().calls().length).toBe(2);
    });

    it('does not fetch a chain for INDEX, which has no strikes', () => {
      flushCascade();

      state().kind.set('INDEX');
      state().onKindChange();

      expect(state().isOption()).toBeFalse();
      expect(state().needsExpiry()).toBeFalse();
      http.expectNone((r) => r.url === `${base}/streamer/instruments/chain`);
    });

    it('labels a contract with its strike and premium, dashing an unpriced one', () => {
      flushCascade();

      expect(state().optionLabel(contract('CE', 24000, { ltp: 99.65 }))).toBe(
        '24000 · ₹99.65 — NIFTY 24000 CE',
      );
      expect(state().optionLabel(contract('CE', 24000))).toBe('24000 · — — NIFTY 24000 CE');
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
      state().onModeChange();

      const req = http.expectOne((r) => r.url === `${base}/streamer/instruments/chain`);
      expect(req.request.params.get('date')).toBeNull();
      req.flush({ ...CHAIN, pricedOn: null, underlyingPrice: 24310 });

      expect(state().pricedOn()).toBe('');
      expect(state().underlyingClose()).toBe(24310);
    });

    it('opens on the last weekday and on instant replay, so Start works first time', () => {
      flushCascade();

      expect(state().replaySpeed()).toBe(0);
      expect(state().date()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const day = new Date(`${state().date()}T00:00:00Z`).getUTCDay();
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    });
  });

  describe('starting one leg or two', () => {
    it('charts only the call when only a call is picked', () => {
      flushCascade();
      state().callStrike.set(24500);
      state().start();

      expect(state().panels().length).toBe(1);
      expect(state().panels()[0].leg).toBe('CE');
      expect(state().panels()[0].label).toBe('NIFTY 24500 CE');
      expect(requests()[0].instrument).toEqual({
        type: 'CE',
        underlying: 'BANKNIFTY',
        strike: 24500,
        expiry: '2026-08-25',
      });
    });

    it('charts only the put when only a put is picked', () => {
      flushCascade();
      state().putStrike.set(24000);
      state().start();

      expect(state().panels().length).toBe(1);
      expect(state().panels()[0].leg).toBe('PE');
      expect(requests()[0].instrument.type).toBe('PE');
    });

    // The point of the two independent dropdowns: a strategy has two legs and
    // they are watched together, not one after the other.
    it('charts both legs at once when a call and a put are both picked', () => {
      flushCascade();
      state().callStrike.set(24500);
      state().putStrike.set(24000);
      state().start();

      const panels = state().panels();
      expect(panels.length).toBe(2);
      expect(panels.map((p: { leg: string }) => p.leg)).toEqual(['CE', 'PE']);
      expect(panels.map((p: { label: string }) => p.label)).toEqual([
        'NIFTY 24500 CE',
        'NIFTY 24000 PE',
      ]);
      // Two independent sessions, so one leg failing to resolve cannot take
      // the other down.
      expect(requests().map((r) => r.instrument.strike)).toEqual([24500, 24000]);
      // Same day, same speed, same history — the two run off one clock.
      expect(requests()[0].date).toBe(requests()[1].date);
      expect(requests()[0].replaySpeed).toBe(requests()[1].replaySpeed);
    });

    it('gives the two panels distinct keys so neither reuses the other canvas', () => {
      flushCascade();
      state().callStrike.set(24500);
      state().putStrike.set(24500); // same strike, different leg
      state().start();

      const [a, b] = state().panels();
      expect(a.key).not.toBe(b.key);
    });

    it('says up front what Start will do', () => {
      flushCascade();
      expect(state().plan()).toContain('Select a call');

      state().callStrike.set(24500);
      expect(state().plan()).toContain('NIFTY 24500 CE');

      state().putStrike.set(24000);
      expect(state().plan()).toContain('side by side');
    });

    it('refuses to start an option with neither leg picked', () => {
      flushCascade();

      state().start();

      expect(state().formError()).toContain('Pick a call, a put, or both');
      expect(state().panels()).toEqual([]);
    });

    it('refuses TEST with no date, which the backend would reject as a 400', () => {
      flushCascade();
      state().callStrike.set(24500);
      state().date.set('');

      state().start();

      expect(state().formError()).toContain('session date');
      expect(state().panels()).toEqual([]);
    });

    it('charts the underlying itself for INDEX, with no strike or expiry', () => {
      flushCascade();
      state().kind.set('INDEX');
      state().onKindChange();

      state().start();

      expect(state().panels().length).toBe(1);
      expect(state().panels()[0].leg).toBeNull();
      expect(requests()[0].instrument).toEqual({ type: 'INDEX', underlying: 'BANKNIFTY' });
    });

    it('sends historyDays only when prior days were asked for', () => {
      flushCascade();
      state().callStrike.set(24500);

      state().historyDays.set(0);
      state().start();
      expect(requests()[0].historyDays).toBeUndefined();

      state().historyDays.set(2);
      state().start();
      expect(requests()[0].historyDays).toBe(2);
    });

    // The wire timeframe is fixed and the chart resamples: that is what lets
    // LIVE offer every interval, since the live builder only makes 1-minute bars.
    it('always asks the backend for 1-minute bars, whatever the display interval', () => {
      flushCascade();
      state().callStrike.set(24500);
      state().displaySeconds.set(900);

      state().start();

      expect(requests()[0].interval).toBe('1minute');
    });

    it('omits date and replaySpeed in LIVE mode, which rejects both', () => {
      flushCascade();
      state().mode.set('LIVE');
      state().onModeChange();
      http.expectOne((r) => r.url === `${base}/streamer/instruments/chain`).flush(CHAIN);

      state().callStrike.set(24500);
      state().start();

      const request = requests()[0];
      expect(request.mode).toBe('LIVE');
      expect(request.date).toBeUndefined();
      expect(request.replaySpeed).toBeUndefined();
    });

    it('hands a fresh request object on every Start, so the same panel restarts', () => {
      flushCascade();
      state().callStrike.set(24500);

      state().start();
      const first = requests()[0];
      state().start();
      const second = requests()[0];

      expect(second).not.toBe(first);
      expect(second).toEqual(first);
    });

    it('leaves levels off unless they were asked for', () => {
      flushCascade();
      state().callStrike.set(24500);

      state().start();

      expect(requests()[0].levels).toBeUndefined();
    });

    it('asks for levels on the interval the chart is displaying', () => {
      // The wire is always 1-minute and the chart resamples, so the *displayed*
      // interval is the only one that says which bars the lines describe.
      flushCascade();
      state().callStrike.set(24500);
      state().levelChoice.set('swing');
      state().displaySeconds.set(900);

      state().start();

      expect(requests()[0].levels).toEqual({
        method: 'swing',
        interval: '15minute',
        swingLookback: 3,
        minTouches: 2,
        maxLevels: 6,
        tolerancePct: 0.25,
      });
    });

    it('carries the chosen sensitivity into the request', () => {
      flushCascade();
      state().callStrike.set(24500);
      state().levelChoice.set('both');
      state().levelSensitivity.set('major');

      state().start();

      expect(requests()[0].levels).toEqual(
        jasmine.objectContaining({ method: 'both', swingLookback: 6, maxLevels: 4 }),
      );
    });

    // The whole point of the feature working the same way twice: a replay that
    // annotates differently from a live chart is a replay nobody can trust.
    it('plots levels in LIVE mode exactly as it does in TEST', () => {
      flushCascade();
      state().mode.set('LIVE');
      state().onModeChange();
      http.expectOne((r) => r.url === `${base}/streamer/instruments/chain`).flush(CHAIN);

      state().callStrike.set(24500);
      state().levelChoice.set('swing');
      state().start();

      const live = requests()[0];
      expect(live.mode).toBe('LIVE');
      expect(live.levels).toEqual(jasmine.objectContaining({ method: 'swing' }));
    });

    it('says in the plan line that levels will be plotted', () => {
      flushCascade();
      state().callStrike.set(24500);

      expect(state().plan()).not.toContain('support');

      state().levelChoice.set('pivot');
      expect(state().plan()).toContain('pivot points');
    });
  });

  describe('running strategies', () => {
    const CATALOGUE = {
      strategies: [
        {
          id: 'vwap-ema-trend',
          name: 'VWAP + EMA trend',
          description: 'buys strength',
          timeframeMinutes: 5,
          warmupBars: 26,
          params: {},
        },
        {
          id: 'vwap-reclaim',
          name: 'VWAP reclaim',
          description: 'buys the dip that holds',
          timeframeMinutes: 5,
          warmupBars: 26,
          params: {},
        },
      ],
    };

    /** The catalogue request the page fires on construction. */
    function flushCatalogue(): void {
      http.expectOne(`${base}/strategy/catalogue`).flush(CATALOGUE);
    }

    function runSnapshot(sessionIds: string[]) {
      return {
        runId: 'run-1',
        status: 'RUNNING',
        startedAt: '2026-08-14T03:45:00.000Z',
        sessionDate: '2026-08-14',
        capital: 100000,
        noEntryAfterMs: 0,
        squareOffMs: 0,
        costModel: { label: 'flat', includes: [], excludes: [] },
        journalling: false,
        strategies: CATALOGUE.strategies,
        charts: sessionIds.map((sessionId, i) => ({
          sessionId,
          instrumentKey: `k${i}`,
          tradingsymbol: `s${i}`,
          label: `s${i}`,
          leg: i === 0 ? 'CE' : 'PE',
          lotSize: 65,
          status: 'RUNNING',
          barsConsumed: 0,
        })),
        books: [] as unknown[],
        totals: {
          capitalDeployed: 0,
          realisedPnl: 0,
          unrealisedPnl: 0,
          totalPnl: 0,
          totalPnlPct: 0,
          costs: 0,
          trades: 0,
          openTrades: 0,
          wins: 0,
          losses: 0,
          winRate: null,
        },
        error: null,
      };
    }

    it('offers exactly the strategies the backend published, and none of its own', () => {
      flushCascade();
      flushCatalogue();

      expect(
        state()
          .catalogue()
          .map((s: { id: string }) => s.id),
      ).toEqual(['vwap-ema-trend', 'vwap-reclaim']);
    });

    it('starts no simulation, and behaves exactly as before, with nothing selected', () => {
      flushCascade();
      flushCatalogue();
      state().callStrike.set(24500);
      state().start();

      http.expectNone(`${base}/strategy/simulation/start`);
      // The panel starts its own session, which is the pre-strategy behaviour.
      expect(state().panels()[0].sessionId).toBeNull();
      expect(state().run()).toBeNull();
    });

    it('sends the capital, the picked strategies and one chart per leg', () => {
      flushCascade();
      flushCatalogue();

      state().callStrike.set(24500);
      state().putStrike.set(24000);
      state().toggleStrategy('vwap-ema-trend');
      state().toggleStrategy('vwap-reclaim');
      state().capital.set(250000);
      state().journal.set(true);
      state().start();

      const req = http.expectOne(`${base}/strategy/simulation/start`);
      expect(req.request.body.capital).toBe(250000);
      expect(req.request.body.strategies).toEqual(['vwap-ema-trend', 'vwap-reclaim']);
      expect(req.request.body.journal).toBe(true);
      expect(req.request.body.charts.length).toBe(2);
      expect(req.request.body.charts[0].instrument.type).toBe('CE');
      expect(req.request.body.charts[1].instrument.type).toBe('PE');

      req.flush(runSnapshot(['sess-ce', 'sess-pe']));
    });

    // This is what keeps the marks and the candles under them from being two
    // different replays of the same instrument.
    it('hands each panel the session the run already started, not a new one', () => {
      flushCascade();
      flushCatalogue();

      state().callStrike.set(24500);
      state().putStrike.set(24000);
      state().toggleStrategy('vwap-ema-trend');
      state().start();

      http
        .expectOne(`${base}/strategy/simulation/start`)
        .flush(runSnapshot(['sess-ce', 'sess-pe']));

      expect(
        state()
          .panels()
          .map((p: { sessionId: string }) => p.sessionId),
      ).toEqual(['sess-ce', 'sess-pe']);
      // No panel started a session of its own.
      http.expectNone(`${base}/streamer/stream/start`);
    });

    it('routes a book to the panel showing the session that produced it', () => {
      flushCascade();
      flushCatalogue();
      state().callStrike.set(24500);
      state().toggleStrategy('vwap-ema-trend');
      state().start();

      const snapshot = runSnapshot(['sess-ce']);
      snapshot.books = [
        { bookId: 'b1', sessionId: 'sess-ce', trades: [{ id: 1 }] },
        { bookId: 'b2', sessionId: 'sess-other', trades: [{ id: 2 }] },
      ];
      http.expectOne(`${base}/strategy/simulation/start`).flush(snapshot);

      expect(state().tradesFor('sess-ce').length).toBe(1);
      expect(state().tradesFor('sess-other').length).toBe(1);
      expect(state().tradesFor(null).length).toBe(0);
      // Stable identity between reads, so the chart does not rebuild every
      // marker on every change-detection pass.
      expect(state().tradesFor('sess-ce')).toBe(state().tradesFor('sess-ce'));
    });

    it('refuses a capital that is not a positive number', () => {
      flushCascade();
      flushCatalogue();
      state().callStrike.set(24500);
      state().toggleStrategy('vwap-ema-trend');
      state().capital.set(0);
      state().start();

      http.expectNone(`${base}/strategy/simulation/start`);
      expect(state().formError()).toContain('Capital');
    });

    it('toggles a strategy off as readily as on', () => {
      flushCascade();
      flushCatalogue();

      state().toggleStrategy('vwap-reclaim');
      expect(state().selected()).toEqual(['vwap-reclaim']);
      state().toggleStrategy('vwap-reclaim');
      expect(state().selected()).toEqual([]);
    });

    it('counts one book per strategy per leg, and says so before Start is pressed', () => {
      flushCascade();
      flushCatalogue();

      state().callStrike.set(24500);
      state().putStrike.set(24000);
      state().toggleStrategy('vwap-ema-trend');
      state().toggleStrategy('vwap-reclaim');

      expect(state().bookCount()).toBe(4);
      expect(state().plan()).toContain('4 paper books');
    });

    it('surfaces a rejected start instead of leaving the button spinning', () => {
      flushCascade();
      flushCatalogue();
      state().callStrike.set(24500);
      state().toggleStrategy('vwap-ema-trend');
      state().start();

      http
        .expectOne(`${base}/strategy/simulation/start`)
        .flush(
          { error: { code: 'VALIDATION_ERROR', message: 'capital is required' } },
          { status: 400, statusText: 'Bad Request' },
        );

      expect(state().starting()).toBe(false);
      expect(state().formError()).toBe('capital is required');
    });
  });
});
