/**
 * Trade activity: every simulated event, newest first, as it happens.
 *
 * The chart says *where*; this says *when and why*, in order. It is the part of
 * the feature that survives the session — you can scroll back through it and
 * reconstruct the day, which is not true of a chart whose marks you have to
 * hover one at a time.
 *
 * Newest first because a running simulation is read from the top: the thing
 * that just happened is the thing being looked for. The trade id is on every
 * row so the feed and the position cards can be read against each other
 * without guessing which of three trades on the same contract is meant.
 */

import { Component, computed, input } from '@angular/core';
import { formatIstStamp, formatPrice } from '../../chart-stream/chart-time';
import {
  PAPER_EVENT_LABEL,
  type PaperEventKind,
  type PaperTradeEvent,
} from '../paper-trade.models';

@Component({
  selector: 'app-trade-activity',
  standalone: true,
  template: `
    <section class="activity">
      <header class="head">
        <div class="ident">
          <h2>Trade activity</h2>
          <span class="key">
            @if (events().length) {
              {{ events().length }} event{{ events().length === 1 ? '' : 's' }} · newest first
            } @else {
              Nothing yet
            }
          </span>
        </div>
      </header>

      @if (events().length) {
        <ol class="feed">
          @for (event of events(); track event.seq) {
            <li class="row" [class]="toneOf(event.kind)">
              <span class="when">{{ stamp(event.at) }}</span>
              <span class="tag">{{ label(event.kind) }}</span>
              <span class="what">
                <strong>{{ event.tradingsymbol }}</strong>
                <em class="id">{{ event.tradeId }}</em>
                <em class="who">{{ event.strategyName }}</em>
                <span class="msg">{{ event.message }}</span>
              </span>
              <span class="num">
                @if (event.netPnl !== null) {
                  <strong class="pnl">{{ signed(event.netPnl) }}</strong>
                } @else if (event.price !== null) {
                  ₹{{ price(event.price) }}
                }
              </span>
            </li>
          }
        </ol>
      } @else {
        <p class="empty">
          Place a paper trade above and every entry, stop, target and exit will be listed here as it
          happens.
        </p>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .activity {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      overflow: hidden;
    }

    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.7rem 1rem;
      border-bottom: 1px solid var(--border);
    }

    h2 {
      font-size: 0.85rem;
      margin: 0;
    }

    .key {
      display: block;
      margin-top: 0.15rem;
      font-size: 0.7rem;
      color: var(--text-faint);
    }

    .feed {
      list-style: none;
      margin: 0;
      padding: 0;
      /* Capped so a long replay does not push the rest of the page off screen;
         the feed scrolls inside itself instead. */
      max-height: 340px;
      overflow-y: auto;
    }

    .row {
      display: grid;
      grid-template-columns: 5.5rem 6.5rem 1fr auto;
      gap: 0.6rem;
      align-items: baseline;
      padding: 0.45rem 1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      font-size: 0.73rem;
      border-left: 3px solid transparent;
    }

    .row:last-child {
      border-bottom: none;
    }

    .row.good {
      border-left-color: #4fd1a5;
    }

    .row.bad {
      border-left-color: #ef5350;
    }

    .row.entry {
      border-left-color: #38bdf8;
    }

    .when {
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .tag {
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 600;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .row.good .tag {
      color: #4fd1a5;
    }

    .row.bad .tag {
      color: #ef5350;
    }

    .row.entry .tag {
      color: #38bdf8;
    }

    .what {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.4rem;
      min-width: 0;
      color: var(--text-muted);
    }

    .what strong {
      color: var(--text);
      font-weight: 600;
    }

    .id {
      font-style: normal;
      font-size: 0.62rem;
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
    }

    .who {
      font-style: normal;
      font-size: 0.62rem;
      padding: 0 0.3rem;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-muted);
    }

    .msg {
      color: var(--text-faint);
    }

    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .row.good .pnl {
      color: #4fd1a5;
    }

    .row.bad .pnl {
      color: #ef5350;
    }

    .empty {
      margin: 0;
      padding: 1.2rem 1rem;
      text-align: center;
      font-size: 0.75rem;
      color: var(--text-faint);
    }

    @media (max-width: 720px) {
      .row {
        grid-template-columns: 1fr auto;
      }

      .tag {
        grid-row: 1;
      }

      .what {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class TradeActivityComponent {
  /** Already newest-first; this component does not reorder what it is given. */
  readonly events = input<readonly PaperTradeEvent[]>([]);

  protected label(kind: PaperEventKind): string {
    return PAPER_EVENT_LABEL[kind];
  }

  /**
   * The colour a row carries.
   *
   * By *outcome*, not by category: a target and a stop are both exits, and
   * colouring them the same would make the feed unreadable at a glance, which
   * is the one thing it is for.
   */
  protected toneOf(kind: PaperEventKind): string {
    switch (kind) {
      case 'TARGET_HIT':
        return 'good';
      case 'STOP_LOSS_HIT':
      case 'ENTRY_REJECTED':
        return 'bad';
      case 'TRADE_TAKEN':
        return 'entry';
      default:
        return '';
    }
  }

  protected stamp(epochMs: number): string {
    return formatIstStamp(Math.floor(epochMs / 1000));
  }

  protected price(value: number): string {
    return formatPrice(value);
  }

  protected signed(value: number): string {
    const rounded = Math.round(value);
    const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
    return `${sign}₹${Math.abs(rounded).toLocaleString('en-IN')}`;
  }
}
