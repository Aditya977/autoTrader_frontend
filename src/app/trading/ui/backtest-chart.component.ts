import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { THEME } from '../../chart-stream/chart-theme';
import { formatIstTime, toChartTime } from '../../chart-stream/chart-time';
import { money, price, signedMoney, time, todayKey, tone } from '../format';
import type { BacktestRunSummary, DashboardTrade } from '../trading.models';

/** Bars revealed per playback tick at 1×. A tick is 250 ms. */
const BARS_PER_TICK = 1;
const TICK_MS = 250;

type Bar = [number, number, number, number, number];

/** The exchange date of an epoch-ms instant. */
function dayOf(ms: number): string {
  return todayKey(new Date(ms));
}

/**
 * A backtest, drawn: one instrument, one day at a time, with every trade on
 * the candles — the entry arrow, the exit arrow with its P&L, and the stop the
 * trade carried, from entry to exit.
 *
 * Playback replays the day bar by bar, with trades appearing as their bars
 * print, so a run can be watched the way a live session would have unfolded.
 */
@Component({
  selector: 'app-backtest-chart',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (result(); as r) {
      <div class="controls">
        <select
          aria-label="Instrument"
          [ngModel]="instrumentKey()"
          (ngModelChange)="selectInstrument($event)"
        >
          @for (c of r.charts; track c.instrumentKey) {
            <option [value]="c.instrumentKey">{{ c.tradingsymbol }}</option>
          }
        </select>
        <div class="day">
          <button
            type="button"
            (click)="stepDay(-1)"
            [disabled]="dayIndex() <= 0"
            aria-label="Previous day"
          >
            ‹
          </button>
          <select aria-label="Day" [ngModel]="day()" (ngModelChange)="selectDay($event)">
            @for (d of days(); track d.day) {
              <option [value]="d.day">
                {{ d.day }} · {{ d.trades }} trade{{ d.trades === 1 ? '' : 's' }}
              </option>
            }
          </select>
          <button
            type="button"
            (click)="stepDay(1)"
            [disabled]="dayIndex() >= days().length - 1"
            aria-label="Next day"
          >
            ›
          </button>
        </div>
        <label class="only">
          <input
            type="checkbox"
            [ngModel]="onlyTradeDays()"
            (ngModelChange)="onlyTradeDays.set($event)"
          />
          Days with trades only
        </label>
        <div class="play">
          <button type="button" (click)="togglePlay()">
            {{ playing() ? '❚❚ Pause' : '▶ Play' }}
          </button>
          <select aria-label="Speed" [ngModel]="speed()" (ngModelChange)="speed.set(+$event)">
            <option [value]="1">1×</option>
            <option [value]="4">4×</option>
            <option [value]="15">15×</option>
          </select>
          <button type="button" (click)="showAll()">Whole day</button>
          @if (cursor() < dayBars().length) {
            <span class="clock">{{ clockLabel() }}</span>
          }
        </div>
      </div>

      <div class="chart" #chartHost></div>

      <div class="daytrades">
        @if (dayTrades().length === 0) {
          <p class="empty">No trades on this instrument on {{ day() }}.</p>
        } @else {
          <table>
            <thead>
              <tr>
                <th>Entry</th>
                <th>Exit</th>
                <th class="num">Lots</th>
                <th class="num">Entry ₹</th>
                <th class="num">Exit ₹</th>
                <th class="num">Stop</th>
                <th class="num">P&L</th>
                <th>Why it ended</th>
              </tr>
            </thead>
            <tbody>
              @for (t of dayTrades(); track t.tradeId) {
                <tr [class.future]="!revealed(t)">
                  <td>{{ time(t.entryAt) }}</td>
                  <td>{{ time(t.exitAt) }}</td>
                  <td class="num">{{ t.lots }}</td>
                  <td class="num">{{ price(t.entryPrice) }}</td>
                  <td class="num">{{ price(t.exitPrice) }}</td>
                  <td class="num">{{ price(t.stopLoss) }}</td>
                  <td class="num" [class]="tone(t.netPnl)">{{ signedMoney(t.netPnl) }}</td>
                  <td>
                    {{ t.exitReason }} <span class="muted">{{ t.exitNote }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <p class="sum">
            Day P&L on this instrument:
            <b [class]="tone(dayPnl())">{{ signedMoney(dayPnl()) }}</b>
            · capital used per trade up to {{ money(maxCapital()) }}
          </p>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 0.6rem;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      font-size: 0.75rem;
    }
    select,
    button {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.28rem 0.5rem;
      font: inherit;
      font-size: 0.75rem;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .day,
    .play {
      display: inline-flex;
      gap: 0.3rem;
      align-items: center;
    }
    .only {
      display: inline-flex;
      gap: 0.3rem;
      align-items: center;
      color: var(--text-muted);
    }
    .clock {
      font-family: var(--font-mono);
      color: var(--text-muted);
    }
    .chart {
      height: 360px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.74rem;
    }
    th,
    td {
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid var(--border);
      text-align: left;
      white-space: nowrap;
    }
    th {
      color: var(--text-muted);
      font-weight: 500;
    }
    .num {
      text-align: right;
      font-family: var(--font-mono);
    }
    tr.future {
      opacity: 0.35;
    }
    .pos {
      color: var(--up);
    }
    .neg {
      color: var(--down);
    }
    .muted,
    .empty {
      color: var(--text-muted);
    }
    .empty,
    .sum {
      font-size: 0.75rem;
      margin: 0.3rem 0 0;
    }
  `,
})
export class BacktestChartComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = viewChild<ElementRef<HTMLDivElement>>('chartHost');

  readonly result = input<BacktestRunSummary | null>(null);

  readonly instrumentKey = signal('');
  readonly day = signal('');
  readonly onlyTradeDays = signal(true);
  readonly playing = signal(false);
  readonly speed = signal(4);
  /** How many of the day's bars are shown. Equal to their count when not playing. */
  readonly cursor = signal(0);

  private chart: IChartApi | null = null;
  private chartHost: HTMLDivElement | null = null;
  private candles: ISeriesApi<'Candlestick'> | null = null;
  private markers: ISeriesMarkersPluginApi<Time> | null = null;
  private stops: ISeriesApi<'Line'>[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly chartData = computed(
    () => this.result()?.charts.find((c) => c.instrumentKey === this.instrumentKey()) ?? null,
  );

  private readonly instrumentTrades = computed<DashboardTrade[]>(() =>
    (this.result()?.trades ?? [])
      .filter((t) => t.instrumentKey === this.instrumentKey())
      .sort((a, b) => a.entryAt - b.entryAt),
  );

  readonly days = computed(() => {
    const bars = this.chartData()?.bars ?? [];
    const counts = new Map<string, number>();
    for (const bar of bars) {
      const d = dayOf(bar[0]);
      if (!counts.has(d)) counts.set(d, 0);
    }
    for (const t of this.instrumentTrades()) {
      const d = dayOf(t.entryAt);
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([d, trades]) => ({ day: d, trades }))
      .filter((d) => !this.onlyTradeDays() || d.trades > 0)
      .sort((a, b) => a.day.localeCompare(b.day));
  });

  readonly dayIndex = computed(() => this.days().findIndex((d) => d.day === this.day()));

  readonly dayBars = computed<Bar[]>(() =>
    (this.chartData()?.bars ?? []).filter((bar) => dayOf(bar[0]) === this.day()),
  );

  readonly dayTrades = computed(() =>
    this.instrumentTrades().filter((t) => dayOf(t.entryAt) === this.day()),
  );

  readonly dayPnl = computed(() => this.dayTrades().reduce((sum, t) => sum + (t.netPnl ?? 0), 0));

  readonly maxCapital = computed(() =>
    Math.max(0, ...this.dayTrades().map((t) => t.entryPrice * t.quantity)),
  );

  readonly clockLabel = computed(() => {
    const bar = this.dayBars()[Math.max(0, this.cursor() - 1)];
    return bar ? formatIstTime(toChartTime(bar[0])) : '';
  });

  readonly money = money;
  readonly price = price;
  readonly signedMoney = signedMoney;
  readonly tone = tone;
  readonly time = time;

  constructor() {
    // A new run: pick its first instrument and its first day with a trade.
    effect(() => {
      const r = this.result();
      this.pause();
      if (!r || r.charts.length === 0) return;
      const withTrade = r.trades[0]?.instrumentKey;
      this.instrumentKey.set(withTrade ?? r.charts[0]!.instrumentKey);
      // Untracked: reading the day list here would re-run this on every
      // instrument change and snap the picker back to the first instrument.
      this.day.set(untracked(() => this.days())[0]?.day ?? '');
      this.cursor.set(Number.MAX_SAFE_INTEGER);
    });

    // Keep the chosen day valid when the list of days changes.
    effect(() => {
      const days = this.days();
      if (days.length && !days.some((d) => d.day === this.day())) this.day.set(days[0]!.day);
    });

    // After the DOM is updated, not before: the chart's container only exists
    // once a result is shown, and a plain effect can run ahead of it.
    afterRenderEffect(() => {
      this.dayBars();
      this.dayTrades();
      this.cursor();
      this.host();
      this.render();
    });

    this.destroyRef.onDestroy(() => {
      this.pause();
      this.chart?.remove();
    });
  }

  selectInstrument(key: string): void {
    this.pause();
    this.instrumentKey.set(key);
    this.cursor.set(Number.MAX_SAFE_INTEGER);
  }

  selectDay(d: string): void {
    this.pause();
    this.day.set(d);
    this.cursor.set(Number.MAX_SAFE_INTEGER);
  }

  stepDay(delta: number): void {
    const next = this.days()[this.dayIndex() + delta];
    if (next) this.selectDay(next.day);
  }

  showAll(): void {
    this.pause();
    this.cursor.set(Number.MAX_SAFE_INTEGER);
  }

  togglePlay(): void {
    if (this.playing()) {
      this.pause();
      return;
    }
    if (this.cursor() >= this.dayBars().length) this.cursor.set(1);
    this.playing.set(true);
    this.timer = setInterval(() => {
      const next = this.cursor() + BARS_PER_TICK * this.speed();
      if (next >= this.dayBars().length) {
        this.cursor.set(this.dayBars().length);
        this.pause();
      } else {
        this.cursor.set(next);
      }
    }, TICK_MS);
  }

  /** Whether a trade's entry bar has been revealed by playback yet. */
  revealed(trade: DashboardTrade): boolean {
    const bars = this.dayBars();
    const last = bars[Math.min(this.cursor(), bars.length) - 1];
    return last !== undefined && trade.entryAt <= last[0] + 60_000;
  }

  private pause(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.playing.set(false);
  }

  private ensureChart(): boolean {
    const host = this.host()?.nativeElement;
    if (!host) return false;
    if (this.chart && this.chartHost === host) return true;
    // The container is re-created when a run is cleared and another drawn;
    // a chart bound to the old one would draw into a detached element.
    this.chart?.remove();
    this.stops = [];
    this.chartHost = host;
    this.chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: THEME.background },
        textColor: THEME.text,
        attributionLogo: false,
      },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      rightPriceScale: { borderColor: THEME.border },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: {
        borderColor: THEME.border,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (t: Time) => formatIstTime(t as number),
      },
      localization: { locale: 'en-IN', timeFormatter: (t: Time) => formatIstTime(t as number) },
    });
    this.candles = this.chart.addSeries(CandlestickSeries, {
      upColor: THEME.up,
      downColor: THEME.down,
      borderUpColor: THEME.up,
      borderDownColor: THEME.down,
      wickUpColor: THEME.upFaded,
      wickDownColor: THEME.downFaded,
    });
    this.markers = createSeriesMarkers(this.candles, []);
    return true;
  }

  private render(): void {
    if (!this.result() || !this.ensureChart() || !this.chart || !this.candles) return;
    const all = this.dayBars();
    const shown = all.slice(0, Math.min(this.cursor(), all.length));
    const lastShown = shown.at(-1)?.[0] ?? Number.NEGATIVE_INFINITY;
    const visibleUntil = lastShown + 60_000;

    this.candles.setData(
      shown.map(([t, o, h, l, c]) => ({
        time: toChartTime(t),
        open: o,
        high: h,
        low: l,
        close: c,
      })),
    );

    const marks: SeriesMarker<Time>[] = [];
    for (const s of this.stops) this.chart.removeSeries(s);
    this.stops = [];

    for (const trade of this.dayTrades()) {
      if (trade.entryAt > visibleUntil) continue;
      // A fill is stamped at its bar's close; the marker sits on that bar.
      const entryBar = toChartTime(trade.entryAt - 60_000);
      const long = trade.side !== 'SELL';
      marks.push({
        time: entryBar,
        position: long ? 'belowBar' : 'aboveBar',
        color: long ? THEME.up : THEME.down,
        shape: long ? 'arrowUp' : 'arrowDown',
        text: `${long ? 'BUY' : 'SELL'} ${trade.lots}L @ ${price(trade.entryPrice)}`,
      });
      const exitVisible = trade.exitAt !== null && trade.exitAt <= visibleUntil;
      if (exitVisible && trade.exitAt !== null) {
        marks.push({
          time: toChartTime(trade.exitAt - 60_000),
          position: long ? 'aboveBar' : 'belowBar',
          color: (trade.netPnl ?? 0) >= 0 ? THEME.up : THEME.down,
          shape: long ? 'arrowDown' : 'arrowUp',
          text: `${signedMoney(trade.netPnl)} ${trade.exitReason ?? ''}`,
        });
      }
      if (trade.stopLoss !== null) {
        const end = exitVisible && trade.exitAt !== null ? trade.exitAt - 60_000 : lastShown;
        if (end > trade.entryAt - 60_000) {
          const line = this.chart.addSeries(LineSeries, {
            color: THEME.down,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
          line.setData([
            { time: entryBar, value: trade.stopLoss },
            { time: toChartTime(end), value: trade.stopLoss },
          ]);
          this.stops.push(line);
        }
      }
    }
    marks.sort((a, b) => (a.time as number) - (b.time as number));
    this.markers?.setMarkers(marks);

    if (!this.playing()) this.chart.timeScale().fitContent();
    else this.chart.timeScale().scrollToRealTime();
  }
}
