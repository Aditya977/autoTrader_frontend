import { Component, computed, input, output } from '@angular/core';
import { formatIstStamp, formatIstTime, formatPrice } from '../chart-stream/chart-time';
import type { SimTrade, SimulationBook, SimulationRunSnapshot } from './strategy.models';

/** One row of the activity table: a trade, plus the book it belongs to. */
interface TradeRow {
  trade: SimTrade;
  strategyName: string;
  label: string;
  leg: 'CE' | 'PE' | null;
}

/**
 * The run, beside the charts.
 *
 * Three readings, in the order a user actually wants them:
 *
 * 1. **the total** — what the whole run is worth right now;
 * 2. **per strategy** — which of them is carrying it, which is bleeding, and
 *    what each is holding this second;
 * 3. **every trade** — the audit, newest first, with the reason each was
 *    entered and exited.
 *
 * Net P&L leads everywhere, and the cost model is stated on the panel rather
 * than buried: a flat charge per sell is a large fraction of the edge on a
 * frequent intraday strategy, and a figure that quietly excluded it would read
 * as profit that does not exist. What the model *omits* is on screen too, so
 * "net" is never mistaken for "final".
 */
@Component({
  selector: 'app-strategy-panel',
  standalone: true,
  template: `
    @if (run(); as r) {
      <section class="panel">
        <header class="head">
          <div class="ident">
            <h2>Simulation</h2>
            <span class="key">
              {{ r.sessionDate }} · ₹{{ money(r.capital) }} per book · {{ r.books.length }} book{{
                r.books.length === 1 ? '' : 's'
              }}
            </span>
          </div>
          <div class="state">
            <span class="status" [class]="statusClass()">
              <i class="dot"></i>{{ statusText() }}
            </span>
            <button type="button" class="ghost stop" [disabled]="!canStop()" (click)="stop.emit()">
              Stop
            </button>
          </div>
        </header>

        @if (r.error; as message) {
          <p class="error">{{ message }}</p>
        }

        <div class="totals">
          <div
            class="hero"
            [class.up]="r.totals.totalPnl >= 0"
            [class.down]="r.totals.totalPnl < 0"
          >
            <span class="lbl">Net P&amp;L</span>
            <strong>{{ signed(r.totals.totalPnl) }}</strong>
            <span class="pct">{{ signedPct(r.totals.totalPnlPct) }}</span>
          </div>
          <dl class="grid">
            <div>
              <dt>Realised</dt>
              <dd>{{ signed(r.totals.realisedPnl) }}</dd>
            </div>
            <div>
              <dt>Open</dt>
              <dd>{{ signed(r.totals.unrealisedPnl) }}</dd>
            </div>
            <div>
              <dt>Brokerage</dt>
              <dd class="cost">−₹{{ money(r.totals.costs) }}</dd>
            </div>
            <div>
              <dt>Trades</dt>
              <dd>{{ r.totals.trades }}</dd>
            </div>
            <div>
              <dt>Win rate</dt>
              <dd>{{ r.totals.winRate === null ? '—' : r.totals.winRate + '%' }}</dd>
            </div>
            <div>
              <dt>Deployed</dt>
              <dd>₹{{ money(r.totals.capitalDeployed) }}</dd>
            </div>
          </dl>
        </div>

        <div class="books">
          @for (book of r.books; track book.bookId) {
            <article class="book" [class.up]="book.totalPnl > 0" [class.down]="book.totalPnl < 0">
              <header>
                <div class="who">
                  <strong>{{ book.strategyName }}</strong>
                  <span class="on">
                    <i class="leg" [class.call]="book.leg === 'CE'" [class.put]="book.leg === 'PE'">
                      {{ book.leg ?? '—' }}
                    </i>
                    {{ book.label }} · {{ book.timeframeMinutes }}m
                  </span>
                </div>
                <div class="pnl">
                  <strong>{{ signed(book.totalPnl) }}</strong>
                  <span>{{ signedPct(book.totalPnlPct) }}</span>
                </div>
              </header>

              <dl class="stats">
                <div>
                  <dt>Trades</dt>
                  <dd>{{ book.tradeCount }}</dd>
                </div>
                <div>
                  <dt>W / L</dt>
                  <dd>{{ book.wins }} / {{ book.losses }}</dd>
                </div>
                <div>
                  <dt>Win rate</dt>
                  <dd>{{ book.winRate === null ? '—' : book.winRate + '%' }}</dd>
                </div>
                <div>
                  <dt>Cash</dt>
                  <dd>₹{{ money(book.cash) }}</dd>
                </div>
                <div>
                  <dt>Costs</dt>
                  <dd class="cost">−₹{{ money(book.costs) }}</dd>
                </div>
                <div>
                  <dt>Bars</dt>
                  <dd>{{ book.barsProcessed }}</dd>
                </div>
              </dl>

              @if (book.openTrade; as open) {
                <p class="holding">
                  <span class="tag">Holding</span>
                  {{ open.lots }} lot{{ open.lots === 1 ? '' : 's' }} ({{ open.quantity }}) from ₹{{
                    price(open.entryPrice)
                  }}
                  @if (book.lastPrice !== null) {
                    · now ₹{{ price(book.lastPrice) }}
                  }
                  @if (open.stopPrice !== null) {
                    · SL ₹{{ price(open.stopPrice) }}
                  }
                  @if (open.targetPrice !== null) {
                    · TP ₹{{ price(open.targetPrice) }}
                  }
                  <em>{{ signed(book.unrealisedPnl) }}</em>
                </p>
              } @else if (book.lastRejection; as why) {
                <!-- A signal that produced nothing is the most confusing thing a
                     simulation can show. Say what happened. -->
                <p class="rejected"><span class="tag warn">Skipped</span> {{ why }}</p>
              }
            </article>
          }
        </div>

        @if (rows().length) {
          <div class="log">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Strategy</th>
                  <th>Contract</th>
                  <th class="num">Lots</th>
                  <th class="num">Entry</th>
                  <th class="num">Exit</th>
                  <th>Why</th>
                  <th class="num">Net</th>
                </tr>
              </thead>
              <tbody>
                @for (
                  row of rows();
                  track row.trade.strategyId + ':' + row.trade.instrumentKey + ':' + row.trade.id
                ) {
                  <tr [class.open]="row.trade.status === 'OPEN'">
                    <td class="mono" [title]="stamp(row.trade.entryTime)">
                      {{ clock(row.trade.entryTime) }}
                      @if (row.trade.exitTime !== null) {
                        <span class="arrow">→ {{ clock(row.trade.exitTime) }}</span>
                      }
                    </td>
                    <td>{{ row.strategyName }}</td>
                    <td class="mono">
                      <i class="leg" [class.call]="row.leg === 'CE'" [class.put]="row.leg === 'PE'">
                        {{ row.leg ?? '—' }}
                      </i>
                      {{ row.label }}
                    </td>
                    <td class="num mono">{{ row.trade.lots }}</td>
                    <td class="num mono">{{ price(row.trade.entryPrice) }}</td>
                    <td class="num mono">
                      {{ row.trade.exitPrice === null ? '—' : price(row.trade.exitPrice) }}
                    </td>
                    <td class="why" [title]="reasonTitle(row.trade)">{{ reason(row.trade) }}</td>
                    <td
                      class="num mono net"
                      [class.up]="row.trade.status === 'CLOSED' && row.trade.netPnl >= 0"
                      [class.down]="row.trade.status === 'CLOSED' && row.trade.netPnl < 0"
                    >
                      {{ row.trade.status === 'OPEN' ? 'open' : signed(row.trade.netPnl) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="empty">
            No trades yet.
            @if (r.status === 'RUNNING') {
              Strategies need {{ warmupText() }} before their first decision.
            }
          </p>
        }

        <footer class="fine">
          Costs modelled: <strong>{{ r.costModel.label }}</strong
          >. Not modelled: {{ r.costModel.excludes.join(', ') }} — treat net as an upper bound.
          @if (r.journalling) {
            · Trades are being written to the journal.
          }
        </footer>
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .panel {
      display: flex;
      flex-direction: column;
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
      padding: 0.7rem 0.9rem;
      border-bottom: 1px solid var(--border);
    }

    h2 {
      font-size: 0.85rem;
      line-height: 1.2;
    }

    .key {
      display: block;
      font-size: 0.68rem;
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
    }

    .state {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.7rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .status .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .status.live {
      color: #4fd1a5;
    }
    .status.done {
      color: var(--text-faint);
    }
    .status.bad {
      color: #ef5350;
    }

    button.ghost {
      padding: 0.25rem 0.6rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.7rem;
      cursor: pointer;
    }

    button.ghost:hover:not(:disabled) {
      color: #ef5350;
      border-color: rgba(239, 83, 80, 0.5);
    }

    button.ghost:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .error {
      margin: 0;
      padding: 0.5rem 0.9rem;
      background: rgba(239, 83, 80, 0.1);
      color: #ef8a88;
      font-size: 0.75rem;
    }

    /* --- totals ---------------------------------------------------------- */

    .totals {
      display: grid;
      grid-template-columns: minmax(150px, auto) 1fr;
      gap: 1rem;
      align-items: center;
      padding: 0.85rem 0.9rem;
      border-bottom: 1px solid var(--border);
    }

    .hero {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }

    .hero .lbl {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-faint);
    }

    .hero strong {
      font-size: 1.5rem;
      font-variant-numeric: tabular-nums;
      line-height: 1.1;
    }

    .hero .pct {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }

    .hero.up strong,
    .hero.up .pct {
      color: #4fd1a5;
    }
    .hero.down strong,
    .hero.down .pct {
      color: #ef5350;
    }

    dl.grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
      gap: 0.5rem 0.75rem;
      margin: 0;
    }

    dl div {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      min-width: 0;
    }

    dt {
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-faint);
    }

    dd {
      margin: 0;
      font-size: 0.82rem;
      font-variant-numeric: tabular-nums;
    }

    dd.cost {
      color: #d9a441;
    }

    /* --- per-strategy books ---------------------------------------------- */

    .books {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 0.6rem;
      padding: 0.75rem 0.9rem;
      border-bottom: 1px solid var(--border);
    }

    .book {
      border: 1px solid var(--border);
      border-left-width: 3px;
      border-radius: 8px;
      padding: 0.6rem 0.7rem;
      background: var(--surface-2, rgba(255, 255, 255, 0.02));
    }

    .book.up {
      border-left-color: #26a17b;
    }
    .book.down {
      border-left-color: #ef5350;
    }

    .book > header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.6rem;
      margin-bottom: 0.5rem;
    }

    .who strong {
      display: block;
      font-size: 0.8rem;
    }

    .who .on {
      display: block;
      font-size: 0.68rem;
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
    }

    .pnl {
      text-align: right;
      white-space: nowrap;
    }

    .pnl strong {
      display: block;
      font-size: 0.95rem;
      font-variant-numeric: tabular-nums;
    }

    .pnl span {
      font-size: 0.68rem;
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
    }

    .book.up .pnl strong {
      color: #4fd1a5;
    }
    .book.down .pnl strong {
      color: #ef5350;
    }

    dl.stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.4rem 0.5rem;
      margin: 0;
    }

    dl.stats dd {
      font-size: 0.75rem;
    }

    .holding,
    .rejected {
      margin: 0.55rem 0 0;
      font-size: 0.7rem;
      color: var(--text-muted);
      line-height: 1.5;
      font-variant-numeric: tabular-nums;
    }

    .holding em {
      font-style: normal;
      font-weight: 600;
      color: var(--text);
    }

    .tag {
      display: inline-block;
      padding: 0.05rem 0.32rem;
      margin-right: 0.3rem;
      border-radius: 4px;
      background: rgba(79, 209, 165, 0.16);
      color: #4fd1a5;
      font-size: 0.6rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .tag.warn {
      background: rgba(217, 164, 65, 0.16);
      color: #d9a441;
    }

    .leg {
      font-style: normal;
      font-size: 0.62rem;
      padding: 0.02rem 0.22rem;
      border-radius: 3px;
      background: var(--surface-3, rgba(255, 255, 255, 0.06));
      color: var(--text-faint);
    }

    .leg.call {
      color: #4fd1a5;
    }
    .leg.put {
      color: #ef5350;
    }

    /* --- trade log ------------------------------------------------------- */

    .log {
      max-height: 320px;
      overflow: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.72rem;
    }

    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 0.4rem 0.5rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      text-align: left;
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-faint);
      font-weight: 600;
    }

    tbody td {
      padding: 0.35rem 0.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text-muted);
      vertical-align: top;
    }

    tbody tr.open td {
      background: rgba(79, 209, 165, 0.05);
    }

    .num {
      text-align: right;
    }

    .mono {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .arrow {
      color: var(--text-faint);
    }

    .why {
      max-width: 22ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .net.up {
      color: #4fd1a5;
    }
    .net.down {
      color: #ef5350;
    }

    .empty {
      margin: 0;
      padding: 1.1rem 0.9rem;
      font-size: 0.75rem;
      color: var(--text-faint);
      text-align: center;
    }

    .fine {
      padding: 0.5rem 0.9rem;
      border-top: 1px solid var(--border);
      font-size: 0.66rem;
      color: var(--text-faint);
      line-height: 1.5;
    }
  `,
})
export class StrategyPanelComponent {
  readonly run = input<SimulationRunSnapshot | null>(null);
  readonly stop = output<void>();

  protected readonly canStop = computed(() => this.run()?.status === 'RUNNING');

  protected readonly statusText = computed(() => {
    const run = this.run();
    if (!run) return 'idle';
    if (run.status !== 'RUNNING') return run.status.toLowerCase();
    const open = run.totals.openTrades;
    return open > 0 ? `running · ${open} open` : 'running';
  });

  protected readonly statusClass = computed(() => {
    switch (this.run()?.status) {
      case 'RUNNING':
        return 'live';
      case 'ERROR':
        return 'bad';
      default:
        return 'done';
    }
  });

  /**
   * Every trade across every book, newest first.
   *
   * Newest first because a running simulation is read from the top — the thing
   * that just happened is the thing being looked for — and because an open
   * position sorts to where the eye already is.
   */
  protected readonly rows = computed<TradeRow[]>(() => {
    const run = this.run();
    if (!run) return [];

    const rows: TradeRow[] = [];
    for (const book of run.books) {
      for (const trade of book.trades) {
        rows.push({
          trade,
          strategyName: book.strategyName,
          label: book.label,
          leg: book.leg,
        });
      }
    }
    return rows.sort(
      (a, b) => (b.trade.exitTime ?? b.trade.entryTime) - (a.trade.exitTime ?? a.trade.entryTime),
    );
  });

  /** The longest warm-up any selected strategy needs, said in bars and minutes. */
  protected readonly warmupText = computed(() => {
    const run = this.run();
    if (!run || run.strategies.length === 0) return 'some bars';
    const worst = run.strategies.reduce((slowest, s) =>
      s.warmupBars * s.timeframeMinutes > slowest.warmupBars * slowest.timeframeMinutes
        ? s
        : slowest,
    );
    return `${worst.warmupBars} × ${worst.timeframeMinutes}m bars`;
  });

  protected trackBooks(_index: number, book: SimulationBook): string {
    return book.bookId;
  }

  protected reason(trade: SimTrade): string {
    return trade.status === 'OPEN' ? trade.entryReason : (trade.exitReason ?? '—');
  }

  /** Both halves of the story, for the hover — entry and exit rationale. */
  protected reasonTitle(trade: SimTrade): string {
    const entry = `In: ${trade.entryReason}`;
    return trade.exitReason ? `${entry}\nOut: ${trade.exitReason}` : entry;
  }

  protected clock(epochMs: number): string {
    return formatIstTime(Math.floor(epochMs / 1000));
  }

  protected stamp(epochMs: number): string {
    return formatIstStamp(Math.floor(epochMs / 1000));
  }

  protected price(value: number): string {
    return formatPrice(value);
  }

  /** Rupees, no decimals — a P&L to the paisa reads as false precision. */
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
