import { Component, computed, input } from '@angular/core';
import { formatIstTime } from '../chart-stream/chart-time';
import type { SimTrade } from '../strategy/strategy.models';
import type { BacktestComparison, BacktestDetail, TradeMetrics } from './backtest.models';

/** One row of the regime table: a bucket and how the strategy did in it. */
interface RegimeRow {
  dimension: string;
  bucket: string;
  metrics: TradeMetrics;
}

/**
 * What a run did, in the order the question is usually asked.
 *
 * 1. **the headline** — net, expectancy, profit factor, drawdown;
 * 2. **by regime** — the slice that turns a number into a change somebody can
 *    make. "−₹5,000" says nothing; "+₹4,000 on trend days, −₹9,000 on sideways
 *    days" says the strategy works and the filter is missing;
 * 3. **the diff**, when two runs are being compared — did the change help;
 * 4. **day by day**, with the regime and the reason a blank day was blank;
 * 5. **every trade**, with why it was entered and how it ended.
 *
 * Expectancy is given at least as much room as net P&L on purpose. Over twenty
 * days a strategy takes tens of trades, which is far too few for a total to
 * separate an edge from a run of luck — and expectancy is the figure that stays
 * comparable when the next run takes a different number of trades.
 */
@Component({
  selector: 'app-backtest-result',
  standalone: true,
  template: `
    @if (detail(); as d) {
      <section class="card">
        <header class="card-head">
          <div>
            <h2>#{{ d.id }} · {{ d.label }}</h2>
            <p class="hint">
              {{ d.strategyName }} · {{ d.underlying }} · {{ d.fromDate }} → {{ d.toDate }} ·
              {{ d.tradingDays }} days · ₹{{ d.capital.toLocaleString('en-IN') }}/day · lot
              {{ d.lotSize }}
            </p>
          </div>
          <span class="pill" [class]="d.status.toLowerCase()">{{ d.status }}</span>
        </header>

        @if (d.error; as message) {
          <p class="notice warn">{{ message }}</p>
        }

        <!-- what it used, so a comparison means something -->
        <div class="chips">
          @for (entry of paramList(); track entry[0]) {
            <span class="chip"
              >{{ entry[0] }} <b>{{ entry[1] }}</b></span
            >
          }
        </div>

        @if (d.notes; as notes) {
          <p class="notes"><span class="tag">Why</span> {{ notes }}</p>
        }

        @if (d.metrics; as m) {
          <div class="headline">
            <div class="hero" [class.up]="m.netPnl >= 0" [class.down]="m.netPnl < 0">
              <span class="lbl">Net P&amp;L</span>
              <strong>{{ signed(m.netPnl) }}</strong>
            </div>
            <dl class="grid">
              <div>
                <dt>Expectancy / trade</dt>
                <dd [class.up]="(m.expectancy ?? 0) > 0" [class.down]="(m.expectancy ?? 0) < 0">
                  {{ money(m.expectancy) }}
                </dd>
              </div>
              <div>
                <dt>Trades</dt>
                <dd>{{ m.trades }}</dd>
              </div>
              <div>
                <dt>Win rate</dt>
                <dd>{{ m.winRate === null ? '—' : m.winRate + '%' }}</dd>
              </div>
              <div>
                <dt>Profit factor</dt>
                <dd>{{ num(m.profitFactor) }}</dd>
              </div>
              <div>
                <dt>Payoff</dt>
                <dd>{{ num(m.payoffRatio) }}</dd>
              </div>
              <div>
                <dt>Max drawdown</dt>
                <dd class="down">{{ money(m.maxDrawdown) }}</dd>
              </div>
              <div>
                <dt>Brokerage</dt>
                <dd class="cost">{{ money(m.costs) }}</dd>
              </div>
              <div>
                <dt>Worst streak</dt>
                <dd>{{ m.longestLossStreak }} losses</dd>
              </div>
              <div>
                <dt>Quiet days</dt>
                <dd>{{ d.skippedDays }} / {{ d.tradingDays }}</dd>
              </div>
            </dl>
          </div>

          @if (exitList().length) {
            <p class="hint exits">
              Exits:
              @for (e of exitList(); track e[0]) {
                <span class="chip"
                  >{{ e[0] }} <b>{{ e[1] }}</b></span
                >
              }
              — a run of stops says the stop is too tight, which no P&amp;L figure says.
            </p>
          }
        }

        <!-- by regime: where the finding usually is -->
        @if (regimeRows().length) {
          <h3>By market condition</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Condition</th>
                  <th class="num">Trades</th>
                  <th class="num">Win rate</th>
                  <th class="num">Net</th>
                  <th class="num">Expectancy</th>
                  <th class="num">Profit factor</th>
                </tr>
              </thead>
              <tbody>
                @for (row of regimeRows(); track row.dimension + row.bucket) {
                  <tr>
                    <td>
                      <span class="dim">{{ row.dimension }}</span> {{ row.bucket }}
                    </td>
                    <td class="num mono">{{ row.metrics.trades }}</td>
                    <td class="num mono">
                      {{ row.metrics.winRate === null ? '—' : row.metrics.winRate + '%' }}
                    </td>
                    <td
                      class="num mono"
                      [class.up]="row.metrics.netPnl >= 0"
                      [class.down]="row.metrics.netPnl < 0"
                    >
                      {{ signed(row.metrics.netPnl) }}
                    </td>
                    <td class="num mono">{{ money(row.metrics.expectancy) }}</td>
                    <td class="num mono">{{ num(row.metrics.profitFactor) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <!-- the diff -->
        @if (comparison(); as c) {
          <h3>#{{ c.candidate.id }} against #{{ c.baseline.id }}</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th class="num">#{{ c.baseline.id }}</th>
                  <th class="num">#{{ c.candidate.id }}</th>
                  <th class="num">Change</th>
                </tr>
              </thead>
              <tbody>
                @for (delta of c.deltas; track delta.metric) {
                  <tr>
                    <td>{{ delta.metric }}</td>
                    <td class="num mono">{{ num(delta.baseline) }}</td>
                    <td class="num mono">{{ num(delta.candidate) }}</td>
                    <td
                      class="num mono"
                      [class.up]="better(delta) === true"
                      [class.down]="better(delta) === false"
                    >
                      {{ delta.change === null ? '—' : signedRaw(delta.change) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <!-- day by day -->
        <h3>Day by day</h3>
        <div class="table-wrap scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Condition</th>
                <th class="num">Move</th>
                <th class="num">Range</th>
                <th class="num">Gap</th>
                <th class="num">Eff.</th>
                <th class="num">Trades</th>
                <th class="num">Net</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              @for (day of d.days; track day.date) {
                <tr [class.quiet]="day.trades === 0">
                  <td class="mono">{{ day.date }}</td>
                  <td class="mono cond">{{ day.regime.label }}</td>
                  <td class="num mono">{{ pct(day.shape.netMovePct) }}</td>
                  <td class="num mono">{{ pct(day.shape.rangePct) }}</td>
                  <td class="num mono">
                    {{ day.shape.gapPct === null ? '—' : pct(day.shape.gapPct) }}
                  </td>
                  <td class="num mono">{{ day.shape.efficiency.toFixed(2) }}</td>
                  <td class="num mono">{{ day.trades }}</td>
                  <td class="num mono" [class.up]="day.netPnl > 0" [class.down]="day.netPnl < 0">
                    {{ day.trades === 0 ? '—' : signed(day.netPnl) }}
                  </td>
                  <td class="note">{{ day.note ?? '' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- every trade -->
        @if (d.trades.length) {
          <h3>Trades</h3>
          <div class="table-wrap scroll">
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Time</th>
                  <th>Side</th>
                  <th class="num">Lots</th>
                  <th class="num">Entry</th>
                  <th class="num">Exit</th>
                  <th>Exit reason</th>
                  <th class="num">Net</th>
                  <th>Why it was taken</th>
                </tr>
              </thead>
              <tbody>
                @for (t of d.trades; track t.id) {
                  <tr>
                    <td class="mono">{{ dayOf(t) }}</td>
                    <td class="mono">
                      {{ clock(t.entryTime) }}
                      @if (t.exitTime !== null) {
                        → {{ clock(t.exitTime) }}
                      }
                    </td>
                    <td>
                      <span
                        class="side"
                        [class.buy]="t.side === 'BUY'"
                        [class.sell]="t.side === 'SELL'"
                      >
                        {{ t.side }}
                      </span>
                    </td>
                    <td class="num mono">{{ t.lots }}</td>
                    <td class="num mono">{{ t.entryPrice.toFixed(2) }}</td>
                    <td class="num mono">
                      {{ t.exitPrice === null ? '—' : t.exitPrice.toFixed(2) }}
                    </td>
                    <td class="mono">{{ t.exitReasonKind ?? '—' }}</td>
                    <td class="num mono" [class.up]="t.netPnl >= 0" [class.down]="t.netPnl < 0">
                      {{ signed(t.netPnl) }}
                    </td>
                    <td class="why" [title]="t.entryReason">{{ t.entryReason }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <p class="fine">
          Costs modelled: ₹40 flat per sell order. Not modelled: STT, exchange fees, GST, stamp
          duty, spread, slippage — treat net as an upper bound. Every day starts on the same
          capital, so the run's P&amp;L is the sum of its days rather than a compounded balance.
        </p>
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      padding: 1rem 1.1rem;
    }

    .card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.7rem;
    }

    h2 {
      font-size: 0.88rem;
      margin: 0 0 0.15rem;
    }

    h3 {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-faint);
      margin: 1.2rem 0 0.5rem;
    }

    .hint {
      margin: 0;
      font-size: 0.72rem;
      color: var(--text-faint);
      line-height: 1.5;
    }

    .hint.exits {
      margin-top: 0.6rem;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      margin-bottom: 0.6rem;
    }

    .chip {
      padding: 0.15rem 0.45rem;
      border: 1px solid var(--border);
      border-radius: 99px;
      font-size: 0.68rem;
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
    }

    .chip b {
      color: var(--text-muted);
    }

    .notes {
      margin: 0 0 0.7rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      line-height: 1.5;
    }

    .tag {
      display: inline-block;
      padding: 0.05rem 0.32rem;
      margin-right: 0.35rem;
      border-radius: 4px;
      background: rgba(56, 139, 253, 0.16);
      color: #6ea8ff;
      font-size: 0.6rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .headline {
      display: grid;
      grid-template-columns: minmax(150px, auto) 1fr;
      gap: 1rem;
      align-items: center;
      padding: 0.85rem 0;
      border-top: 1px solid var(--border);
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

    .hero.up strong {
      color: #4fd1a5;
    }
    .hero.down strong {
      color: #ef5350;
    }

    dl.grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
      gap: 0.5rem 0.8rem;
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

    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .table-wrap.scroll {
      max-height: 360px;
      overflow-y: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.73rem;
    }

    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 0.4rem 0.55rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      text-align: left;
      font-size: 0.6rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-faint);
    }

    tbody td {
      padding: 0.35rem 0.55rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text-muted);
    }

    tbody tr.quiet td {
      color: var(--text-faint);
    }

    .num {
      text-align: right;
    }

    .mono {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .cond {
      font-size: 0.66rem;
    }

    .dim {
      display: inline-block;
      min-width: 5.5em;
      color: var(--text-faint);
      font-size: 0.62rem;
      text-transform: uppercase;
    }

    .up {
      color: #4fd1a5;
    }
    .down {
      color: #ef5350;
    }

    .side {
      padding: 0.05rem 0.3rem;
      border-radius: 4px;
      font-size: 0.65rem;
      background: var(--surface-3, rgba(255, 255, 255, 0.06));
    }

    .side.buy {
      color: #4fd1a5;
    }
    .side.sell {
      color: #ef5350;
    }

    .note,
    .why {
      max-width: 34ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pill {
      padding: 0.12rem 0.45rem;
      border-radius: 4px;
      font-size: 0.65rem;
      background: var(--surface-3, rgba(255, 255, 255, 0.06));
      white-space: nowrap;
    }

    .pill.complete {
      color: #4fd1a5;
    }
    .pill.failed {
      color: #ef5350;
    }

    .notice.warn {
      margin: 0 0 0.7rem;
      padding: 0.5rem 0.7rem;
      border-radius: 6px;
      background: rgba(239, 83, 80, 0.1);
      color: #ef8a88;
      font-size: 0.76rem;
    }

    .fine {
      margin: 1rem 0 0;
      font-size: 0.66rem;
      color: var(--text-faint);
      line-height: 1.55;
    }
  `,
})
export class BacktestResultComponent {
  readonly detail = input<BacktestDetail | null>(null);
  readonly comparison = input<BacktestComparison | null>(null);

  /** The parameters this run used, as chips — a comparison without them is noise. */
  protected readonly paramList = computed(() => Object.entries(this.detail()?.params ?? {}));

  protected readonly exitList = computed(() =>
    Object.entries(this.detail()?.metrics?.exitBreakdown ?? {}),
  );

  /**
   * Every regime bucket, flattened into one table.
   *
   * Buckets with no trades are dropped: a row of dashes for `GAP_DOWN` on a
   * month that had no gap-down days is noise, and it reads as a failure rather
   * than as an absence.
   */
  protected readonly regimeRows = computed<RegimeRow[]>(() => {
    const detail = this.detail();
    if (!detail) return [];

    const rows: RegimeRow[] = [];
    for (const dimension of ['trend', 'gap', 'volatility'] as const) {
      const bucket = detail.byRegime[dimension];
      for (const [name, metrics] of Object.entries(bucket)) {
        if (metrics.trades > 0) {
          rows.push({ dimension, bucket: name, metrics });
        }
      }
    }
    return rows;
  });

  /**
   * Whether a change is an improvement, or `null` when it did not move.
   *
   * `higherIsBetter` travels with each delta from the backend so a reader
   * glancing at "maxDrawdown +2,400" does not have to hold the convention in
   * their head.
   */
  protected better(delta: { change: number | null; higherIsBetter: boolean }): boolean | null {
    if (delta.change === null || delta.change === 0) return null;
    return delta.higherIsBetter ? delta.change > 0 : delta.change < 0;
  }

  /** The exchange-local day a trade was taken on. */
  protected dayOf(trade: SimTrade): string {
    return new Date(trade.entryTime + 5.5 * 3_600_000).toISOString().slice(5, 10);
  }

  protected clock(epochMs: number): string {
    return formatIstTime(Math.floor(epochMs / 1000));
  }

  protected signed(value: number): string {
    const rounded = Math.round(value);
    const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
    return `${sign}₹${Math.abs(rounded).toLocaleString('en-IN')}`;
  }

  protected signedRaw(value: number): string {
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return `${sign}${Math.abs(value).toLocaleString('en-IN', {
      maximumFractionDigits: 2,
    })}`;
  }

  /** Rupees, or an em dash — a metric that is absent must never render as zero. */
  protected money(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return `₹${Math.round(value).toLocaleString('en-IN')}`;
  }

  protected num(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  protected pct(value: number): string {
    return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
  }
}
