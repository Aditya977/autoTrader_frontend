import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { SimTrade } from '../strategy/strategy.models';
import { BacktestResultComponent } from './backtest-result.component';
import type {
  BacktestComparison,
  BacktestDay,
  BacktestDetail,
  TradeMetrics,
} from './backtest.models';

const OPEN_MS = Date.UTC(2026, 7, 14, 3, 45);

function metrics(overrides: Partial<TradeMetrics> = {}): TradeMetrics {
  return {
    trades: 12,
    wins: 7,
    losses: 5,
    scratches: 0,
    winRate: 58.33,
    grossPnl: 12_480,
    costs: 480,
    netPnl: 12_000,
    expectancy: 1_000,
    profitFactor: 1.8,
    avgWin: 3_000,
    avgLoss: -1_800,
    payoffRatio: 1.67,
    largestWin: 6_000,
    largestLoss: -2_400,
    maxDrawdown: 4_200,
    longestWinStreak: 3,
    longestLossStreak: 2,
    exitBreakdown: { TARGET: 7, STOP: 4, SQUARE_OFF: 1 },
    ...overrides,
  };
}

function trade(overrides: Partial<SimTrade> = {}): SimTrade {
  return {
    id: 1,
    strategyId: 'opening-range-break',
    instrumentKey: 'NSE_INDEX|Nifty 50',
    tradingsymbol: 'NIFTY 50',
    side: 'BUY',
    status: 'CLOSED',
    quantity: 75,
    lots: 1,
    lotSize: 75,
    entryTime: OPEN_MS + 30 * 60_000,
    entryPrice: 24_050,
    entryReason: 'closed above the 15m opening high',
    stopPrice: 23_990,
    targetPrice: 24_140,
    exitTime: OPEN_MS + 90 * 60_000,
    exitPrice: 24_140,
    exitReason: 'target hit',
    exitReasonKind: 'TARGET',
    grossPnl: 6_790,
    costs: 40,
    netPnl: 6_750,
    netPnlPct: 0.37,
    mae: -400,
    mfe: 6_800,
    barsHeld: 12,
    features: {},
    ...overrides,
  };
}

function day(overrides: Partial<BacktestDay> = {}): BacktestDay {
  return {
    date: '2026-08-14',
    shape: {
      date: '2026-08-14',
      open: 24_000,
      high: 24_200,
      low: 23_980,
      close: 24_180,
      bars: 375,
      netMovePct: 0.75,
      rangePct: 0.92,
      gapPct: 0.31,
      efficiency: 0.52,
    },
    regime: {
      trend: 'TREND_UP',
      gap: 'GAP_UP',
      volatility: 'NORMAL',
      label: 'GAP_UP · TREND_UP · NORMAL',
    },
    netPnl: 6_750,
    grossPnl: 6_790,
    costs: 40,
    trades: 1,
    wins: 1,
    losses: 0,
    bars: 75,
    note: null,
    ...overrides,
  };
}

function detail(overrides: Partial<BacktestDetail> = {}): BacktestDetail {
  return {
    id: 7,
    label: 'ORB · NIFTY · August',
    strategy: 'opening-range-break',
    strategyName: 'Opening range break',
    params: { rangeMinutes: 15, targetR: 1.5 },
    datasetId: 1,
    underlying: 'NIFTY',
    tradingsymbol: 'NIFTY 50',
    fromDate: '2026-08-01',
    toDate: '2026-08-31',
    capital: 500_000,
    lotSize: 75,
    timeframeMinutes: 5,
    status: 'COMPLETE',
    tradingDays: 20,
    tradeCount: 12,
    netPnl: 12_000,
    metrics: metrics(),
    notes: 'baseline',
    error: null,
    createdAt: '2026-09-01T04:00:00.000Z',
    completedAt: '2026-09-01T04:00:02.000Z',
    days: [day()],
    trades: [trade()],
    byRegime: {
      trend: { TREND_UP: metrics({ trades: 8, netPnl: 16_000 }) },
      gap: { GAP_UP: metrics({ trades: 4, netPnl: -4_000 }) },
      volatility: {},
    },
    skippedDays: 8,
    ...overrides,
  };
}

describe('BacktestResultComponent', () => {
  let fixture: ComponentFixture<BacktestResultComponent>;

  const text = (): string => fixture.nativeElement.textContent as string;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BacktestResultComponent] });
    fixture = TestBed.createComponent(BacktestResultComponent);
  });

  function render(
    value: BacktestDetail | null,
    comparison: BacktestComparison | null = null,
  ): void {
    fixture.componentRef.setInput('detail', value);
    fixture.componentRef.setInput('comparison', comparison);
    fixture.detectChanges();
  }

  it('renders nothing without a run', () => {
    render(null);
    expect(text().trim()).toBe('');
  });

  it('leads with net P&L and expectancy together', () => {
    render(detail());
    expect(text()).toContain('Net P&L');
    expect(text()).toContain('+₹12,000');
    // Over twenty days a total is far too few trades to separate edge from
    // luck; expectancy is what stays comparable across runs.
    expect(text()).toContain('Expectancy / trade');
  });

  /**
   * Without the parameters on screen, a comparison between two runs is
   * meaningless: the difference could be the change under test or one nobody
   * recorded.
   */
  it('shows the parameters the run actually used', () => {
    render(detail());
    expect(text()).toContain('rangeMinutes');
    expect(text()).toContain('targetR');
  });

  it('names what the cost model leaves out', () => {
    render(detail());
    expect(text()).toContain('₹40 flat per sell order');
    expect(text()).toContain('slippage');
  });

  it('breaks results down by market condition', () => {
    render(detail());
    // "−₹5,000" says nothing; "+₹16,000 on trend days, −₹4,000 on gap days" is
    // a change somebody can make.
    expect(text()).toContain('TREND_UP');
    expect(text()).toContain('GAP_UP');
    expect(text()).toContain('+₹16,000');
    expect(text()).toContain('−₹4,000');
  });

  it('drops regime buckets that hold no trades', () => {
    render(
      detail({
        byRegime: {
          trend: { TREND_UP: metrics({ trades: 3 }), SIDEWAYS: metrics({ trades: 0 }) },
          gap: {},
          volatility: {},
        },
      }),
    );
    // A row of dashes for a condition the month never had reads as a failure
    // rather than as an absence.
    expect(text()).not.toContain('SIDEWAYS');
  });

  it('says how many days produced nothing at all', () => {
    render(detail());
    // "20 days, 12 trades" and "20 days, 8 of them filtered out" are very
    // different strategies wearing the same summary.
    expect(text()).toContain('8 / 20');
  });

  it('gives a quiet day its reason instead of a blank row', () => {
    render(
      detail({
        days: [day({ trades: 0, netPnl: 0, wins: 0, note: 'opening range too wide' })],
      }),
    );
    expect(text()).toContain('opening range too wide');
  });

  it('shows each day with its regime and its shape', () => {
    render(detail());
    expect(text()).toContain('2026-08-14');
    expect(text()).toContain('GAP_UP · TREND_UP · NORMAL');
    expect(text()).toContain('0.52'); // efficiency
  });

  it('shows the exit breakdown, which no P&L figure says', () => {
    render(detail());
    expect(text()).toContain('TARGET');
    expect(text()).toContain('STOP');
  });

  it('shows each trade with the reason it was taken', () => {
    render(detail());
    expect(text()).toContain('closed above the 15m opening high');
    expect(text()).toContain('BUY');
  });

  it('marks a short as a short', () => {
    render(detail({ trades: [trade({ side: 'SELL', entryReason: 'broke the opening low' })] }));
    expect(text()).toContain('SELL');
  });

  describe('comparison', () => {
    const comparison = (deltas: BacktestComparison['deltas']): BacktestComparison => ({
      baseline: detail({ id: 6 }),
      candidate: detail({ id: 7 }),
      deltas,
    });

    it('renders the metric-by-metric diff', () => {
      render(
        detail(),
        comparison([
          {
            metric: 'netPnl',
            baseline: 8_000,
            candidate: 12_000,
            change: 4_000,
            higherIsBetter: true,
          },
        ]),
      );

      expect(text()).toContain('#7 against #6');
      expect(text()).toContain('netPnl');
      expect(text()).toContain('+4,000');
    });

    /**
     * `higherIsBetter` travels with each delta so a reader glancing at
     * "maxDrawdown +2,400" knows that is worse without holding the convention.
     */
    it('colours a rise in drawdown as worse, not better', () => {
      const component = fixture.componentInstance as unknown as {
        better(d: { change: number | null; higherIsBetter: boolean }): boolean | null;
      };

      expect(component.better({ change: 4_000, higherIsBetter: true })).toBe(true);
      expect(component.better({ change: 2_400, higherIsBetter: false })).toBe(false);
      expect(component.better({ change: -100, higherIsBetter: false })).toBe(true);
      expect(component.better({ change: 0, higherIsBetter: true })).toBeNull();
      expect(component.better({ change: null, higherIsBetter: true })).toBeNull();
    });
  });

  it('renders an absent metric as a dash, never as zero', () => {
    render(
      detail({
        metrics: metrics({ profitFactor: null, expectancy: null, winRate: null }),
      }),
    );
    // A strategy with no losses has not proved an infinite profit factor, and a
    // zero would say it made nothing per trade.
    expect(text()).toContain('—');
    expect(text()).not.toContain('Infinity');
  });

  it('surfaces a failed run rather than rendering an empty shell', () => {
    render(detail({ status: 'FAILED', error: 'dataset holds no underlying bars' }));
    expect(text()).toContain('dataset holds no underlying bars');
    expect(text()).toContain('FAILED');
  });
});
