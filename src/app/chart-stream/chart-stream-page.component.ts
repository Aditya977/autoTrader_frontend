import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { ChartStreamComponent } from './chart-stream.component';
import { ChartStreamApiService, ChartStreamError } from './chart-stream-api.service';
import { ChartStreamAuthService } from './chart-stream-auth.service';
import type {
  ChartInterval,
  ChartSessionMode,
  InstrumentRequest,
  InstrumentType,
  StartStreamRequest,
} from './chart-stream.models';

const INTERVALS: ChartInterval[] = [
  '1minute',
  '3minute',
  '5minute',
  '15minute',
  '30minute',
  '1hour',
  '1day',
];

const INSTRUMENT_TYPES: InstrumentType[] = ['INDEX', 'FUTURE', 'CE', 'PE', 'EQUITY'];

@Component({
  selector: 'app-chart-stream-page',
  standalone: true,
  imports: [FormsModule, ChartStreamComponent],
  template: `
    <section class="panel">
      <h1>Chart stream</h1>

      <div class="row">
        <label>
          Mode
          <select [(ngModel)]="mode" name="mode">
            <option value="TEST">TEST (replay)</option>
            <option value="LIVE">LIVE</option>
          </select>
        </label>

        <label>
          Type
          <select [(ngModel)]="instrumentType" name="type">
            @for (t of instrumentTypes; track t) {
              <option [value]="t">{{ t }}</option>
            }
          </select>
        </label>

        <label>
          Underlying
          <input [(ngModel)]="underlying" name="underlying" (change)="loadExpiries()" />
        </label>

        @if (needsStrike()) {
          <label>
            Strike
            <input type="number" [(ngModel)]="strike" name="strike" />
          </label>
        }

        @if (needsExpiry()) {
          <label>
            Expiry
            <select [(ngModel)]="expiry" name="expiry">
              @for (e of expiries(); track e) {
                <option [value]="e">{{ e }}</option>
              }
            </select>
          </label>
        }

        <label>
          Interval
          <select [(ngModel)]="interval" name="interval" [disabled]="mode() === 'LIVE'">
            @for (i of intervals; track i) {
              <option [value]="i">{{ i }}</option>
            }
          </select>
        </label>

        @if (mode() === 'TEST') {
          <label>
            Date
            <input type="date" [(ngModel)]="date" name="date" />
          </label>

          <label>
            Replay speed
            <input type="number" min="0" [(ngModel)]="replaySpeed" name="replaySpeed" />
          </label>
        }

        <button type="button" (click)="start()">Start</button>
      </div>

      @if (mode() === 'LIVE') {
        <p class="hint">
          LIVE accepts <code>1minute</code> only; aggregate coarser bars client-side.
          @if (authenticated() === false) {
            <button type="button" class="link" (click)="auth.login()">Log in with Upstox</button>
          }
        </p>
      }

      @if (instrumentType() === 'EQUITY') {
        <p class="hint warn">
          EQUITY is accepted by the schema but rejected at resolution (422) — this deployment's
          instrument master syncs only the configured index/derivative underlyings.
        </p>
      }

      @if (formError(); as message) {
        <p class="hint warn">{{ message }}</p>
      }
    </section>

    <app-chart-stream />
  `,
  styles: `
    :host {
      display: block;
      max-width: 1100px;
      margin: 0 auto;
      padding: 1.5rem;
      font-family:
        system-ui,
        -apple-system,
        sans-serif;
    }

    h1 {
      margin: 0 0 1rem;
      font-size: 1.25rem;
    }

    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: flex-end;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.75rem;
      color: #475569;
    }

    input,
    select {
      padding: 0.375rem 0.5rem;
      border: 1px solid #cbd5e1;
      border-radius: 0.25rem;
      font-size: 0.875rem;
    }

    button {
      padding: 0.4rem 0.9rem;
      border: 0;
      border-radius: 0.25rem;
      background: #2563eb;
      color: #fff;
      font-size: 0.875rem;
      cursor: pointer;
    }

    button.link {
      background: none;
      color: #2563eb;
      text-decoration: underline;
      padding: 0;
    }

    .hint {
      margin: 0.75rem 0 0;
      font-size: 0.8125rem;
      color: #64748b;
    }

    .hint.warn {
      color: #b45309;
    }
  `,
})
export class ChartStreamPageComponent {
  private readonly api = inject(ChartStreamApiService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(ChartStreamAuthService);

  private readonly chart = viewChild.required(ChartStreamComponent);

  protected readonly intervals = INTERVALS;
  protected readonly instrumentTypes = INSTRUMENT_TYPES;

  protected readonly mode = signal<ChartSessionMode>('TEST');
  protected readonly instrumentType = signal<InstrumentType>('CE');
  protected readonly underlying = signal('NIFTY');
  protected readonly strike = signal<number | null>(24350);
  protected readonly expiry = signal('');
  protected readonly interval = signal<ChartInterval>('1minute');
  protected readonly date = signal('');
  protected readonly replaySpeed = signal(30);

  /** Never hardcoded — the instrument master refreshes and contracts expire. */
  protected readonly expiries = signal<string[]>([]);
  protected readonly authenticated = signal<boolean | null>(null);
  protected readonly formError = signal<string | null>(null);

  protected readonly needsStrike = computed(
    () => this.instrumentType() === 'CE' || this.instrumentType() === 'PE',
  );
  protected readonly needsExpiry = computed(
    () => this.needsStrike() || this.instrumentType() === 'FUTURE',
  );

  constructor() {
    this.loadExpiries();
    this.auth
      .status()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => this.authenticated.set(s.authenticated),
        error: () => this.authenticated.set(false),
      });
  }

  protected loadExpiries(): void {
    const underlying = this.underlying().trim();
    if (!underlying) return;
    this.api
      .expiries(underlying)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ expiries }) => {
          this.expiries.set(expiries);
          if (!expiries.includes(this.expiry())) this.expiry.set(expiries[0] ?? '');
        },
        error: (e: ChartStreamError) => this.formError.set(e.message),
      });
  }

  protected start(): void {
    this.formError.set(null);

    const instrument: InstrumentRequest = {
      type: this.instrumentType(),
      underlying: this.underlying().trim(),
    };
    if (this.needsStrike()) {
      const strike = this.strike();
      if (strike === null) {
        this.formError.set('Strike is required for CE / PE.');
        return;
      }
      instrument.strike = Number(strike);
    }
    if (this.needsExpiry()) {
      if (!this.expiry()) {
        this.formError.set('Expiry is required for FUTURE / CE / PE.');
        return;
      }
      instrument.expiry = this.expiry();
    }

    const live = this.mode() === 'LIVE';
    // `date` and `replaySpeed` are TEST-only: sending either with LIVE is a
    // 400, not an ignored field. LIVE also accepts `1minute` only.
    const request: StartStreamRequest = live
      ? { mode: 'LIVE', instrument, interval: '1minute' }
      : {
          mode: 'TEST',
          instrument,
          interval: this.interval(),
          ...(this.date() ? { date: this.date() } : {}),
          replaySpeed: Number(this.replaySpeed()),
        };

    this.chart().start(request);
  }
}
