import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { money, percent, signedMoney, tone } from '../format';
import type { DashboardPerformance, PnlBucket } from '../trading.models';

type Period = 'daily' | 'weekly' | 'monthly';

/**
 * Performance over a chosen window: the headline figures for the whole range,
 * then the same figures per day, week (Monday-dated) or month.
 *
 * The range is the parent's to fetch — this component only says which range
 * the user picked — so the dashboard keeps one source of truth for the dates.
 */
@Component({
  selector: 'app-performance-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="controls">
      <div class="seg" role="tablist" aria-label="Period">
        @for (p of periods; track p.key) {
          <button
            type="button"
            role="tab"
            [class.on]="period() === p.key"
            [attr.aria-selected]="period() === p.key"
            (click)="period.set(p.key)"
          >
            {{ p.label }}
          </button>
        }
      </div>
      <label>
        From
        <input
          type="date"
          [ngModel]="from()"
          (ngModelChange)="rangeChange.emit({ from: $event, to: to() })"
        />
      </label>
      <label>
        To
        <input
          type="date"
          [ngModel]="to()"
          (ngModelChange)="rangeChange.emit({ from: from(), to: $event })"
        />
      </label>
      <button type="button" class="ghost" (click)="rangeChange.emit({ from: '', to: '' })">
        All time
      </button>
    </div>

    @if (performance(); as perf) {
      <div class="stats">
        <div>
          <span>Net P&L</span
          ><b [class]="toneOf(perf.range.netPnl)">{{ signedMoney(perf.range.netPnl) }}</b>
        </div>
        <div>
          <span>Trades</span><b>{{ perf.range.trades }}</b>
        </div>
        <div>
          <span>Won / lost</span><b>{{ perf.range.wins }} / {{ perf.range.losses }}</b>
        </div>
        <div>
          <span>Win rate</span
          ><b>{{ perf.range.winRate === null ? '—' : perf.range.winRate + '%' }}</b>
        </div>
        <div>
          <span>Avg profit</span><b class="pos">{{ money(perf.range.avgProfit) }}</b>
        </div>
        <div>
          <span>Avg loss</span><b class="neg">{{ money(perf.range.avgLoss) }}</b>
        </div>
        <div>
          <span>Avg per trade</span
          ><b [class]="toneOf(perf.range.avgPnl)">{{ signedMoney(perf.range.avgPnl) }}</b>
        </div>
        <div>
          <span>Charges</span><b>{{ money(perf.range.costs) }}</b>
        </div>
      </div>

      @if (rows().length === 0) {
        <p class="empty">No closed trades in this range.</p>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ periodLabel() }}</th>
                <th class="num">Trades</th>
                <th class="num">Won</th>
                <th class="num">Lost</th>
                <th class="num">Win rate</th>
                <th class="num">Avg profit</th>
                <th class="num">Avg loss</th>
                <th class="num">Net P&L</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.period) {
                <tr>
                  <td>{{ row.period }}</td>
                  <td class="num">{{ row.trades }}</td>
                  <td class="num">{{ row.wins }}</td>
                  <td class="num">{{ row.losses }}</td>
                  <td class="num">{{ row.winRate === null ? '—' : percentOf(row.winRate) }}</td>
                  <td class="num">{{ money(row.avgProfit) }}</td>
                  <td class="num">{{ money(row.avgLoss) }}</td>
                  <td class="num" [class]="toneOf(row.netPnl)">{{ signedMoney(row.netPnl) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }
  `,
  styles: `
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
      align-items: center;
      margin-bottom: 0.75rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .seg {
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .seg button {
      background: transparent;
      color: var(--text-muted);
      border: 0;
      padding: 0.3rem 0.7rem;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .seg button.on {
      background: var(--surface-3);
      color: var(--text);
    }
    label {
      display: inline-flex;
      gap: 0.35rem;
      align-items: center;
    }
    input {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.25rem 0.4rem;
      font: inherit;
    }
    .ghost {
      background: transparent;
      color: var(--text-muted);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.3rem 0.6rem;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .stats div {
      display: grid;
      gap: 0.1rem;
      padding: 0.5rem 0.6rem;
      background: var(--surface-2);
      border-radius: var(--radius-sm);
    }
    .stats span {
      font-size: 0.68rem;
      color: var(--text-muted);
    }
    .stats b {
      font-family: var(--font-mono);
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    .pos {
      color: var(--up);
    }
    .neg {
      color: var(--down);
    }
    .empty {
      color: var(--text-muted);
      font-size: 0.8rem;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
    }
    th,
    td {
      padding: 0.4rem 0.55rem;
      border-bottom: 1px solid var(--border);
      text-align: left;
      white-space: nowrap;
    }
    th {
      color: var(--text-muted);
      font-weight: 500;
    }
    .num {
      text-align: right;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class PerformancePanelComponent {
  readonly performance = input<DashboardPerformance | null>(null);
  readonly from = input<string>('');
  readonly to = input<string>('');
  readonly rangeChange = output<{ from: string; to: string }>();

  readonly periods: readonly { key: Period; label: string }[] = [
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
  ];
  readonly period = signal<Period>('daily');

  readonly rows = computed<PnlBucket[]>(() => {
    const perf = this.performance();
    if (!perf) return [];
    // Newest first: the recent past is what a dashboard is opened to see.
    return [...perf[this.period()]].reverse();
  });

  readonly periodLabel = computed(() =>
    this.period() === 'daily' ? 'Day' : this.period() === 'weekly' ? 'Week of' : 'Month',
  );

  readonly money = money;
  readonly signedMoney = signedMoney;
  readonly toneOf = tone;
  percentOf(value: number): string {
    return percent(value).replace('+', '');
  }
}
