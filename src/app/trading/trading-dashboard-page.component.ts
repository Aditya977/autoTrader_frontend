import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, interval } from 'rxjs';
import { NavTabsComponent } from '../shared/nav-tabs.component';
import { PreferencesService } from '../shared/preferences.service';
import { StrategyApiService } from '../strategy/strategy-api.service';
import type { StrategyDescriptor } from '../strategy/strategy.models';
import { TradingApiService } from './trading-api.service';
import type {
  BacktestRunSummary,
  DashboardOverview,
  DashboardPerformance,
  DashboardTrade,
  LiveSessionSnapshot,
  RunBacktestRequest,
  StartLiveTradingRequest,
  TradeMode,
} from './trading.models';
import { BacktestPanelComponent } from './ui/backtest-panel.component';
import { LiveSessionPanelComponent } from './ui/live-session-panel.component';
import { OverviewCardsComponent } from './ui/overview-cards.component';
import { PerformancePanelComponent } from './ui/performance-panel.component';
import { TradeHistoryTableComponent } from './ui/trade-history-table.component';

/** How often the page refreshes while a live session is running. */
const LIVE_REFRESH_MS = 5_000;

/**
 * Trading Dashboard — formerly "Backtest".
 *
 * One page for live trading and for history, because they are one engine: the
 * live session and the backtest run the same strategy code through the same
 * per-instrument lanes and write to the same trade history. The Live /
 * Backtest switch chooses whose trades the overview, performance and history
 * describe — today's P&L must never include a backtest of last March — and
 * which control panel is shown.
 */
@Component({
  selector: 'app-trading-dashboard-page',
  standalone: true,
  imports: [
    NavTabsComponent,
    OverviewCardsComponent,
    LiveSessionPanelComponent,
    BacktestPanelComponent,
    PerformancePanelComponent,
    TradeHistoryTableComponent,
  ],
  template: `
    <header class="topbar">
      <div class="brand">
        <span class="mark">T</span>
        <h1>Trading Dashboard</h1>
      </div>
      <div class="mode" role="tablist" aria-label="Which trades to show">
        <button
          type="button"
          role="tab"
          [class.on]="mode() === 'LIVE'"
          [attr.aria-selected]="mode() === 'LIVE'"
          (click)="setMode('LIVE')"
        >
          Live
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
      <app-nav-tabs />
    </header>

    <main>
      @if (error(); as e) {
        <div class="banner" role="alert">
          {{ e }}
          <button type="button" (click)="error.set(null)">Dismiss</button>
        </div>
      }

      <section>
        <h2>
          Current overview
          <span class="sub">{{ mode() === 'LIVE' ? 'live trades' : 'backtest trades' }}</span>
        </h2>
        <app-overview-cards [overview]="overview()" />
      </section>

      <section>
        @if (mode() === 'LIVE') {
          <h2>Live trading</h2>
          <app-live-session-panel
            [sessions]="sessions()"
            [strategies]="strategies()"
            [busy]="busy()"
            (start)="startLive($event)"
            (stop)="stopLive($event)"
          />
        } @else {
          <h2>Run a backtest</h2>
          <app-backtest-panel
            [strategies]="strategies()"
            [busy]="busy()"
            [result]="lastBacktest()"
            (run)="runBacktest($event)"
          />
        }
      </section>

      <section>
        <h2>Performance</h2>
        <app-performance-panel
          [performance]="performance()"
          [from]="from()"
          [to]="to()"
          (rangeChange)="setRange($event)"
        />
      </section>

      <section>
        <h2>
          Trade history
          <span class="sub">{{ trades().length }} trade(s){{ rangeLabel() }}</span>
        </h2>
        <app-trade-history-table
          [trades]="trades()"
          [emptyText]="
            mode() === 'LIVE'
              ? 'No live trades recorded yet.'
              : 'No backtest trades yet — run one above.'
          "
        />
      </section>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 1.5rem;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .topbar app-nav-tabs {
      margin-left: auto;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.7rem;
    }
    .mark {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--accent);
      font-size: 0.85rem;
      font-weight: 600;
    }
    h1 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }
    .mode {
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .mode button {
      background: transparent;
      color: var(--text-muted);
      border: 0;
      padding: 0.3rem 0.9rem;
      font-size: 0.78rem;
      cursor: pointer;
    }
    .mode button.on {
      background: var(--surface-3);
      color: var(--text);
    }
    main {
      display: grid;
      gap: 1rem;
      padding: 1.25rem 1.5rem 2.5rem;
      max-width: 1500px;
      margin: 0 auto;
    }
    section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.1rem;
      min-width: 0;
    }
    h2 {
      margin: 0 0 0.75rem;
      font-size: 0.9rem;
      font-weight: 600;
    }
    .sub {
      margin-left: 0.5rem;
      font-size: 0.72rem;
      font-weight: 400;
      color: var(--text-muted);
    }
    .banner {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.6rem 0.9rem;
      border: 1px solid var(--danger);
      border-radius: var(--radius-sm);
      color: var(--danger);
      font-size: 0.8rem;
    }
    .banner button {
      background: transparent;
      border: 0;
      color: inherit;
      cursor: pointer;
    }
    @media (max-width: 640px) {
      .topbar,
      main {
        padding-left: 1rem;
        padding-right: 1rem;
      }
    }
  `,
})
export class TradingDashboardPageComponent implements OnInit {
  private readonly api = inject(TradingApiService);
  private readonly strategyApi = inject(StrategyApiService);
  private readonly prefs = inject(PreferencesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly mode = signal<TradeMode>(this.prefs.get<TradeMode>('trading.mode', 'LIVE'));
  readonly strategies = signal<StrategyDescriptor[]>([]);
  readonly sessions = signal<LiveSessionSnapshot[]>([]);
  readonly overview = signal<DashboardOverview | null>(null);
  readonly performance = signal<DashboardPerformance | null>(null);
  readonly trades = signal<DashboardTrade[]>([]);
  readonly lastBacktest = signal<BacktestRunSummary | null>(null);
  readonly from = signal('');
  readonly to = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly liveRunning = computed(() =>
    this.sessions().some((s) => s.status === 'RUNNING' || s.status === 'STARTING'),
  );

  readonly rangeLabel = computed(() => {
    const from = this.from();
    const to = this.to();
    if (!from && !to) return '';
    return ` · ${from || '…'} → ${to || '…'}`;
  });

  ngOnInit(): void {
    this.strategyApi
      .catalogue()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ strategies }) => this.strategies.set(strategies),
        error: (e: Error) => this.error.set(`Could not load strategies: ${e.message}`),
      });

    this.refresh();

    // Figures move only while a session trades, so only then is it worth
    // asking every few seconds.
    interval(LIVE_REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.liveRunning()) this.refresh();
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

  startLive(request: StartLiveTradingRequest): void {
    this.busy.set(true);
    this.error.set(null);
    this.api.startLive(request).subscribe({
      next: () => {
        this.busy.set(false);
        this.refresh();
      },
      error: (e: Error) => {
        this.busy.set(false);
        this.error.set(`Could not start live trading: ${e.message}`);
        this.refresh();
      },
    });
  }

  stopLive(sessionId: string): void {
    this.busy.set(true);
    this.api.stopLive(sessionId).subscribe({
      next: () => {
        this.busy.set(false);
        this.refresh();
      },
      error: (e: Error) => {
        this.busy.set(false);
        this.error.set(`Could not stop the session: ${e.message}`);
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

  /** Everything the page shows, for the current mode and range, in one round. */
  private refresh(): void {
    const mode = this.mode();
    const capital = this.prefs.get<number | null>('trading.capital', null);
    forkJoin({
      sessions: this.api.liveSessions(),
      overview: this.api.overview(mode, capital),
      performance: this.api.performance(mode, this.from() || null, this.to() || null),
      trades: this.api.trades({
        mode,
        ...(this.from() ? { from: this.from() } : {}),
        ...(this.to() ? { to: this.to() } : {}),
        limit: 1000,
      }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ sessions, overview, performance, trades }) => {
          this.sessions.set(sessions.sessions);
          this.overview.set(overview);
          this.performance.set(performance);
          this.trades.set(trades.trades);
        },
        error: (e: Error) => this.error.set(`Could not load the dashboard: ${e.message}`),
      });
  }
}
