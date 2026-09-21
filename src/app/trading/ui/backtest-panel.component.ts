import { Component, input, output } from '@angular/core';
import type { StrategyDescriptor } from '../../strategy/strategy.models';
import { money, signedMoney, tone } from '../format';
import type { BacktestRunSummary, RunBacktestRequest } from '../trading.models';
import { TradingSetupFormComponent } from './trading-setup-form.component';

/**
 * Run the strategy over past days — through the same engine that trades
 * live, so a backtest is a prediction of the live session rather than a
 * separate model of it. Results land in the trade history under "Backtest".
 */
@Component({
  selector: 'app-backtest-panel',
  standalone: true,
  imports: [TradingSetupFormComponent],
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
          <b>{{ r.strategyName }}</b> · {{ r.from }} → {{ r.to }} ·
          {{ instrumentsOf(r) }}
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
          <span class="warn"
            >{{ r.trades.length - r.recorded }} trade(s) could not be saved to history</span
          >
        }
      </div>
    }
  `,
  styles: `
    .lede {
      margin: 0 0 0.75rem;
      font-size: 0.78rem;
      color: var(--text-muted);
    }
    .result {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      margin-top: 0.9rem;
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
  `,
})
export class BacktestPanelComponent {
  readonly strategies = input<readonly StrategyDescriptor[]>([]);
  readonly busy = input(false);
  readonly result = input<BacktestRunSummary | null>(null);
  readonly run = output<RunBacktestRequest>();

  readonly money = money;
  readonly signedMoney = signedMoney;
  readonly tone = tone;

  instrumentsOf(run: BacktestRunSummary): string {
    return run.instruments.map((i) => i.tradingsymbol).join(', ');
  }
}
