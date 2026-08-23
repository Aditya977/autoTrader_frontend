import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { ChartStreamComponent } from './chart-stream.component';
import { ChartStreamApiService, ChartStreamError } from './chart-stream-api.service';
import { UpstoxAuthService } from '../auth/upstox-auth.service';
import type {
  ChartInterval,
  ChartSessionMode,
  InstrumentRequest,
  InstrumentType,
  PricedOptionContract,
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

/**
 * What the picker offers.
 *
 * `EQUITY` is deliberately absent: the backend accepts it in the schema but
 * rejects it at resolution every time (this deployment's instrument master
 * syncs only index derivatives), and an option that always fails is worse than
 * one that is not there.
 */
const INSTRUMENT_TYPES: { value: InstrumentType; label: string }[] = [
  { value: 'INDEX', label: 'Index' },
  { value: 'FUTURE', label: 'Future' },
  { value: 'CE', label: 'Call option (CE)' },
  { value: 'PE', label: 'Put option (PE)' },
];

/**
 * Replay pace, as choices rather than a free number.
 *
 * `0` is the useful default and was previously unusable: the session finished
 * before the socket opened and the chart stayed empty. The backend now replays
 * its backlog on connect, so "instant" genuinely means the whole day appears at
 * once. The paced options remain for watching a session unfold.
 */
const REPLAY_SPEEDS: { value: number; label: string }[] = [
  { value: 0, label: 'Instant (whole day at once)' },
  { value: 120, label: 'Very fast (120×)' },
  { value: 60, label: 'Fast (60×)' },
  { value: 30, label: 'Medium (30×)' },
  { value: 5, label: 'Slow (5×)' },
  { value: 1, label: 'Real time (1×)' },
];

/** Prior trading days of context to draw to the left of the streamed session. */
const HISTORY_CHOICES: { value: number; label: string }[] = [
  { value: 0, label: 'This day only' },
  { value: 1, label: '+ previous day' },
  { value: 2, label: '+ previous 2 days' },
  { value: 5, label: '+ previous 5 days' },
  { value: 10, label: '+ previous 10 days' },
];

@Component({
  selector: 'app-chart-stream-page',
  standalone: true,
  imports: [DatePipe, FormsModule, ChartStreamComponent],
  template: `
    <section class="panel">
      <header class="bar">
        <h1>Chart stream</h1>
        <span class="session">
          Signed in to Upstox
          @if (auth.expiresAt(); as until) {
            <span class="until">· until {{ until | date: 'shortTime' }}</span>
          }
          <button type="button" class="link" (click)="signOut()">Sign out</button>
        </span>
      </header>

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
          <select [(ngModel)]="instrumentType" name="type" (ngModelChange)="onTypeChange()">
            @for (t of instrumentTypes; track t.value) {
              <option [value]="t.value">{{ t.label }}</option>
            }
          </select>
        </label>

        <label>
          Underlying
          <select
            [(ngModel)]="underlying"
            name="underlying"
            (ngModelChange)="onUnderlyingChange()"
            [disabled]="underlyings().length === 0"
          >
            @for (u of underlyings(); track u) {
              <option [value]="u">{{ u }}</option>
            }
          </select>
        </label>

        @if (needsExpiry()) {
          <label>
            Expiry
            <select
              [(ngModel)]="expiry"
              name="expiry"
              (ngModelChange)="onExpiryChange()"
              [disabled]="expiries().length === 0"
            >
              @for (e of expiries(); track e) {
                <option [value]="e">{{ e }}{{ e === nextExpiry() ? ' (next)' : '' }}</option>
              }
            </select>
          </label>
        }

        @if (isOption()) {
          <label>
            Calls
            <select
              [ngModel]="instrumentType() === 'CE' ? strike() : null"
              name="call"
              (ngModelChange)="pickCall($event)"
              [disabled]="calls().length === 0"
            >
              <option [ngValue]="null" disabled>
                {{ chainPlaceholder(calls().length) }}
              </option>
              @for (c of calls(); track c.instrumentKey) {
                <option [ngValue]="c.strike">{{ label(c) }}</option>
              }
            </select>
          </label>

          <label>
            Puts
            <select
              [ngModel]="instrumentType() === 'PE' ? strike() : null"
              name="put"
              (ngModelChange)="pickPut($event)"
              [disabled]="puts().length === 0"
            >
              <option [ngValue]="null" disabled>
                {{ chainPlaceholder(puts().length) }}
              </option>
              @for (p of puts(); track p.instrumentKey) {
                <option [ngValue]="p.strike">{{ label(p) }}</option>
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
            <input type="date" [(ngModel)]="date" name="date" (ngModelChange)="onDateChange()" />
          </label>

          <label>
            Replay speed
            <select [(ngModel)]="replaySpeed" name="replaySpeed">
              @for (s of speeds; track s.value) {
                <option [ngValue]="s.value">{{ s.label }}</option>
              }
            </select>
          </label>
        }

        <label>
          History
          <select [(ngModel)]="historyDays" name="historyDays">
            @for (h of historyChoices; track h.value) {
              <option [ngValue]="h.value">{{ h.label }}</option>
            }
          </select>
        </label>

        <button type="button" (click)="start()">Start</button>
      </div>

      @if (selectedContract(); as contract) {
        <p class="hint">
          Selected <strong>{{ contract.tradingsymbol }}</strong> — strike {{ contract.strike }}, lot
          {{ contract.lotSize }}, tick {{ contract.tickSize }}
          @if (contract.close !== null) {
            <span>, closed {{ contract.close }} on {{ pricedOn() }}</span>
          }
          .
        </p>
      }

      @if (isOption() && calls().length) {
        <p class="hint">
          @if (pricedOn()) {
            Prices are each contract's <strong>close on {{ pricedOn() }}</strong> (spot
            {{ underlyingClose() ?? '—' }}), for the strikes nearest at-the-money; strikes further
            out show <code>—</code> and are still selectable.
          } @else {
            Prices are <strong>live last-traded premiums</strong> from your Upstox session (spot
            {{ underlyingClose() ?? '—' }}), for every strike in the chain.
          }
        </p>
      }

      @if (mode() === 'LIVE') {
        <p class="hint">
          LIVE accepts <code>1minute</code> only; aggregate coarser bars client-side.
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

    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
      margin: 0 0 1rem;
    }

    h1 {
      margin: 0;
      font-size: 1.25rem;
    }

    .session {
      font-size: 0.75rem;
      color: #64748b;
    }

    .session .until {
      margin-right: 0.375rem;
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

    select:disabled {
      background: #f1f5f9;
      color: #94a3b8;
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
  protected readonly auth = inject(UpstoxAuthService);
  private readonly router = inject(Router);

  private readonly chart = viewChild.required(ChartStreamComponent);

  protected readonly intervals = INTERVALS;
  protected readonly instrumentTypes = INSTRUMENT_TYPES;
  protected readonly speeds = REPLAY_SPEEDS;
  protected readonly historyChoices = HISTORY_CHOICES;

  protected readonly mode = signal<ChartSessionMode>('TEST');
  protected readonly instrumentType = signal<InstrumentType>('CE');
  protected readonly underlying = signal('');
  protected readonly strike = signal<number | null>(null);
  protected readonly expiry = signal('');
  protected readonly interval = signal<ChartInterval>('1minute');
  protected readonly date = signal('');
  protected readonly replaySpeed = signal(0);
  protected readonly historyDays = signal(0);

  /**
   * Every list below is server-supplied and never hardcoded — the instrument
   * master resyncs daily, contracts expire, and strike ladders move with the
   * underlying. A baked-in list is wrong by the next trading day.
   */
  protected readonly underlyings = signal<string[]>([]);
  protected readonly expiries = signal<string[]>([]);
  protected readonly calls = signal<PricedOptionContract[]>([]);
  protected readonly puts = signal<PricedOptionContract[]>([]);
  protected readonly chainLoading = signal(false);
  /** The date the listed closes belong to; empty when the chain is unpriced. */
  protected readonly pricedOn = signal('');
  protected readonly underlyingClose = signal<number | null>(null);

  protected readonly formError = signal<string | null>(null);

  protected readonly isOption = computed(
    () => this.instrumentType() === 'CE' || this.instrumentType() === 'PE',
  );
  protected readonly needsExpiry = computed(
    () => this.isOption() || this.instrumentType() === 'FUTURE',
  );

  /** Expiries arrive ascending, so the nearest one is simply the first. */
  protected readonly nextExpiry = computed(() => this.expiries()[0] ?? '');

  /** The contract the current type/strike pair points at, for the confirmation line. */
  protected readonly selectedContract = computed(() => {
    const strike = this.strike();
    if (!this.isOption() || strike === null) return null;
    const ladder = this.instrumentType() === 'CE' ? this.calls() : this.puts();
    return ladder.find((c) => c.strike === strike) ?? null;
  });

  constructor() {
    this.loadUnderlyings();
  }

  /**
   * Ends the Upstox session and returns to the login screen.
   *
   * Navigated explicitly rather than left to the interceptor: nothing is
   * in flight to receive a 401, so without this the user would sit on a page
   * whose next request happens to fail.
   */
  protected signOut(): void {
    this.auth
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.router.navigate(['/login']));
  }

  protected chainPlaceholder(count: number): string {
    if (this.chainLoading()) return 'Loading…';
    return count === 0 ? 'No contracts' : 'Select a strike';
  }

  /**
   * `24500 · ₹99.65 — NIFTY 24500 CE 25 AUG 26`
   *
   * Strike first because that is what the eye scans for, then the premium so
   * the ladder reads as a price ladder. An unpriced contract keeps its slot and
   * shows a dash rather than being hidden — it is still selectable.
   */
  protected label(contract: PricedOptionContract): string {
    const price = contract.ltp === null ? '—' : `₹${contract.ltp}`;
    return `${contract.strike} · ${price} — ${contract.tradingsymbol}`;
  }

  /** Underlyings first: everything else is scoped by whichever one is chosen. */
  private loadUnderlyings(): void {
    this.api
      .underlyings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ underlyings }) => {
          this.underlyings.set(underlyings);
          if (!underlyings.includes(this.underlying())) {
            this.underlying.set(underlyings[0] ?? '');
          }
          this.onUnderlyingChange();
        },
        error: (e: ChartStreamError) => this.formError.set(e.message),
      });
  }

  protected onTypeChange(): void {
    // A strike carried over from the other leg would name a contract that may
    // not exist on this one.
    this.strike.set(null);
    if (this.needsExpiry()) this.loadExpiries();
  }

  protected onUnderlyingChange(): void {
    this.strike.set(null);
    this.expiry.set('');
    this.calls.set([]);
    this.puts.set([]);
    if (this.needsExpiry()) this.loadExpiries();
  }

  protected onExpiryChange(): void {
    this.strike.set(null);
    this.loadChain();
  }

  /**
   * The listed closes are as of the replay date, so changing the date changes
   * the prices. The strike survives — the same contract at a different date is
   * still the contract the user picked.
   */
  protected onDateChange(): void {
    this.loadChain();
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
          // Default to the nearest expiry rather than leaving it blank — that
          // is the one a user asking for "NIFTY calls" almost always means.
          if (!expiries.includes(this.expiry())) this.expiry.set(expiries[0] ?? '');
          this.loadChain();
        },
        error: (e: ChartStreamError) => this.formError.set(e.message),
      });
  }

  private loadChain(): void {
    const underlying = this.underlying().trim();
    const expiry = this.expiry();
    if (!this.isOption() || !underlying || !expiry) {
      this.calls.set([]);
      this.puts.set([]);
      return;
    }

    this.chainLoading.set(true);
    // A date asks for that session's closes; no date asks for the chain as it
    // stands now, which the backend answers in one authenticated call covering
    // every strike. LIVE mode therefore shows real last-traded premiums.
    const pricedOn = this.mode() === 'TEST' ? this.date() : '';
    this.api
      .chain(underlying, expiry, pricedOn || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (chain) => {
          this.calls.set(chain.calls);
          this.puts.set(chain.puts);
          this.pricedOn.set(chain.pricedOn ?? '');
          this.underlyingClose.set(chain.underlyingPrice ?? null);
          this.chainLoading.set(false);
        },
        error: (e: ChartStreamError) => {
          this.calls.set([]);
          this.puts.set([]);
          this.pricedOn.set('');
          this.underlyingClose.set(null);
          this.chainLoading.set(false);
          this.formError.set(e.message);
        },
      });
  }

  /**
   * Picking from a ladder sets the leg as well as the strike — the two pickers
   * are one choice presented as two lists, so selecting a call *means* CE.
   */
  protected pickCall(strike: number | null): void {
    if (strike === null) return;
    this.instrumentType.set('CE');
    this.strike.set(strike);
  }

  protected pickPut(strike: number | null): void {
    if (strike === null) return;
    this.instrumentType.set('PE');
    this.strike.set(strike);
  }

  protected start(): void {
    this.formError.set(null);

    const instrument: InstrumentRequest = {
      type: this.instrumentType(),
      underlying: this.underlying().trim(),
    };
    if (!instrument.underlying) {
      this.formError.set('Pick an underlying.');
      return;
    }
    if (this.isOption()) {
      const strike = this.strike();
      if (strike === null) {
        this.formError.set('Pick a strike from the calls or puts list.');
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
    // `historyDays` is the exception — prior sessions are just as useful behind
    // a live chart — so it goes on both, and only when non-zero.
    const history = Number(this.historyDays());
    const request: StartStreamRequest = live
      ? {
          mode: 'LIVE',
          instrument,
          interval: '1minute',
          ...(history > 0 ? { historyDays: history } : {}),
        }
      : {
          mode: 'TEST',
          instrument,
          interval: this.interval(),
          ...(this.date() ? { date: this.date() } : {}),
          replaySpeed: Number(this.replaySpeed()),
          ...(history > 0 ? { historyDays: history } : {}),
        };

    this.chart().start(request);
  }
}
