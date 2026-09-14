import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChartStreamError } from '../chart-stream/chart-stream-api.service';
import { NavTabsComponent } from '../shared/nav-tabs.component';
import { SessionLookupComponent } from './session-lookup.component';
import { DayShapesApiService } from './day-shapes-api.service';
import type { CategoryProfile, DayShapeModel, DayShapeModelSummary } from './day-shapes.models';

/**
 * The day-shape catalogue: what kinds of morning there are, and what followed.
 *
 * Two things this page has to get across, and the second is the harder one.
 *
 * **The shapes are real.** Each category carries an exemplar — a session that
 * actually traded, drawn as its own 25-point trajectory — because the medoid is
 * a real day rather than an average of several, and a picture of a real day is
 * checkable against a chart in a way an average is not.
 *
 * **The outcomes are not a signal.** Every category shows what its sessions
 * went on to do, and it would be easy to read those as a forecast. They are
 * not: `research/09` measured them against a control whose price path had been
 * destroyed by shuffling, and the control predicted afternoon range *better*
 * than the real data did. So the outcome block is labelled as description
 * throughout, and the page says the finding out loud rather than leaving a
 * reader to infer an edge that is not there.
 */
@Component({
  selector: 'app-day-shapes-page',
  standalone: true,
  imports: [NavTabsComponent, SessionLookupComponent],
  template: `
    <div class="page">
      <header class="head">
        <div>
          <h1>Day shapes</h1>
          <p class="hint">
            Every session's first 90 minutes, normalised against its trailing 14-day ATR and grouped
            by shape.
          </p>
        </div>
        <app-nav-tabs />
      </header>

      @if (error(); as message) {
        <p class="notice warn">{{ message }}</p>
      }

      @if (loading()) {
        <p class="notice">Reading the catalogue…</p>
      }

      @if (models().length) {
        <div class="controls">
          <span class="lbl">Taxonomy</span>
          @for (kv of kValues(); track kv) {
            <button type="button" class="seg" [class.on]="kv === selectedK()" (click)="select(kv)">
              {{ kv }} categories
              <small>stability {{ stabilityOf(kv).toFixed(2) }}</small>
            </button>
          }
        </div>

        <div class="controls">
          <span class="lbl">Bar size</span>
          @for (tf of timeframes; track tf) {
            <button
              type="button"
              class="seg"
              [class.on]="tf === selectedTf()"
              (click)="selectTimeframe(tf)"
            >
              {{ tf }} min
            </button>
          }
        </div>

        <p class="explain">
          <b>Why two.</b> Four categories are what <i>reproduce</i>: refit the model on random
          halves of the training period and four come back, twelve largely do not. Twelve are easier
          to tell apart and rest on thinner evidence. The stability figure on each button is the
          median adjusted Rand index over twenty refits — it is the price of the finer cut, shown
          rather than hidden.
        </p>

        <p class="explain">
          <b>Why the bar size changes the answer.</b> A shape is not one thing.
          <i>Efficiency</i> counts bar-to-bar travel, so a session that grinds upward while wobbling
          every minute reads as chop at one minute and as a clean trend at fifteen — the wobble is
          inside a bucket by then. Each bar size therefore has its own fitted taxonomy, and two that
          disagree about the same morning are saying something neither says alone.
        </p>
      }

      @if (model(); as m) {
        <p class="fitted">
          Fitted on <b>{{ m.fitted.sessions.toLocaleString('en-IN') }}</b> sessions of
          {{ m.fitted.instruments.join(', ') }}, {{ m.fitted.from }} → {{ m.fitted.to }}. The
          2025–26 holdout was scored against these categories and never used to place them.
        </p>

        <p class="notice caution">
          <b>Read the outcomes as description, not forecast.</b> These categories were tested
          against a control whose price path was destroyed by shuffling its minutes. The control
          predicted afternoon range <i>better</i> than the real data, and the barrier win rate is
          flat across every category. Nothing here cleared the pre-registered test for a tradeable
          edge.
        </p>

        <app-session-lookup [k]="m.k" (matched)="expandedId.set($event)" />

        <div class="cards">
          @for (c of m.categories; track c.id) {
            <article class="card" [class.open]="c.id === expandedId()">
              <button
                type="button"
                class="card-head"
                (click)="toggle(c.id)"
                [attr.aria-expanded]="c.id === expandedId()"
              >
                <svg
                  class="spark"
                  viewBox="0 0 100 44"
                  role="img"
                  [attr.aria-label]="'Shape of ' + c.name"
                >
                  <line x1="0" [attr.y1]="zeroY(c)" x2="100" [attr.y2]="zeroY(c)" class="axis" />
                  <polyline [attr.points]="points(c)" class="path" />
                  <line
                    [attr.x1]="prefixX(m)"
                    y1="2"
                    [attr.x2]="prefixX(m)"
                    y2="42"
                    class="split"
                  />
                </svg>
                <div class="title">
                  <h2>{{ c.name }}</h2>
                  <p class="meta">
                    {{ c.sessions }} sessions · {{ (c.share * 100).toFixed(1) }}% of days
                  </p>
                </div>
                <span class="chev">{{ c.id === expandedId() ? '−' : '+' }}</span>
              </button>

              @if (c.id === expandedId()) {
                <div class="body">
                  <p class="desc">{{ c.description }}</p>

                  <h3>The morning, by 10:45</h3>
                  <dl class="grid">
                    <div>
                      <dt>Net move</dt>
                      <dd>{{ signed(c.centre.netAtr) }} ATR</dd>
                    </div>
                    <div>
                      <dt>Range travelled</dt>
                      <dd>{{ c.centre.rangeRatio.toFixed(2) }} ATR</dd>
                    </div>
                    <div>
                      <dt>Efficiency</dt>
                      <dd>{{ c.centre.efficiency.toFixed(2) }}</dd>
                    </div>
                    <div>
                      <dt>Closed in range</dt>
                      <dd>{{ (c.centre.closePosition * 100).toFixed(0) }}%</dd>
                    </div>
                    <div>
                      <dt>Gap from prior close</dt>
                      <dd>{{ signed(c.centre.gapAtr) }} ATR</dd>
                    </div>
                    <div>
                      <dt>High / low set at</dt>
                      <dd>
                        {{ (c.centre.highAt * 100).toFixed(0) }}% /
                        {{ (c.centre.lowAt * 100).toFixed(0) }}%
                      </dd>
                    </div>
                  </dl>

                  <h3>What followed <small>— description, not forecast</small></h3>
                  <dl class="grid">
                    <div>
                      <dt>Afternoon range</dt>
                      <dd>{{ c.outcome.afternoonRangeAtr.toFixed(2) }} ATR</dd>
                    </div>
                    <div>
                      <dt>Afternoon direction</dt>
                      <dd>{{ signed(c.outcome.afternoonNetAtr) }} ATR</dd>
                    </div>
                    <div>
                      <dt>Long from 10:45, 2 ATR vs 1.5 ATR</dt>
                      <dd>{{ (c.outcome.barrierWinRate * 100).toFixed(1) }}% won</dd>
                    </div>
                  </dl>

                  <p class="exemplar">
                    Shape drawn from a real session:
                    <b>{{ c.exemplar.symbol }}</b> on <b>{{ c.exemplar.date }}</b
                    >. The vertical line marks 10:45 — everything left of it decided the category,
                    everything right of it was measured afterwards.
                  </p>
                </div>
              }
            </article>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .page {
      max-width: 1100px;
      margin: 0 auto;
      padding: 1.2rem 1.2rem 4rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      flex-wrap: wrap;
    }

    h1 {
      margin: 0;
      font-size: 1.35rem;
    }

    .hint {
      margin: 0.25rem 0 0;
      color: var(--text-muted);
      font-size: 0.78rem;
      max-width: 60ch;
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
    }

    .lbl {
      font-size: 0.72rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-right: 0.2rem;
    }

    .seg {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.05rem;
      padding: 0.35rem 0.7rem;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.8rem;
      cursor: pointer;
    }

    .seg small {
      font-size: 0.66rem;
      opacity: 0.75;
      font-variant-numeric: tabular-nums;
    }

    .seg.on {
      color: var(--text);
      border-color: var(--accent, #4f9);
      background: var(--surface-3, rgba(255, 255, 255, 0.06));
    }

    .explain,
    .fitted {
      margin: 0;
      font-size: 0.78rem;
      color: var(--text-muted);
      max-width: 78ch;
      line-height: 1.55;
    }

    .notice {
      margin: 0;
      padding: 0.6rem 0.8rem;
      border-radius: 8px;
      font-size: 0.78rem;
      background: var(--surface-2, rgba(255, 255, 255, 0.03));
      line-height: 1.55;
    }

    .notice.warn {
      border: 1px solid #a44;
      color: #f99;
    }

    .notice.caution {
      border-left: 3px solid #c9a227;
      max-width: 78ch;
    }

    .cards {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .card {
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      background: var(--surface, transparent);
    }

    .card-head {
      display: grid;
      grid-template-columns: 110px 1fr auto;
      align-items: center;
      gap: 0.9rem;
      width: 100%;
      padding: 0.7rem 0.9rem;
      background: none;
      border: 0;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .card-head:hover {
      background: var(--surface-2, rgba(255, 255, 255, 0.03));
    }

    .card-head:focus-visible {
      outline: 2px solid var(--accent, #4f9);
      outline-offset: -2px;
    }

    .spark {
      width: 110px;
      height: 44px;
      display: block;
    }

    .spark .path {
      fill: none;
      stroke: var(--accent, #4f9);
      stroke-width: 1.6;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }

    .spark .axis {
      stroke: var(--border);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }

    .spark .split {
      stroke: var(--text-muted);
      stroke-width: 1;
      stroke-dasharray: 2 2;
      opacity: 0.6;
      vector-effect: non-scaling-stroke;
    }

    .title h2 {
      margin: 0;
      font-size: 0.92rem;
      font-weight: 600;
    }

    .meta {
      margin: 0.15rem 0 0;
      font-size: 0.72rem;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }

    .chev {
      font-size: 1rem;
      color: var(--text-muted);
      width: 1rem;
      text-align: center;
    }

    .body {
      padding: 0 0.9rem 0.9rem;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .desc {
      margin: 0.7rem 0 0;
      font-size: 0.82rem;
      line-height: 1.55;
    }

    h3 {
      margin: 0.5rem 0 0;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-muted);
      font-weight: 600;
    }

    h3 small {
      text-transform: none;
      letter-spacing: 0;
      font-weight: 400;
      opacity: 0.8;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 0.5rem 1rem;
      margin: 0;
    }

    .grid dt {
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    .grid dd {
      margin: 0.1rem 0 0;
      font-size: 0.88rem;
      font-variant-numeric: tabular-nums;
    }

    .exemplar {
      margin: 0.4rem 0 0;
      font-size: 0.74rem;
      color: var(--text-muted);
      line-height: 1.55;
    }

    @media (max-width: 640px) {
      .card-head {
        grid-template-columns: 80px 1fr auto;
        gap: 0.6rem;
      }
      .spark {
        width: 80px;
      }
    }
  `,
})
export class DayShapesPageComponent {
  private readonly api = inject(DayShapesApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly models = signal<DayShapeModelSummary[]>([]);
  protected readonly model = signal<DayShapeModel | null>(null);
  protected readonly selectedK = signal<number | null>(null);
  protected readonly selectedTf = signal(15);
  protected readonly timeframes = [1, 3, 5, 15];
  protected readonly expandedId = signal<number | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /** The x where the prefix ends, as a fraction of the drawn width. */
  protected readonly prefixX = (m: DayShapeModel): number =>
    Math.round((m.prefixMinutes / 375) * 100);

  constructor() {
    this.api
      .models()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ models }) => {
          this.models.set(models);
          const preferred = models.find((m) => m.isDefault) ?? models[0];
          if (preferred) {
            this.selectedTf.set(preferred.timeframeMinutes);
            this.select(preferred.k);
          } else this.loading.set(false);
        },
        error: (e: unknown) => this.fail(e),
      });
  }

  /** Distinct category counts across the fitted models, ascending. */
  protected kValues(): number[] {
    return [...new Set(this.models().map((m) => m.k))].sort((a, b) => a - b);
  }

  /** The stability of a given (timeframe, k) pair, for the button's caption. */
  protected stabilityOf(k: number): number {
    return (
      this.models().find((m) => m.k === k && m.timeframeMinutes === this.selectedTf())?.stability ??
      0
    );
  }

  protected selectTimeframe(tf: number): void {
    this.selectedTf.set(tf);
    const k = this.selectedK();
    if (k !== null) this.select(k);
  }

  protected select(k: number): void {
    this.selectedK.set(k);
    this.expandedId.set(null);
    this.loading.set(true);
    this.error.set(null);
    this.api
      .categories(k, this.selectedTf())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (model) => {
          this.model.set(model);
          this.loading.set(false);
        },
        error: (e: unknown) => this.fail(e),
      });
  }

  protected toggle(id: number): void {
    this.expandedId.update((current) => (current === id ? null : id));
  }

  /**
   * The exemplar trajectory as SVG points, scaled to its own extremes.
   *
   * Each shape is scaled independently on purpose. A shared scale would flatten
   * every quiet day into a straight line to make room for the violent ones,
   * which loses the thing the reader came for — the *shape*. Magnitude is in
   * the numbers underneath, where it can be compared properly.
   */
  protected points(category: CategoryProfile): string {
    const shape = category.shape;
    if (!shape.length) return '';
    const lo = Math.min(0, ...shape);
    const hi = Math.max(0, ...shape);
    const span = hi - lo || 1;
    return shape
      .map((value, i) => {
        const x = (i / Math.max(1, shape.length - 1)) * 100;
        const y = 42 - ((value - lo) / span) * 40;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  /** Where the day's open sits on the same scale — the zero line. */
  protected zeroY(category: CategoryProfile): number {
    const shape = category.shape;
    if (!shape.length) return 22;
    const lo = Math.min(0, ...shape);
    const hi = Math.max(0, ...shape);
    const span = hi - lo || 1;
    return Number((42 - ((0 - lo) / span) * 40).toFixed(1));
  }

  protected signed(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
  }

  private fail(e: unknown): void {
    this.loading.set(false);
    this.error.set(
      e instanceof ChartStreamError ? e.message : 'The day-shape catalogue could not be read.',
    );
  }
}
