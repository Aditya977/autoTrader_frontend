import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  TickMarkType,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { ChartStreamApiService, ChartStreamError } from './chart-stream-api.service';
import { ChartStreamSocketService } from './chart-stream-socket.service';
import {
  CandleSeriesBuffer,
  toCandlestickData,
  toVolumeData,
  type Bar,
} from './candle-series-buffer';
import {
  formatIstAxisStamp,
  formatIstDay,
  formatIstStamp,
  formatIstTime,
  formatPrice,
  formatVolume,
} from './chart-time';
import {
  TERMINAL_STATUSES,
  type ChartSessionSnapshot,
  type StartStreamRequest,
} from './chart-stream.models';

/**
 * Chart colours, kept in TypeScript rather than read back out of CSS.
 *
 * The chart is a canvas: it cannot inherit a CSS custom property, so these
 * would have to be read with `getComputedStyle` at construction time and
 * re-read on every theme change. With a single committed theme (see
 * `styles.scss`) that indirection buys nothing, so the values are stated once
 * here and mirrored by the token of the same name.
 */
const THEME = {
  background: '#111820',
  text: '#8b9bad',
  grid: '#18222d',
  border: '#212e3c',
  crosshair: '#56718a',
  up: '#26a17b',
  down: '#ef5350',
  upFaded: 'rgba(38, 161, 123, 0.4)',
  downFaded: 'rgba(239, 83, 80, 0.4)',
} as const;

/** What the pointer is currently over, or the last bar when it is elsewhere. */
interface Readout {
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  changePct: number | null;
  /** True while the pointer is genuinely over a bar, as opposed to idling. */
  hovering: boolean;
}

@Component({
  selector: 'app-chart-stream',
  standalone: true,
  template: `
    <section class="panel" [class.dimmed]="finished()">
      <header class="head">
        <div class="ident">
          <span class="leg" [class.call]="leg() === 'CE'" [class.put]="leg() === 'PE'">
            {{ leg() ?? 'CHART' }}
          </span>
          <div class="names">
            <h2>{{ label() }}</h2>
            <span class="key">{{ session()?.instrumentKey ?? '—' }}</span>
          </div>
        </div>

        <div class="state">
          <span class="status" [class]="statusClass()">
            <i class="dot"></i>{{ statusText() }}
          </span>
          <span class="bars">{{ barCount() }} bars</span>
          <button type="button" class="ghost" (click)="stop()" [disabled]="!canStop()">Stop</button>
        </div>
      </header>

      @if (readout(); as r) {
        <div class="readout" [class.live]="!r.hovering">
          <span class="stamp">{{ r.time }}</span>
          <span class="ohlc">
            <b>O</b>{{ r.open }} <b>H</b>{{ r.high }} <b>L</b>{{ r.low }} <b>C</b>{{ r.close }}
          </span>
          <span class="vol"><b>V</b>{{ r.volume }}</span>
          @if (r.changePct !== null) {
            <span class="chg" [class.up]="r.changePct >= 0" [class.down]="r.changePct < 0">
              {{ r.changePct >= 0 ? '+' : '' }}{{ r.changePct.toFixed(2) }}%
            </span>
          }
        </div>
      }

      @if (error(); as message) {
        <p class="error">{{ message }}</p>
      }

      <div class="canvas">
        <div #chartHost class="chart"></div>

        @if (tooltip(); as t) {
          <div class="tooltip" [style.left.px]="t.x" [style.top.px]="t.y">
            <div class="t-time">{{ t.readout.time }}</div>
            <dl>
              <div><dt>Open</dt><dd>{{ t.readout.open }}</dd></div>
              <div><dt>High</dt><dd>{{ t.readout.high }}</dd></div>
              <div><dt>Low</dt><dd>{{ t.readout.low }}</dd></div>
              <div>
                <dt>Close</dt>
                <dd [class.up]="(t.readout.changePct ?? 0) >= 0"
                    [class.down]="(t.readout.changePct ?? 0) < 0">{{ t.readout.close }}</dd>
              </div>
              <div><dt>Volume</dt><dd>{{ t.readout.volume }}</dd></div>
            </dl>
          </div>
        }

        @if (empty()) {
          <div class="empty">
            <span>{{ emptyText() }}</span>
          </div>
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .panel {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      overflow: hidden;
      transition: opacity 0.2s ease;
    }

    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.7rem 0.9rem;
      border-bottom: 1px solid var(--border);
    }

    .ident {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      min-width: 0;
    }

    .leg {
      flex: none;
      padding: 0.2rem 0.45rem;
      border-radius: 5px;
      background: var(--surface-3);
      color: var(--text-muted);
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.06em;
    }

    .leg.call {
      background: rgba(38, 161, 123, 0.16);
      color: #4fd1a5;
    }

    .leg.put {
      background: rgba(239, 83, 80, 0.16);
      color: #ff8a87;
    }

    .names {
      min-width: 0;
    }

    h2 {
      font-size: 0.9rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .key {
      display: block;
      font-family: var(--font-mono);
      font-size: 0.68rem;
      color: var(--text-faint);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .state {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex: none;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
    }

    .status.running {
      color: var(--up);
    }

    .status.running .dot {
      animation: pulse 1.6s ease-in-out infinite;
    }

    .status.failed {
      color: var(--danger);
    }

    .status.done {
      color: var(--accent);
    }

    @keyframes pulse {
      50% {
        opacity: 0.25;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .status.running .dot {
        animation: none;
      }
    }

    .bars {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--text-faint);
    }

    .readout {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.75rem;
      padding: 0.4rem 0.9rem;
      border-bottom: 1px solid var(--border);
      background: var(--surface-2);
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--text);
    }

    .readout .stamp {
      color: var(--text);
      font-weight: 600;
    }

    .readout.live .stamp::after {
      content: ' · latest';
      color: var(--text-faint);
      font-weight: 400;
    }

    .readout b {
      color: var(--text-faint);
      font-weight: 500;
      margin-right: 0.2rem;
    }

    .readout .ohlc b:not(:first-child) {
      margin-left: 0.45rem;
    }

    .readout .vol {
      color: var(--text-muted);
    }

    .chg.up {
      color: var(--up);
    }

    .chg.down {
      color: var(--down);
    }

    .error {
      margin: 0;
      padding: 0.55rem 0.9rem;
      background: rgba(240, 102, 107, 0.12);
      border-bottom: 1px solid rgba(240, 102, 107, 0.3);
      color: #ff9a9d;
      font-size: 0.8rem;
    }

    .canvas {
      position: relative;
    }

    .chart {
      width: 100%;
      height: 380px;
    }

    /* The tooltip is positioned from the crosshair handler and must never eat
       the pointer events that produce it. */
    .tooltip {
      position: absolute;
      pointer-events: none;
      z-index: 3;
      min-width: 132px;
      padding: 0.5rem 0.6rem;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: rgba(13, 19, 26, 0.96);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      font-size: 0.72rem;
      backdrop-filter: blur(2px);
    }

    .t-time {
      margin-bottom: 0.35rem;
      padding-bottom: 0.3rem;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
    }

    .tooltip dl {
      margin: 0;
      display: grid;
      gap: 0.1rem;
    }

    .tooltip dl > div {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
    }

    .tooltip dt {
      color: var(--text-faint);
    }

    .tooltip dd {
      margin: 0;
      font-family: var(--font-mono);
      color: var(--text);
    }

    .tooltip dd.up {
      color: var(--up);
    }

    .tooltip dd.down {
      color: var(--down);
    }

    .empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--text-faint);
      font-size: 0.8rem;
      pointer-events: none;
    }
  `,
})
export class ChartStreamComponent {
  private readonly api = inject(ChartStreamApiService);
  private readonly socket = inject(ChartStreamSocketService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The session to run, or `null` for an idle panel.
   *
   * A new object identity means "start this", including the same instrument
   * asked for twice — pressing Start again is a deliberate restart, not a
   * no-op, and comparing by value would swallow it.
   */
  readonly request = input<StartStreamRequest | null>(null);
  /** Human name for the panel header — the tradingsymbol, typically. */
  readonly label = input('Chart');
  /** Colours the header badge; `null` for a non-option instrument. */
  readonly leg = input<'CE' | 'PE' | null>(null);
  /** Bar width in seconds. Applied by resampling, so it costs no round trip. */
  readonly displaySeconds = input(60);

  private readonly chartHost = viewChild.required<ElementRef<HTMLDivElement>>('chartHost');
  private chart?: IChartApi;
  private candles?: ISeriesApi<'Candlestick'>;
  private volume?: ISeriesApi<'Histogram'>;
  private readonly buffer = new CandleSeriesBuffer();

  /** The bars currently drawn, so the crosshair can look one up by time. */
  private drawn: Bar[] = [];
  private drawnByTime = new Map<number, Bar>();
  private dayStarts = new Set<number>();

  readonly session = signal<ChartSessionSnapshot | null>(null);
  readonly error = signal<string | null>(null);
  readonly barCount = signal(0);
  /**
   * Bumped on every redraw.
   *
   * `barCount` looks like the natural trigger for the readout below and is the
   * wrong one: a redraw can rewrite the newest bar — a replaced backlog bar, a
   * changed display interval that happens to yield the same number of buckets —
   * without the count moving, and the header would then keep showing the old
   * numbers. This changes whenever the drawn series does.
   */
  private readonly revision = signal(0);
  readonly hovered = signal<Bar | null>(null);
  readonly tooltipAt = signal<{ x: number; y: number } | null>(null);

  readonly canStop = computed(
    () => this.session()?.status === 'RUNNING' || this.session()?.status === 'STARTING',
  );
  /** Whether the session is over — for how the panel renders, nothing more. */
  readonly finished = computed(() => {
    const status = this.session()?.status;
    return status !== undefined && TERMINAL_STATUSES.includes(status);
  });
  readonly empty = computed(() => this.barCount() === 0);

  readonly statusText = computed(() => {
    const status = this.session()?.status;
    if (!status) return this.request() ? 'starting' : 'idle';
    return status.toLowerCase();
  });

  readonly statusClass = computed(() => {
    switch (this.session()?.status) {
      case 'RUNNING':
      case 'STARTING':
        return 'running';
      case 'ERROR':
        return 'failed';
      case 'COMPLETED':
      case 'STOPPED':
        return 'done';
      default:
        return '';
    }
  });

  readonly emptyText = computed(() => {
    if (this.error()) return 'no data';
    if (!this.request()) return 'Pick an instrument and press Start';
    return this.finished() ? 'the session produced no bars' : 'waiting for the first bar…';
  });

  /**
   * What the header line shows: the hovered bar, or the newest one when the
   * pointer is elsewhere.
   *
   * A chart that blanks its numbers the moment the pointer leaves is worse
   * than one that falls back to the last bar, because the last bar is what the
   * eye was reading anyway.
   */
  readonly readout = computed<Readout | null>(() => {
    const hovered = this.hovered();
    // `drawn` is a plain array, so the redraw counter is what makes this
    // recompute when it is replaced.
    this.revision();
    const bar = hovered ?? this.drawn.at(-1);
    if (!bar) return null;
    return {
      time:
        this.displaySeconds() >= 86_400 ? formatIstDay(bar.time) : formatIstStamp(bar.time),
      open: formatPrice(bar.open),
      high: formatPrice(bar.high),
      low: formatPrice(bar.low),
      close: formatPrice(bar.close),
      volume: formatVolume(bar.volume),
      changePct: bar.open === 0 ? null : ((bar.close - bar.open) / bar.open) * 100,
      hovering: hovered !== null,
    };
  });

  readonly tooltip = computed(() => {
    const at = this.tooltipAt();
    const readout = this.readout();
    if (!at || !readout || !this.hovered()) return null;
    return { ...at, readout };
  });

  constructor() {
    effect(() => {
      const host = this.chartHost().nativeElement;
      if (this.chart) return;
      this.chart = createChart(host, this.chartOptions());
      // lightweight-charts v5: the per-type `addCandlestickSeries()` helper is
      // gone, replaced by `addSeries(CandlestickSeries)`.
      this.candles = this.chart.addSeries(CandlestickSeries, {
        upColor: THEME.up,
        downColor: THEME.down,
        borderUpColor: THEME.up,
        borderDownColor: THEME.down,
        wickUpColor: THEME.upFaded,
        wickDownColor: THEME.downFaded,
      });
      // Volume rides an unnamed overlay scale pinned to the bottom fifth, so
      // it never competes with price for vertical room.
      this.volume = this.chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      this.volume.priceScale().applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
      this.candles.priceScale().applyOptions({
        scaleMargins: { top: 0.08, bottom: 0.24 },
      });
      this.chart.subscribeCrosshairMove(this.onCrosshair);
    });

    // Starting is driven by the input rather than by a method the parent
    // calls, so a panel that appears because a second leg was selected starts
    // itself — the parent never has to reach into a `viewChild` that may not
    // exist yet on the turn it renders.
    effect(() => {
      const request = this.request();
      if (!request) return;
      untracked(() => this.start(request));
    });

    // Redrawing on interval change reuses the bars already in the buffer, so
    // switching from 1m to 5m mid-replay costs nothing and loses nothing.
    effect(() => {
      this.displaySeconds();
      untracked(() => this.redraw({ refit: true }));
    });

    this.destroyRef.onDestroy(() => {
      this.chart?.unsubscribeCrosshairMove(this.onCrosshair);
      this.chart?.remove();
      this.chart = undefined;
      this.candles = undefined;
      this.volume = undefined;
    });
  }

  start(request: StartStreamRequest): void {
    this.error.set(null);
    this.session.set(null);
    this.buffer.clear();
    this.barCount.set(0);
    this.hovered.set(null);
    this.tooltipAt.set(null);
    this.redraw();

    this.api
      .start(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          this.session.set(snapshot);
          this.listen(snapshot.sessionId);
        },
        error: (e: ChartStreamError) => this.error.set(describe(e)),
      });
  }

  stop(): void {
    const id = this.session()?.sessionId;
    if (!id) return;
    this.api
      .stop(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => this.session.set(snapshot),
        error: (e: ChartStreamError) => this.error.set(describe(e)),
      });
  }

  private listen(sessionId: string): void {
    this.socket
      .connect(sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        switch (event.type) {
          case 'CANDLE':
            this.buffer.add(event);
            // Batched by the microtask below rather than redrawn per bar: an
            // instant replay delivers a whole day in one burst of frames, and
            // a `setData` per frame is hundreds of full redraws for one
            // visible result.
            this.scheduleRedraw();
            break;
          case 'SESSION_STATUS':
            this.session.set(event);
            break;
          case 'SESSION_ERROR':
            this.error.set(event.message);
            this.session.update((s) => (s ? { ...s, status: 'ERROR' } : s));
            break;
          case 'SESSION_COMPLETED':
          case 'SESSION_STOPPED':
            this.session.update((s) =>
              s
                ? { ...s, status: event.type === 'SESSION_COMPLETED' ? 'COMPLETED' : 'STOPPED' }
                : s,
            );
            break;
        }
      });
  }

  private redrawQueued = false;

  /** Coalesces a burst of CANDLE frames into a single redraw per microtask. */
  private scheduleRedraw(): void {
    if (this.redrawQueued) return;
    this.redrawQueued = true;
    void Promise.resolve().then(() => {
      this.redrawQueued = false;
      this.redraw({ refit: true });
    });
  }

  private redraw(options: { refit?: boolean } = {}): void {
    if (!this.candles || !this.volume) return;
    this.drawn = this.buffer.resampled(this.displaySeconds());
    this.drawnByTime = new Map(this.drawn.map((bar) => [bar.time as number, bar]));

    // Which bars open a new IST trading day, so the axis can label them with a
    // date instead of a time. Lightweight Charts decides that itself — in UTC,
    // where an IST session never crosses a day boundary — so on a multi-day
    // chart it would mark none at all and every day would look like one long
    // session.
    this.dayStarts = new Set();
    let previousDay = '';
    for (const bar of this.drawn) {
      const day = formatIstDay(bar.time);
      if (day !== previousDay) this.dayStarts.add(bar.time as number);
      previousDay = day;
    }

    this.candles.setData(toCandlestickData(this.drawn));
    this.volume.setData(toVolumeData(this.drawn, THEME.upFaded, THEME.downFaded));
    this.barCount.set(this.drawn.length);
    this.revision.update((n) => n + 1);

    // `setData` keeps the current visible range, so a growing replay would
    // march off the right edge without this.
    if (options.refit) this.chart?.timeScale().fitContent();
  }

  /**
   * Arrow property, not a method: it is passed to `subscribeCrosshairMove` and
   * handed back to `unsubscribeCrosshairMove` on destroy, which only matches
   * if it is the same function reference both times.
   */
  private readonly onCrosshair = (params: MouseEventParams<Time>): void => {
    const time = params.time as UTCTimestamp | undefined;
    const point = params.point;
    if (time === undefined || !point) {
      this.hovered.set(null);
      this.tooltipAt.set(null);
      return;
    }

    const bar = this.drawnByTime.get(time as number) ?? null;
    this.hovered.set(bar);
    if (!bar) {
      this.tooltipAt.set(null);
      return;
    }

    // Offset from the cursor and flipped near the right edge, so the tooltip
    // never covers the bar it is describing.
    const width = this.chartHost().nativeElement.clientWidth;
    const flip = point.x > width - 170;
    this.tooltipAt.set({
      x: flip ? Math.max(8, point.x - 156) : point.x + 16,
      y: Math.max(8, point.y - 12),
    });
  };

  private chartOptions() {
    return {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: THEME.background },
        textColor: THEME.text,
        fontFamily: getComputedStyle(document.body).fontFamily,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: THEME.grid },
        horzLines: { color: THEME.grid },
      },
      rightPriceScale: { borderColor: THEME.border },
      crosshair: {
        // Free rather than magnet: the tooltip reports the bar under the
        // pointer, and a magnetised crosshair that snaps to a price makes the
        // reported bar disagree with where the user is looking.
        mode: CrosshairMode.Normal,
        vertLine: { color: THEME.crosshair, style: LineStyle.Dashed, labelBackgroundColor: '#243444' },
        horzLine: { color: THEME.crosshair, style: LineStyle.Dashed, labelBackgroundColor: '#243444' },
      },
      timeScale: {
        borderColor: THEME.border,
        // Without this the axis shows dates only, so every bar of a one-day
        // replay sits under a single "14 Aug" label and the chart gives no
        // clue what time anything happened at.
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        // Times are IST because that is the exchange's clock; the data stays
        // UTC (see chart-time.ts).
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          const seconds = time as number;
          if (this.displaySeconds() >= 86_400) return formatIstDay(seconds);
          // A date where a day begins, a time everywhere else — the axis then
          // reads as "14 Aug · 09:15 · 10:00 · … · 15 Aug · 09:15".
          if (this.dayStarts.has(seconds)) return formatIstDay(seconds);
          return type === TickMarkType.Year || type === TickMarkType.Month
            ? formatIstDay(seconds)
            : formatIstTime(seconds);
        },
      },
      localization: {
        locale: 'en-IN',
        // Drawn into the time axis under the cursor, so it is the short form —
        // the tooltip beside the pointer carries the full stamp.
        timeFormatter: (time: Time) =>
          this.displaySeconds() >= 86_400
            ? formatIstDay(time as number)
            : formatIstAxisStamp(time as number),
      },
    };
  }
}

function describe(e: ChartStreamError): string {
  return e.issues.length ? e.issues.map((i) => `${i.path}: ${i.message}`).join('; ') : e.message;
}
