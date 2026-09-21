import { Component, DestroyRef, OnInit, inject, model, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ChartStreamApiService } from '../../chart-stream/chart-stream-api.service';
import type { InstrumentType } from '../../chart-stream/chart-stream.models';
import type { TradingInstrument } from '../trading.models';

/** One editable row. Strings for the inputs; converted on the way out. */
interface Row {
  type: InstrumentType;
  underlying: string;
  expiry: string;
  strike: string;
}

const TYPES: readonly InstrumentType[] = ['CE', 'PE', 'FUTURE', 'INDEX'];

/**
 * The list of instruments a live session or a backtest trades.
 *
 * Instruments are named the way the rest of the app names them — type,
 * underlying, expiry, strike — and resolved to a contract by the backend, so
 * nothing here ever constructs an instrument key. Each row is independent:
 * the live engine gives every instrument its own lane.
 *
 * Emits only rows complete enough to send; an unfinished row is not an error,
 * it is a row the user has not finished.
 */
@Component({
  selector: 'app-instrument-list-editor',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="rows">
      @for (row of rows(); track $index; let i = $index) {
        <div class="row">
          <select
            [ngModel]="row.type"
            (ngModelChange)="patch(i, { type: $event })"
            aria-label="Type"
          >
            @for (t of types; track t) {
              <option [value]="t">{{ t }}</option>
            }
          </select>
          <select
            [ngModel]="row.underlying"
            (ngModelChange)="onUnderlying(i, $event)"
            aria-label="Underlying"
          >
            <option value="" disabled>Underlying</option>
            @for (u of underlyings(); track u) {
              <option [value]="u">{{ u }}</option>
            }
          </select>
          @if (row.type !== 'INDEX') {
            <select
              [ngModel]="row.expiry"
              (ngModelChange)="patch(i, { expiry: $event })"
              aria-label="Expiry"
            >
              <option value="" disabled>Expiry</option>
              @for (e of expiriesOf(row.underlying); track e) {
                <option [value]="e">{{ e }}</option>
              }
            </select>
          }
          @if (row.type === 'CE' || row.type === 'PE') {
            <input
              type="number"
              min="1"
              step="50"
              placeholder="Strike"
              aria-label="Strike"
              [ngModel]="row.strike"
              (ngModelChange)="patch(i, { strike: $event })"
            />
          }
          <button type="button" class="ghost" (click)="remove(i)" [disabled]="rows().length === 1">
            Remove
          </button>
        </div>
      }
    </div>
    <button type="button" class="ghost add" (click)="add()">+ Add instrument</button>
    @if (loadError()) {
      <p class="error">{{ loadError() }}</p>
    }
  `,
  styles: `
    .rows {
      display: grid;
      gap: 0.4rem;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      align-items: center;
    }
    select,
    input {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.35rem 0.5rem;
      font: inherit;
      font-size: 0.8rem;
      min-width: 0;
    }
    input {
      width: 7rem;
    }
    .ghost {
      background: transparent;
      color: var(--text-muted);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.3rem 0.6rem;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .ghost:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .add {
      margin-top: 0.5rem;
    }
    .error {
      color: var(--danger);
      font-size: 0.75rem;
      margin: 0.4rem 0 0;
    }
  `,
})
export class InstrumentListEditorComponent implements OnInit {
  private readonly api = inject(ChartStreamApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Complete instruments only — two-way bound by the parent. */
  readonly value = model<TradingInstrument[]>([]);

  readonly types = TYPES;
  readonly rows = signal<Row[]>([{ type: 'CE', underlying: '', expiry: '', strike: '' }]);
  readonly underlyings = signal<string[]>([]);
  readonly loadError = signal<string | null>(null);
  private readonly expiries = signal<Record<string, string[]>>({});

  ngOnInit(): void {
    const initial = this.value();
    if (initial.length) {
      this.rows.set(
        initial.map(({ instrument }) => ({
          type: instrument.type,
          underlying: instrument.underlying,
          expiry: instrument.expiry ?? '',
          strike: instrument.strike === undefined ? '' : String(instrument.strike),
        })),
      );
      for (const row of this.rows()) this.loadExpiries(row.underlying);
    }
    this.api
      .underlyings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ underlyings }) => this.underlyings.set(underlyings),
        error: (error: Error) => this.loadError.set(`Could not load underlyings: ${error.message}`),
      });
  }

  expiriesOf(underlying: string): string[] {
    return this.expiries()[underlying] ?? [];
  }

  onUnderlying(index: number, underlying: string): void {
    this.patch(index, { underlying, expiry: '' });
    this.loadExpiries(underlying);
  }

  patch(index: number, change: Partial<Row>): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
    this.emit();
  }

  add(): void {
    const last = this.rows().at(-1);
    this.rows.update((rows) => [
      ...rows,
      {
        type: last?.type ?? 'CE',
        underlying: last?.underlying ?? '',
        expiry: last?.expiry ?? '',
        strike: '',
      },
    ]);
    this.emit();
  }

  remove(index: number): void {
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
    this.emit();
  }

  private loadExpiries(underlying: string): void {
    if (!underlying || this.expiries()[underlying]) return;
    this.api
      .expiries(underlying)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ expiries }) => this.expiries.update((all) => ({ ...all, [underlying]: expiries })),
        error: (error: Error) => this.loadError.set(`Could not load expiries: ${error.message}`),
      });
  }

  private emit(): void {
    this.value.set(this.rows().flatMap((row) => toInstrument(row)));
  }
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
