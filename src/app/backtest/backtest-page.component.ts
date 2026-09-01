import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChartStreamError } from '../chart-stream/chart-stream-api.service';
import { StrategyApiService } from '../strategy/strategy-api.service';
import type { StrategyDescriptor } from '../strategy/strategy.models';
import { UpstoxAuthService } from '../auth/upstox-auth.service';
import { NavTabsComponent } from '../shared/nav-tabs.component';
import { BacktestApiService } from './backtest-api.service';
import { BacktestResultComponent } from './backtest-result.component';
import type {
  BacktestComparison,
  BacktestDetail,
  BacktestSummary,
  DatasetInstrument,
  JournalDataset,
} from './backtest.models';

/** Calls and puts either side of the money, captured alongside the index. */
const STRIKE_CHOICES = [
  { value: 2, label: '2 either side of the money' },
  { value: 3, label: '3 either side' },
  { value: 5, label: '5 either side' },
  { value: 0, label: 'Index only (no options)' },
];

/** Capture windows offered, in calendar days back from the current expiry. */
const LOOKBACKS = [
  { value: 30, label: '1 month' },
  { value: 60, label: '2 months' },
  { value: 90, label: '3 months' },
  { value: 180, label: '6 months' },
];

/**
 * The backtest tab: capture a month, run a strategy over it, read what it did,
 * change something, run it again, compare.
 *
 * That sequence is the whole page, and the layout follows it top to bottom
 * rather than grouping by noun. Everything the loop needs is on one screen
 * because the loop is only useful if going round it is cheap.
 *
 * ## Options, with the index beside them
 *
 * A capture pulls option legs around the money **and** the index. That works —
 * despite the instrument master keeping only *active* contracts — because the
 * capture anchors on the nearest expiry still live and reaches back from it,
 * rather than forward from a settled one whose strikes can no longer be named.
 * Measured against a real month: ~7,800 bars on the near-the-money legs against
 * ~7,900 for the index.
 *
 * The contract picker matters more than it looks. A leg that was far from the
 * money early in the month has bars for only part of it, so the run covers a
 * shorter window than the dataset's label claims — which is why `tradingDays`
 * is on screen beside every choice and a short one says so.
 *
 * The strategy list follows the contract: everything can trade an option, but
 * an index carries **no volume**, so the volume-weighted strategies disappear
 * from the list when the index is selected. Left in, they would take zero
 * trades and report it as a quiet month.
 */
@Component({
  selector: 'app-backtest-page',
  standalone: true,
  imports: [DatePipe, FormsModule, NavTabsComponent, BacktestResultComponent],
  template: `
    <header class="topbar">
      <div class="brand">
        <span class="mark">◫</span>
        <div>
          <h1>Backtest</h1>
          <span class="sub">Replay a captured month, one day at a time</span>
        </div>
      </div>

      <app-nav-tabs />

      <div class="account">
        <span class="badge"><i class="dot"></i>Signed in</span>
        @if (auth.expiresAt(); as until) {
          <span class="until">until {{ until | date: 'shortTime' }}</span>
        }
        <button type="button" class="link" (click)="signOut()">Sign out</button>
      </div>
    </header>

    <main>
      @if (error(); as message) {
        <p class="notice warn">{{ message }}</p>
      }

      <!-- 1. the data ------------------------------------------------------ -->
      <section class="card">
        <header class="card-head">
          <h2>1 · Captured data</h2>
          <p class="hint">
            Option legs around the money, plus the index alongside them. The capture anchors on the
            nearest expiry <strong>still live</strong> and reaches back from it, which is what makes
            a month of option history available at all — a settled expiry drops out of the
            instrument master and its strikes stop being nameable.
          </p>
        </header>

        <div class="row">
          <label>
            <span>Underlying</span>
            <select [(ngModel)]="underlying" name="underlying">
              <option value="NIFTY">NIFTY</option>
              <option value="BANKNIFTY">BANKNIFTY</option>
            </select>
          </label>

          <label>
            <span>History</span>
            <select [(ngModel)]="lookbackDays" name="lookback">
              @for (l of lookbacks; track l.value) {
                <option [ngValue]="l.value">{{ l.label }}</option>
              }
            </select>
          </label>

          <label>
            <span>Strikes</span>
            <select [(ngModel)]="strikesPerSide" name="strikes">
              @for (s of strikeChoices; track s.value) {
                <option [ngValue]="s.value">{{ s.label }}</option>
              }
            </select>
          </label>

          <button type="button" class="primary" [disabled]="capturing()" (click)="capture()">
            {{ capturing() ? 'Capturing…' : 'Capture' }}
          </button>
        </div>

        @if (capturing()) {
          <p class="hint working">
            Pulling a month of one-minute bars. This is minutes of upstream requests, not seconds —
            leave it running.
          </p>
        }

        @if (datasets().length) {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Dataset</th>
                  <th>Window</th>
                  <th class="num">Bars</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                @for (d of datasets(); track d.id) {
                  <tr [class.on]="datasetId() === d.id" (click)="selectDataset(d.id)">
                    <td>
                      <input
                        type="radio"
                        name="dataset"
                        [checked]="datasetId() === d.id"
                        (change)="selectDataset(d.id)"
                      />
                    </td>
                    <td>{{ d.label }}</td>
                    <td class="mono">{{ d.fromDate }} → {{ d.toDate }}</td>
                    <td class="num mono">{{ d.barCount.toLocaleString() }}</td>
                    <td>
                      <span class="pill" [class]="d.status.toLowerCase()">
                        {{ d.status }}
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (!capturing()) {
          <p class="empty">
            No captures yet. Press <strong>Capture</strong> to pull a month of index bars.
          </p>
        }
      </section>

      <!-- 2. the run ------------------------------------------------------- -->
      <section class="card">
        <header class="card-head">
          <h2>2 · Run a strategy</h2>
          <p class="hint">
            Every day starts on the same capital, so days are comparable and no single day can
            dominate the month.
          </p>
        </header>

        <div class="row">
          <label class="grow">
            <span>Contract to trade</span>
            <select
              [ngModel]="instrumentKey()"
              name="instrument"
              (ngModelChange)="onInstrumentChange($event)"
              [disabled]="instruments().length === 0"
            >
              @for (i of instruments(); track i.instrumentKey) {
                <option [ngValue]="i.instrumentKey">
                  {{ i.tradingsymbol }} · {{ i.tradingDays }} days · {{ i.bars }} bars
                </option>
              }
            </select>
          </label>
        </div>

        @if (selectedInstrument(); as inst) {
          @if (inst.tradingDays < bestCoverage()) {
            <p class="hint warnish">
              {{ inst.tradingsymbol }} has bars on only {{ inst.tradingDays }} of the
              {{ bestCoverage() }} days this capture covers — it was far from the money for the
              rest. A run over it covers a shorter month than the label says.
            </p>
          }
        }

        <div class="row">
          <label class="grow">
            <span>Strategy</span>
            <select
              [ngModel]="strategyId()"
              name="strategy"
              (ngModelChange)="onStrategyChange($event)"
            >
              @for (s of availableStrategies(); track s.id) {
                <option [ngValue]="s.id">{{ s.name }} · {{ s.timeframeMinutes }}m</option>
              }
            </select>
          </label>

          <label>
            <span>Capital / day</span>
            <input type="number" min="10000" step="50000" [(ngModel)]="capital" name="capital" />
          </label>

          <label>
            <span>Lot size</span>
            <input type="number" min="1" step="1" [(ngModel)]="lotSize" name="lot" />
          </label>

          <label
            title="Share of free cash a single position may deploy. Going all-in on one option premium loses half the book on one bad day, and the month then measures that rather than the strategy."
          >
            <span>Exposure</span>
            <input
              type="number"
              min="0.05"
              max="1"
              step="0.05"
              [ngModel]="exposureFraction()"
              name="exposure"
              (ngModelChange)="exposureFraction.set(+$event)"
            />
            <em>of cash per trade</em>
          </label>

          <label [title]="marginHint()">
            <span>Margin</span>
            <input
              type="number"
              min="0.05"
              max="1"
              step="0.05"
              [ngModel]="marginFraction()"
              name="margin"
              (ngModelChange)="marginFraction.set(+$event)"
            />
            <em>{{ marginHint() }}</em>
          </label>
        </div>

        @if (selectedStrategy(); as s) {
          <p class="hint desc">{{ s.description }}</p>

          <div class="params">
            @for (spec of s.paramSpecs; track spec.key) {
              <label [title]="spec.description">
                <span>{{ spec.label }}</span>
                <input
                  type="number"
                  [min]="spec.min"
                  [max]="spec.max"
                  [step]="spec.step"
                  [ngModel]="paramValue(spec.key)"
                  [name]="'p-' + spec.key"
                  (ngModelChange)="setParam(spec.key, $event)"
                />
                <em>{{ spec.min }}–{{ spec.max }}</em>
              </label>
            }
          </div>
        }

        <div class="row">
          <label class="grow">
            <span>Notes — what changed, and why</span>
            <input
              type="text"
              [(ngModel)]="notes"
              name="notes"
              placeholder="e.g. widened the stop after four stop-outs on gap days"
            />
          </label>

          <label>
            <span>From (optional)</span>
            <input type="date" [(ngModel)]="fromDate" name="from" />
          </label>

          <label>
            <span>To (optional)</span>
            <input type="date" [(ngModel)]="toDate" name="to" />
          </label>
        </div>

        <div class="actions">
          <p class="hint">
            A date window keeps a holdout back: fit on the early weeks, measure on the last, and do
            not look at the last while fitting.
          </p>
          <button
            type="button"
            class="primary"
            [disabled]="running() || datasetId() === null"
            (click)="run()"
          >
            {{ running() ? 'Running…' : 'Run backtest' }}
          </button>
        </div>
      </section>

      <!-- 3. the result ---------------------------------------------------- -->
      @if (result(); as detail) {
        <app-backtest-result [detail]="detail" [comparison]="comparison()" />
      }

      <!-- 4. the history --------------------------------------------------- -->
      @if (runs().length) {
        <section class="card">
          <header class="card-head">
            <h2>3 · Previous runs</h2>
            <p class="hint">
              Tick two to compare them. A sequence of runs without notes is a sequence of numbers.
            </p>
          </header>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Run</th>
                  <th>Strategy</th>
                  <th class="num">Days</th>
                  <th class="num">Trades</th>
                  <th class="num">Net</th>
                  <th class="num">Expectancy</th>
                  <th class="num">PF</th>
                  <th class="num">Max DD</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                @for (r of runs(); track r.id) {
                  <tr [class.on]="result()?.id === r.id">
                    <td>
                      <input
                        type="checkbox"
                        [checked]="isPicked(r.id)"
                        (change)="togglePick(r.id)"
                      />
                    </td>
                    <td class="link-cell" (click)="open(r.id)">#{{ r.id }} {{ r.label }}</td>
                    <td>{{ r.strategyName }}</td>
                    <td class="num mono">{{ r.tradingDays }}</td>
                    <td class="num mono">{{ r.tradeCount }}</td>
                    <td class="num mono" [class.up]="r.netPnl >= 0" [class.down]="r.netPnl < 0">
                      {{ signed(r.netPnl) }}
                    </td>
                    <td class="num mono">{{ maybe(r.metrics?.expectancy) }}</td>
                    <td class="num mono">{{ maybe(r.metrics?.profitFactor) }}</td>
                    <td class="num mono">{{ maybe(r.metrics?.maxDrawdown) }}</td>
                    <td class="notes">{{ r.notes ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div class="actions">
            <p class="hint">
              @if (picked().length === 2) {
                Comparing #{{ picked()[0] }} against #{{ picked()[1] }}.
              } @else {
                Pick exactly two runs to compare — {{ picked().length }} picked.
              }
            </p>
            <button
              type="button"
              class="ghost"
              [disabled]="picked().length !== 2 || comparing()"
              (click)="compare()"
            >
              {{ comparing() ? 'Comparing…' : 'Compare' }}
            </button>
          </div>
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

    button.link {
      border: 0;
      background: none;
      color: var(--text-muted);
      font: inherit;
      cursor: pointer;
      text-decoration: underline;
    }

    main {
      max-width: 1600px;
      margin: 0 auto;
      padding: 1.25rem 1.5rem 3rem;
      display: grid;
      gap: 1.1rem;
    }

    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      padding: 1rem 1.1rem;
    }

    .card-head {
      margin-bottom: 0.85rem;
    }

    h2 {
      font-size: 0.85rem;
      margin: 0 0 0.2rem;
    }

    .hint {
      margin: 0;
      font-size: 0.72rem;
      color: var(--text-faint);
      line-height: 1.55;
      max-width: 80ch;
    }

    .hint.desc {
      margin: 0.6rem 0 0;
      color: var(--text-muted);
    }

    .hint.working {
      margin-top: 0.6rem;
      color: #d9a441;
    }

    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 0.75rem 0.9rem;
      margin-bottom: 0.75rem;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      min-width: 0;
    }

    label.grow {
      flex: 1 1 260px;
    }

    label > span {
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-faint);
    }

    label > em {
      font-style: normal;
      font-size: 0.62rem;
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
    }

    input,
    select {
      padding: 0.4rem 0.5rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface-2, rgba(255, 255, 255, 0.03));
      color: var(--text);
      font: inherit;
      font-size: 0.8rem;
    }

    input[type='number'] {
      width: 120px;
      font-variant-numeric: tabular-nums;
    }

    .params {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 0.6rem 0.8rem;
      margin: 0.8rem 0;
      padding: 0.75rem;
      border: 1px dashed var(--border);
      border-radius: 8px;
    }

    .params input {
      width: 100%;
    }

    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    button.primary {
      padding: 0.45rem 1.1rem;
      border: 0;
      border-radius: 6px;
      background: var(--accent);
      color: #06121d;
      font: inherit;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
    }

    button.ghost {
      padding: 0.4rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.78rem;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.45;
      cursor: default;
    }

    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.75rem;
    }

    thead th {
      padding: 0.45rem 0.6rem;
      background: var(--surface-2, rgba(255, 255, 255, 0.02));
      border-bottom: 1px solid var(--border);
      text-align: left;
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-faint);
    }

    tbody td {
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text-muted);
    }

    tbody tr.on {
      background: rgba(56, 139, 253, 0.08);
    }

    tbody tr:hover {
      background: rgba(255, 255, 255, 0.02);
    }

    .link-cell {
      cursor: pointer;
      color: var(--text);
    }

    .link-cell:hover {
      text-decoration: underline;
    }

    .num {
      text-align: right;
    }

    .mono {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .up {
      color: #4fd1a5;
    }
    .down {
      color: #ef5350;
    }

    .notes {
      max-width: 30ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pill {
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      font-size: 0.65rem;
      background: var(--surface-3, rgba(255, 255, 255, 0.06));
    }

    .pill.complete {
      color: #4fd1a5;
    }
    .pill.partial {
      color: #d9a441;
    }
    .pill.failed {
      color: #ef5350;
    }

    .empty {
      margin: 0;
      padding: 1rem;
      text-align: center;
      font-size: 0.75rem;
      color: var(--text-faint);
    }

    .notice {
      margin: 0;
      padding: 0.6rem 0.8rem;
      border-radius: 8px;
      font-size: 0.78rem;
    }

    .notice.warn {
      background: rgba(239, 83, 80, 0.1);
      color: #ef8a88;
    }
  `,
})
export class BacktestPageComponent {
  private readonly api = inject(BacktestApiService);
  private readonly strategies = inject(StrategyApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  protected readonly auth = inject(UpstoxAuthService);

  protected readonly lookbacks = LOOKBACKS;
  protected readonly strikeChoices = STRIKE_CHOICES;

  protected readonly underlying = signal('NIFTY');
  protected readonly lookbackDays = signal(30);
  protected readonly capturing = signal(false);
  protected readonly strikesPerSide = signal(2);
  protected readonly datasets = signal<JournalDataset[]>([]);
  protected readonly datasetId = signal<number | null>(null);
  protected readonly instruments = signal<DatasetInstrument[]>([]);
  protected readonly instrumentKey = signal<string | null>(null);

  protected readonly catalogue = signal<StrategyDescriptor[]>([]);
  protected readonly strategyId = signal('');
  protected readonly params = signal<Record<string, number>>({});
  protected readonly capital = signal(500_000);
  protected readonly lotSize = signal(75);
  /**
   * Share of a position's notional the book ties up.
   *
   * `1` for an option, whose premium is paid in full. An index means an index
   * *future*, which posts roughly a fifth — and getting that wrong is not a
   * rounding error: one NIFTY lot is ₹18 lakh of notional, so reserving it in
   * full makes the strategy untradeable and the run silently returns no trades.
   * Set from the chosen contract; still editable.
   */
  protected readonly marginFraction = signal(1);

  /**
   * Share of free cash a single position may deploy.
   *
   * A quarter rather than all of it. Going all-in is what an unqualified
   * "capital" implies and almost never what anyone means — on an option it is
   * reckless in a way that swamps the measurement, because a premium can halve
   * in a session and the month's P&L then describes that decision rather than
   * the strategy.
   */
  protected readonly exposureFraction = signal(0.25);
  protected readonly notes = signal('');
  protected readonly fromDate = signal('');
  protected readonly toDate = signal('');

  protected readonly running = signal(false);
  protected readonly result = signal<BacktestDetail | null>(null);
  protected readonly runs = signal<BacktestSummary[]>([]);
  protected readonly picked = signal<number[]>([]);
  protected readonly comparing = signal(false);
  protected readonly comparison = signal<BacktestComparison | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly selectedInstrument = computed(
    () => this.instruments().find((i) => i.instrumentKey === this.instrumentKey()) ?? null,
  );

  /** `INDEX` when the index is selected, `OPTION` for a call or a put. */
  protected readonly instrumentKind = computed<'INDEX' | 'OPTION'>(() =>
    this.selectedInstrument()?.role === 'UNDERLYING' ? 'INDEX' : 'OPTION',
  );

  /**
   * The strategies that can read the chosen contract.
   *
   * An index carries no volume, so a volume-weighted strategy pointed at one
   * never warms up and takes zero trades — which looks exactly like a quiet
   * month rather than like the mismatch it is. Filtering here means the pairing
   * cannot be made by accident; the backend refuses it too, with the reason.
   */
  protected readonly availableStrategies = computed(() => {
    const kind = this.instrumentKind();
    return this.catalogue().filter((s) => s.instrument === 'ANY' || s.instrument === kind);
  });

  /** The most days any leg in this capture covers — what a short one is short of. */
  protected readonly bestCoverage = computed(() =>
    this.instruments().reduce((most, i) => Math.max(most, i.tradingDays), 0),
  );

  protected readonly marginHint = computed(() =>
    this.instrumentKind() === 'INDEX'
      ? 'An index future posts about a fifth of the contract value as margin.'
      : 'An option bought outright is paid for in full.',
  );

  protected readonly selectedStrategy = computed(
    () => this.catalogue().find((s) => s.id === this.strategyId()) ?? null,
  );

  constructor() {
    this.loadCatalogue();
    this.loadDatasets();
    this.loadRuns();
  }

  protected signOut(): void {
    this.auth
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.router.navigate(['/login']));
  }

  /* --- data ------------------------------------------------------------- */

  protected capture(): void {
    this.error.set(null);
    this.capturing.set(true);
    this.api
      .captureDataset({
        underlyings: [this.underlying()],
        lookbackDays: Number(this.lookbackDays()),
        strikesPerSide: Number(this.strikesPerSide()),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dataset) => {
          this.capturing.set(false);
          this.selectDataset(dataset.id);
          this.loadDatasets();
        },
        error: (e: ChartStreamError) => {
          this.capturing.set(false);
          this.error.set(e.message);
        },
      });
  }

  private loadDatasets(): void {
    this.api
      .datasets()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (datasets) => {
          this.datasets.set(datasets);
          if (this.datasetId() === null && datasets.length > 0) {
            // The newest usable capture, so Run works without a second click.
            const usable = datasets.find((d) => d.barCount > 0);
            if (usable) this.selectDataset(usable.id);
          }
        },
        error: (e: ChartStreamError) => this.error.set(e.message),
      });
  }

  /**
   * Selects a capture and loads what it holds.
   *
   * The contract is chosen for the user rather than left blank: the most liquid
   * option leg, because options are what get traded and the picker's whole
   * point is that a run works without a second decision. The index is the
   * fallback for a capture taken without legs.
   */
  protected selectDataset(id: number): void {
    this.datasetId.set(id);
    this.instruments.set([]);
    this.instrumentKey.set(null);

    this.api
      .instruments(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ instruments }) => {
          this.instruments.set(instruments);
          const options = instruments.filter((i) => i.role !== 'UNDERLYING');
          const pool = options.length > 0 ? options : instruments;
          const best = [...pool].sort((a, b) => b.bars - a.bars)[0];
          if (best) this.onInstrumentChange(best.instrumentKey);
        },
        error: (e: ChartStreamError) => this.error.set(e.message),
      });
  }

  /**
   * Switching contract re-picks the strategy and the margin.
   *
   * Both follow from what was chosen: a volume-weighted strategy cannot read an
   * index, and an index future posts margin where an option is paid for in
   * full. Leaving either stale is how a run silently measures nothing.
   */
  protected onInstrumentChange(key: string): void {
    this.instrumentKey.set(key);
    this.marginFraction.set(this.instrumentKind() === 'INDEX' ? 0.2 : 1);

    const available = this.availableStrategies();
    if (!available.some((s) => s.id === this.strategyId())) {
      const first = available[0];
      if (first) this.onStrategyChange(first.id);
    }
  }

  /* --- strategy --------------------------------------------------------- */

  private loadCatalogue(): void {
    this.strategies
      .catalogue()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ strategies }) => {
          this.catalogue.set(strategies);
          const first = this.availableStrategies()[0];
          if (first && !this.strategyId()) this.onStrategyChange(first.id);
        },
        error: (e: ChartStreamError) => this.error.set(e.message),
      });
  }

  /** Switching strategy resets the parameters to that strategy's defaults. */
  protected onStrategyChange(id: string): void {
    this.strategyId.set(id);
    const definition = this.catalogue().find((s) => s.id === id);
    this.params.set({ ...(definition?.params ?? {}) });
  }

  protected paramValue(key: string): number | null {
    return this.params()[key] ?? null;
  }

  protected setParam(key: string, value: unknown): void {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    this.params.update((current) => ({ ...current, [key]: numeric }));
  }

  /* --- running ---------------------------------------------------------- */

  protected run(): void {
    const datasetId = this.datasetId();
    if (datasetId === null) {
      this.error.set('Pick a captured dataset first.');
      return;
    }

    this.error.set(null);
    this.running.set(true);
    this.comparison.set(null);

    this.api
      .run({
        datasetId,
        strategyId: this.strategyId(),
        params: this.params(),
        capital: Number(this.capital()),
        lotSize: Number(this.lotSize()),
        marginFraction: Number(this.marginFraction()),
        exposureFraction: Number(this.exposureFraction()),
        ...(this.instrumentKey() ? { instrumentKey: this.instrumentKey() as string } : {}),
        ...(this.notes().trim() ? { notes: this.notes().trim() } : {}),
        ...(this.fromDate() ? { fromDate: this.fromDate() } : {}),
        ...(this.toDate() ? { toDate: this.toDate() } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.running.set(false);
          this.result.set(detail);
          this.loadRuns();
        },
        error: (e: ChartStreamError) => {
          this.running.set(false);
          this.error.set(e.message);
        },
      });
  }

  private loadRuns(): void {
    this.api
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ runs }) => this.runs.set(runs),
        error: (e: ChartStreamError) => this.error.set(e.message),
      });
  }

  protected open(id: number): void {
    this.api
      .detail(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.result.set(detail);
          this.comparison.set(null);
        },
        error: (e: ChartStreamError) => this.error.set(e.message),
      });
  }

  /* --- comparing -------------------------------------------------------- */

  protected isPicked(id: number): boolean {
    return this.picked().includes(id);
  }

  /**
   * Toggles a run into the comparison, keeping at most two.
   *
   * The **oldest** pick is dropped when a third is added, so ticking through a
   * list compares each run against the one before it — which is the reading the
   * loop actually wants.
   */
  protected togglePick(id: number): void {
    this.picked.update((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      return [...current, id].slice(-2);
    });
  }

  protected compare(): void {
    const [a, b] = this.picked();
    if (a === undefined || b === undefined) return;

    this.error.set(null);
    this.comparing.set(true);
    this.api
      .compare(a, b)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (comparison) => {
          this.comparing.set(false);
          this.comparison.set(comparison);
          this.result.set(comparison.candidate);
        },
        error: (e: ChartStreamError) => {
          this.comparing.set(false);
          this.error.set(e.message);
        },
      });
  }

  /* --- formatting ------------------------------------------------------- */

  protected signed(value: number): string {
    const rounded = Math.round(value);
    const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
    return `${sign}₹${Math.abs(rounded).toLocaleString('en-IN')}`;
  }

  /** A metric that is genuinely absent renders as an em dash, never as zero. */
  protected maybe(value: number | null | undefined): string {
    return value === null || value === undefined
      ? '—'
      : value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
}
