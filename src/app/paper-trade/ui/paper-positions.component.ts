/**
 * The open book: what is held right now, and what it is worth.
 *
 * One card per position, and the card leads with the P&L because that is the
 * only number anybody looks at first. Everything else on it exists to answer
 * the question the P&L provokes — how much is in it, at what price, since when,
 * and where are the exits.
 *
 * Settled trades are here too, dimmed and below, rather than in a separate
 * table: a trade that stopped out ninety seconds ago is still the thing being
 * thought about, and moving it to another section at the instant it closes is
 * how a UI loses the user's place.
 */

import { Component, computed, input, output } from '@angular/core';
import { formatIstTime, formatPrice } from '../../chart-stream/chart-time';
import { EXIT_REASON_LABEL, type PaperPosition, type PaperTotals } from '../paper-trade.models';

@Component({
  selector: 'app-paper-positions',
  standalone: true,
  template: `
    @if (positions().length) {
      <section class="book">
        <header class="head">
          <div class="ident">
            <h2>Paper positions</h2>
            <span class="key">
              {{ totals().openTrades }} open · {{ totals().trades }} taken · ₹{{
                money(totals().deployed)
              }}
              deployed
            </span>
          </div>
          <div
            class="hero"
            [class.up]="totals().totalPnl >= 0"
            [class.down]="totals().totalPnl < 0"
          >
            <span class="lbl">Net P&amp;L</span>
            <strong>{{ signed(totals().totalPnl) }}</strong>
            <span class="pct">{{ signedPct(totals().totalPnlPct) }}</span>
          </div>
        </header>

        <div class="cards">
          @for (p of ordered(); track p.id) {
            <article
              class="card"
              [class.settled]="p.status === 'EXITED'"
              [class.waiting]="p.status === 'CREATED'"
              [class.up]="p.status !== 'CREATED' && p.netPnl > 0"
              [class.down]="p.status !== 'CREATED' && p.netPnl < 0"
            >
              <header>
                <div class="who">
                  <strong class="sym">{{ p.contract.tradingsymbol }}</strong>
                  <span class="meta">
                    <i
                      class="leg"
                      [class.call]="p.contract.leg === 'CE'"
                      [class.put]="p.contract.leg === 'PE'"
                      >{{ p.contract.leg ?? '—' }}</i
                    >
                    <span class="id">{{ p.id }}</span>
                    · {{ p.strategyName }}
                    @if (p.contract.strike !== null) {
                      · {{ p.contract.strike }}
                    }
                    @if (p.contract.expiry) {
                      · exp {{ p.contract.expiry }}
                    }
                  </span>
                </div>
                <span class="status" [class]="statusClass(p)">
                  <i class="dot"></i>{{ statusText(p) }}
                </span>
              </header>

              <div class="pnl">
                <strong>{{ p.status === 'CREATED' ? '—' : signed(p.netPnl) }}</strong>
                <span class="pct">{{
                  p.status === 'CREATED' ? 'not filled' : signedPct(p.netPnlPct)
                }}</span>
              </div>

              <dl class="stats">
                <div>
                  <dt>Entry</dt>
                  <dd>{{ p.entryPrice === null ? '—' : '₹' + price(p.entryPrice) }}</dd>
                </div>
                <div>
                  <dt>Current</dt>
                  <dd>{{ p.currentPrice === null ? '—' : '₹' + price(p.currentPrice) }}</dd>
                </div>
                <div>
                  <dt>Quantity</dt>
                  <dd>
                    {{ p.quantity }} <em>({{ p.lots }} × {{ p.lotSize }})</em>
                  </dd>
                </div>
                <div>
                  <dt>Investment</dt>
                  <dd>₹{{ money(p.investment) }}</dd>
                </div>
                <div>
                  <dt>Stop loss</dt>
                  <dd class="sl">{{ p.stopLoss === null ? '—' : '₹' + price(p.stopLoss) }}</dd>
                </div>
                <div>
                  <dt>Target</dt>
                  <dd class="tgt">{{ p.target === null ? '—' : '₹' + price(p.target) }}</dd>
                </div>
                <div>
                  <dt>Entry time</dt>
                  <dd>{{ p.entryTime === null ? '—' : clock(p.entryTime) }}</dd>
                </div>
                <div>
                  <dt>{{ p.status === 'EXITED' ? 'Exit' : 'Capital' }}</dt>
                  <dd>
                    @if (p.status === 'EXITED') {
                      {{ p.exitPrice === null ? '—' : '₹' + price(p.exitPrice) }}
                      <em>{{ p.exitTime === null ? '' : clock(p.exitTime) }}</em>
                    } @else {
                      ₹{{ money(p.capitalUsed) }}
                    }
                  </dd>
                </div>
              </dl>

              <footer>
                <span class="why">
                  @if (p.status === 'EXITED') {
                    {{ exitLabel(p) }} — {{ p.exitNote }}
                    @if (p.costs) {
                      · charges ₹{{ money(p.costs) }}
                    }
                  } @else if (p.status === 'ACTIVE') {
                    In: {{ p.entryReason }}
                  } @else {
                    Waiting for {{ p.strategyName }} to signal an entry.
                  }
                </span>
                @if (p.status !== 'EXITED') {
                  <button type="button" class="ghost" (click)="close.emit(p.id)">
                    {{ p.status === 'CREATED' ? 'Cancel' : 'Exit now' }}
                  </button>
                }
              </footer>
            </article>
          }
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .book {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      overflow: hidden;
    }

    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1rem;
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
      font-variant-numeric: tabular-nums;
    }

    .hero {
      display: grid;
      justify-items: end;
      gap: 0.1rem;
    }

    .hero .lbl {
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-faint);
    }

    .hero strong {
      font-size: 1.15rem;
      font-variant-numeric: tabular-nums;
    }

    .hero .pct {
      font-size: 0.7rem;
      color: var(--text-faint);
    }

    .hero.up strong {
      color: #4fd1a5;
    }

    .hero.down strong {
      color: #ef5350;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      gap: 0.75rem;
      padding: 0.85rem 1rem 1rem;
    }

    .card {
      border: 1px solid var(--border);
      border-left: 3px solid var(--text-faint);
      border-radius: 8px;
      padding: 0.7rem 0.8rem;
      background: var(--bg);
    }

    .card.up {
      border-left-color: #4fd1a5;
    }

    .card.down {
      border-left-color: #ef5350;
    }

    .card.waiting {
      border-left-style: dashed;
    }

    /* Dimmed rather than removed: a trade that closed a minute ago is still
       what is being thought about. */
    .card.settled {
      opacity: 0.68;
    }

    .card > header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .sym {
      display: block;
      font-size: 0.8rem;
    }

    .meta {
      display: block;
      margin-top: 0.15rem;
      font-size: 0.66rem;
      color: var(--text-faint);
    }

    .id {
      font-variant-numeric: tabular-nums;
    }

    .leg {
      display: inline-block;
      padding: 0 0.3rem;
      margin-right: 0.25rem;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.07);
      font-style: normal;
      font-size: 0.6rem;
    }

    .leg.call {
      background: rgba(79, 209, 165, 0.18);
      color: #4fd1a5;
    }

    .leg.put {
      background: rgba(239, 83, 80, 0.18);
      color: #ef5350;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.15rem 0.45rem;
      border-radius: 99px;
      font-size: 0.62rem;
      white-space: nowrap;
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-muted);
    }

    .status .dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: currentColor;
    }

    .status.live {
      background: rgba(79, 209, 165, 0.16);
      color: #4fd1a5;
    }

    .status.wait {
      background: rgba(240, 164, 74, 0.16);
      color: #f0a44a;
    }

    .pnl {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin: 0.55rem 0 0.15rem;
    }

    .pnl strong {
      font-size: 1.25rem;
      font-variant-numeric: tabular-nums;
    }

    .card.up .pnl strong {
      color: #4fd1a5;
    }

    .card.down .pnl strong {
      color: #ef5350;
    }

    .pnl .pct {
      font-size: 0.72rem;
      color: var(--text-faint);
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.35rem 0.6rem;
      margin: 0.6rem 0 0;
    }

    .stats dt {
      font-size: 0.6rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-faint);
    }

    .stats dd {
      margin: 0;
      font-size: 0.76rem;
      font-variant-numeric: tabular-nums;
      color: var(--text);
    }

    .stats dd em {
      font-style: normal;
      font-size: 0.66rem;
      color: var(--text-faint);
    }

    .stats .sl {
      color: #ef5350;
    }

    .stats .tgt {
      color: #4fd1a5;
    }

    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-top: 0.6rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--border);
    }

    .why {
      font-size: 0.66rem;
      color: var(--text-faint);
      line-height: 1.45;
    }

    .ghost {
      padding: 0.25rem 0.6rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: transparent;
      color: var(--text-muted);
      font-size: 0.68rem;
      cursor: pointer;
      white-space: nowrap;
    }

    .ghost:hover {
      color: var(--text);
      border-color: var(--text-faint);
    }
  `,
})
export class PaperPositionsComponent {
  readonly positions = input<readonly PaperPosition[]>([]);
  readonly totals = input.required<PaperTotals>();

  /** The id to close, or to cancel when it never filled. */
  readonly close = output<string>();

  /**
   * Working positions first, then settled ones newest-first.
   *
   * Not simply reverse-chronological: an open position is the one that can
   * still be acted on, so it belongs where the eye lands regardless of when it
   * was opened.
   */
  protected readonly ordered = computed(() => {
    const live = this.positions().filter((p) => p.status !== 'EXITED');
    const done = this.positions()
      .filter((p) => p.status === 'EXITED')
      .sort((a, b) => (b.exitTime ?? b.createdAt) - (a.exitTime ?? a.createdAt));
    return [...live, ...done];
  });

  protected statusText(p: PaperPosition): string {
    if (p.status === 'CREATED') return 'waiting';
    if (p.status === 'ACTIVE') return 'active';
    return 'exited';
  }

  protected statusClass(p: PaperPosition): string {
    if (p.status === 'ACTIVE') return 'live';
    if (p.status === 'CREATED') return 'wait';
    return '';
  }

  protected exitLabel(p: PaperPosition): string {
    return p.exitReason ? EXIT_REASON_LABEL[p.exitReason] : 'Exited';
  }

  protected clock(epochMs: number): string {
    return formatIstTime(Math.floor(epochMs / 1000));
  }

  protected price(value: number): string {
    return formatPrice(value);
  }

  protected money(value: number): string {
    return Math.round(value).toLocaleString('en-IN');
  }

  protected signed(value: number): string {
    const rounded = Math.round(value);
    const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
    return `${sign}₹${Math.abs(rounded).toLocaleString('en-IN')}`;
  }

  protected signedPct(value: number): string {
    return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
  }
}
