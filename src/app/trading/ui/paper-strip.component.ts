import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { signedMoney, tone } from '../format';
import type { PaperTradingStatus } from '../trading.models';

/**
 * One line of paper trading for the Charts page: is it running, how many
 * strategies, what is open, today's P&L — and where to manage it. The chart
 * itself draws the trades; this only says what state they come from.
 */
@Component({
  selector: 'app-paper-strip',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="strip">
      <span class="title">Paper trading</span>
      @if (status(); as st) {
        <span
          class="pill"
          [class.ok]="st.state === 'RUNNING'"
          [class.warn]="st.state === 'STARTING'"
        >
          <i class="dot"></i>{{ stateLabel() }}
        </span>
        @if (st.state === 'RUNNING') {
          <span class="fact">
            <b>{{ st.enabledStrategies.length }}</b> strateg{{
              st.enabledStrategies.length === 1 ? 'y' : 'ies'
            }}
          </span>
          <span class="fact"
            ><b>{{ openCount() }}</b> open</span
          >
          <span class="fact">
            Today <b [class]="tone(todayPnl())">{{ signedMoney(todayPnl()) }}</b>
          </span>
        } @else if (st.reason) {
          <span class="fact muted">{{ st.reason }}</span>
        }
      } @else {
        <span class="fact faint">Loading…</span>
      }
      @if (note(); as n) {
        <span class="fact faint">{{ n }}</span>
      }
      <a class="manage" routerLink="/dashboard">Manage on Dashboard →</a>
    </div>
  `,
  styles: `
    .strip {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
      padding: 0.6rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      font-size: 0.78rem;
    }
    .title {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .fact {
      color: var(--text-muted);
    }
    .fact b {
      color: var(--text);
      font-family: var(--font-mono);
      font-weight: 600;
    }
    .fact b.pos {
      color: var(--up);
    }
    .fact b.neg {
      color: var(--down);
    }
    .manage {
      margin-left: auto;
      color: var(--accent);
      font-weight: 500;
      text-decoration: none;
    }
    .manage:hover {
      text-decoration: underline;
    }
  `,
})
export class PaperStripComponent {
  readonly status = input<PaperTradingStatus | null>(null);
  /** What the charts below are showing of it, e.g. the replayed day's trades. */
  readonly note = input<string | null>(null);

  readonly stateLabel = computed(() => {
    const st = this.status();
    if (!st) return '';
    if (st.state === 'RUNNING') return 'Running';
    if (st.state === 'STARTING') return 'Starting';
    return st.paused ? 'Paused' : 'Idle';
  });

  readonly openCount = computed(
    () => this.status()?.session?.books.filter((b) => b.openTrade).length ?? 0,
  );

  readonly todayPnl = computed(() =>
    (this.status()?.session?.books ?? []).reduce(
      (sum, b) => sum + b.realisedPnl + (b.openTrade ? b.unrealisedPnl : 0),
      0,
    ),
  );

  readonly signedMoney = signedMoney;
  readonly tone = tone;
}
