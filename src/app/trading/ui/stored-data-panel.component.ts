import { Component, computed, input, signal } from '@angular/core';
import type { ExportManifest, StoredSeries } from '../trading.models';

/**
 * What the backend has recorded and a local copy can pull with
 * `npm run sync:vm`: the paper trades, the contracts traded, and every stored
 * one-minute series — the indices and the option contracts — with how far
 * each reaches. Read from the export manifest, which is counts and dates only.
 */
@Component({
  selector: 'app-stored-data-panel',
  standalone: true,
  template: `
    @if (manifest(); as m) {
      <dl class="totals">
        <div>
          <dt>Paper trades</dt>
          <dd>
            {{ m.paperTrades.count }}
            @if (m.paperTrades.firstDate) {
              <span class="faint"
                >{{ m.paperTrades.firstDate }} → {{ m.paperTrades.lastDate }}</span
              >
            }
          </dd>
        </div>
        <div>
          <dt>Contracts traded</dt>
          <dd>{{ m.tradedContracts }}</dd>
        </div>
        <div>
          <dt>Index series</dt>
          <dd>
            {{ indexSeries().length }}
            @if (indexLast(); as last) {
              <span class="faint">to {{ last }}</span>
            }
          </dd>
        </div>
        <div>
          <dt>Option series</dt>
          <dd>
            {{ optionSeries().length }}
            @if (optionLast(); as last) {
              <span class="faint">to {{ last }}</span>
            }
          </dd>
        </div>
        <div>
          <dt>Bars</dt>
          <dd>{{ totalBars().toLocaleString('en-IN') }}</dd>
        </div>
      </dl>

      @for (d of m.datasets; track d.id) {
        <details [open]="expanded() === d.id" (toggle)="onToggle(d.id, $event)">
          <summary>
            <span class="name">{{ d.label }}</span>
            <span class="faint">
              {{ d.series.length }} series · {{ bars(d.series).toLocaleString('en-IN') }} bars ·
              {{ d.fromDate }} → {{ d.toDate }}
            </span>
          </summary>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Type</th>
                  <th class="num">Bars</th>
                  <th>From</th>
                  <th>To</th>
                </tr>
              </thead>
              <tbody>
                @for (s of d.series; track s.instrumentKey) {
                  <tr>
                    <td>{{ s.tradingsymbol }}</td>
                    <td class="muted">{{ s.role === 'UNDERLYING' ? 'Index' : s.role }}</td>
                    <td class="num">{{ s.bars.toLocaleString('en-IN') }}</td>
                    <td class="muted">{{ s.firstDate }}</td>
                    <td class="muted">{{ s.lastDate }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </details>
      } @empty {
        <p class="empty">No bars stored yet.</p>
      }
      <p class="note faint">
        Pull it all locally with <code>npm run sync:vm</code> (needs the server's DATA_SYNC_TOKEN).
      </p>
    } @else if (error()) {
      <p class="empty">{{ error() }}</p>
    } @else {
      <p class="empty">Loading…</p>
    }
  `,
  styles: `
    .totals {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
      gap: 0.75rem;
      margin: 0 0 0.9rem;
    }
    .totals dt {
      color: var(--text-muted);
      font-size: 0.72rem;
    }
    .totals dd {
      display: grid;
      margin: 0.15rem 0 0;
      font-size: 1rem;
      font-weight: 600;
    }
    .totals dd .faint {
      font-size: 0.72rem;
      font-weight: 400;
    }
    details {
      border-top: 1px solid var(--border);
      padding: 0.5rem 0;
    }
    summary {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem 0.8rem;
      cursor: pointer;
      font-size: 0.8rem;
    }
    summary .name {
      font-weight: 600;
    }
    .table-wrap {
      max-height: 22rem;
      overflow-y: auto;
      margin-top: 0.5rem;
    }
    .note {
      margin: 0.6rem 0 0;
      font-size: 0.72rem;
    }
  `,
})
export class StoredDataPanelComponent {
  readonly manifest = input<ExportManifest | null>(null);
  readonly error = input<string | null>(null);

  /** The one dataset shown open; none to start with. */
  readonly expanded = signal<number | null>(null);

  private readonly allSeries = computed(() =>
    (this.manifest()?.datasets ?? []).flatMap((d) => d.series),
  );
  readonly indexSeries = computed(() => this.allSeries().filter((s) => s.role === 'UNDERLYING'));
  readonly optionSeries = computed(() => this.allSeries().filter((s) => s.role !== 'UNDERLYING'));
  readonly indexLast = computed(() => latest(this.indexSeries()));
  readonly optionLast = computed(() => latest(this.optionSeries()));
  readonly totalBars = computed(() => this.bars(this.allSeries()));

  bars(series: readonly StoredSeries[]): number {
    return series.reduce((n, s) => n + s.bars, 0);
  }

  onToggle(id: number, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    if (open) this.expanded.set(id);
    else if (this.expanded() === id) this.expanded.set(null);
  }
}

function latest(series: readonly StoredSeries[]): string | null {
  return series.reduce<string | null>(
    (max, s) => (max && max > s.lastDate ? max : s.lastDate),
    null,
  );
}
