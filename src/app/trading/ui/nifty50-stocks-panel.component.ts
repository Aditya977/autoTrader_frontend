import { Component, computed, input, signal } from '@angular/core';
import { percent, price, time, tone } from '../format';
import type { PaperStocksView, StockQuote } from '../trading.models';

type SortKey = 'symbol' | 'sector' | 'changePct';

/**
 * The NIFTY 50 stocks riding on the paper-trading socket: whether they are
 * streaming and, if not, why; and every stock's last price against its
 * previous close. The page refreshes it on the same timer as the session's
 * contracts, so the prices move the way the contracts' do.
 */
@Component({
  selector: 'app-nifty50-stocks-panel',
  standalone: true,
  template: `
    @if (view(); as v) {
      <div class="state">
        <span class="pill" [class.ok]="v.streaming">
          <i class="dot"></i>{{ v.streaming ? 'Streaming' : 'Not streaming' }}
        </span>
        @if (!v.enabled) {
          <span class="muted">NIFTY 50 streaming is off (STREAM_NIFTY50)</span>
        } @else if (v.reason) {
          <span class="muted">{{ v.reason }}</span>
        }
        <span class="spacer"></span>
        @if (v.stocks.length) {
          <label class="filter">
            Sector
            <select [value]="sector()" (change)="setSector($event)">
              <option value="">All sectors</option>
              @for (s of sectors(); track s) {
                <option [value]="s">{{ s }}</option>
              }
            </select>
          </label>
        }
      </div>

      @if (v.stocks.length) {
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>
                  <button type="button" class="sort" (click)="sortBy('symbol')">
                    Symbol{{ arrow('symbol') }}
                  </button>
                </th>
                <th>
                  <button type="button" class="sort" (click)="sortBy('sector')">
                    Sector{{ arrow('sector') }}
                  </button>
                </th>
                <th class="num">LTP</th>
                <th class="num">Change</th>
                <th class="num">
                  <button type="button" class="sort" (click)="sortBy('changePct')">
                    % Change{{ arrow('changePct') }}
                  </button>
                </th>
                <th class="num">Last tick</th>
              </tr>
            </thead>
            <tbody>
              @for (q of rows(); track q.symbol) {
                <tr>
                  <td class="sym">{{ q.symbol }}</td>
                  <td class="muted">{{ q.sector }}</td>
                  <td class="num">{{ price(q.lastPrice) }}</td>
                  <td class="num" [class]="tone(q.change)">{{ signed(q.change) }}</td>
                  <td class="num" [class]="tone(q.changePct)">{{ percent(q.changePct) }}</td>
                  <td class="num faint">{{ time(q.lastTickAt) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="empty">No NIFTY 50 constituents loaded on the backend.</p>
      }
    } @else if (error()) {
      <p class="empty">{{ error() }}</p>
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
    .filter {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      color: var(--text-muted);
      font-size: 0.74rem;
    }
    .table-wrap {
      max-height: 32rem;
      overflow-y: auto;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
    }
    .sort {
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      letter-spacing: inherit;
      text-transform: inherit;
      cursor: pointer;
    }
    .sort:hover:not(:disabled) {
      background: transparent;
      color: var(--text);
    }
    .sym {
      font-weight: 600;
    }
  `,
})
export class Nifty50StocksPanelComponent {
  readonly view = input<PaperStocksView | null>(null);
  /** Why the stocks could not be loaded, e.g. a backend without the endpoint. */
  readonly error = input<string | null>(null);

  readonly sector = signal('');
  readonly sort = signal<{ key: SortKey; dir: 1 | -1 }>({ key: 'symbol', dir: 1 });

  readonly sectors = computed(() =>
    [...new Set((this.view()?.stocks ?? []).map((q) => q.sector))].sort(),
  );

  readonly rows = computed(() => {
    const sector = this.sector();
    const { key, dir } = this.sort();
    return (this.view()?.stocks ?? [])
      .filter((q) => !sector || q.sector === sector)
      .slice()
      .sort((a, b) => compare(a, b, key, dir));
  });

  readonly price = price;
  readonly percent = percent;
  readonly time = time;
  readonly tone = tone;

  setSector(event: Event): void {
    this.sector.set((event.target as HTMLSelectElement).value);
  }

  sortBy(key: SortKey): void {
    const current = this.sort();
    this.sort.set({
      key,
      // % change opens biggest-gainer first; text columns open A→Z.
      dir: current.key === key ? (current.dir === 1 ? -1 : 1) : key === 'changePct' ? -1 : 1,
    });
  }

  arrow(key: SortKey): string {
    const { key: on, dir } = this.sort();
    return on === key ? (dir === 1 ? ' ▲' : ' ▼') : '';
  }

  /** `+12.40` / `−3.10` / `—`. */
  signed(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return '—';
    const text = price(Math.abs(value));
    return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
  }
}

/** Nulls (no tick yet) sort after every real value, whichever way the column runs. */
function compare(a: StockQuote, b: StockQuote, key: SortKey, dir: 1 | -1): number {
  if (key === 'changePct') {
    if (a.changePct === null) return b.changePct === null ? a.symbol.localeCompare(b.symbol) : 1;
    if (b.changePct === null) return -1;
    return (a.changePct - b.changePct) * dir;
  }
  return (a[key].localeCompare(b[key]) || a.symbol.localeCompare(b.symbol)) * dir;
}
