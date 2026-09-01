import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { StrategyPanelComponent } from './strategy-panel.component';
import type { SimTrade, SimulationBook, SimulationRunSnapshot } from './strategy.models';

const OPEN_MS = Date.UTC(2026, 7, 14, 3, 45);

function trade(overrides: Partial<SimTrade> = {}): SimTrade {
  return {
    id: 1,
    strategyId: 'vwap-ema-trend',
    instrumentKey: 'NSE_FO|CE',
    tradingsymbol: 'NIFTY 24500 CE',
    side: 'BUY',
    status: 'CLOSED',
    quantity: 150,
    lots: 2,
    lotSize: 75,
    entryTime: OPEN_MS + 30 * 60_000,
    entryPrice: 100,
    entryReason: 'crossed above VWAP',
    stopPrice: 75,
    targetPrice: 140,
    exitTime: OPEN_MS + 60 * 60_000,
    exitPrice: 120,
    exitReason: 'target hit at 140.00',
    exitReasonKind: 'TARGET',
    grossPnl: 3000,
    costs: 40,
    netPnl: 2960,
    netPnlPct: 19.7,
    mae: -200,
    mfe: 3100,
    features: {},
    ...overrides,
  };
}

function book(overrides: Partial<SimulationBook> = {}): SimulationBook {
  return {
    bookId: 'vwap-ema-trend::session-1',
    strategyId: 'vwap-ema-trend',
    strategyName: 'VWAP + EMA trend',
    sessionId: 'session-1',
    instrumentKey: 'NSE_FO|CE',
    tradingsymbol: 'NIFTY 24500 CE',
    label: 'NIFTY 24500 CE',
    leg: 'CE',
    timeframeMinutes: 5,
    startingCapital: 100_000,
    cash: 102_960,
    equity: 102_960,
    realisedPnl: 2960,
    unrealisedPnl: 0,
    totalPnl: 2960,
    totalPnlPct: 2.96,
    costs: 40,
    tradeCount: 1,
    wins: 1,
    losses: 0,
    scratches: 0,
    winRate: 100,
    openTrade: null,
    lastPrice: 120,
    lastRejection: null,
    barsProcessed: 75,
    trades: [trade()],
    ...overrides,
  };
}

function run(overrides: Partial<SimulationRunSnapshot> = {}): SimulationRunSnapshot {
  const books = overrides.books ?? [book()];
  return {
    runId: 'run-1',
    status: 'RUNNING',
    startedAt: '2026-08-14T03:45:00.000Z',
    sessionDate: '2026-08-14',
    capital: 100_000,
    noEntryAfterMs: OPEN_MS + 345 * 60_000,
    squareOffMs: OPEN_MS + 365 * 60_000,
    costModel: {
      label: '₹40 flat per sell order',
      includes: ['brokerage'],
      excludes: ['STT', 'slippage'],
    },
    journalling: false,
    strategies: [
      {
        id: 'vwap-ema-trend',
        name: 'VWAP + EMA trend',
        description: 'buys strength',
        timeframeMinutes: 5,
        warmupBars: 26,
        params: {},
      },
    ],
    charts: [],
    books,
    totals: {
      capitalDeployed: 100_000 * books.length,
      realisedPnl: 2960,
      unrealisedPnl: 0,
      totalPnl: 2960,
      totalPnlPct: 2.96,
      costs: 40,
      trades: 1,
      openTrades: 0,
      wins: 1,
      losses: 0,
      winRate: 100,
    },
    error: null,
    ...overrides,
  };
}

describe('StrategyPanelComponent', () => {
  let fixture: ComponentFixture<StrategyPanelComponent>;

  const text = (): string => fixture.nativeElement.textContent as string;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StrategyPanelComponent] });
    fixture = TestBed.createComponent(StrategyPanelComponent);
  });

  function render(snapshot: SimulationRunSnapshot | null): void {
    fixture.componentRef.setInput('run', snapshot);
    fixture.detectChanges();
  }

  it('renders nothing at all with no run', () => {
    render(null);
    expect(text().trim()).toBe('');
  });

  it('leads with net P&L, and names what the cost model leaves out', () => {
    render(run());

    expect(text()).toContain('Net P&L');
    expect(text()).toContain('+₹2,960');
    // The exclusions must be on screen: a "net" figure that quietly ignored
    // STT and slippage would read as profit that does not exist.
    expect(text()).toContain('STT');
    expect(text()).toContain('₹40 flat per sell order');
  });

  it('shows one card per book, so two strategies are compared not merged', () => {
    render(
      run({
        books: [
          book(),
          book({
            bookId: 'vwap-reclaim::session-1',
            strategyId: 'vwap-reclaim',
            strategyName: 'VWAP reclaim',
            totalPnl: -1_200,
            realisedPnl: -1_200,
            totalPnlPct: -1.2,
            wins: 0,
            losses: 1,
            winRate: 0,
            trades: [trade({ id: 2, netPnl: -1_200, exitReasonKind: 'STOP' })],
          }),
        ],
      }),
    );

    expect(text()).toContain('VWAP + EMA trend');
    expect(text()).toContain('VWAP reclaim');
    expect(text()).toContain('−₹1,200');
  });

  it('says what a book is holding right now', () => {
    render(
      run({
        books: [
          book({
            openTrade: trade({ status: 'OPEN', exitTime: null, exitPrice: null }),
            unrealisedPnl: 2_960,
            lastPrice: 120,
          }),
        ],
      }),
    );

    expect(text()).toContain('Holding');
    expect(text()).toContain('2 lots');
    expect(text()).toContain('SL');
  });

  it('explains a signal that produced no trade rather than dropping it', () => {
    render(
      run({
        books: [
          book({
            trades: [],
            tradeCount: 0,
            lastRejection: 'one lot costs ₹9,000.00, more than the ₹5,000.00 available',
          }),
        ],
      }),
    );

    expect(text()).toContain('Skipped');
    expect(text()).toContain('more than the');
  });

  it('lists trades newest first', () => {
    render(
      run({
        books: [
          book({
            tradeCount: 2,
            trades: [
              trade({ id: 1, entryTime: OPEN_MS, exitTime: OPEN_MS + 10 * 60_000 }),
              trade({
                id: 2,
                entryTime: OPEN_MS + 60 * 60_000,
                exitTime: OPEN_MS + 90 * 60_000,
              }),
            ],
          }),
        ],
      }),
    );

    const rows = fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLElement>;
    expect(rows.length).toBe(2);
    expect(rows[0]?.textContent).toContain('10:45'); // the later entry, first
  });

  it('offers Stop only while the run is running', () => {
    render(run({ status: 'RUNNING' }));
    const button = (): HTMLButtonElement =>
      fixture.nativeElement.querySelector('button.stop') as HTMLButtonElement;
    expect(button().disabled).toBe(false);

    render(run({ status: 'COMPLETED' }));
    expect(button().disabled).toBe(true);
  });

  it('emits stop when pressed', () => {
    render(run({ status: 'RUNNING' }));
    let stopped = 0;
    fixture.componentInstance.stop.subscribe(() => stopped++);

    (fixture.nativeElement.querySelector('button.stop') as HTMLButtonElement).click();
    expect(stopped).toBe(1);
  });

  it('says how much warm-up is still owed when nothing has traded', () => {
    render(run({ books: [book({ trades: [], tradeCount: 0 })] }));
    expect(text()).toContain('No trades yet');
    expect(text()).toContain('26 × 5m bars');
  });
});
