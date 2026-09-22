import { Component, input, output } from '@angular/core';
import type { StrategyDescriptor } from '../../strategy/strategy.models';
import { money, signedMoney, tone } from '../format';
import type { BacktestRunSummary, RunBacktestRequest } from '../trading.models';
import { BacktestChartComponent } from './backtest-chart.component';
import { TradingSetupFormComponent } from './trading-setup-form.component';

/**
 * Run the strategy over past days — through the same engine that trades
 * live, so a backtest is a prediction of the live session rather than a
 * separate model of it. Results land in the trade history under "Backtest",
 * and the latest run is drawn on a chart that can be played back.
 */
@Component({
  selector: 'app-backtest-panel',
  standalone: true,
  imports: [TradingSetupFormComponent, BacktestChartComponent],
  template: `
    <p class="lede">
      Replays one-minute history through the live engine's own per-instrument lanes — the same
      signal, stop, hold and sizing code — and records every trade under the Backtest view.
    </p>
    <app-trading-setup-form
      mode="BACKTEST"
      submitLabel="Run backtest"
      busyLabel="Running…"
      [strategies]="strategies()"
      [busy]="busy()"
      (runBacktest)="run.emit($event)"
    />

    @if (result(); as r) {
      <div class="result">
        <span>
          <b>{{ r.strategyName }}</b> · {{ r.from }} → {{ r.to }} · {{ instrumentsOf(r) }}
        </span>
        <span
          >Trades <b>{{ r.stats.trades }}</b></span
        >
        <span
          >Won / lost <b>{{ r.stats.wins }} / {{ r.stats.losses }}</b></span
        >
        <span
          >Win rate <b>{{ r.stats.winRate === null ? '—' : r.stats.winRate + '%' }}</b></span
        >
        <span
          >Net P&L <b [class]="tone(r.stats.netPnl)">{{ signedMoney(r.stats.netPnl) }}</b></span
        >
        <span
          >Ending cash <b>{{ money(r.endingCash) }}</b></span
        >
        @if (r.rejections) {
          <span class="muted">{{ r.rejections }} signal(s) refused for capital</span>
        }
        @if (r.recorded < r.trades.length) {
          <span class="warn">
            {{ r.trades.length - r.recorded }} trade(s) could not be saved to history
          </span>
        }
      </div>
      <app-backtest-chart [result]="r" />
    }

    <div class="history">
      <span>Backtest history: {{ storedTrades() }} saved trade(s)</span>
      <button
        type="button"
        class="danger"
        [disabled]="busy() || storedTrades() === 0"
        (click)="confirmClear()"
      >
        Clear backtest history
      </button>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: 0.9rem;
    }
    .lede {
      margin: 0;
      font-size: 0.78rem;
      color: var(--text-muted);
    }
    .result {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      padding: 0.6rem 0.75rem;
      background: var(--surface-2);
      border-radius: var(--radius-sm);
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    b {
      color: var(--text);
      font-weight: 500;
    }
    b.pos {
      color: var(--up);
    }
    b.neg {
      color: var(--down);
    }
    .warn {
      color: var(--warn);
    }
    .muted {
      color: var(--text-faint);
    }
    .history {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: center;
      justify-content: space-between;
      padding-top: 0.6rem;
      border-top: 1px solid var(--border);
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .danger {
      background: transparent;
      color: var(--danger);
      border: 1px solid var(--danger);
      border-radius: var(--radius-sm);
      padding: 0.3rem 0.8rem;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .danger:disabled {
      opacity: 0.4;
      cursor: default;
    }
  `,
})
export class BacktestPanelComponent {
  readonly strategies = input<readonly StrategyDescriptor[]>([]);
  readonly busy = input(false);
  readonly result = input<BacktestRunSummary | null>(null);
  /** Backtest trades currently saved, so the clear button can say what it deletes. */
  readonly storedTrades = input(0);
  readonly run = output<RunBacktestRequest>();
  readonly clear = output<void>();

  readonly money = money;
  readonly signedMoney = signedMoney;
  readonly tone = tone;

  instrumentsOf(run: BacktestRunSummary): string {
    return run.instruments.map((i) => i.tradingsymbol).join(', ');
  }

  confirmClear(): void {
    const n = this.storedTrades();
    // Deleting history cannot be undone, so say exactly what goes.
    const ok = window.confirm(
      `Delete all ${n} saved backtest trade(s)? Live trades are not affected. This cannot be undone.`,
    );
    if (ok) this.clear.emit();
  }
}
