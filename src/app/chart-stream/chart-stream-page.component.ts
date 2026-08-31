import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChartStreamComponent } from './chart-stream.component';
import { ChartStreamApiService, ChartStreamError } from './chart-stream-api.service';
import { UpstoxAuthService } from '../auth/upstox-auth.service';
import { DISPLAY_INTERVALS, intervalNameFor } from './chart-time';
import type {
  ChartSessionMode,
  InstrumentRequest,
  InstrumentType,
  LevelMethod,
  PricedOptionContract,
  StartStreamRequest,
  StreamLevelsOptions,
} from './chart-stream.models';

/**
 * What the picker offers.
 *
 * `EQUITY` is deliberately absent: the backend accepts it in the schema but
 * rejects it at resolution every time (this deployment's instrument master
 * syncs only index derivatives), and an option that always fails is worse than
 * one that is not there.
 *
 * `OPTIONS` is one entry rather than the CE/PE pair the backend's
 * `InstrumentType` uses, because a call and a put are no longer alternatives
 * here — either or both can be charted, and forcing the user to declare a leg
 * before picking a strike is what made charting both impossible.
 */
type InstrumentKind = 'INDEX' | 'FUTURE' | 'OPTIONS';

const INSTRUMENT_KINDS: { value: InstrumentKind; label: string }[] = [
  { value: 'OPTIONS', label: 'Options' },
  { value: 'INDEX', label: 'Index' },
  { value: 'FUTURE', label: 'Future' },
];

/**
 * Replay pace, as choices rather than a free number.
 *
 * `0` is the useful default: the backend replays its whole backlog to whoever
 * connects, so "instant" genuinely means the day appears at once. The paced
 * options remain for watching a session unfold.
 */
const REPLAY_SPEEDS: { value: number; label: string }[] = [
  { value: 0, label: 'Instant — whole day at once' },
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

/**
 * How support and resistance should be found, as the three answers that
 * actually differ rather than as five numeric knobs.
 *
 * `off` is a real option and the default: annotations are a choice, and a
 * chart nobody asked to annotate should not pay for the extra history fetch
 * that finding levels costs.
 */
type LevelChoice = 'off' | LevelMethod;

const LEVEL_CHOICES: { value: LevelChoice; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'swing', label: 'Swing levels' },
  { value: 'pivot', label: 'Pivot points' },
  { value: 'both', label: 'Swings + pivots' },
];

/**
 * How hard to look for swing levels, as the trade-off it really is.
 *
 * One control instead of four: `swingLookback` decides how big a turn has to
 * be, `minTouches` how often it must have been tested, and moving them
 * independently mostly produces combinations nobody wants. These three are the
 * useful diagonal through that space.
 */
const LEVEL_SENSITIVITIES: {
  value: string;
  label: string;
  tuning: { swingLookback: number; minTouches: number; maxLevels: number; tolerancePct: number };
}[] = [
  {
    value: 'major',
    label: 'Major only',
    tuning: { swingLookback: 6, minTouches: 2, maxLevels: 4, tolerancePct: 0.35 },
  },
  {
    value: 'balanced',
    label: 'Balanced',
    tuning: { swingLookback: 3, minTouches: 2, maxLevels: 6, tolerancePct: 0.25 },
  },
  {
    value: 'detailed',
    label: 'Detailed',
    tuning: { swingLookback: 2, minTouches: 1, maxLevels: 10, tolerancePct: 0.15 },
  },
];

/**
 * The most recent weekday before today, as `YYYY-MM-DD` in IST.
 *
 * A starting point, not a claim about the exchange calendar — it does not know
 * about holidays, and a holiday simply comes back with no bars and says so. The
 * point is that the date field opens on something replayable instead of empty,
 * which is otherwise the single most common reason Start fails on first use.
 */
function lastWeekdayKey(now: Date): string {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  do {
    ist.setUTCDate(ist.getUTCDate() - 1);
  } while (ist.getUTCDay() === 0 || ist.getUTCDay() === 6);
  return ist.toISOString().slice(0, 10);
}

/** One running chart: an instrument, and the session request that fills it. */
interface ChartPanel {
  /**
   * Identity for `@for`, so the CE panel keeps its chart instance when the PE
   * panel is added or removed beside it. Deliberately excludes the run counter:
   * pressing Start again should restart the same panel, not tear down its
   * canvas and build a new one.
   */
  key: string;
  label: string;
  leg: 'CE' | 'PE' | null;
  request: StartStreamRequest;
}

@Component({
  selector: 'app-chart-stream-page',
  standalone: true,
  imports: [DatePipe, FormsModule, ChartStreamComponent],
  template: `
    <header class="topbar">
      <div class="brand">
        <span class="mark">◧</span>
        <div>
          <h1>Chart stream</h1>
          <span class="sub">Upstox live &amp; replay</span>
        </div>
      </div>

      <div class="account">
        <span class="badge"><i class="dot"></i>Signed in</span>
        @if (auth.expiresAt(); as until) {
          <span class="until">until {{ until | date: 'shortTime' }}</span>
        }
        <button type="button" class="link" (click)="signOut()">Sign out</button>
      </div>
    </header>

    <main>
      <section class="controls" [class.busy]="chainLoading()">
        <div class="fields">
          <label>
            <span>Mode</span>
            <select [(ngModel)]="mode" name="mode" (ngModelChange)="onModeChange()">
              <option value="TEST">Test — replay a past day</option>
              <option value="LIVE">Live</option>
            </select>
          </label>

          <label>
            <span>Instrument</span>
            <select [(ngModel)]="kind" name="kind" (ngModelChange)="onKindChange()">
              @for (k of instrumentKinds; track k.value) {
                <option [value]="k.value">{{ k.label }}</option>
              }
            </select>
          </label>

          <label>
            <span>Underlying</span>
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
              <span>Expiry</span>
              <select
                [(ngModel)]="expiry"
                name="expiry"
                (ngModelChange)="onExpiryChange()"
                [disabled]="expiries().length === 0"
              >
                @for (e of expiries(); track e) {
                  <option [value]="e">{{ e }}{{ e === nextExpiry() ? ' · next' : '' }}</option>
                }
              </select>
            </label>
          }

          @if (isOption()) {
            <label class="leg call">
              <span>Call (CE)</span>
              <select
                [ngModel]="callStrike()"
                name="call"
                (ngModelChange)="callStrike.set($event)"
                [disabled]="calls().length === 0"
              >
                <option [ngValue]="null">{{ chainPlaceholder(calls().length) }}</option>
                @for (c of calls(); track c.instrumentKey) {
                  <option [ngValue]="c.strike">{{ optionLabel(c) }}</option>
                }
              </select>
            </label>

            <label class="leg put">
              <span>Put (PE)</span>
              <select
                [ngModel]="putStrike()"
                name="put"
                (ngModelChange)="putStrike.set($event)"
                [disabled]="puts().length === 0"
              >
                <option [ngValue]="null">{{ chainPlaceholder(puts().length) }}</option>
                @for (p of puts(); track p.instrumentKey) {
                  <option [ngValue]="p.strike">{{ optionLabel(p) }}</option>
                }
              </select>
            </label>
          }

          @if (mode() === 'TEST') {
            <label>
              <span>Session date</span>
              <input type="date" [(ngModel)]="date" name="date" (ngModelChange)="onDateChange()" />
            </label>

            <label>
              <span>Replay speed</span>
              <select [(ngModel)]="replaySpeed" name="replaySpeed">
                @for (s of speeds; track s.value) {
                  <option [ngValue]="s.value">{{ s.label }}</option>
                }
              </select>
            </label>
          }

          <label>
            <span>History</span>
            <select [(ngModel)]="historyDays" name="historyDays">
              @for (h of historyChoices; track h.value) {
                <option [ngValue]="h.value">{{ h.label }}</option>
              }
            </select>
          </label>

          <label>
            <span>Support / resistance</span>
            <select [(ngModel)]="levelChoice" name="levels">
              @for (l of levelChoices; track l.value) {
                <option [ngValue]="l.value">{{ l.label }}</option>
              }
            </select>
          </label>

          @if (levelChoice() !== 'off') {
            <label>
              <span>S/R detail</span>
              <select [(ngModel)]="levelSensitivity" name="levelSensitivity">
                @for (s of levelSensitivities; track s.value) {
                  <option [ngValue]="s.value">{{ s.label }}</option>
                }
              </select>
            </label>
          }
        </div>

        <div class="actions">
          <div class="timeframe" role="group" aria-label="Bar interval">
            @for (i of displayIntervals; track i.seconds) {
              <button
                type="button"
                [class.on]="displaySeconds() === i.seconds"
                (click)="displaySeconds.set(i.seconds)"
              >
                {{ i.label }}
              </button>
            }
          </div>

          <p class="plan">{{ plan() }}</p>
          <button type="button" class="primary" (click)="start()">Start</button>
        </div>

        @if (formError(); as message) {
          <p class="notice warn">{{ message }}</p>
        }

        @if (isOption() && calls().length) {
          <p class="notice">
            @if (pricedOn()) {
              Premiums are each contract's <strong>close on {{ pricedOn() }}</strong> (spot
              {{ underlyingClose() ?? '—' }}), for the strikes nearest at-the-money; strikes further
              out show <code>—</code> and stay selectable.
            } @else {
              Premiums are <strong>live last-traded</strong> from your Upstox session (spot
              {{ underlyingClose() ?? '—' }}), for every strike in the chain.
            }
            Pick a call, a put, or both — both charts run side by side off the same clock.
          </p>
        }
      </section>

      @if (panels().length) {
        <section class="grid" [class.pair]="panels().length > 1">
          @for (panel of panels(); track panel.key) {
            <app-chart-stream
              [request]="panel.request"
              [label]="panel.label"
              [leg]="panel.leg"
              [displaySeconds]="displaySeconds()"
            />
          }
        </section>
      } @else {
        <section class="placeholder">
          <p>Nothing streaming yet.</p>
          <p class="hint">
            Choose an instrument above and press <strong>Start</strong>. Select a call
            <em>and</em> a put to watch both legs of a strategy at once.
          </p>
        </section>
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1.5rem;
      border-bottom: 1px solid var(--border);
      background: rgba(11, 15, 20, 0.85);
      backdrop-filter: blur(8px);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.7rem;
    }

    .mark {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--accent), #1b6fae);
      color: #06121d;
      font-size: 1rem;
    }

    h1 {
      font-size: 0.95rem;
      line-height: 1.2;
    }

    .sub {
      font-size: 0.72rem;
      color: var(--text-faint);
    }

    .account {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.2rem 0.5rem;
      border-radius: 99px;
      background: rgba(38, 161, 123, 0.14);
      color: #4fd1a5;
      font-weight: 500;
    }

    .badge .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    main {
      max-width: 1600px;
      margin: 0 auto;
      padding: 1.25rem 1.5rem 3rem;
      display: grid;
      gap: 1.25rem;
    }

    .controls {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      padding: 1rem 1.1rem;
      transition: opacity 0.15s ease;
    }

    .controls.busy .fields {
      opacity: 0.7;
    }

    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 0.75rem 0.9rem;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      min-width: 0;
    }

    label > span {
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-faint);
    }

    /* The two option legs are the only place colour carries meaning in the
       form, and it is the same green/red the charts use for direction. */
    label.leg.call > span {
      color: #4fd1a5;
    }

    label.leg.put > span {
      color: #ff8a87;
    }

    label.leg.call select:hover:not(:disabled) {
      border-color: rgba(79, 209, 165, 0.6);
    }

    label.leg.put select:hover:not(:disabled) {
      border-color: rgba(255, 138, 135, 0.6);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      margin-top: 1rem;
      padding-top: 0.9rem;
      border-top: 1px solid var(--border);
    }

    .timeframe {
      display: inline-flex;
      padding: 2px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface-2);
    }

    .timeframe button {
      border: 0;
      background: none;
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
    }

    .timeframe button.on {
      background: var(--surface-3);
      color: var(--text);
    }

    .plan {
      flex: 1 1 240px;
      margin: 0;
      font-size: 0.78rem;
      color: var(--text-muted);
    }

    .notice {
      margin: 0.85rem 0 0;
      padding: 0.5rem 0.7rem;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      font-size: 0.78rem;
      color: var(--text-muted);
      line-height: 1.55;
    }

    .notice.warn {
      background: rgba(224, 164, 88, 0.12);
      color: #f0c48a;
    }

    .notice strong {
      color: var(--text);
    }

    .grid {
      display: grid;
      gap: 1rem;
    }

    /* Two legs sit side by side once there is room for both to stay readable;
       below that they stack, which is still a comparison, just a vertical one. */
    @media (min-width: 1180px) {
      .grid.pair {
        grid-template-columns: 1fr 1fr;
      }
    }

    .placeholder {
      display: grid;
      place-content: center;
      gap: 0.35rem;
      min-height: 320px;
      padding: 2rem;
      border: 1px dashed var(--border-strong);
      border-radius: var(--radius);
      text-align: center;
      color: var(--text-muted);
    }

    .placeholder p {
      margin: 0;
    }

    .placeholder .hint {
      max-width: 46ch;
      font-size: 0.82rem;
      color: var(--text-faint);
    }
  `,
})
export class ChartStreamPageComponent {
  private readonly api = inject(ChartStreamApiService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(UpstoxAuthService);
  private readonly router = inject(Router);

  protected readonly instrumentKinds = INSTRUMENT_KINDS;
  protected readonly speeds = REPLAY_SPEEDS;
  protected readonly historyChoices = HISTORY_CHOICES;
  protected readonly displayIntervals = DISPLAY_INTERVALS;
  protected readonly levelChoices = LEVEL_CHOICES;
  protected readonly levelSensitivities = LEVEL_SENSITIVITIES;

  protected readonly mode = signal<ChartSessionMode>('TEST');
  protected readonly kind = signal<InstrumentKind>('OPTIONS');
  protected readonly underlying = signal('');
  /** The two legs are independent: either, neither, or both may be charted. */
  protected readonly callStrike = signal<number | null>(null);
  protected readonly putStrike = signal<number | null>(null);
  protected readonly expiry = signal('');
  protected readonly date = signal(lastWeekdayKey(new Date()));
  protected readonly replaySpeed = signal(0);
  protected readonly historyDays = signal(0);
  /**
   * Whether — and how — to plot support and resistance with the chart.
   *
   * A *request* field rather than a display toggle, unlike the bar interval:
   * finding levels needs bars the chart itself may not have (a LIVE session
   * opened at 09:20 has five), so the backend fetches prior sessions for the
   * analysis. Each panel's own S/R button still turns the drawn lines on and
   * off afterwards without restarting anything.
   */
  protected readonly levelChoice = signal<LevelChoice>('off');
  protected readonly levelSensitivity = signal('balanced');
  /**
   * Bar width on screen, in seconds.
   *
   * A *display* concern, not a request field: the backend streams one-minute
   * bars and the chart resamples them, so changing this re-buckets what is
   * already on screen instead of restarting the session. That is also what
   * lets LIVE mode offer every interval — the wire is always `1minute`, which
   * is the only thing the live candle builder produces.
   */
  protected readonly displaySeconds = signal<number>(60);

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
  protected readonly panels = signal<ChartPanel[]>([]);

  protected readonly isOption = computed(() => this.kind() === 'OPTIONS');
  protected readonly needsExpiry = computed(() => this.kind() !== 'INDEX');

  /** Expiries arrive ascending, so the nearest one is simply the first. */
  protected readonly nextExpiry = computed(() => this.expiries()[0] ?? '');

  /** What pressing Start will do, stated before it is pressed. */
  protected readonly plan = computed(() => {
    const legs = this.selectedLegs();
    if (!legs.length) {
      return this.isOption()
        ? 'Select a call and/or a put to chart.'
        : `Charts ${this.underlying() || 'the underlying'}.`;
    }
    const what =
      legs.length === 1
        ? `Charts ${legs[0].label}.`
        : `Charts ${legs[0].label} and ${legs[1].label} side by side.`;
    return `${what}${this.levelPlan()}`;
  });

  /** The S/R half of the plan line — empty when levels are off. */
  private readonly levelPlan = computed(() => {
    switch (this.levelChoice()) {
      case 'swing':
        return ' Plots swing support & resistance.';
      case 'pivot':
        return ' Plots the previous session’s pivot points.';
      case 'both':
        return ' Plots swing levels and pivot points.';
      default:
        return '';
    }
  });

  /**
   * The contracts currently chosen, in call-then-put order.
   *
   * One list rather than two nullable fields because everything downstream —
   * validation, the plan line, the panels — wants "what is selected", and the
   * count is the only thing that differs between one chart and two.
   */
  private readonly selectedLegs = computed<
    { leg: 'CE' | 'PE'; strike: number; label: string }[]
  >(() => {
    if (!this.isOption()) return [];
    const legs: { leg: 'CE' | 'PE'; strike: number; label: string }[] = [];
    const call = this.callStrike();
    if (call !== null) {
      legs.push({ leg: 'CE', strike: call, label: this.contractName('CE', call) });
    }
    const put = this.putStrike();
    if (put !== null) {
      legs.push({ leg: 'PE', strike: put, label: this.contractName('PE', put) });
    }
    return legs;
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
    return count === 0 ? 'No contracts' : 'None';
  }

  /**
   * `24500 · ₹99.65 — NIFTY 24500 CE 25 AUG 26`
   *
   * Strike first because that is what the eye scans for, then the premium so
   * the ladder reads as a price ladder. An unpriced contract keeps its slot and
   * shows a dash rather than being hidden — it is still selectable.
   */
  protected optionLabel(contract: PricedOptionContract): string {
    const price = contract.ltp === null ? '—' : `₹${contract.ltp}`;
    return `${contract.strike} · ${price} — ${contract.tradingsymbol}`;
  }

  /** The tradingsymbol for a chosen strike, falling back to a readable name. */
  private contractName(leg: 'CE' | 'PE', strike: number): string {
    const ladder = leg === 'CE' ? this.calls() : this.puts();
    return (
      ladder.find((c) => c.strike === strike)?.tradingsymbol ??
      `${this.underlying()} ${strike} ${leg}`
    );
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

  protected onKindChange(): void {
    this.clearLegs();
    if (this.needsExpiry()) this.loadExpiries();
  }

  protected onUnderlyingChange(): void {
    this.clearLegs();
    this.expiry.set('');
    this.calls.set([]);
    this.puts.set([]);
    if (this.needsExpiry()) this.loadExpiries();
  }

  protected onExpiryChange(): void {
    this.clearLegs();
    this.loadChain();
  }

  /**
   * The listed closes are as of the replay date, so changing the date changes
   * the prices. The strikes survive — the same contract at a different date is
   * still the contract the user picked.
   */
  protected onDateChange(): void {
    this.loadChain();
  }

  /** LIVE prices the chain as it stands now; TEST prices it as of the date. */
  protected onModeChange(): void {
    this.loadChain();
  }

  private clearLegs(): void {
    // A strike carried over would name a contract that may not exist on the
    // new underlying or expiry.
    this.callStrike.set(null);
    this.putStrike.set(null);
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
   * Builds one session request per selected leg and hands them to the charts.
   *
   * Two legs are two independent backend sessions, not one multi-instrument
   * session: they are already independent on the wire (a session streams one
   * instrument key), and keeping them separate means one leg failing to
   * resolve leaves the other charting rather than taking both down.
   */
  protected start(): void {
    this.formError.set(null);

    const underlying = this.underlying().trim();
    if (!underlying) {
      this.formError.set('Pick an underlying.');
      return;
    }
    if (this.needsExpiry() && !this.expiry()) {
      this.formError.set('Expiry is required for futures and options.');
      return;
    }
    // TEST without a date is a 400 from the backend, not an ignored field.
    if (this.mode() === 'TEST' && !this.date()) {
      this.formError.set('Pick the session date to replay.');
      return;
    }

    const panels = this.isOption()
      ? this.selectedLegs().map((leg) =>
          this.panelFor(
            { type: leg.leg, underlying, strike: leg.strike, expiry: this.expiry() },
            leg.label,
            leg.leg,
          ),
        )
      : [
          this.panelFor(
            {
              type: this.kind() as InstrumentType,
              underlying,
              ...(this.needsExpiry() ? { expiry: this.expiry() } : {}),
            },
            underlying,
            null,
          ),
        ];

    if (!panels.length) {
      this.formError.set('Pick a call, a put, or both.');
      return;
    }

    this.panels.set(panels);
  }

  /**
   * The `levels` block for a start request, or `null` for an un-annotated chart.
   *
   * `interval` is the one field the chart cannot leave to the backend default:
   * the wire is always `1minute` and the chart resamples on screen, so without
   * naming the *displayed* interval here the backend would find levels in
   * one-minute wiggles and the browser would draw them over 15-minute bars.
   */
  private levelOptions(): StreamLevelsOptions | null {
    const choice = this.levelChoice();
    if (choice === 'off') return null;

    const sensitivity =
      LEVEL_SENSITIVITIES.find((s) => s.value === this.levelSensitivity()) ??
      LEVEL_SENSITIVITIES[1]!;

    return {
      method: choice,
      interval: intervalNameFor(this.displaySeconds()),
      ...sensitivity.tuning,
    };
  }

  private panelFor(
    instrument: InstrumentRequest,
    label: string,
    leg: 'CE' | 'PE' | null,
  ): ChartPanel {
    const live = this.mode() === 'LIVE';
    const history = Number(this.historyDays());
    // `date` and `replaySpeed` are TEST-only: sending either with LIVE is a
    // 400, not an ignored field. `historyDays` is the exception — prior
    // sessions are just as useful behind a live chart — so it goes on both,
    // and only when non-zero.
    //
    // `interval` is always `1minute`: it is the only bar the live builder
    // produces, it is the finest a replay can source, and the chart resamples
    // it on screen. Asking the backend for coarser bars would fix the
    // timeframe for the life of the session and buy nothing.
    //
    // `levels` is the exception to the LIVE/TEST split below: both modes
    // publish the same CANDLE events through the same aggregator, so both are
    // annotated by the same code and a replay behaves exactly as live does.
    const levels = this.levelOptions();
    const request: StartStreamRequest = live
      ? {
          mode: 'LIVE',
          instrument,
          interval: '1minute',
          ...(history > 0 ? { historyDays: history } : {}),
          ...(levels ? { levels } : {}),
        }
      : {
          mode: 'TEST',
          instrument,
          interval: '1minute',
          date: this.date(),
          replaySpeed: Number(this.replaySpeed()),
          ...(history > 0 ? { historyDays: history } : {}),
          ...(levels ? { levels } : {}),
        };

    return {
      key: `${instrument.type}:${instrument.underlying}:${instrument.expiry ?? ''}:${
        instrument.strike ?? ''
      }`,
      label,
      leg,
      request,
    };
  }
}
