import { Component, DestroyRef, OnInit, computed, inject, model, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ChartStreamApiService } from '../../chart-stream/chart-stream-api.service';
import type { InstrumentType } from '../../chart-stream/chart-stream.models';
import type { TradingInstrument } from '../trading.models';

const TYPES: readonly { value: InstrumentType; label: string }[] = [
  { value: 'CE', label: 'CE' },
  { value: 'PE', label: 'PE' },
  { value: 'FUTURE', label: 'FUT' },
  { value: 'INDEX', label: 'Index' },
];

/**
 * The instruments a live session or a backtest trades.
 *
 * Two parts, deliberately separate: one compact "add" row, and the list of
 * what has been added as removable chips. The earlier design gave every
 * instrument its own full row of dropdowns, which was unreadable past three
 * instruments; now the only thing on screen per instrument is its name and
 * a remove button, and the dropdowns exist once.
 *
 * Instruments are named the way the rest of the app names them — type,
 * underlying, expiry, strike — and resolved to a contract by the backend, so
 * nothing here ever constructs an instrument key.
 */
@Component({
  selector: 'app-instrument-list-editor',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="add">
      <div class="seg" role="radiogroup" aria-label="Instrument type">
        @for (t of types; track t.value) {
          <button
            type="button"
            role="radio"
            [class.on]="type() === t.value"
            [attr.aria-checked]="type() === t.value"
            (click)="type.set(t.value)"
          >
            {{ t.label }}
          </button>
        }
      </div>
      <select
        aria-label="Underlying"
        [ngModel]="underlying()"
        (ngModelChange)="onUnderlying($event)"
      >
        <option value="" disabled>Underlying</option>
        @for (u of underlyings(); track u) {
          <option [value]="u">{{ u }}</option>
        }
      </select>
      @if (type() !== 'INDEX') {
        <select aria-label="Expiry" [ngModel]="expiry()" (ngModelChange)="expiry.set($event)">
          <option value="" disabled>Expiry</option>
          @for (e of expiries(); track e) {
            <option [value]="e">{{ e }}</option>
          }
        </select>
      }
      @if (type() === 'CE' || type() === 'PE') {
        <input
          type="number"
          min="1"
          step="50"
          placeholder="Strike"
          aria-label="Strike"
          [ngModel]="strike()"
          (ngModelChange)="strike.set($event)"
          (keydown.enter)="$event.preventDefault(); add()"
        />
      }
      <button type="button" class="add-btn" [disabled]="!draft()" (click)="add()">Add</button>
    </div>
    @if (duplicate()) {
      <p class="hint">That instrument is already in the list.</p>
    }

    @if (value().length === 0) {
      <p class="empty">No instruments yet — add one above.</p>
    } @else {
      <ul class="chips">
        @for (item of value(); track labelOf(item); let i = $index) {
          <li class="chip">
            <span class="kind" [class]="item.instrument.type">{{ kindOf(item) }}</span>
            <span class="name">{{ labelOf(item) }}</span>
            <button type="button" [attr.aria-label]="'Remove ' + labelOf(item)" (click)="remove(i)">
              ×
            </button>
          </li>
        }
      </ul>
      <button type="button" class="clear" (click)="value.set([])">Remove all</button>
    }

    @if (loadError()) {
      <p class="error">{{ loadError() }}</p>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 0.6rem;
      align-content: start;
    }
    .add {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      align-items: center;
    }
    .seg {
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .seg button {
      background: transparent;
      color: var(--text-muted);
      border: 0;
      padding: 0.32rem 0.6rem;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .seg button.on {
      background: var(--surface-3);
      color: var(--text);
    }
    select,
    input {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.32rem 0.5rem;
      font: inherit;
      font-size: 0.78rem;
      min-width: 0;
    }
    input {
      width: 6.5rem;
    }
    .add-btn {
      background: var(--accent-dim);
      color: var(--text);
      border: 0;
      border-radius: var(--radius-sm);
      padding: 0.35rem 0.8rem;
      font-size: 0.78rem;
      cursor: pointer;
    }
    .add-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .chips {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.25rem 0.3rem 0.25rem 0.45rem;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 999px;
      font-size: 0.75rem;
    }
    .kind {
      font-size: 0.62rem;
      font-weight: 600;
      padding: 0.05rem 0.35rem;
      border-radius: 999px;
      background: var(--surface-3);
      color: var(--text-muted);
    }
    .kind.CE {
      color: var(--up);
    }
    .kind.PE {
      color: var(--down);
    }
    .chip button {
      background: transparent;
      border: 0;
      color: var(--text-muted);
      font-size: 0.9rem;
      line-height: 1;
      padding: 0 0.3rem;
      cursor: pointer;
      border-radius: 999px;
    }
    .chip button:hover {
      color: var(--danger);
    }
    .clear {
      justify-self: start;
      background: transparent;
      border: 0;
      color: var(--text-faint);
      font-size: 0.7rem;
      padding: 0;
      cursor: pointer;
    }
    .empty,
    .hint {
      margin: 0;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .hint {
      color: var(--warn);
    }
    .error {
      color: var(--danger);
      font-size: 0.75rem;
      margin: 0;
    }
  `,
})
export class InstrumentListEditorComponent implements OnInit {
  private readonly api = inject(ChartStreamApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** The instruments added so far — two-way bound by the parent. */
  readonly value = model<TradingInstrument[]>([]);

  readonly types = TYPES;
  readonly type = signal<InstrumentType>('CE');
  readonly underlying = signal('');
  readonly expiry = signal('');
  readonly strike = signal<string | number>('');

  readonly underlyings = signal<string[]>([]);
  readonly loadError = signal<string | null>(null);
  private readonly expiryCache = signal<Record<string, string[]>>({});

  readonly expiries = computed(() => this.expiryCache()[this.underlying()] ?? []);

  /** The instrument the add row describes, or `null` while it is incomplete. */
  readonly draft = computed<TradingInstrument | null>(() => {
    const [item] = toInstrument({
      type: this.type(),
      underlying: this.underlying(),
      expiry: this.expiry(),
      strike: String(this.strike() ?? ''),
    });
    if (!item) return null;
    return this.duplicate() ? null : item;
  });

  readonly duplicate = computed(() => {
    const [item] = toInstrument({
      type: this.type(),
      underlying: this.underlying(),
      expiry: this.expiry(),
      strike: String(this.strike() ?? ''),
    });
    return item ? this.value().some((v) => sameInstrument(v, item)) : false;
  });

  ngOnInit(): void {
    this.api
      .underlyings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ underlyings }) => {
          this.underlyings.set(underlyings);
          const first = this.value()[0]?.instrument.underlying ?? underlyings[0];
          if (!this.underlying() && first) this.onUnderlying(first);
        },
        error: (error: Error) => this.loadError.set(`Could not load underlyings: ${error.message}`),
      });
  }

  onUnderlying(underlying: string): void {
    this.underlying.set(underlying);
    this.expiry.set('');
    const cached = this.expiryCache()[underlying];
    if (cached) {
      this.expiry.set(cached[0] ?? '');
      return;
    }
    this.api
      .expiries(underlying)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ expiries }) => {
          this.expiryCache.update((all) => ({ ...all, [underlying]: expiries }));
          if (this.underlying() === underlying && !this.expiry()) {
            this.expiry.set(expiries[0] ?? '');
          }
        },
        error: (error: Error) => this.loadError.set(`Could not load expiries: ${error.message}`),
      });
  }

  add(): void {
    const item = this.draft();
    if (!item) return;
    this.value.update((list) => [...list, item]);
    // Keep type, underlying and expiry: the next instrument is usually the
    // other leg or the next strike of the same chain.
    this.strike.set('');
  }

  remove(index: number): void {
    this.value.update((list) => list.filter((_, i) => i !== index));
  }

  labelOf(item: TradingInstrument): string {
    return instrumentLabel(item);
  }

  kindOf(item: TradingInstrument): string {
    const type = item.instrument.type;
    return type === 'FUTURE' ? 'FUT' : type === 'INDEX' ? 'IDX' : type;
  }
}

/** `NIFTY 24500 CE · 25 Sep` — how an instrument reads in a chip. */
export function instrumentLabel({ instrument: i }: TradingInstrument): string {
  const expiry = i.expiry ? ` · ${shortDate(i.expiry)}` : '';
  if (i.type === 'INDEX') return i.underlying;
  if (i.type === 'FUTURE') return `${i.underlying} FUT${expiry}`;
  return `${i.underlying} ${i.strike} ${i.type}${expiry}`;
}

function shortDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function sameInstrument(a: TradingInstrument, b: TradingInstrument): boolean {
  const x = a.instrument;
  const y = b.instrument;
  return (
    x.type === y.type &&
    x.underlying === y.underlying &&
    (x.expiry ?? '') === (y.expiry ?? '') &&
    (x.strike ?? 0) === (y.strike ?? 0)
  );
}

/** A row the backend can resolve, or nothing yet. */
export function toInstrument(row: {
  type: InstrumentType;
  underlying: string;
  expiry: string;
  strike: string;
}): TradingInstrument[] {
  if (!row.underlying) return [];
  if (row.type === 'INDEX') return [{ instrument: { type: 'INDEX', underlying: row.underlying } }];
  if (!row.expiry) return [];
  if (row.type === 'FUTURE') {
    return [{ instrument: { type: 'FUTURE', underlying: row.underlying, expiry: row.expiry } }];
  }
  const strike = Number(row.strike);
  if (!Number.isFinite(strike) || strike <= 0) return [];
  return [
    { instrument: { type: row.type, underlying: row.underlying, expiry: row.expiry, strike } },
  ];
}
