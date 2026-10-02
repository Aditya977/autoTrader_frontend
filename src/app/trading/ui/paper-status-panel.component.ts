import { Component, computed, input, output } from '@angular/core';
import { money, price, signedMoney, time, tone } from '../format';
import type { PaperTradingStatus } from '../trading.models';

/**
 * Paper trading as it stands: whether today's session runs and, if not, why;
 * the contracts it streams; every strategy's book on every index; and the
 * session's activity. The backend starts and ends sessions on its own — the
 * only controls are pause (for the rest of today) and resume.
 */
@Component({
  selector: 'app-paper-status-panel',
  standalone: true,
  template: `
    @if (status(); as st) {
      <div class="state">
        <span
          class="pill"
          [class.ok]="st.state === 'RUNNING'"
          [class.warn]="st.state === 'STARTING'"
        >
          <i class="dot"></i>{{ stateLabel() }}
        </span>
        @if (st.state === 'RUNNING' && session(); as s) {
          <span class="muted">since {{ startedAt() }}</span>
          <span class="feed" [class.down]="!s.feed.healthy">
            Feed {{ s.feed.healthy ? 'connected' : 'reconnecting…' }}
            @if (s.feed.disconnects) {
              · {{ s.feed.disconnects }} drop(s)
            }
          </span>
        } @else if (st.reason) {
          <span class="muted">{{ st.reason }}</span>
        }
        <span class="spacer"></span>
        @if (st.paused) {
          <button type="button" class="primary sm" [disabled]="busy()" (click)="resume.emit()">
            Resume today
          </button>
        } @else if (st.state !== 'IDLE') {
          <button type="button" class="danger sm" [disabled]="busy()" (click)="confirmPause()">
            Pause for today
          </button>
        } @else if (st.reason?.startsWith('start failed')) {
          <button type="button" class="primary sm" [disabled]="busy()" (click)="resume.emit()">
            Retry now
          </button>
        }
      </div>

      @if (session(); as s) {
        @if (s.error) {
          <p class="error">{{ s.error }}</p>
        }

        @if (s.contracts.length) {
          <div class="contracts">
            @for (c of s.contracts; track c.instrumentKey) {
              <span
                class="contract"
                [class.ce]="c.optionType === 'CE'"
                [class.pe]="c.optionType === 'PE'"
              >
                <span class="sym">{{ c.tradingsymbol }}</span>
                <b>{{ price(c.lastPrice) }}</b>
              </span>
            }
          </div>
        }

        @if (s.books.length) {
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Index</th>
                  <th class="num">Available</th>
                  <th>Position</th>
                  <th class="num">Stop</th>
                  <th class="num">Open P&L</th>
                  <th class="num">Trades</th>
                  <th class="num">Realised</th>
                </tr>
              </thead>
              <tbody>
                @for (b of s.books; track b.strategyId + b.instrument) {
                  <tr [title]="b.error ?? b.lastRejection ?? ''">
                    <td>
                      {{ b.strategyName }}
                      @if (b.error) {
                        <span class="pill bad">error</span>
                      }
                    </td>
                    <td>{{ indexName(b.instrument) }}</td>
                    <td class="num">
                      {{ money(b.availableBalance) }}
                      <span class="faint">/ {{ money(b.capital) }}</span>
                    </td>
                    <td>
                      @if (b.openTrade; as t) {
                        {{ t.side }} {{ t.lots }} lot · {{ t.tradingsymbol }} &#64;
                        {{ price(t.entryPrice) }}
                      } @else {
                        <span class="faint">flat</span>
                      }
                    </td>
                    <td class="num">{{ price(b.openTrade?.stopLoss) }}</td>
                    <td class="num" [class]="b.openTrade ? tone(b.unrealisedPnl) : ''">
                      {{ b.openTrade ? signedMoney(b.unrealisedPnl) : '—' }}
                    </td>
                    <td class="num">{{ b.tradeCount }}</td>
                    <td class="num" [class]="tone(b.realisedPnl)">
                      {{ signedMoney(b.realisedPnl) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        @if (s.activity.length) {
          <details class="activity">
            <summary>Activity · {{ s.activity.length }}</summary>
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
        }
      } @else {
        <p class="lede">
          A session starts by itself a minute after the open on every trading day, once a strategy
          is enabled and Upstox is signed in. It streams the at-the-money call and put of the
          nearest expiry on each index and squares everything off before the close. No order is sent
          to a broker.
        </p>
      }
    } @else {
      <p class="empty">Loading…</p>
    }
  `,
  styles: `
    .state {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 0.75rem;
      margin-bottom: 0.85rem;
      font-size: 0.78rem;
    }
    .spacer {
      flex: 1;
    }
    .feed {
      color: var(--up);
    }
    .feed.down {
      color: var(--warn);
    }
    .error {
      margin: 0 0 0.75rem;
      font-size: 0.78rem;
      color: var(--danger);
    }
    .contracts {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 0.85rem;
    }
    .contract {
      display: inline-flex;
      align-items: baseline;
      gap: 0.5rem;
      padding: 0.3rem 0.6rem;
      border: 1px solid var(--border);
      border-left-width: 3px;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      font-size: 0.74rem;
    }
    .contract.ce {
      border-left-color: #4fd1a5;
    }
    .contract.pe {
      border-left-color: #ff8a87;
    }
    .contract .sym {
      color: var(--text-muted);
    }
    .contract b {
      font-family: var(--font-mono);
      font-weight: 600;
    }
    td .pill {
      margin-left: 0.35rem;
    }
    .activity {
      margin-top: 0.85rem;
      font-size: 0.75rem;
    }
    .activity summary {
      cursor: pointer;
      color: var(--text-muted);
    }
    .activity ul {
      list-style: none;
      margin: 0.5rem 0 0;
      padding: 0;
      max-height: 15rem;
      overflow-y: auto;
    }
    .activity li {
      display: flex;
      gap: 0.6rem;
      padding: 0.25rem 0;
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
    .activity .ERROR,
    .activity .FEED_DOWN,
    .activity .REJECTED {
      color: var(--warn);
    }
  `,
})
export class PaperStatusPanelComponent {
  readonly status = input<PaperTradingStatus | null>(null);
  readonly busy = input(false);

  readonly pause = output<void>();
  readonly resume = output<void>();

  readonly session = computed(() => this.status()?.session ?? null);
  readonly startedAt = computed(() => {
    const s = this.session();
    return s ? time(Date.parse(s.startedAt)) : '';
  });
  readonly stateLabel = computed(() => {
    const st = this.status();
    if (!st) return '';
    if (st.state === 'RUNNING') return 'Running';
    if (st.state === 'STARTING') return 'Starting';
    return st.paused ? 'Paused' : 'Idle';
  });

  readonly money = money;
  readonly price = price;
  readonly signedMoney = signedMoney;
  readonly tone = tone;
  readonly time = time;

  indexName(instrument: string): string {
    return instrument === 'BANKNIFTY' ? 'BANK NIFTY' : instrument;
  }

  confirmPause(): void {
    if (
      window.confirm(
        'Pause paper trading for the rest of today? Every open position is squared off at the last price.',
      )
    ) {
      this.pause.emit();
    }
  }
}
