import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DayShapesApiService } from './day-shapes-api.service';
import { isSessionShapeError, type SessionShapeView } from './day-shapes.models';

/**
 * Look up one session and read what it was.
 *
 * The panel answers a narrower question than the catalogue above it — *what
 * kind of morning was this particular day* — and it exists because a taxonomy
 * you cannot point at a date is a table of averages nobody can check.
 *
 * Three things are deliberately shown together:
 *
 * 1. **This session's own trajectory**, drawn against the exemplar of the
 *    category it matched. Two lines on one scale is the only honest way to show
 *    "this is like that": a single line proves nothing about the match.
 * 2. **The multi-timeframe row.** The same morning classified at 1, 3, 5 and 15
 *    minutes. When those disagree it is not an inconsistency — `efficiency`
 *    counts bar-to-bar travel, so a day can be genuinely smooth in the large
 *    and jittery in the small, and the disagreement is the finding.
 * 3. **The margin.** A session sitting almost equidistant between two
 *    categories has been given a label, not a diagnosis, and the panel says so
 *    rather than presenting every match with equal confidence.
 */
@Component({
  selector: 'app-session-lookup',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="panel">
      <header>
        <h2>Look up a session</h2>
        <p class="hint">
          Pick a date and see which category its morning matched, how cleanly, and what the same
          morning looks like at other bar sizes.
        </p>
      </header>

      <div class="controls">
        <label>
          <span>Instrument</span>
          <select [ngModel]="symbol()" (ngModelChange)="pickSymbol($event)">
            @for (s of symbols(); track s) {
              <option [value]="s">{{ s }}</option>
            }
          </select>
        </label>

        <label>
          <span>Date</span>
          <select
            [ngModel]="date()"
            (ngModelChange)="date.set($event); load()"
            [disabled]="!dates().length"
          >
            @for (d of dates(); track d) {
              <option [value]="d">{{ d }}</option>
            }
          </select>
        </label>

        <label>
          <span>Timeframe</span>
          <select [ngModel]="timeframe()" (ngModelChange)="timeframe.set(+$event); load()">
            @for (tf of timeframes; track tf) {
              <option [value]="tf">{{ tf }} min</option>
            }
          </select>
        </label>
      </div>

      @if (loading()) {
        <p class="note">Reading the session…</p>
      }
      @if (message(); as m) {
        <p class="note warn">{{ m }}</p>
      }

      @if (view(); as v) {
        <div class="result">
          <div class="chart">
            <svg viewBox="0 0 320 130" role="img" [attr.aria-label]="chartLabel(v)">
              <line x1="0" [attr.y1]="zeroY(v)" x2="320" [attr.y2]="zeroY(v)" class="axis" />
              <polyline [attr.points]="categoryPoints(v)" class="typical" />
              <polyline [attr.points]="sessionPoints(v)" class="actual" />
              <line [attr.x1]="prefixX(v)" y1="6" [attr.x2]="prefixX(v)" y2="124" class="split" />
            </svg>
            <p class="legend">
              <span class="key actual"></span> {{ v.date }}
              <span class="key typical"></span> typical “{{ v.category.name }}”
              <span class="sep">·</span> dashed line is 10:45
            </p>
          </div>

          <div class="verdict">
            <h3>{{ v.classification.name }}</h3>
            <p class="conf">
              distance {{ v.classification.distance.toFixed(2) }} · runner-up
              {{ v.classification.runnerUpDistance.toFixed(2) }} ·
              <b [class.loose]="v.classification.margin > 0.85">
                {{ v.classification.margin > 0.85 ? 'loose match' : 'clean match' }}
              </b>
            </p>
          </div>

          <h4>The same morning at every bar size</h4>
          <div class="tf-row">
            @for (row of v.acrossTimeframes; track row.timeframeMinutes) {
              <div class="tf" [class.on]="row.timeframeMinutes === v.timeframeMinutes">
                <span class="tf-label">{{ row.timeframeMinutes }} min</span>
                <span class="tf-name">{{ row.name }}</span>
                <span class="tf-eff">efficiency {{ row.efficiency.toFixed(2) }}</span>
              </div>
            }
          </div>

          <h4>What the numbers were</h4>
          <div class="grid">
            <div>
              <dt>Net by 10:45</dt>
              <dd>{{ signed(v.features.netAtr) }} ATR</dd>
            </div>
            <div>
              <dt>Morning range</dt>
              <dd>{{ v.features.rangeRatio.toFixed(2) }} ATR</dd>
            </div>
            <div>
              <dt>Efficiency</dt>
              <dd>{{ v.features.efficiency.toFixed(2) }}</dd>
            </div>
            <div>
              <dt>Closed in range</dt>
              <dd>{{ (v.features.closePosition * 100).toFixed(0) }}%</dd>
            </div>
            <div>
              <dt>Trailing ATR</dt>
              <dd>{{ v.atrPrior.toFixed(2) }} pts</dd>
            </div>
            @if (v.outcome; as o) {
              <div>
                <dt>Afternoon range</dt>
                <dd>{{ o.fwdRangeAtr.toFixed(2) }} ATR</dd>
              </div>
              <div>
                <dt>Afternoon move</dt>
                <dd>{{ signed(o.fwdNetAtr) }} ATR</dd>
              </div>
            }
          </div>

          <h4>Reading it</h4>
          <ul class="insights">
            @for (line of v.insights; track line) {
              <li>{{ line }}</li>
            }
          </ul>
        </div>
      }
    </section>
  `,
  styles: `
    .panel {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.9rem;
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
    }
    h2 {
      margin: 0;
      font-size: 1rem;
    }
    .hint {
      margin: 0.2rem 0 0;
      font-size: 0.76rem;
      color: var(--text-muted);
      max-width: 70ch;
      line-height: 1.5;
    }
    .controls {
      display: flex;
      gap: 0.8rem;
      flex-wrap: wrap;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.7rem;
      color: var(--text-muted);
    }
    select {
      background: var(--surface-2, rgba(255, 255, 255, 0.04));
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.3rem 0.45rem;
      font: inherit;
      font-size: 0.82rem;
      min-width: 11rem;
    }
    .note {
      margin: 0;
      font-size: 0.78rem;
      color: var(--text-muted);
    }
    .note.warn {
      color: #f99;
    }
    .result {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .chart svg {
      width: 100%;
      height: auto;
      max-height: 190px;
      display: block;
    }
    .axis {
      stroke: var(--border);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    .split {
      stroke: var(--text-muted);
      stroke-width: 1;
      stroke-dasharray: 3 3;
      opacity: 0.7;
      vector-effect: non-scaling-stroke;
    }
    polyline {
      fill: none;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }
    polyline.actual {
      stroke: var(--accent, #4f9);
      stroke-width: 1.8;
    }
    polyline.typical {
      stroke: var(--text-muted);
      stroke-width: 1.4;
      stroke-dasharray: 4 3;
      opacity: 0.85;
    }
    .legend {
      margin: 0.3rem 0 0;
      font-size: 0.7rem;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex-wrap: wrap;
    }
    .key {
      width: 14px;
      height: 0;
      border-top: 2px solid;
      display: inline-block;
    }
    .key.actual {
      border-color: var(--accent, #4f9);
    }
    .key.typical {
      border-top-style: dashed;
      border-color: var(--text-muted);
    }
    .sep {
      opacity: 0.5;
    }
    .verdict h3 {
      margin: 0;
      font-size: 0.95rem;
    }
    .conf {
      margin: 0.15rem 0 0;
      font-size: 0.72rem;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    .conf .loose {
      color: #d9a441;
    }
    h4 {
      margin: 0.4rem 0 0;
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-muted);
      font-weight: 600;
    }
    .tf-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 0.4rem;
    }
    .tf {
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 0.4rem 0.55rem;
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }
    .tf.on {
      border-color: var(--accent, #4f9);
      background: var(--surface-3, rgba(255, 255, 255, 0.05));
    }
    .tf-label {
      font-size: 0.66rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .tf-name {
      font-size: 0.8rem;
    }
    .tf-eff {
      font-size: 0.68rem;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 0.4rem 1rem;
    }
    .grid dt {
      font-size: 0.68rem;
      color: var(--text-muted);
    }
    .grid dd {
      margin: 0.05rem 0 0;
      font-size: 0.85rem;
      font-variant-numeric: tabular-nums;
    }
    .insights {
      margin: 0;
      padding-left: 1.1rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .insights li {
      font-size: 0.78rem;
      line-height: 1.55;
    }
  `,
})
export class SessionLookupComponent {
  private readonly api = inject(DayShapesApiService);

  /** Which taxonomy the page is showing, so the lookup matches it. */
  readonly k = input.required<number>();
  /** Raised when a lookup lands, so the page can highlight the matched card. */
  readonly matched = output<number>();

  protected readonly timeframes = [1, 3, 5, 15];
  protected readonly symbols = signal<string[]>([]);
  protected readonly dates = signal<string[]>([]);
  protected readonly symbol = signal('');
  protected readonly date = signal('');
  protected readonly timeframe = signal(15);
  protected readonly view = signal<SessionShapeView | null>(null);
  protected readonly loading = signal(false);
  protected readonly message = signal<string | null>(null);

  constructor() {
    this.api.symbols().subscribe({
      next: ({ symbols }) => {
        this.symbols.set(symbols);
        const first = symbols.find((s) => s === 'NIFTY') ?? symbols[0];
        if (first) this.pickSymbol(first);
      },
      error: () => this.message.set('The instrument list could not be read.'),
    });
  }

  protected pickSymbol(symbol: string): void {
    this.symbol.set(symbol);
    this.view.set(null);
    this.api.dates(symbol).subscribe({
      next: ({ dates }) => {
        this.dates.set(dates);
        const first = dates[0];
        if (first) {
          this.date.set(first);
          this.load();
        }
      },
      error: () => this.message.set('That instrument has no dates to show.'),
    });
  }

  protected load(): void {
    const symbol = this.symbol();
    const date = this.date();
    if (!symbol || !date) return;
    this.loading.set(true);
    this.message.set(null);
    this.api.session(symbol, date, this.timeframe(), this.k()).subscribe({
      next: (result) => {
        this.loading.set(false);
        if (isSessionShapeError(result)) {
          this.view.set(null);
          this.message.set(result.error);
          return;
        }
        this.view.set(result);
        this.matched.emit(result.classification.categoryId);
      },
      error: () => {
        this.loading.set(false);
        this.message.set('That session could not be read.');
      },
    });
  }

  protected prefixX(v: SessionShapeView): number {
    return Math.round((90 / 375) * 320);
  }

  protected chartLabel(v: SessionShapeView): string {
    return `${v.symbol} on ${v.date}, drawn against the typical ${v.category.name}`;
  }

  /**
   * Both lines share one scale, taken from both series together.
   *
   * Scaling them separately would make any two shapes look alike, which is
   * exactly the comparison this chart exists to let a reader judge.
   */
  private bounds(v: SessionShapeView): { lo: number; span: number } {
    const all = [...v.shape, ...v.category.shape, 0];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    return { lo, span: hi - lo || 1 };
  }

  private plot(values: readonly number[], v: SessionShapeView): string {
    const { lo, span } = this.bounds(v);
    return values
      .map((value, i) => {
        const x = (i / Math.max(1, values.length - 1)) * 320;
        const y = 124 - ((value - lo) / span) * 118;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  protected sessionPoints(v: SessionShapeView): string {
    return this.plot(v.shape, v);
  }

  protected categoryPoints(v: SessionShapeView): string {
    return this.plot(v.category.shape, v);
  }

  protected zeroY(v: SessionShapeView): number {
    const { lo, span } = this.bounds(v);
    return Number((124 - ((0 - lo) / span) * 118).toFixed(1));
  }

  protected signed(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
  }
}
