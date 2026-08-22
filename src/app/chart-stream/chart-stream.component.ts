import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CandlestickSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import { ChartStreamApiService, ChartStreamError } from './chart-stream-api.service';
import { ChartStreamSocketService } from './chart-stream-socket.service';
import { CandleSeriesBuffer } from './candle-series-buffer';
import type { ChartSessionSnapshot, StartStreamRequest } from './chart-stream.models';

@Component({
  selector: 'app-chart-stream',
  standalone: true,
  template: `
    <div class="toolbar">
      <span class="status" [class.live]="canStop()">{{ session()?.status ?? 'idle' }}</span>
      <span class="instrument">{{ session()?.instrumentKey }}</span>
      <span class="bars">{{ barCount() }} bars</span>
      <button type="button" (click)="stop()" [disabled]="!canStop()">Stop</button>
    </div>
    @if (error(); as message) {
      <div class="error">{{ message }}</div>
    }
    <div #chartHost class="chart"></div>
  `,
  styles: `
    :host {
      display: block;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0;
      font-size: 0.875rem;
    }

    .status {
      font-weight: 600;
      text-transform: lowercase;
    }

    .status.live {
      color: #16a34a;
    }

    .instrument {
      color: #64748b;
    }

    .bars {
      margin-left: auto;
      color: #64748b;
    }

    .error {
      padding: 0.5rem 0.75rem;
      margin-bottom: 0.5rem;
      border-radius: 0.375rem;
      background: #fee2e2;
      color: #991b1b;
    }

    .chart {
      width: 100%;
      height: 420px;
    }
  `,
})
export class ChartStreamComponent {
  private readonly api = inject(ChartStreamApiService);
  private readonly socket = inject(ChartStreamSocketService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly chartHost = viewChild.required<ElementRef<HTMLDivElement>>('chartHost');
  private chart?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;
  private readonly buffer = new CandleSeriesBuffer();

  readonly session = signal<ChartSessionSnapshot | null>(null);
  readonly error = signal<string | null>(null);
  readonly barCount = signal(0);
  readonly canStop = computed(
    () => this.session()?.status === 'RUNNING' || this.session()?.status === 'STARTING',
  );

  constructor() {
    effect(() => {
      if (this.chart) return;
      this.chart = createChart(this.chartHost().nativeElement, { autoSize: true });
      // lightweight-charts v5: the per-type `addCandlestickSeries()` helper is
      // gone, replaced by `addSeries(CandlestickSeries)`.
      this.series = this.chart.addSeries(CandlestickSeries);
    });

    this.destroyRef.onDestroy(() => {
      this.chart?.remove();
      this.chart = undefined;
      this.series = undefined;
    });
  }

  start(request: StartStreamRequest): void {
    this.error.set(null);
    this.buffer.clear();
    this.barCount.set(0);
    this.series?.setData([]);

    this.api
      .start(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          this.session.set(snapshot);
          this.listen(snapshot.sessionId);
        },
        error: (e: ChartStreamError) => this.error.set(this.describe(e)),
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
        error: (e: ChartStreamError) => this.error.set(this.describe(e)),
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
            this.series?.setData(this.buffer.snapshot());
            // `setData` keeps the current visible range, so a growing replay
            // would march off the right edge without this.
            this.chart?.timeScale().fitContent();
            this.barCount.set(this.buffer.size);
            break;
          case 'SESSION_STATUS':
            this.session.set(event);
            break;
          case 'SESSION_ERROR':
            this.error.set(event.message);
            break;
          case 'SESSION_COMPLETED':
          case 'SESSION_STOPPED':
            this.session.update((s) =>
              s
                ? {
                    ...s,
                    status: event.type === 'SESSION_COMPLETED' ? 'COMPLETED' : 'STOPPED',
                  }
                : s,
            );
            break;
        }
      });
  }

  private describe(e: ChartStreamError): string {
    return e.issues.length ? e.issues.map((i) => `${i.path}: ${i.message}`).join('; ') : e.message;
  }
}
