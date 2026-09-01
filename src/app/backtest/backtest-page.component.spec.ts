import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { BacktestPageComponent } from './backtest-page.component';

const base = environment.apiBase;

const CATALOGUE = {
  strategies: [
    {
      id: 'price-only',
      name: 'Price only',
      description: 'a strategy that needs nothing but OHLC',
      requiresVolume: false,
      timeframeMinutes: 5,
      warmupBars: 3,
      paramSpecs: [
        {
          key: 'rangeMinutes',
          label: 'Opening range',
          description: 'minutes from the open that form the range',
          min: 5,
          max: 90,
          step: 5,
          integer: true,
        },
        {
          key: 'targetR',
          label: 'Target (R)',
          description: 'target as a multiple of the stop distance',
          min: 0.5,
          max: 5,
          step: 0.1,
          integer: false,
        },
      ],
      params: { rangeMinutes: 15, targetR: 1.5 },
    },
    {
      id: 'vwap-ema-trend',
      name: 'VWAP + EMA trend',
      description: 'volume weighted, so useless on an index',
      requiresVolume: true,
      timeframeMinutes: 5,
      warmupBars: 26,
      paramSpecs: [],
      params: {},
    },
  ],
};

/**
 * The two symbol lists, as the backend keeps them apart.
 *
 * A stock is synced for capture only — it has no expiry and no chain — so it
 * never belongs in `underlyings`, which is what the chart's picker reads.
 */
const SYMBOLS = {
  underlyings: ['BANKNIFTY', 'NIFTY'],
  equities: ['RELIANCE', 'TCS'],
};

const DATASETS = [
  {
    id: 3,
    label: 'NIFTY August',
    status: 'COMPLETE',
    underlyings: ['NIFTY'],
    expiry: '2026-09-01',
    fromDate: '2026-08-01',
    toDate: '2026-08-31',
    interval: '1minute',
    instrumentCount: 1,
    barCount: 7_500,
    error: null,
    requestedAt: '2026-09-01T04:00:00.000Z',
    completedAt: '2026-09-01T04:05:00.000Z',
  },
];

/** What a capture holds: the index, and two option legs of differing coverage. */
const INSTRUMENTS = {
  instruments: [
    {
      instrumentKey: 'NSE_INDEX|Nifty 50',
      tradingsymbol: 'NIFTY',
      role: 'UNDERLYING',
      underlying: 'NIFTY',
      strike: null,
      expiry: null,
      bars: 7_875,
      firstDate: '2026-08-02',
      lastDate: '2026-08-31',
      tradingDays: 21,
      // An index carries none — not little, none.
      hasVolume: false,
    },
    {
      instrumentKey: 'NSE_FO|CE-24100',
      tradingsymbol: 'NIFTY 24100 CE 01 SEP 26',
      role: 'CE',
      underlying: 'NIFTY',
      strike: 24_100,
      expiry: '2026-09-01',
      bars: 7_760,
      firstDate: '2026-08-02',
      lastDate: '2026-08-31',
      tradingDays: 21,
      hasVolume: true,
    },
    {
      instrumentKey: 'NSE_FO|PE-24050',
      tradingsymbol: 'NIFTY 24050 PE 01 SEP 26',
      role: 'PE',
      underlying: 'NIFTY',
      strike: 24_050,
      expiry: '2026-09-01',
      bars: 3_738,
      firstDate: '2026-08-14',
      lastDate: '2026-08-31',
      tradingDays: 10,
      hasVolume: true,
    },
  ],
};

describe('BacktestPageComponent', () => {
  let fixture: ComponentFixture<BacktestPageComponent>;
  let http: HttpTestingController;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = (): any => fixture.componentInstance as any;

  /**
   * The requests the page fires on construction, plus the instruments call that
   * follows once a capture has been selected.
   */
  function flushBoot(datasets: unknown[] = DATASETS, withInstruments = true): void {
    http.expectOne(`${base}/streamer/instruments/underlyings`).flush(SYMBOLS);
    http.expectOne(`${base}/strategy/catalogue`).flush(CATALOGUE);
    http.expectOne((r) => r.url === `${base}/streamer/journal/datasets`).flush(datasets);
    http.expectOne((r) => r.url === `${base}/strategy/backtest`).flush({ runs: [] });
    if (withInstruments) {
      http.expectOne((r) => r.url.endsWith('/instruments')).flush(INSTRUMENTS);
    }
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BacktestPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(BacktestPageComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
  });

  /**
   * Options are what actually get traded, and they carry the volume an index
   * does not — so the most liquid leg is the default rather than the index.
   */
  it('picks the most liquid option leg, not the index', () => {
    flushBoot();
    expect(state().instrumentKey()).toBe('NSE_FO|CE-24100');
    expect(state().hasVolume()).toBe(true);
  });

  it('offers every strategy on an option, which carries volume', () => {
    flushBoot();
    const ids = state()
      .availableStrategies()
      .map((s: { id: string }) => s.id);
    expect(ids).toEqual(['price-only', 'vwap-ema-trend']);
  });

  /**
   * An index carries no volume, so a volume-weighted strategy pointed at one
   * never warms up and takes zero trades — which reads as a quiet month rather
   * than as the mismatch it is.
   */
  it('drops the volume-weighted strategies when the index is chosen', () => {
    flushBoot();
    state().onInstrumentChange('NSE_INDEX|Nifty 50');

    const ids = state()
      .availableStrategies()
      .map((s: { id: string }) => s.id);
    expect(ids).toEqual(['price-only']);
    expect(state().hasVolume()).toBe(false);
  });

  /**
   * A strategy is written *for* a bar — its warm-up and its periods were chosen
   * against one — so the picker starts there. It is editable from there because
   * the same rules on a different bar are a different experiment, and which one
   * works is a question for the measurement.
   */
  it('starts the timeframe at the one the strategy declares', () => {
    flushBoot();
    expect(state().timeframeMinutes()).toBe(5);

    state().timeframeMinutes.set(1);
    state().onStrategyChange('vwap-ema-trend');
    expect(state().timeframeMinutes()).toBe(5);
  });

  it('moves off a strategy the new contract cannot run', () => {
    flushBoot();
    state().onStrategyChange('vwap-ema-trend');

    state().onInstrumentChange('NSE_INDEX|Nifty 50');
    // Left alone, this would take zero trades and report a quiet month.
    expect(state().strategyId()).toBe('price-only');
  });

  /**
   * A leg that was far from the money early in the month has bars for only part
   * of it, so a run over it covers a shorter window than the label claims.
   */
  it('knows the best coverage in the capture, so a short leg can say so', () => {
    flushBoot();
    expect(state().bestCoverage()).toBe(21);

    state().onInstrumentChange('NSE_FO|PE-24050');
    expect(state().selectedInstrument().tradingDays).toBe(10);
  });

  it('selects the first strategy and loads its defaults, so Run works at once', () => {
    flushBoot();

    expect(state().strategyId()).toBe('price-only');
    expect(state().params()).toEqual({ rangeMinutes: 15, targetR: 1.5 });
  });

  it('resets parameters to the defaults when the strategy changes', () => {
    flushBoot();
    state().setParam('targetR', 3);
    expect(state().params().targetR).toBe(3);

    state().onStrategyChange('price-only');
    expect(state().params().targetR).toBe(1.5);
  });

  it('preselects the newest usable capture', () => {
    flushBoot();
    expect(state().datasetId()).toBe(3);
  });

  it('does not preselect a capture that holds no bars', () => {
    flushBoot([{ ...DATASETS[0], id: 9, barCount: 0, status: 'FAILED' }], false);
    expect(state().datasetId()).toBeNull();
  });

  /**
   * The capture anchors on the nearest **live** expiry and reaches back, which
   * is what makes a month of option history available despite the instrument
   * master dropping settled contracts.
   */
  it('captures option legs around the money, with the index beside them', () => {
    flushBoot();

    state().lookbackDays.set(60);
    state().strikesPerSide.set(3);
    state().capture();

    const request = http.expectOne(`${base}/streamer/journal/datasets`);
    expect(request.request.body).toEqual({
      underlyings: ['NIFTY'],
      lookbackDays: 60,
      strikesPerSide: 3,
    });

    request.flush({ ...DATASETS[0], id: 11 });
    // Selecting the fresh capture means Run needs no second click.
    expect(state().datasetId()).toBe(11);
    http.expectOne((r) => r.url.endsWith('/instruments')).flush(INSTRUMENTS);
    http.expectOne((r) => r.url === `${base}/streamer/journal/datasets`).flush(DATASETS);
  });

  /**
   * A stock capture asks nothing about strikes and nothing about an underlying,
   * because a stock has neither. The old single form asked both to fetch
   * RELIANCE, and offered an underlying with no bearing on what it pulled.
   */
  it('captures a stock alone, with no derivative fields in the request', () => {
    flushBoot();

    state().setMode('EQUITY');
    // The month-shaped windows are gone: a stock is here for its years.
    expect(state().lookbackDays()).toBe(180);
    expect(state().equity()).toBe('RELIANCE');

    state().lookbackDays.set(730);
    state().capture();

    const request = http.expectOne(`${base}/streamer/journal/datasets`);
    expect(request.request.body).toEqual({
      equities: ['RELIANCE'],
      lookbackDays: 730,
    });

    request.flush({ ...DATASETS[0], id: 12 });
    http.expectOne((r) => r.url.endsWith('/instruments')).flush(INSTRUMENTS);
    http.expectOne((r) => r.url === `${base}/streamer/journal/datasets`).flush(DATASETS);
  });

  /**
   * The chart's picker asks for an expiry next, which a stock has no answer to,
   * so the two lists stay apart all the way to the form.
   */
  it('keeps the stock list out of the underlying picker', () => {
    flushBoot();
    expect(state().underlyings()).toEqual(['BANKNIFTY', 'NIFTY']);
    expect(state().equities()).toEqual(['RELIANCE', 'TCS']);
  });

  it('sends the timeframe the picker is on, not the declared default', () => {
    flushBoot();

    state().timeframeMinutes.set(15);
    state().run();

    const request = http.expectOne(`${base}/strategy/backtest/run`);
    expect(request.request.body.timeframeMinutes).toBe(15);

    request.flush({ id: 2, days: [], trades: [], metrics: null });
    http.expectOne((r) => r.url === `${base}/strategy/backtest`).flush({ runs: [] });
  });

  it('sends the parameters, the capital and the notes with a run', () => {
    flushBoot();

    state().setParam('targetR', 2.5);
    state().capital.set(750_000);
    state().notes.set('widened the target');
    state().run();

    const request = http.expectOne(`${base}/strategy/backtest/run`);
    expect(request.request.body).toEqual(
      jasmine.objectContaining({
        datasetId: 3,
        instrumentKey: 'NSE_FO|CE-24100',
        strategyId: 'price-only',
        capital: 750_000,
        lotSize: 75,
        timeframeMinutes: 5,
        notes: 'widened the target',
        params: { rangeMinutes: 15, targetR: 2.5 },
      }),
    );
    // Omitted rather than sent empty: the window is the holdout discipline, and
    // an empty string is a 400 rather than "no window".
    expect(request.request.body.fromDate).toBeUndefined();

    request.flush({ id: 1, days: [], trades: [], metrics: null });
    http.expectOne((r) => r.url === `${base}/strategy/backtest`).flush({ runs: [] });
  });

  it('sends a date window when one is set, which is how a holdout is kept back', () => {
    flushBoot();

    state().fromDate.set('2026-08-01');
    state().toDate.set('2026-08-21');
    state().run();

    const request = http.expectOne(`${base}/strategy/backtest/run`);
    expect(request.request.body.fromDate).toBe('2026-08-01');
    expect(request.request.body.toDate).toBe('2026-08-21');

    request.flush({ id: 1, days: [], trades: [] });
    http.expectOne((r) => r.url === `${base}/strategy/backtest`).flush({ runs: [] });
  });

  it('refuses to run without a captured dataset', () => {
    flushBoot([], false);

    state().run();

    http.expectNone(`${base}/strategy/backtest/run`);
    expect(state().error()).toContain('captured dataset');
  });

  it('surfaces a rejected run instead of leaving the button spinning', () => {
    flushBoot();
    state().run();

    http
      .expectOne(`${base}/strategy/backtest/run`)
      .flush(
        { error: { code: 'VALIDATION_ERROR', message: 'targetR must be between 0.5 and 5' } },
        { status: 400, statusText: 'Bad Request' },
      );

    expect(state().running()).toBe(false);
    expect(state().error()).toContain('between 0.5 and 5');
  });

  describe('comparing runs', () => {
    /**
     * The oldest pick is dropped when a third is added, so ticking down a list
     * compares each run against the one before it — the reading the loop wants.
     */
    it('keeps at most two picks, dropping the oldest', () => {
      flushBoot();

      state().togglePick(1);
      state().togglePick(2);
      state().togglePick(3);
      expect(state().picked()).toEqual([2, 3]);

      state().togglePick(2);
      expect(state().picked()).toEqual([3]);
    });

    it('does nothing without exactly two picks', () => {
      flushBoot();
      state().togglePick(1);
      state().compare();
      http.expectNone((r) => r.url === `${base}/strategy/backtest/compare`);
    });

    it('asks the backend for the diff and shows the candidate', () => {
      flushBoot();
      state().togglePick(4);
      state().togglePick(5);
      state().compare();

      const request = http.expectOne((r) => r.url === `${base}/strategy/backtest/compare`);
      expect(request.request.params.get('baseline')).toBe('4');
      expect(request.request.params.get('candidate')).toBe('5');

      request.flush({
        baseline: { id: 4 },
        candidate: { id: 5 },
        deltas: [],
      });

      expect(state().comparing()).toBe(false);
      expect(state().result().id).toBe(5);
    });
  });

  it('reports a catalogue failure without breaking the page', () => {
    http.expectOne(`${base}/streamer/instruments/underlyings`).flush(SYMBOLS);
    http
      .expectOne(`${base}/strategy/catalogue`)
      .flush(
        { error: { code: 'UPSTREAM_ERROR', message: 'catalogue unavailable' } },
        { status: 502, statusText: 'Bad Gateway' },
      );
    http.expectOne((r) => r.url === `${base}/streamer/journal/datasets`).flush(DATASETS);
    http.expectOne((r) => r.url === `${base}/strategy/backtest`).flush({ runs: [] });
    http.expectOne((r) => r.url.endsWith('/instruments')).flush(INSTRUMENTS);

    expect(state().error()).toContain('catalogue unavailable');
    // The datasets still loaded — one failure does not take the page down.
    expect(state().datasets().length).toBe(1);
  });
});
