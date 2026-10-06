import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { price, signedMoney, tone } from '../format';
import type { PaperInstrument, PaperTradeRecord } from '../trading.models';

/**
 * The paper-trading report: one row per closed paper trade, in the columns
 * the backend stores (`paper_trades`), newest first — filterable by index and
 * strategy, with the totals of what is shown.
 */
@Component({
  selector: 'app-paper-report-table',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="bar">
      <label>
        <span>Instrument</span>
        <select [ngModel]="instrument()" (ngModelChange)="instrument.set($event)" name="instrument">
          <option value="">All</option>
          <option value="NIFTY">NIFTY</option>
          <option value="BANKNIFTY">BANK NIFTY</option>
        </select>
      </label>
      <label>
        <span>Strategy</span>
        <select [ngModel]="strategy()" (ngModelChange)="strategy.set($event)" name="strategy">
          <option value="">All</option>
          @for (s of strategies(); track s.id) {
            <option [value]="s.id">{{ s.name }}</option>
          }
        </select>
      </label>
      <div class="summary">
        <span>
          <b>{{ shown().length }}</b> trade{{ shown().length === 1 ? '' : 's' }}
        </span>
        <span>
          Win rate <b>{{ winRate() === null ? '—' : winRate() + '%' }}</b>
        </span>
        <span>
          SL hit <b>{{ stopHits() }}</b>
        </span>
        <span>
          Net <b [class]="tone(netPnl())">{{ signedMoney(netPnl()) }}</b>
        </span>
      </div>
    </div>

    @if (shown().length === 0) {
      <p class="empty">
        {{
          trades().length ? 'No paper trades match these filters.' : 'No paper trades recorded yet.'
        }}
      </p>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th class="num">Lot</th>
              <th>Instrument</th>
              <th>Strategy</th>
              <th>Contract</th>
              <th class="num">Entry</th>
              <th class="num">Exit</th>
              <th>Result</th>
              <th class="num">Stop-loss</th>
              <th>SL hit</th>
              <th class="num">Net P&L</th>
            </tr>
          </thead>
          <tbody>
            @for (t of shown(); track t.tradeId) {
              <tr>
                <td>{{ t.date }}</td>
                <td class="mono">{{ t.time }}</td>
                <td class="num">{{ t.lots }}</td>
                <td>{{ t.instrument === 'BANKNIFTY' ? 'BANK NIFTY' : t.instrument }}</td>
                <td>{{ t.strategyName }}</td>
                <td class="muted">{{ t.tradingsymbol }}</td>
                <td class="num">{{ price(t.entryPrice) }}</td>
                <td class="num">{{ price(t.exitPrice) }}</td>
                <td>
                  <span class="pill" [class.ok]="t.profitable" [class.bad]="!t.profitable">
                    {{ t.profitable ? 'Profit' : 'Loss' }}
                  </span>
                </td>
                <td class="num">{{ price(t.stopLoss) }}</td>
                <td [class.neg]="t.stopLossHit">{{ t.stopLossHit ? 'Yes' : 'No' }}</td>
                <td class="num" [class]="tone(t.netPnl)">{{ signedMoney(t.netPnl) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: `
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 0.75rem 1rem;
      margin-bottom: 0.85rem;
    }
    label {
      display: grid;
      gap: 0.25rem;
      min-width: 10rem;
    }
    label > span {
      font-size: 0.66rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    select {
      padding-top: 0.38rem;
      padding-bottom: 0.38rem;
      font-size: 0.8rem;
    }
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem 1.1rem;
      margin-left: auto;
      font-size: 0.78rem;
      color: var(--text-muted);
    }
    .summary b {
      color: var(--text);
      font-family: var(--font-mono);
      font-weight: 600;
    }
    .summary b.pos {
      color: var(--up);
    }
    .summary b.neg {
      color: var(--down);
    }
    .mono {
      font-family: var(--font-mono);
    }
  `,
})
export class PaperReportTableComponent {
  readonly trades = input<readonly PaperTradeRecord[]>([]);

  readonly instrument = signal<'' | PaperInstrument>('');
  readonly strategy = signal('');

  /** The strategies that appear in the report, for the filter. */
  readonly strategies = computed(() => {
    const byId = new Map<string, string>();
    for (const t of this.trades()) byId.set(t.strategyId, t.strategyName);
    return [...byId].map(([id, name]) => ({ id, name }));
  });

  readonly shown = computed(() =>
    this.trades().filter(
      (t) =>
        (!this.instrument() || t.instrument === this.instrument()) &&
        (!this.strategy() || t.strategyId === this.strategy()),
    ),
  );

  readonly netPnl = computed(() => this.shown().reduce((sum, t) => sum + t.netPnl, 0));
  readonly stopHits = computed(() => this.shown().filter((t) => t.stopLossHit).length);
  readonly winRate = computed(() => {
    const n = this.shown().length;
    return n ? Math.round((this.shown().filter((t) => t.profitable).length / n) * 100) : null;
  });

  readonly price = price;
  readonly signedMoney = signedMoney;
  readonly tone = tone;
}
