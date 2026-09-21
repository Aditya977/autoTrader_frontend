import { Component, computed, input, output } from '@angular/core';
import type { StrategyDescriptor } from '../../strategy/strategy.models';
import { money, price, signedMoney, time, tone } from '../format';
import type { LiveSessionSnapshot, StartLiveTradingRequest } from '../trading.models';
import { TradingSetupFormComponent } from './trading-setup-form.component';

/**
 * Live trading: start a session over any number of instruments, then watch
 * each one's lane — its bars, its open position, its P&L — and the feed.
 *
 * Every instrument is its own row because every instrument is its own lane on
 * the backend: its own candles, its own strategy state, its own position. The
 * only thing they share is the account balance.
 */
@Component({
  selector: 'app-live-session-panel',
  standalone: true,
  imports: [TradingSetupFormComponent],
  template: `
    @if (running(); as s) {
      <div class="bar">
        <span class="badge live">● LIVE</span>
        <span>{{ s.strategyName }}</span>
        <span class="muted"
          >since {{ startedAt(s) }} · {{ s.instruments.length }} instrument(s)</span
        >
        <span class="feed" [class.down]="!s.feed.healthy">
          feed {{ s.feed.healthy ? 'connected' : 'reconnecting…' }}
          @if (s.feed.disconnects) {
            · {{ s.feed.disconnects }} drop(s)
          }
          @if (s.feed.restarts) {
            · {{ s.feed.restarts }} restart(s)
          }
        </span>
        <button type="button" class="danger" [disabled]="busy()" (click)="stop.emit(s.sessionId)">
          Stop &amp; square off
        </button>
      </div>

      <div class="account">
        <span
          >Capital <b>{{ money(s.account.capital) }}</b></span
        >
        <span
          >Available <b>{{ money(s.account.availableBalance) }}</b></span
        >
        <span
          >In positions <b>{{ money(s.account.lockedCapital) }}</b></span
        >
        <span
          >Realised
          <b [class]="tone(s.account.realisedPnl)">{{
            signedMoney(s.account.realisedPnl)
          }}</b></span
        >
        <span
          >Unrealised
          <b [class]="tone(s.account.unrealisedPnl)">{{
            signedMoney(s.account.unrealisedPnl)
          }}</b></span
        >
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Instrument</th>
              <th class="num">Lot</th>
              <th class="num">LTP</th>
              <th class="num">Bars</th>
              <th>Position</th>
              <th class="num">Stop</th>
              <th class="num">Unrealised</th>
              <th class="num">Trades</th>
              <th class="num">Realised</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            @for (lane of s.instruments; track lane.instrumentKey) {
              <tr>
                <td>{{ lane.tradingsymbol }}</td>
                <td class="num">{{ lane.lotSize }}</td>
                <td class="num">{{ price(lane.lastPrice) }}</td>
                <td class="num" [title]="'warm-up ' + lane.warmupBars + ' bars'">
                  {{ lane.barsSeen }}
                </td>
                <td>
                  @if (lane.openTrade; as t) {
                    {{ t.side }} {{ t.lots }}×{{ t.lotSize }} @ {{ price(t.entryPrice) }}
                  } @else {
                    <span class="muted">flat</span>
                  }
                </td>
                <td class="num">{{ price(lane.openTrade?.stopLoss) }}</td>
                <td class="num" [class]="tone(lane.openTrade ? lane.unrealisedPnl : 0)">
                  {{ lane.openTrade ? signedMoney(lane.unrealisedPnl) : '—' }}
                </td>
                <td class="num">{{ lane.tradeCount }}</td>
                <td class="num" [class]="tone(lane.realisedPnl)">
                  {{ signedMoney(lane.realisedPnl) }}
                </td>
                <td class="note">
                  @if (lane.error) {
                    <span class="err">{{ lane.error }}</span>
                  } @else if (lane.lastRejection) {
                    {{ lane.lastRejection }}
                  } @else if (lane.ticks === 0) {
                    <span class="muted">waiting for ticks</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <details class="activity" open>
        <summary>Activity</summary>
        <ul>
          @for (a of s.activity; track $index) {
            <li [class]="a.kind">
              <span class="t">{{ time(a.at) }}</span>
              @if (a.tradingsymbol) {
                <span class="sym">{{ a.tradingsymbol }}</span>
              }
              <span>{{ a.message }}</span>
            </li>
          }
        </ul>
      </details>
    } @else {
      <p class="lede">
        Streams every instrument below over one Upstox connection and runs the strategy on each one
        independently. Fills are simulated at the candle close — no order is sent to the broker.
      </p>
      <app-trading-setup-form
        mode="LIVE"
        submitLabel="Start live trading"
        busyLabel="Starting…"
        [strategies]="strategies()"
        [busy]="busy()"
        (startLive)="start.emit($event)"
      />
      @if (last(); as l) {
        <p class="muted small">
          Last session {{ l.status.toLowerCase() }} — {{ l.strategyName }} on {{ l.tradeDate }}.
          @if (l.error) {
            <span class="err">{{ l.error }}</span>
          }
        </p>
      }
    }
  `,
  styles: `
    .bar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: center;
      font-size: 0.8rem;
      margin-bottom: 0.6rem;
    }
    .badge.live {
      color: var(--up);
      font-weight: 600;
    }
    .feed {
      color: var(--up);
      font-size: 0.72rem;
    }
    .feed.down {
      color: var(--warn);
    }
    .danger {
      margin-left: auto;
      background: transparent;
      color: var(--danger);
      border: 1px solid var(--danger);
      border-radius: var(--radius-sm);
      padding: 0.3rem 0.8rem;
      cursor: pointer;
    }
    .account {
      display: flex;
      flex-wrap: wrap;
      gap: 1.25rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-bottom: 0.6rem;
    }
    .account b {
      color: var(--text);
      font-family: var(--font-mono);
      font-weight: 500;
    }
    .table-wrap {
      overflow-x: auto;
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
    .note {
      white-space: normal;
      color: var(--text-muted);
      max-width: 22rem;
    }
    .pos {
      color: var(--up);
    }
    .neg {
      color: var(--down);
    }
    .muted {
      color: var(--text-muted);
    }
    .small {
      font-size: 0.75rem;
    }
    .err {
      color: var(--danger);
    }
    .lede {
      margin: 0 0 0.75rem;
      font-size: 0.78rem;
      color: var(--text-muted);
    }
    .activity {
      margin-top: 0.75rem;
      font-size: 0.75rem;
    }
    .activity summary {
      cursor: pointer;
      color: var(--text-muted);
    }
    .activity ul {
      list-style: none;
      margin: 0.4rem 0 0;
      padding: 0;
      max-height: 14rem;
      overflow-y: auto;
    }
    .activity li {
      display: flex;
      gap: 0.5rem;
      padding: 0.2rem 0;
      border-bottom: 1px dashed var(--border);
    }
    .activity .t {
      font-family: var(--font-mono);
      color: var(--text-faint);
    }
    .activity .sym {
      color: var(--accent);
    }
    .activity .ENTRY {
      color: var(--up);
    }
    .activity .EXIT {
      color: var(--text);
    }
    .activity .ERROR,
    .activity .FEED_DOWN {
      color: var(--warn);
    }
  `,
})
export class LiveSessionPanelComponent {
  readonly sessions = input<readonly LiveSessionSnapshot[]>([]);
  readonly strategies = input<readonly StrategyDescriptor[]>([]);
  readonly busy = input(false);

  readonly start = output<StartLiveTradingRequest>();
  readonly stop = output<string>();

  readonly running = computed(
    () => this.sessions().find((s) => s.status === 'RUNNING' || s.status === 'STARTING') ?? null,
  );
  readonly last = computed(() => this.sessions().find((s) => s.status !== 'RUNNING') ?? null);

  readonly money = money;
  readonly price = price;
  readonly signedMoney = signedMoney;
  readonly tone = tone;
  readonly time = time;

  startedAt(session: LiveSessionSnapshot): string {
    return time(Date.parse(session.startedAt));
  }
}
