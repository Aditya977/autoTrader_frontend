import {
  Component,
  ElementRef,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import { toChartTime } from '../chart-stream/chart-time';
import { DayShapesApiService } from './day-shapes-api.service';
import {
  isSessionBarsError,
  isSimilarSessionsError,
  type SessionCandle,
  type ShapeMatch,
  type SimilarSessionsView,
} from './day-shapes.models';

/**
 * The days that look like this one.
 *
 * Collapsed it is a single line — *"14 similar days"* — because that is the
 * only thing worth the vertical space until someone asks. Expanding lists the
 * dates; picking one draws its candles underneath.
 *
 * ## What the percentage is, and what it is not
 *
 * It is a **resemblance**: the correlation of two normalised price paths,
 * multiplied by how closely their swings match in size. Both halves are shown
 * on each row because they fail in opposite directions and a bare composite
 * cannot say which happened — the same shape at a third of the size and a
 * different shape at the same size can both land near 40.
 *
 * It is **not a probability**. Nothing in it estimates how likely anything is
 * to happen next, and the wording on this panel is deliberate: "similar", never
 * "chance". The backend's own research note records that the coarser day-shape
 * categories failed to predict the afternoon — a control with the price path
 * shuffled predicted its range better — so a percentage rendered as a forecast
 * would revive a claim that has already been tested and rejected.
 *
 * ## Why the threshold is a gate and not a ranking
 *
 * Below `minScore` the backend returns nothing rather than the closest few. A
 * day with no lookalikes shows an empty state, because a "best match" of 31%
 * is not a match — it is the top of a list that should not exist.
 */
@Component({
  selector: 'app-similar-sessions',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="similar" [class.open]="expanded()">
      <button
        type="button"
        class="summary"
        (click)="toggle()"
        [disabled]="loading() || !!message()"
        [attr.aria-expanded]="expanded()"
      >
        <span class="caret" aria-hidden="true">{{ expanded() ? '▾' : '▸' }}</span>

        @if (loading()) {
          <span class="count">Looking for similar days…</span>
        } @else if (message(); as m) {
          <span class="count warn">{{ m }}</span>
        } @else if (view(); as v) {
          @if (v.matchCount === 0) {
            <span class="count none">
              No day in this history resembles {{ v.date }} by
              {{ v.minScore }}% or more
            </span>
          } @else {
            <span class="count">
              <b>{{ v.matchCount }}</b>
              {{ v.matchCount === 1 ? 'similar day' : 'similar days' }}
            </span>
            <span class="sub">
              at {{ v.minScore }}%+ across {{ v.pool.sessions }} sessions
            </span>
          }
        }
      </button>

      <div class="gate" (click)="$event.stopPropagation()">
        <label>
          <span>Match at least</span>
          <select [ngModel]="minScore()" (ngModelChange)="setThreshold(+$event)">
            @for (t of thresholds; track t) {
              <option [value]="t">{{ t }}%</option>
            }
          </select>
        </label>
      </div>

      @if (expanded() && view(); as v) {
        @if (v.matches.length) {
          <ol class="matches">
            @for (m of v.matches; track m.date) {
              <li>
                <button
                  type="button"
                  class="match"
                  [class.on]="picked() === m.date"
                  (click)="pick(m.date)"
                >
                  <span class="date">{{ m.date }}</span>
                  <span class="bar" aria-hidden="true">
                    <span class="fill" [style.width.%]="m.score"></span>
                  </span>
                  <span class="score">{{ m.score.toFixed(1) }}%</span>
                  <span class="detail">
                    form {{ m.correlation.toFixed(2) }} · size
                    {{ m.amplitudeRatio.toFixed(2) }} · gap
                    {{ m.rmseAtr.toFixed(2) }} ATR
                  </span>
                  @if (!m.complete) {
                    <span class="badge">part day</span>
                  }
                </button>
              </li>
            }
          </ol>

          @if (v.matchCount > v.matches.length) {
            <p class="note">
              Showing the closest {{ v.matches.length }} of
              {{ v.matchCount }}.
            </p>
          }

          <p class="caveat">
            A percentage here is how alike two charts <b>look</b> — the
            correlation of their paths times how closely their swings match in
            size. It is not a probability, and it says nothing about what any of
            these days did next.
          </p>
        }

        @if (picked(); as day) {
          <div class="preview">
            <header>
              <h5>{{ day }}</h5>
              <label>
                <span>Bars</span>
                <select
                  [ngModel]="barTimeframe()"
                  (ngModelChange)="setBarTimeframe(+$event)"
                >
                  @for (tf of barTimeframes; track tf.minutes) {
                    <option [value]="tf.minutes">{{ tf.label }}</option>
                  }
                </select>
              </label>
              <button type="button" class="close" (click)="pick(day)">
                Close
              </button>
            </header>

            @if (barsMessage(); as bm) {
              <p class="note warn">{{ bm }}</p>
            }
            <div #chartHost class="canvas"></div>

            @if (typeSummary().length) {
              <p class="types">
                @for (t of typeSummary(); track t.name) {
                  <span class="chip">{{ t.name }} × {{ t.count }}</span>
                }
              </p>
            }
          </div>
        }
      }
    </section>
  `,
  styles: `
    .similar {
      border: 1px solid var(--border);
      border-radius: 8px;
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      column-gap: 0.5rem;
    }
    .similar.open {
      background: var(--surface-2, rgba(255, 255, 255, 0.02));
    }
    .summary {
      display: flex;
      align-items: baseline;
      gap: 0.45rem;
      padding: 0.5rem 0.65rem;
      background: none;
      border: 0;
      color: var(--text);
      font: inherit;
      text-align: left;
      cursor: pointer;
      width: 100%;
    }
    .summary:disabled {
      cursor: default;
    }
    .caret {
      color: var(--text-muted);
      font-size: 0.7rem;
      width: 0.7rem;
    }
    .count {
      font-size: 0.82rem;
    }
    .count b {
      font-size: 0.95rem;
    }
    .count.none,
    .sub {
      color: var(--text-muted);
      font-size: 0.72rem;
    }
    .count.warn {
      color: #f99;
      font-size: 0.76rem;
    }
    .gate {
      padding-right: 0.65rem;
    }
    .gate label {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.68rem;
      color: var(--text-muted);
    }
    select {
      background: var(--surface-2, rgba(255, 255, 255, 0.04));
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.2rem 0.35rem;
      font: inherit;
      font-size: 0.74rem;
    }
    .matches,
    .note,
    .caveat,
    .preview {
      grid-column: 1 / -1;
    }
    .matches {
      list-style: none;
      margin: 0;
      padding: 0 0.65rem 0.3rem;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      max-height: 19rem;
      overflow-y: auto;
    }
    .match {
      display: grid;
      grid-template-columns: 6rem 1fr 3.6rem;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      background: none;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 0.28rem 0.4rem;
      color: var(--text);
      font: inherit;
      cursor: pointer;
      text-align: left;
    }
    .match:hover {
      background: var(--surface-3, rgba(255, 255, 255, 0.05));
    }
    .match.on {
      border-color: var(--accent, #4f9);
      background: var(--surface-3, rgba(255, 255, 255, 0.06));
    }
    .date {
      font-size: 0.78rem;
      font-variant-numeric: tabular-nums;
    }
    .bar {
      height: 5px;
      border-radius: 3px;
      background: var(--surface-3, rgba(255, 255, 255, 0.07));
      overflow: hidden;
    }
    .fill {
      display: block;
      height: 100%;
      background: var(--accent, #4f9);
      opacity: 0.75;
    }
    .score {
      font-size: 0.78rem;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .detail {
      grid-column: 1 / -1;
      font-size: 0.66rem;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    .badge {
      grid-column: 1 / -1;
      justify-self: start;
      font-size: 0.6rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 0.05rem 0.3rem;
      border-radius: 4px;
      border: 1px solid #c9a227;
      color: #d9a441;
    }
    .note {
      margin: 0;
      padding: 0 0.65rem 0.4rem;
      font-size: 0.7rem;
      color: var(--text-muted);
    }
    .note.warn {
      color: #f99;
    }
    .caveat {
      margin: 0;
      padding: 0 0.65rem 0.6rem;
      font-size: 0.68rem;
      line-height: 1.55;
      color: var(--text-muted);
      max-width: 78ch;
    }
    .preview {
      border-top: 1px solid var(--border);
      padding: 0.5rem 0.65rem 0.65rem;
    }
    .preview header {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      margin-bottom: 0.4rem;
    }
    .preview h5 {
      margin: 0;
      font-size: 0.82rem;
      font-variant-numeric: tabular-nums;
    }
    .preview label {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.66rem;
      color: var(--text-muted);
    }
    .close {
      margin-left: auto;
      background: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.68rem;
      padding: 0.2rem 0.5rem;
      cursor: pointer;
    }
    .canvas {
      height: 260px;
      width: 100%;
    }
    .types {
      margin: 0.45rem 0 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }
    .chip {
      font-size: 0.64rem;
      color: var(--text-muted);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0.1rem 0.45rem;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class SimilarSessionsComponent {
  private readonly api = inject(DayShapesApiService);

  readonly symbol = input.required<string>();
  readonly date = input.required<string>();
  /**
   * The trajectory grid the lookup is using.
   *
   * Only 1, 3, 5 and 15 are valid: a trajectory has evenly spaced points, so
   * the bar size must divide the 375-minute session exactly.
   */
  readonly timeframe = input.required<number>();

  /** The two gates the panel was specified against. */
  protected readonly thresholds = [75, 80, 85, 90];

  /**
   * Bar sizes the preview can draw.
   *
   * Not the same list as the trajectory grid, and the omission matters: the
   * bars endpoint serves the timeframes the candle taxonomy publishes a block
   * for, and three minutes is not one of them. Sending a 3 here would be a 400.
   */
  protected readonly barTimeframes = [
    { minutes: 1, label: '1 min' },
    { minutes: 5, label: '5 min' },
    { minutes: 15, label: '15 min' },
    { minutes: 60, label: '1 hour' },
  ];

  protected readonly minScore = signal(75);
  protected readonly expanded = signal(false);
  protected readonly view = signal<SimilarSessionsView | null>(null);
  protected readonly loading = signal(false);
  protected readonly message = signal<string | null>(null);

  protected readonly picked = signal<string | null>(null);
  protected readonly barTimeframe = signal(15);
  protected readonly candles = signal<SessionCandle[]>([]);
  protected readonly barsMessage = signal<string | null>(null);

  private readonly chartHost =
    viewChild<ElementRef<HTMLDivElement>>('chartHost');
  private chart?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;

  constructor() {
    // Re-search whenever the session under the cursor changes. Collapsing on a
    // new date is deliberate: the count belongs to *this* day, and leaving the
    // previous day's list open under a new heading would be a lie for however
    // long the request takes.
    effect(() => {
      const symbol = this.symbol();
      const date = this.date();
      const timeframe = this.timeframe();
      const minScore = this.minScore();
      if (!symbol || !date) return;
      this.picked.set(null);
      this.search(symbol, date, timeframe, minScore);
    });

    // The canvas only exists while a match is open, so the chart is built when
    // the host appears and torn down when it goes.
    effect(() => {
      const host = this.chartHost()?.nativeElement;
      const bars = this.candles();
      if (!host) {
        this.disposeChart();
        return;
      }
      this.draw(host, bars);
    });
  }

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }

  protected setThreshold(value: number): void {
    this.minScore.set(value);
  }

  protected setBarTimeframe(minutes: number): void {
    this.barTimeframe.set(minutes);
    const day = this.picked();
    if (day) this.loadBars(day);
  }

  /** Opens a match, or closes it when the open one is clicked again. */
  protected pick(date: string): void {
    if (this.picked() === date) {
      this.picked.set(null);
      this.candles.set([]);
      return;
    }
    this.picked.set(date);
    this.loadBars(date);
  }

  /**
   * Which candle shapes the drawn day was made of.
   *
   * The taxonomy label is already on every bar, so summarising it costs
   * nothing and answers the question the chart raises but cannot show: a day
   * of marubozus and a day of dojis can trace the same path.
   */
  protected typeSummary(): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const bar of this.candles()) {
      const name = typeof bar.named === 'string' ? bar.named : null;
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 8);
  }

  private search(
    symbol: string,
    date: string,
    timeframe: number,
    minScore: number,
  ): void {
    this.loading.set(true);
    this.message.set(null);
    this.api.similar(symbol, date, timeframe, minScore).subscribe({
      next: (result) => {
        this.loading.set(false);
        if (isSimilarSessionsError(result)) {
          this.view.set(null);
          this.message.set(result.error);
          return;
        }
        this.view.set(result);
      },
      error: () => {
        this.loading.set(false);
        this.view.set(null);
        this.message.set('Similar days could not be looked up.');
      },
    });
  }

  private loadBars(date: string): void {
    this.barsMessage.set(null);
    this.api.bars(this.symbol(), date, this.barTimeframe()).subscribe({
      next: (result) => {
        if (isSessionBarsError(result)) {
          this.candles.set([]);
          this.barsMessage.set(result.error);
          return;
        }
        this.candles.set(result.bars);
        if (result.issues > 0) {
          this.barsMessage.set(
            `${result.issues} bar(s) were rejected as internally inconsistent and are not drawn.`,
          );
        }
      },
      error: () => {
        this.candles.set([]);
        this.barsMessage.set('That session’s bars could not be read.');
      },
    });
  }

  private draw(host: HTMLDivElement, bars: readonly SessionCandle[]): void {
    if (!this.chart) {
      this.chart = createChart(host, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: '#111820' },
          textColor: '#8b9bad',
          fontFamily: getComputedStyle(document.body).fontFamily,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: '#18222d' },
          horzLines: { color: '#18222d' },
        },
        rightPriceScale: { borderColor: '#212e3c' },
        timeScale: {
          borderColor: '#212e3c',
          timeVisible: true,
          secondsVisible: false,
        },
      });
      // lightweight-charts v5: the per-type helper is gone, replaced by
      // `addSeries(CandlestickSeries)`. Same call the live chart makes.
      this.series = this.chart.addSeries(CandlestickSeries, {
        upColor: '#26a17b',
        downColor: '#ef5350',
        borderUpColor: '#26a17b',
        borderDownColor: '#ef5350',
        wickUpColor: 'rgba(38, 161, 123, 0.4)',
        wickDownColor: 'rgba(239, 83, 80, 0.4)',
      });
    }
    this.series?.setData(
      bars.map((bar) => ({
        // The wire carries epoch milliseconds; the chart plots epoch seconds.
        time: toChartTime(bar.time),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    );
    this.chart?.timeScale().fitContent();
  }

  private disposeChart(): void {
    this.chart?.remove();
    this.chart = undefined;
    this.series = undefined;
  }
}
