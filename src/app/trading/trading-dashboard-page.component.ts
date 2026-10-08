import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, interval, type Observable } from 'rxjs';
import { AppHeaderComponent } from '../shared/app-header.component';
import { PreferencesService } from '../shared/preferences.service';
import { StrategyApiService } from '../strategy/strategy-api.service';
import type { StrategyDescriptor } from '../strategy/strategy.models';
import { TradingApiService } from './trading-api.service';
import type {
  BacktestRunSummary,
  DashboardOverview,
  DashboardPerformance,
  DashboardTrade,
  PaperTradeRecord,
  PaperTradingStatus,
  RunBacktestRequest,
  StrategyDeployment,
  TradeMode,
} from './trading.models';
import { BacktestPanelComponent } from './ui/backtest-panel.component';
import { OverviewCardsComponent } from './ui/overview-cards.component';
import { PaperReportTableComponent } from './ui/paper-report-table.component';
import { PaperStatusPanelComponent } from './ui/paper-status-panel.component';
import { PerformancePanelComponent } from './ui/performance-panel.component';
import { StrategyDeploymentsComponent } from './ui/strategy-deployments.component';
import { TradeHistoryTableComponent } from './ui/trade-history-table.component';

/** How often the page refreshes while a paper session is trading. */
const RUNNING_REFRESH_MS = 5_000;
/** How often it checks whether the backend has started (or ended) a session. */
const IDLE_REFRESH_MS = 30_000;

/**
 * Trading Dashboard — paper trading and backtests, never mixed.
 *
 * - **Paper trading**: which strategies are deployed, what today's session is
 *   doing, and the report of every paper trade. The backend runs it on its own;
 *   capital and lot size are its, not the page's.
 * - **Backtest**: run a strategy over past days and read what it would have done.
 */
@Component({
  selector: 'app-trading-dashboard-page',
  standalone: true,
  imports: [
    AppHeaderComponent,
    OverviewCardsComponent,
    PaperStatusPanelComponent,
    StrategyDeploymentsComponent,
    PaperReportTableComponent,
    BacktestPanelComponent,
    PerformancePanelComponent,
    TradeHistoryTableComponent,
  ],
  template: `
    <app-header>
      <div class="mode" role="tablist" aria-label="Paper trading or backtests">
        <button
          type="button"
          role="tab"
          [class.on]="mode() === 'PAPER'"
          [attr.aria-selected]="mode() === 'PAPER'"
          (click)="setMode('PAPER')"
        >
          Paper trading
        </button>
        <button
          type="button"
          role="tab"
          [class.on]="mode() === 'BACKTEST'"
          [attr.aria-selected]="mode() === 'BACKTEST'"
          (click)="setMode('BACKTEST')"
        >
          Backtest
        </button>
      </div>
    </app-header>

    <main>
      <div class="page-head">
        <h1>{{ mode() === 'PAPER' ? 'Paper trading' : 'Backtest' }}</h1>
        <p>
          @if (mode() === 'PAPER') {
            The enabled strategies trade NIFTY and BANK NIFTY options on the live feed with
            simulated fills. The backend starts and ends each day's session on its own.
          } @else {
            Run a strategy over past days through the same engine paper trading uses.
          }
        </p>
      </div>

      @if (error(); as e) {
        <div class="banner" role="alert">
          <span>{{ e }}</span>
          <button type="button" class="link" (click)="error.set(null)">Dismiss</button>
        </div>
      }

      <app-overview-cards [overview]="overview()" />

      @if (mode() === 'PAPER') {
        <div class="split">
          <section class="card">
            <div class="card-head">
              <h2>Today's session</h2>
              @if (paperStatus()?.session; as s) {
                <span class="meta">{{ s.tradeDate }}</span>
              }
            </div>
            <app-paper-status-panel
              [status]="paperStatus()"
              [busy]="busy()"
              (pause)="pausePaper()"
              (resume)="resumePaper()"
            />
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Strategies</h2>
              <span class="meta">{{ enabledCount() }} of {{ deployments().length }} enabled</span>
            </div>
            <app-strategy-deployments
              [deployments]="deployments()"
              [allocations]="paperStatus()?.allocations ?? []"
              [strategyAllocations]="paperStatus()?.strategyAllocations ?? {}"
              [running]="paperStatus()?.state === 'RUNNING'"
              [busy]="busy()"
              (toggle)="setEnabled($event)"
            />
          </section>
        </div>
      } @else {
        <section class="card">
          <div class="card-head"><h2>Run a backtest</h2></div>
          <app-backtest-panel
            [strategies]="strategies()"
            [busy]="busy()"
            [result]="lastBacktest()"
            [storedTrades]="storedBacktests()"
            (run)="runBacktest($event)"
            (clear)="clearBacktests()"
          />
        </section>
      }

      <section class="card">
        <div class="card-head">
          <h2>Performance</h2>
          <span class="meta">{{ rangeLabel() || 'all time' }}</span>
        </div>
        <app-performance-panel
          [performance]="performance()"
          [from]="from()"
          [to]="to()"
          (rangeChange)="setRange($event)"
        />
      </section>

      <section class="card">
        @if (mode() === 'PAPER') {
          <div class="card-head">
            <h2>Paper-trading report</h2>
            <span class="meta">{{ rangeLabel() || 'all time' }}</span>
          </div>
          <app-paper-report-table [trades]="paperTrades()" />
        } @else {
          <div class="card-head">
            <h2>Backtest trades</h2>
            <span class="meta"
              >{{ trades().length }} trade(s) · {{ rangeLabel() || 'all time' }}</span
            >
          </div>
          <app-trade-history-table
            [trades]="trades()"
            emptyText="No backtest trades yet — run one above."
          />
        }
      </section>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }
    .mode {
      display: inline-flex;
      padding: 0.15rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }
    .mode button {
      padding: 0.3rem 0.85rem;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text-muted);
      font-size: 0.78rem;
    }
    .mode button:hover:not(:disabled) {
      background: transparent;
      color: var(--text);
    }
    .mode button.on {
      background: rgba(59, 167, 255, 0.15);
      color: var(--accent);
      font-weight: 600;
    }
    main {
      display: grid;
      gap: 1rem;
      max-width: 1500px;
      margin: 0 auto;
      padding: 1.25rem 1.5rem 3rem;
    }
    .page-head h1 {
      font-size: 1.15rem;
    }
    .page-head p {
      margin: 0.2rem 0 0;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .split {
      display: grid;
      gap: 1rem;
      align-items: start;
    }
    @media (min-width: 1100px) {
      .split {
        grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
      }
    }
    .banner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      padding: 0.6rem 0.9rem;
      border: 1px solid rgba(240, 102, 107, 0.5);
      border-radius: var(--radius-sm);
      background: rgba(240, 102, 107, 0.08);
      color: var(--danger);
      font-size: 0.8rem;
    }
    .banner .link {
      color: inherit;
    }
    @media (max-width: 640px) {
      main {
        padding: 1rem 1rem 2.5rem;
      }
    }
  `,
})
export class TradingDashboardPageComponent implements OnInit {
  private readonly api = inject(TradingApiService);
  private readonly strategyApi = inject(StrategyApiService);
  private readonly prefs = inject(PreferencesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly mode = signal<TradeMode>(
    this.prefs.get<string>('trading.mode', 'PAPER') === 'BACKTEST' ? 'BACKTEST' : 'PAPER',
  );
  readonly strategies = signal<StrategyDescriptor[]>([]);
  readonly paperStatus = signal<PaperTradingStatus | null>(null);
  readonly deployments = signal<StrategyDeployment[]>([]);
  readonly overview = signal<DashboardOverview | null>(null);
  readonly performance = signal<DashboardPerformance | null>(null);
  readonly trades = signal<DashboardTrade[]>([]);
  readonly paperTrades = signal<PaperTradeRecord[]>([]);
  readonly lastBacktest = signal<BacktestRunSummary | null>(null);
  readonly storedBacktests = signal(0);
  readonly from = signal('');
  readonly to = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly paperActive = computed(() => {
    const state = this.paperStatus()?.state;
    return state === 'RUNNING' || state === 'STARTING';
  });
  readonly enabledCount = computed(() => this.deployments().filter((d) => d.enabled).length);

  readonly rangeLabel = computed(() => {
    const from = this.from();
    const to = this.to();
    if (!from && !to) return '';
    return `${from || '…'} → ${to || '…'}`;
  });

  private sinceRefreshMs = 0;

  ngOnInit(): void {
    this.strategyApi
      .catalogue()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ strategies }) => this.strategies.set(strategies),
        error: (e: Error) => this.error.set(`Could not load strategies: ${e.message}`),
      });

    this.refresh();

    // Paper figures move while a session trades; when idle, a slower check
    // still notices the backend starting the day's session on its own.
    interval(RUNNING_REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.mode() !== 'PAPER') return;
        this.sinceRefreshMs += RUNNING_REFRESH_MS;
        if (this.paperActive() || this.sinceRefreshMs >= IDLE_REFRESH_MS) this.refresh();
      });
  }

  setMode(mode: TradeMode): void {
    if (mode === this.mode()) return;
    this.mode.set(mode);
    this.prefs.set('trading.mode', mode);
    this.refresh();
  }

  setRange(range: { from: string; to: string }): void {
    this.from.set(range.from);
    this.to.set(range.to);
    this.refresh();
  }

  setEnabled(change: { strategyId: string; enabled: boolean }): void {
    this.act(
      this.api.setStrategyEnabled(change.strategyId, change.enabled),
      `Could not ${change.enabled ? 'enable' : 'disable'} the strategy`,
    );
  }

  pausePaper(): void {
    this.act(this.api.pausePaper(), 'Could not pause paper trading');
  }

  resumePaper(): void {
    this.act(this.api.resumePaper(), 'Could not resume paper trading');
  }

  clearBacktests(): void {
    this.busy.set(true);
    this.api.clearBacktests().subscribe({
      next: () => {
        this.busy.set(false);
        this.lastBacktest.set(null);
        this.refresh();
      },
      error: (e: Error) => {
        this.busy.set(false);
        this.error.set(`Could not clear backtest history: ${e.message}`);
      },
    });
  }

  runBacktest(request: RunBacktestRequest): void {
    this.busy.set(true);
    this.error.set(null);
    this.api.runBacktest(request).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.lastBacktest.set(result);
        this.refresh();
      },
      error: (e: Error) => {
        this.busy.set(false);
        this.error.set(`Backtest failed: ${e.message}`);
      },
    });
  }

  /** Runs one control call, then reloads the page's figures either way. */
  private act(call: Observable<unknown>, failure: string): void {
    this.busy.set(true);
    this.error.set(null);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        this.refresh();
      },
      error: (e: Error) => {
        this.busy.set(false);
        this.error.set(`${failure}: ${e.message}`);
        this.refresh();
      },
    });
  }

  /** Everything the page shows, for the current mode and range, in one round. */
  private refresh(): void {
    this.sinceRefreshMs = 0;
    const range = {
      ...(this.from() ? { from: this.from() } : {}),
      ...(this.to() ? { to: this.to() } : {}),
    };
    if (this.mode() === 'PAPER') {
      forkJoin({
        status: this.api.paperStatus(),
        deployments: this.api.deployments(),
        overview: this.api.overview('PAPER'),
        performance: this.api.performance('PAPER', this.from() || null, this.to() || null),
        report: this.api.paperTrades({ ...range, limit: 1000 }),
      })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: ({ status, deployments, overview, performance, report }) => {
            this.paperStatus.set(status);
            this.deployments.set(deployments.strategies);
            this.overview.set(overview);
            this.performance.set(performance);
            this.paperTrades.set(report.trades);
          },
          error: (e: Error) => this.error.set(`Could not load the dashboard: ${e.message}`),
        });
      return;
    }

    const capital = this.prefs.get<number | null>('trading.capital', null);
    forkJoin({
      overview: this.api.overview('BACKTEST', capital),
      performance: this.api.performance('BACKTEST', this.from() || null, this.to() || null),
      trades: this.api.trades({ mode: 'BACKTEST', ...range, limit: 1000 }),
      // All-time backtest count, for the clear button, whatever range is shown.
      backtests: this.api.performance('BACKTEST'),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ overview, performance, trades, backtests }) => {
          this.overview.set(overview);
          this.performance.set(performance);
          this.trades.set(trades.trades);
          this.storedBacktests.set(backtests.range.trades);
        },
        error: (e: Error) => this.error.set(`Could not load the dashboard: ${e.message}`),
      });
  }
}
