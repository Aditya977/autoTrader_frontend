import { Component, input } from '@angular/core';
import { dateTime, percent, price, signedMoney, tone } from '../format';
import type { DashboardTrade } from '../trading.models';

/**
 * Every trade, newest first, with everything needed to audit it: when, what,
 * which strategy, the fill prices, the size in units and lots, the stop and
 * target it carried, what it made, why it ended, and the order ids.
 */
@Component({
  selector: 'app-trade-history-table',
  standalone: true,
  template: `
    @if (trades().length === 0) {
      <p class="empty">{{ emptyText() }}</p>
    } @else {
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Entry (IST)</th>
              <th>Exit (IST)</th>
              <th>Instrument</th>
              <th>Strategy</th>
              <th>Side</th>
              <th class="num">Entry</th>
              <th class="num">Exit</th>
              <th class="num">Qty</th>
              <th class="num">Lots</th>
              <th class="num">Stop-loss</th>
              <th class="num">Target</th>
              <th class="num">P&L</th>
              <th class="num">P&L %</th>
              <th>Status / exit reason</th>
              <th>Trade ID</th>
              <th>Order IDs</th>
            </tr>
          </thead>
          <tbody>
            @for (t of trades(); track t.tradeId) {
              <tr>
                <td>{{ dateTime(t.entryAt) }}</td>
                <td>{{ dateTime(t.exitAt) }}</td>
                <td>{{ t.tradingsymbol }}</td>
                <td>{{ t.strategyName }}</td>
                <td [class]="t.side === 'BUY' ? 'pos' : 'neg'">{{ t.side }}</td>
                <td class="num">{{ price(t.entryPrice) }}</td>
                <td class="num">{{ price(t.exitPrice) }}</td>
                <td class="num">{{ t.quantity }}</td>
                <td class="num">{{ t.lots ?? '—' }}</td>
                <td class="num">{{ price(t.stopLoss) }}</td>
                <td class="num">{{ price(t.target) }}</td>
                <td class="num" [class]="tone(t.netPnl)">{{ signedMoney(t.netPnl) }}</td>
                <td class="num" [class]="tone(t.netPnlPct)">{{ percent(t.netPnlPct) }}</td>
                <td>
                  <span class="status" [class.open]="t.status === 'OPEN'">{{ t.status }}</span>
                  @if (t.exitReason) {
                    <span class="code">{{ t.exitReason }}</span>
                  }
                  @if (t.exitNote) {
                    <span class="reason">{{ t.exitNote }}</span>
                  }
                </td>
                <td class="ids">{{ t.tradeId }}</td>
                <td class="ids">
                  <span>{{ t.entryOrderId ?? '—' }}</span>
                  @if (t.exitOrderId) {
                    <span>{{ t.exitOrderId }}</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: `
    .empty {
      color: var(--text-muted);
      font-size: 0.8rem;
    }
    .table-wrap {
      overflow-x: auto;
      max-height: 32rem;
      overflow-y: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.75rem;
    }
    th,
    td {
      padding: 0.4rem 0.55rem;
      border-bottom: 1px solid var(--border);
      text-align: left;
      white-space: nowrap;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--surface);
      color: var(--text-muted);
      font-weight: 500;
    }
    .num {
      text-align: right;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
    }
    .pos {
      color: var(--up);
    }
    .neg {
      color: var(--down);
    }
    .status {
      font-size: 0.68rem;
      padding: 0.05rem 0.35rem;
      border-radius: 4px;
      background: var(--surface-3);
      margin-right: 0.35rem;
    }
    .status.open {
      background: var(--accent-dim);
    }
    .code {
      font-family: var(--font-mono);
      font-size: 0.68rem;
      margin-right: 0.35rem;
    }
    .reason {
      color: var(--text-muted);
    }
    .ids {
      display: grid;
      font-family: var(--font-mono);
      font-size: 0.68rem;
      color: var(--text-faint);
    }
  `,
})
export class TradeHistoryTableComponent {
  readonly trades = input<readonly DashboardTrade[]>([]);
  readonly emptyText = input('No trades recorded yet.');

  readonly dateTime = dateTime;
  readonly price = price;
  readonly signedMoney = signedMoney;
  readonly percent = percent;
  readonly tone = tone;
}
