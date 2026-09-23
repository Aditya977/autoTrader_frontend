import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable, Subscription } from 'rxjs';
import {
  CandlestickSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type PriceLineOptions,
  TickMarkType,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { ChartStreamApiService, ChartStreamError } from './chart-stream-api.service';
import { ChartStreamSocketService } from './chart-stream-socket.service';
import { detectPatterns } from '../chart-patterns/engine/detect-patterns';
import { LightweightChartsPatternOverlay } from '../chart-patterns/render/pattern-overlay';
import { PATTERN_NAMES, type DetectedPattern } from '../chart-patterns/types';
import { LiveTracker } from '../chart-patterns/engine/live-tracker';
import { scanTimeframes, type TimeframeRow } from '../chart-patterns/engine/timeframe-scan';
import { defaultPatternConfig } from '../chart-patterns/config';
import { CandlePatternsApiService } from '../candle-patterns/candle-patterns-api.service';
import { CandlePatternSync, withLabels } from '../candle-patterns/candle-pattern-sync';
import { defaultCandlePatternTuning, tuningKey } from '../candle-patterns/config';
import {
  LightweightChartsCandlePatternOverlay,
  type RenderedCandlePattern,
} from '../candle-patterns/render/candle-pattern-overlay';
import { CandlePatternListComponent } from '../candle-patterns/ui/candle-pattern-list.component';
import { PREF, PreferencesService } from '../shared/preferences.service';
import { PatternTimeframeTableComponent } from '../chart-patterns/ui/pattern-timeframe-table.component';
import { EMA_INDICATORS, ema, emaColor } from '../chart-indicators/ema';
import { VWAP_COLOR, vwapLine } from '../chart-indicators/vwap';
import {
  PDR_COLOR,
  PDR_LINES,
  PDR_LINE_TYPE,
  PDR_STYLE,
  previousDayRangeLines,
  type PdrLine,
} from '../chart-indicators/previous-day-range';
import {
  CandleSeriesBuffer,
  toCandlestickData,
  toVolumeData,
  type Bar,
} from './candle-series-buffer';
import {
  DISPLAY_INTERVALS,
  formatIstAxisStamp,
  formatIstDay,
  formatIstStamp,
  formatIstTime,
  formatPrice,
  formatVolume,
  intervalNameFor,
  istDateKey,
} from './chart-time';
import {
  TERMINAL_STATUSES,
  type ChartCandleEvent,
  type ChartInterval,
  type ChartLevels,
  type ChartRetest,
  type ChartRetests,
  type ChartSessionSnapshot,
  type PreviousDayRange,
  type SessionLevelsQuery,
  type SessionRetestsQuery,
  type StartStreamRequest,
  type SupportResistanceLevel,
} from './chart-stream.models';
import { markersFor } from '../strategy/trade-markers';
import { THEME, fade } from './chart-theme';
import {
  SCENARIO_LABELS,
  SCENARIO_TAGS,
  describeRetest,
  mergeMarkers,
  retestMarkers,
} from './retest-overlay';
import { MarketEnginePanelComponent } from '../market-engine/market-engine-panel.component';
import {
  OverlayMenuComponent,
  countLabel,
  type OverlayChip,
  type OverlayGroup,
} from './overlay-menu.component';
import {
  marketStateMarkers,
  marksAtBar,
  protectedLines,
  withinSeries,
  zoneLines,
} from '../market-engine/market-engine-overlay';
import { explainMark, type MarkNote } from '../market-engine/market-engine-glossary';
import type {
  ChartSet,
  EventLogIngestResult,
  MarketEngineResearchRequest,
  MarketEngineResult,
  ParityCheckResult,
  SessionMarketEngineQuery,
  ValidationResult,
} from '../market-engine/market-engine.models';
import type { SimTrade } from '../strategy/strategy.models';
import { paperMarkers, paperPriceLines } from '../paper-trade/paper-trade-overlay';
import type { PaperPosition } from '../paper-trade/paper-trade.models';
import { levelLinesAt, levelRejectionMarkers } from '../level-rejection/level-rejection-overlay';
import type { LevelRejectionResponse } from '../level-rejection/level-rejection.models';
import { TrendPanelComponent } from '../trend/trend-panel.component';
import {
  DIRECTION_LABELS,
  chartTimeframe,
  eventNotesAtBar,
  readingAt,
  trendLines,
  trendMarkers,
  trendlineSegments,
  type ChartAxis,
  type TrendDetail,
} from '../trend/trend-overlay';
import {
  DEFAULT_TREND_TIMEFRAMES,
  type TimeframeTrend,
  type TrendResult,
  type TrendTimeframe,
} from '../trend/trend.models';

/**
 * How a support/resistance level is drawn.
 *
 * Two visual languages, because the two kinds of level mean different things:
 *
 * - a **swing** level is a *price* — the number is what matters, so it gets the
 *   price-scale tag, a dashed line, and a weight that follows how strongly the
 *   backend rated it;
 * - a **pivot** is a *name* — PP, R1, S2 are read as labels, not as prices, so
 *   they get the in-chart title and a thin dotted line, and they deliberately
 *   do not claim a slot on the price scale. With `both` selected that is the
 *   difference between six axis tags and thirteen fighting for the same
 *   vertical inch.
 *
 * Colour is the same green/red as the candles: a line under price is support,
 * a line above it is resistance, and the chart says so the same way twice.
 */
function priceLineFor(level: SupportResistanceLevel): PriceLineOptions {
  const pivot = level.source === 'PIVOT';
  const base = level.kind === 'SUPPORT' ? THEME.up : THEME.down;

  return {
    price: level.price,
    // Faded by strength, so a two-touch level does not shout as loudly as a
    // five-touch one and the eye ranks them without reading a number.
    color: fade(base, pivot ? 0.42 : 0.35 + 0.5 * level.strength),
    lineWidth: !pivot && level.strength >= 0.6 ? 2 : 1,
    lineStyle: pivot ? LineStyle.Dotted : LineStyle.Dashed,
    lineVisible: true,
    axisLabelVisible: !pivot,
    axisLabelColor: fade(base, 0.85),
    axisLabelTextColor: '#06121d',
    title: pivot ? level.label : `${level.kind === 'SUPPORT' ? 'S' : 'R'}·${level.touches}`,
  };
}

/** What the pointer is currently over, or the last bar when it is elsewhere. */
/** The two readings the findings panel can show. */
type FindingsTab = 'candles' | 'timeframes';

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
  host: {
    '(document:click)': 'closeMenusOutside($event)',
    '(document:keydown.escape)': 'closeMenus()',
  },
  imports: [
    PatternTimeframeTableComponent,
    CandlePatternListComponent,
    MarketEnginePanelComponent,
    TrendPanelComponent,
    OverlayMenuComponent,
  ],
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

          <!-- Two menus rather than one: overlays (levels, retests, patterns…)
               and indicators (EMAs, VWAP) are different kinds of choice, and
               splitting them keeps each dropdown to a single scannable list
               instead of one long one with a change of subject partway down. -->
          <div class="ind">
            <button
              type="button"
              class="ghost"
              [class.on]="overlayCount() > 0"
              [attr.aria-expanded]="showOverlays()"
              aria-haspopup="true"
              [title]="candleStatus()"
              (click)="toggleOverlayMenu()"
            >
              {{ overlaysBusy() ? 'Overlays…' : 'Overlays' }}
              @if (candlePatternsError()) {
                <i class="badge bad">!</i>
              } @else if (overlayCount()) {
                <i class="badge">{{ overlayCount() }}</i>
              }
            </button>

            @if (showOverlays()) {
              <app-overlay-menu
                title="Overlays"
                [groups]="overlayGroups"
                [count]="overlayCount()"
                (clearAll)="clearOverlays()"
              />
            }
          </div>

          <div class="ind">
            <button
              type="button"
              class="ghost"
              [class.on]="indicatorCount() > 0"
              [attr.aria-expanded]="showIndicators()"
              aria-haspopup="true"
              (click)="toggleIndicatorMenu()"
            >
              Indicators
              @if (indicatorCount()) {
                <i class="badge">{{ indicatorCount() }}</i>
              }
            </button>

            @if (showIndicators()) {
              <app-overlay-menu
                title="Indicators"
                [chips]="indicatorChips"
                [count]="indicatorCount()"
                (clearAll)="clearIndicators()"
              />
            }
          </div>

          <button type="button" class="ghost stop" (click)="stop()" [disabled]="!canStop()">
            Stop
          </button>
        </div>
      </header>

      <!-- One findings panel with two tabs rather than two stacked accordions.
           Both describe patterns in the series on screen, and opening them
           both pushed the chart itself down twice. -->
      <div class="tf-panel">
        <div class="tf-bar">
          <button
            type="button"
            class="tf-head"
            [attr.aria-expanded]="findingsOpen()"
            (click)="toggleFindings()"
          >
            <span class="caret">{{ findingsOpen() ? '▾' : '▸' }}</span>
            Patterns
            <span class="hint">{{ findingsHint() }}</span>
          </button>

          @if (findingsOpen()) {
            <div class="tabs" role="tablist" aria-label="Pattern findings">
              <button
                type="button"
                role="tab"
                class="tab"
                [class.on]="findingsTab() === 'candles'"
                [attr.aria-selected]="findingsTab() === 'candles'"
                (click)="showFindingsTab('candles')"
              >
                Candlesticks
                @if (candlePatterns().length) {
                  <i class="badge">{{ candlePatterns().length }}</i>
                }
              </button>
              <button
                type="button"
                role="tab"
                class="tab"
                [class.on]="findingsTab() === 'timeframes'"
                [attr.aria-selected]="findingsTab() === 'timeframes'"
                (click)="showFindingsTab('timeframes')"
              >
                By timeframe
              </button>
            </div>
          }
        </div>

        @if (findingsOpen()) {
          @if (findingsTab() === 'candles') {
            @if (showCandlePatterns()) {
              <app-candle-pattern-list
                [hits]="candlePatterns()"
                [labels]="candleLabels()"
                [formatTime]="formatCandleTime"
              />
              <p class="tf-note">
                The shape, the trend behind it, and what price did next are three separate readings.
                Confidence adds them up on a fixed scale — an engineering score, not a probability
                that the market turns. The forming bar is excluded, so a box never appears and
                vanishes under a candle that had not closed.
              </p>
            } @else {
              <p class="tf-off">
                Candlesticks are switched off.
                <button type="button" class="link" (click)="toggleCandlePatterns()">
                  Turn them on
                </button>
                to read them here and on the chart.
              </p>
            }
          } @else {
            <app-pattern-timeframe-table
              [timeframes]="timeframeRows()"
              [currentSeconds]="displaySeconds()"
            />
            <p class="tf-note">
              The same series read at every bar size. Only shapes scoring above 75% are shown, here
              and on the chart. Confidence is how well a shape fits its own definition, not a
              probability that it plays out. The forming bar is excluded at every size, so a reading
              never changes under a bar that had not closed.
            </p>
          }
        }
      </div>

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

      @if (levelBand(); as sr) {
        <div class="levels">
          <span class="tag">S/R</span>
          @if (sr.above; as r) {
            <span class="lvl up">
              ▲ {{ formatLevel(r) }}
              <i>{{ r.source === 'PIVOT' ? r.label : r.touches + '×' }}</i>
            </span>
          }
          @if (sr.below; as s) {
            <span class="lvl down">
              ▼ {{ formatLevel(s) }}
              <i>{{ s.source === 'PIVOT' ? s.label : s.touches + '×' }}</i>
            </span>
          }
          <span class="meta">
            {{ sr.count }} level{{ sr.count === 1 ? '' : 's' }} on {{ sr.interval }}
            @if (sr.pivotDate) {
              · pivots from {{ sr.pivotDate }}
            }
          </span>
        </div>
      }

      @if (retestBand(); as rt) {
        <div class="levels retests">
          <span class="tag">RT</span>
          @for (retest of rt.shown; track retest.breakoutAt) {
            <span
              class="lvl"
              [class.up]="retest.direction === 'BULLISH'"
              [class.down]="retest.direction === 'BEARISH'"
              [class.pending]="retest.unresolved"
              [title]="describe(retest)"
            >
              {{ retest.direction === 'BULLISH' ? '▲' : '▼' }} {{ scenarioLabel(retest) }}
              <i>{{ qualityLabel(retest) }}</i>
            </span>
          }
          <span class="meta">
            {{ rt.count }} retest{{ rt.count === 1 ? '' : 's' }} on {{ rt.interval }}
            @if (rt.unresolved) {
              · {{ rt.unresolved }} unresolved
            }
          </span>
        </div>
      }

      /**
      @if (previousDayBand(); as pdr) {
        <div class="levels pdr-band">
          <span class="tag">PDR</span>
          <span class="lvl pdh">PDH {{ formatBand(pdr.pdh) }}</span>
          <span class="lvl mid">Mid {{ formatBand(pdr.mid) }}</span>
          <span class="lvl pdl">PDL {{ formatBand(pdr.pdl) }}</span>
          <span class="meta">
            from {{ pdr.previousTradingDate }}
            @if (pdr.days > 1) {
              · {{ pdr.days }} days annotated
            }
          </span>
        </div>
      }

      @if (candleBand(); as cs) {
        <div class="levels candle-band">
          <span class="tag">CANDLES</span>
          @if (cs.loading) {
            <span class="meta">reading the bars on screen…</span>
          } @else if (cs.found) {
            @if (cs.bullish) {
              <span class="lvl up">▲ {{ cs.bullish }}</span>
            }
            @if (cs.bearish) {
              <span class="lvl down">▼ {{ cs.bearish }}</span>
            }
            <span class="meta">
              {{ cs.found }} pattern{{ cs.found === 1 ? '' : 's' }} scoring {{ cs.floor }}+ across
              {{ cs.bars }} bars
            </span>
          } @else {
            <!-- The case that used to be indistinguishable from a broken
                 feature: it ran, and the market was quiet. -->
            <span class="meta none">
              nothing scored {{ cs.floor }} or better across {{ cs.bars }} bars
            </span>
          }
        </div>
      }

      @if (candlePatternsError(); as message) {
        <p class="error">{{ message }}</p>
      }

      @if (pdrError(); as message) {
        <p class="error">{{ message }}</p>
      }

      @if (levelsError(); as message) {
        <p class="error">{{ message }}</p>
      }

      @if (retestsError(); as message) {
        <p class="error">{{ message }}</p>
      }

      <!--
        The engine's read-out sits below the chart rather than in the overlay
        menu: the menu is for switching things on, and this is several lines of
        prose a person reads while looking at the candles.
      -->
      @if (showMarketEngine()) {
        <div class="engine-wrap">
          <app-market-engine-panel
            [result]="marketEngine()"
            [ingestResult]="engineIngest()"
            [parityResult]="engineParity()"
            [validationResult]="engineValidation()"
            [researchBusy]="engineResearchBusy()"
            [researchError]="engineResearchError()"
            (chartSetChange)="setChartSet($event)"
            (ingest)="storeEngineEvents()"
            (parity)="checkEngineParity()"
            (validate)="runEngineValidation()"
          />
        </div>
      }

      @if (marketEngineError(); as message) {
        <p class="error">{{ message }}</p>
      }

      <!-- Every timeframe's trend, below the chart like the engine's read-out. -->
      @if (showTrend()) {
        <div class="engine-wrap">
          <app-trend-panel
            [result]="trend()"
            [focus]="trendFocus()"
            [automatic]="trendFocusIsAutomatic()"
            [detail]="trendDetail()"
            [knownAtMs]="trendKnownAt()"
            (focusChange)="setTrendFocus($event)"
            (detailChange)="setTrendDetail($event)"
          />
        </div>
      }

      @if (trendError(); as message) {
        <p class="error">{{ message }}</p>
      }

      @if (levelRejectionError(); as message) {
        <p class="error">{{ message }}</p>
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
              <div>
                <dt>Open</dt>
                <dd>{{ t.readout.open }}</dd>
              </div>
              <div>
                <dt>High</dt>
                <dd>{{ t.readout.high }}</dd>
              </div>
              <div>
                <dt>Low</dt>
                <dd>{{ t.readout.low }}</dd>
              </div>
              <div>
                <dt>Close</dt>
                <dd
                  [class.up]="(t.readout.changePct ?? 0) >= 0"
                  [class.down]="(t.readout.changePct ?? 0) < 0"
                >
                  {{ t.readout.close }}
                </dd>
              </div>
              <div>
                <dt>Volume</dt>
                <dd>{{ t.readout.volume }}</dd>
              </div>
            </dl>
            <!-- What the engine mark on this candle means, so a label is never a riddle. -->
            @for (note of engineNotes(); track $index) {
              <div class="t-note" [class.up]="note.up" [class.down]="!note.up">
                <div class="t-note-title">{{ note.up ? '↑' : '↓' }} {{ note.title }}</div>
                @for (line of note.lines; track $index) {
                  <p>{{ line }}</p>
                }
              </div>
            }
            <!-- The trend events on this candle — breaks, false breaks, reversals. -->
            @for (note of trendNotes(); track $index) {
              <div class="t-note" [class.up]="note.up" [class.down]="!note.up">
                <div class="t-note-title">{{ note.up ? '↑' : '↓' }} {{ note.title }}</div>
                @for (line of note.lines; track $index) {
                  <p>{{ line }}</p>
                }
              </div>
            }
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

    /* Wraps rather than overflowing. The panel clips its own overflow, so a
       header that will not wrap does not merely look cramped — it puts Stop
       past the right edge where it cannot be clicked, which is exactly what
       happened once two legs sat side by side with six buttons on the bar. */
    .state {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 0.45rem 0.6rem;
      min-width: 0;
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

    /* The overlay button reads as pressed while anything is drawn, because
       that is a mode the chart is in rather than an action. */
    .ghost.on {
      border-color: rgba(90, 169, 230, 0.55);
      background: rgba(90, 169, 230, 0.14);
      color: var(--accent);
    }

    .ghost .badge {
      font-style: normal;
      margin-left: 0.3rem;
      font-size: 0.62rem;
      opacity: 0.8;
    }

    /* Same band as S/R and PDR, in the candlesticks own colour so the three
       are distinguishable at a glance. */
    .candle-band .tag {
      color: var(--up);
    }

    /* The S/R band inverts these on purpose — a level above price is
       resistance, so it is drawn red. A count of bullish patterns is not a
       level, so it takes the plain reading: up is green. */
    .candle-band .lvl.up {
      color: var(--up);
    }
    .candle-band .lvl.down {
      color: var(--down);
    }

    /* Found nothing is an answer, not a fault: it stays in the muted voice
       the rest of the band uses rather than borrowing the error colour. */
    .candle-band .meta.none {
      font-style: italic;
    }

    .pdr-band .lvl.pdh,
    .pdr-band .lvl.pdl,
    .pdr-band .lvl.mid {
      color: #c3d94e;
    }

    /* The midpoint is derived rather than observed, and reads as secondary
       here for the same reason its line is drawn thinner. */
    .pdr-band .lvl.mid {
      opacity: 0.75;
    }

    /* The indicators menu is positioned against this, so the button and the
       panel move together when the header reflows. */
    .ind {
      position: relative;
    }

    .ghost .badge {
      font-style: normal;
      margin-left: 0.3rem;
      font-size: 0.62rem;
      opacity: 0.8;
    }

    .badge.bad {
      color: var(--down);
      font-weight: 700;
    }

    .tf-panel {
      border-top: 1px solid var(--border);
    }

    /* The summary button and the tabs share a row. The tabs appear only once
       the panel is open, so the collapsed state stays a single quiet line. */
    .tf-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding-right: 0.6rem;
    }
    .tf-bar .tf-head {
      width: auto;
      flex: 1 1 auto;
      min-width: 0;
    }

    .tabs {
      display: flex;
      gap: 0.2rem;
      flex: none;
    }

    .tab {
      padding: 0.2rem 0.5rem;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: none;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.7rem;
      cursor: pointer;
    }
    .tab:hover {
      color: var(--text);
    }
    .tab.on {
      border-color: var(--accent-dim);
      background: rgba(90, 169, 230, 0.12);
      color: var(--accent);
    }
    .tab .badge {
      font-style: normal;
      margin-left: 0.25rem;
      font-size: 0.62rem;
      opacity: 0.8;
    }

    /* The tab is reachable with its overlay switched off, so it has to explain
       itself. An empty list would read as a search that found nothing. */
    .tf-off {
      margin: 0;
      padding: 0.4rem 0.6rem 0.6rem;
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--accent);
      font: inherit;
      cursor: pointer;
      text-decoration: underline;
    }

    .tf-head {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      width: 100%;
      padding: 0.4rem 0.6rem;
      background: none;
      border: 0;
      color: var(--text);
      font: inherit;
      font-size: 0.74rem;
      text-align: left;
      cursor: pointer;
    }
    .tf-head .caret {
      color: var(--text-muted);
      width: 0.7rem;
    }
    .tf-head .hint {
      color: var(--text-muted);
      font-size: 0.66rem;
    }
    .tf-note {
      margin: 0;
      padding: 0.4rem 0.6rem 0.5rem;
      font-size: 0.66rem;
      line-height: 1.5;
      color: var(--text-muted);
      max-width: 80ch;
    }

    .levels {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.55rem;
      padding: 0.35rem 0.9rem;
      border-bottom: 1px solid var(--border);
      background: var(--surface-2);
      font-size: 0.72rem;
      color: var(--text-muted);
    }

    .levels .tag {
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--text-faint);
    }

    .levels .lvl {
      font-family: var(--font-mono);
      font-weight: 600;
    }

    .levels .lvl.up {
      color: var(--down);
    }

    .levels .lvl.down {
      color: var(--up);
    }

    /* The touch count rides along quietly: it qualifies the level, it is not
       the level. */
    .levels .lvl i {
      margin-left: 0.15rem;
      font-style: normal;
      font-weight: 400;
      opacity: 0.65;
    }

    .levels .meta {
      color: var(--text-faint);
    }

    /* On the S/R row, ▲/▼ mean "above/below price", so up is resistance and
       reads red. On the retest row they mean the breakout *direction*, so the
       mapping is the plain one and has to be restated rather than inherited. */
    .levels.retests .lvl.up {
      color: var(--up);
    }

    .levels.retests .lvl.down {
      color: var(--down);
    }

    .levels.retests .lvl {
      cursor: help;
      font-family: inherit;
    }

    /* Dotted, like the band on the chart: this one has not resolved yet. */
    .levels.retests .lvl.pending {
      border-bottom: 1px dotted currentColor;
    }

    .engine-wrap {
      padding: 0.55rem 0.9rem 0.7rem;
      border-top: 1px solid var(--border);
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

    /* A marked candle's card carries sentences, so it may widen — but no further
       than a comfortable line length. */
    .tooltip:has(.t-note) {
      width: 300px;
      /* The panel clips, so the card must fit inside the chart's height. */
      max-height: calc(100% - 16px);
      overflow: hidden;
    }

    .t-note {
      margin-top: 0.4rem;
      padding-top: 0.35rem;
      border-top: 1px solid var(--border);
    }

    .t-note-title {
      font-weight: 600;
      margin-bottom: 0.15rem;
    }

    .t-note.up .t-note-title {
      color: var(--up);
    }

    .t-note.down .t-note-title {
      color: var(--down);
    }

    .t-note p {
      margin: 0.15rem 0 0;
      color: var(--text-muted);
      line-height: 1.4;
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

  /**
   * A session that has **already been started elsewhere**, to attach to instead
   * of starting one.
   *
   * This is how a strategy simulation and its chart end up looking at the same
   * bars rather than at two sessions that merely agree: the simulation starts
   * the session (it has to — it must be subscribed before the replay runs) and
   * hands the id here. Without it the panel would open a *second* session over
   * the same instrument, and the marks drawn on this chart would belong to a
   * different replay than the one on screen.
   *
   * `request` is still passed alongside, for the fields the panel reads rather
   * than sends — whether to start with levels showing, chiefly.
   */
  readonly sessionId = input<string | null>(null);

  /**
   * Simulated trades on **this panel's instrument**, drawn as entry/exit marks.
   *
   * The parent filters by instrument; this component draws whatever it is
   * given. Times are snapped to the interval on screen — see `trade-markers.ts`
   * for why that is not optional.
   */
  readonly trades = input<readonly SimTrade[]>([]);

  /**
   * Paper positions on **this panel's instrument**, drawn as entry and exit
   * marks plus live entry, stop and target lines.
   *
   * Separate from {@link trades} rather than folded into one list, because the
   * two are genuinely different objects: a `SimTrade` is a backend book's fill
   * with its own cost model, and a `PaperPosition` is a hand-sized order that
   * may still be waiting to fill. Flattening them would need a lossy mapping in
   * both directions, and the chart draws them differently anyway — only the
   * paper ones get price lines, because only they are still live decisions the
   * user can act on.
   */
  readonly paperPositions = input<readonly PaperPosition[]>([]);

  /**
   * Draw the session only as far as this instant — the replay cursor.
   *
   * `null` is the normal chart: draw everything the buffer holds.
   *
   * This is what makes a paper trade watchable. The bars are all here already
   * (an instant replay delivered the whole day in under a second), so a
   * simulation that merely animated its *own* numbers would be doing so over a
   * chart that had already given away the ending — the stop it is about to hit
   * is sitting on screen the whole time. Truncating the drawn series to the
   * bar the simulation has reached rewinds the chart to 09:15 and lets the day
   * arrive one bar at a time.
   *
   * Everything derived follows for free, because everything derived is
   * computed from the drawn series rather than from the buffer: EMAs, VWAP,
   * chart patterns, candlestick boxes and the previous-day lines all recompute
   * against the truncated set, and the timestamped marks are clipped to it. So
   * the overlays plot as the day unfolds instead of being complete from the
   * first frame.
   *
   * Nothing is lost by truncating: the buffer is untouched, so clearing this
   * back to `null` redraws the whole session exactly as it was.
   */
  readonly playbackUntilMs = input<number | null>(null);

  /**
   * Every candle this panel receives, re-emitted for whoever is simulating on
   * it.
   *
   * The chart owns the socket, so it is the only thing that sees the bars, and
   * the paper-trade engine must not open a second session to get them — that
   * would be a different replay, and the marks would not line up with the
   * candles beneath them. Re-emitting is the whole integration: the page
   * forwards these to the engine, and the engine stays ignorant of sockets.
   */
  readonly candle = output<ChartCandleEvent>();

  /**
   * The feed for this panel has finished — completed, stopped or errored.
   *
   * A simulation holding an open position needs to know, because no further
   * price will ever arrive to move it: without this a replayed day would end
   * with a position that reads as live, shows a P&L frozen at whatever the last
   * bar happened to be, and can never hit its stop or its target.
   */
  readonly sessionEnded = output<void>();

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
  /** v5 moved markers out of the series and into a plugin attached to it. */
  private markers?: ISeriesMarkersPluginApi<Time>;
  /* --- previous day range -------------------------------------------- */
  /** Whether PDH/PDL/mid are drawn. Persisted, like the other toggles. */
  readonly showPreviousDayRange = signal(false);
  /**
   * One range per trading day the chart can show, newest last.
   *
   * Held rather than recomputed because it cannot change: every value comes
   * from a session that has already closed. Fetched once per instrument/date
   * and then only redrawn — which is what "static across the session" means in
   * practice, and why no amount of streaming can move these lines.
   */
  readonly previousDayRanges = signal<PreviousDayRange[]>([]);
  readonly pdrLoading = signal(false);
  readonly pdrError = signal<string | null>(null);
  /**
   * The instrument and date the held ranges belong to.
   *
   * The guard against the one way this overlay can lie: turning it off, moving
   * the panel to another instrument, and turning it back on would otherwise
   * redraw the previous instrument's levels over the new one's bars.
   */
  private pdrFetchedFor: string | null = null;
  private readonly pdrSeries = new Map<PdrLine, ISeriesApi<'Line'>>();

  private readonly buffer = new CandleSeriesBuffer();

  /**
   * The pattern overlay, and what it is currently showing.
   *
   * Kept by id rather than as a list so a recomputation can be diffed
   * against it: a pattern that kept its id is updated in place, and only one
   * that genuinely stopped being detected is removed. Republishing the whole
   * set every pass would redraw identical lines and read as a flicker.
   */
  private readonly overlay = new LightweightChartsPatternOverlay();
  private readonly tracker = new LiveTracker();
  private readonly prefs = inject(PreferencesService);

  /** What the toolbar counts. */
  readonly patterns = signal<DetectedPattern[]>([]);
  /** One row per bar size — which pattern is forming where. */
  readonly timeframeRows = signal<TimeframeRow[]>([]);
  /** Persisted per browser, so the chart opens the way it was left. */
  readonly showPatterns = signal(true);
  /** Which findings tab is on screen, and whether the panel is open at all. */
  readonly findingsOpen = signal(false);
  readonly findingsTab = signal<FindingsTab>('candles');

  /* --- candlestick patterns ------------------------------------------ */

  /**
   * The candlestick overlay: boxes around the bars, with the reading beside
   * them.
   *
   * A separate overlay from {@link overlay} rather than a second kind of hit
   * inside it. The two describe different things — one the shape of individual
   * candles, the other multi-bar price structure — they are toggled
   * independently, and they are drawn in different colours so a reader can
   * tell which feature is speaking. Sharing one primitive would couple their
   * visibility and their palettes for no saving.
   */
  private readonly candleOverlay = new LightweightChartsCandlePatternOverlay();
  private readonly candleSync = new CandlePatternSync();
  private readonly candleApi = inject(CandlePatternsApiService);
  private readonly candleTuning = defaultCandlePatternTuning;
  /** In flight, so a second request is not stacked behind the first. */
  private candleRequest?: Subscription;
  /** Set when bars closed while a request was out. See . */
  private candleSeriesMoved = false;

  /** What the toolbar counts. */
  readonly candlePatterns = signal<RenderedCandlePattern[]>([]);
  /**
   * Off by default, unlike the chart patterns.
   *
   * It costs a request, and a user who has not asked for it should not have
   * their chart make one. The preference then remembers whichever way they
   * left it.
   */
  readonly showCandlePatterns = signal(false);
  readonly candlePatternsLoading = signal(false);
  readonly candlePatternsError = signal<string | null>(null);
  /**
   * Whether an answer has come back at all since the overlay was switched on.
   *
   * The difference between "not asked yet" and "asked, and nothing cleared the
   * floor" is the whole of whether a reader can trust this feature. Without
   * it both look like an unmarked chart, and someone who presses the toggle
   * and sees nothing cannot tell a quiet market from a request that failed.
   */
  readonly candlePatternsRan = signal(false);
  /**
   * Display names as the backend supplied them, for the secondary readings.
   *
   * The primary's name is resolved onto each hit; the rest are looked up from
   * here by the list, so a pattern a bar merely *also* was does not cost a
   * string on the wire for every hit that shares it.
   */
  readonly candleLabels = signal<Record<string, string>>({});
  /**
   * Bars the last answer covered, as the backend counted them.
   *
   * Taken from the response rather than measured from the chart: the request
   * is capped to a window, so the series on screen and the series that was
   * read are not always the same length, and the band should report the one
   * the answer is actually about.
   */
  readonly candleBarsAnalysed = signal(0);

  /** Bar open time, as the list prints it. Passed in so the list holds no timezone. */
  protected readonly formatCandleTime = (ms: number): string =>
    this.displaySeconds() >= 86_400 ? formatIstDay(ms / 1000) : formatIstTime(ms / 1000);

  /* --- indicators ---------------------------------------------------- */
  protected readonly emaChoices = EMA_INDICATORS;
  /** Periods currently drawn. Persisted, like the pattern toggle. */
  readonly selectedEmas = signal<readonly number[]>([]);
  /** Whether the overlay menu is open. Not persisted — a menu is not a setting. */
  readonly showOverlays = signal(false);
  /** Whether the indicator menu is open. A separate dropdown from overlays,
   *  so it is a separate open/closed flag. */
  readonly showIndicators = signal(false);
  private readonly hostElement = inject(ElementRef<HTMLElement>);

  /**
   * Every toggle row in the overlay menu, grouped the way a reader looks for
   * them. Data rather than repeated markup, so a new overlay is one entry here
   * and cannot forget its description or its reason for being unavailable.
   * The indicators (EMAs, VWAP) are {@link indicatorChips}.
   */
  protected readonly overlayGroups: readonly OverlayGroup[] = [
    {
      title: 'Key levels',
      items: [
        {
          id: 'sr',
          name: 'Support & resistance',
          hint: 'Swing and pivot levels on this bar size',
          swatch: 'sr',
          blocked: () => this.needsSession(),
          on: () => this.showLevels(),
          toggle: () => this.toggleLevels(),
          note: () => (this.levelsLoading() ? '…' : countLabel(this.levels().length, 'level')),
        },
        {
          id: 'pdr',
          name: 'Previous day range',
          hint: "Yesterday's high, low and midpoint",
          swatch: 'pdr',
          blocked: () => this.needsInstrument(),
          on: () => this.showPreviousDayRange(),
          toggle: () => this.togglePreviousDayRange(),
          note: () => (this.pdrLoading() ? '…' : null),
        },
      ],
    },
    {
      title: 'Price action at levels',
      items: [
        {
          id: 'retests',
          name: 'Retests',
          hint: 'Where price came back to a broken level',
          swatch: 'rt',
          blocked: () => this.needsSession(),
          on: () => this.showRetests(),
          toggle: () => this.toggleRetests(),
          note: () => (this.retestsLoading() ? '…' : countLabel(this.retests().length, 'retest')),
        },
        {
          id: 'level-rejection',
          name: 'Level rejection',
          hint: 'PDH · PDL · 50% · 13:15 hour → 5M rejection → 1M break',
          swatch: 'lrj',
          blocked: () => this.needsInstrument(),
          on: () => this.showLevelRejection(),
          toggle: () => this.toggleLevelRejection(),
          note: () => {
            if (this.levelRejectionLoading()) return '…';
            const result = this.levelRejection();
            return result ? countLabel(result.result.funnel.entries, 'entry', 'entries') : null;
          },
        },
        {
          id: 'market-engine',
          name: 'Market engine',
          hint: 'Trend state across five timeframes, read-out below the chart',
          swatch: 'mte',
          blocked: () => this.needsSession(),
          on: () => this.showMarketEngine(),
          toggle: () => this.toggleMarketEngine(),
          note: () => {
            if (this.marketEngineLoading()) return '…';
            const engine = this.marketEngine();
            return engine ? countLabel(engine.readings.length, 'reading') : null;
          },
        },
        {
          id: 'trend',
          name: 'Trend',
          hint: 'Structure-first trend on 1m → 1D: swings, breaks, reversals, read-out below',
          swatch: 'trd',
          blocked: () => this.needsSession(),
          on: () => this.showTrend(),
          toggle: () => this.toggleTrend(),
          note: () => {
            if (this.trendLoading() && !this.trend()) return '…';
            const focus = this.focusedTrend();
            const reading = focus ? readingAt(focus, this.trendKnownAt()) : null;
            return focus && reading
              ? `${focus.timeframe} ${DIRECTION_LABELS[reading.direction].toLowerCase()}`
              : null;
          },
        },
      ],
    },
    {
      title: 'Patterns',
      items: [
        {
          id: 'patterns',
          name: 'Chart patterns',
          hint: 'Triangles, flags, channels, double tops and bottoms',
          swatch: 'pat',
          blocked: () => null,
          on: () => this.showPatterns(),
          toggle: () => this.togglePatterns(),
          note: () => countLabel(this.patterns().length, 'found', 'found'),
        },
        {
          id: 'candles',
          name: 'Candlesticks',
          hint: 'Named candle patterns such as engulfing and hammer',
          swatch: 'candles',
          blocked: () => null,
          on: () => this.showCandlePatterns(),
          toggle: () => this.toggleCandlePatterns(),
          note: () => this.candleBadge(),
          bad: () => !!this.candlePatternsError(),
        },
      ],
    },
  ];

  /** EMAs and VWAP, switched on as chips at the foot of the menu. */
  protected readonly indicatorChips: readonly OverlayChip[] = [
    ...EMA_INDICATORS.map((choice) => ({
      id: `ema-${choice.period}`,
      name: `EMA ${choice.period}`,
      color: choice.color,
      on: () => this.isEmaOn(choice.period),
      toggle: () => this.toggleEma(choice.period),
    })),
    {
      id: 'vwap',
      name: 'VWAP',
      color: VWAP_COLOR,
      on: () => this.showVwap(),
      toggle: () => this.toggleVwap(),
    },
  ];

  private needsSession(): string | null {
    return this.session() ? null : 'Start the chart to use this';
  }

  private needsInstrument(): string | null {
    return this.request() ? null : 'Pick an instrument to use this';
  }

  /** Closes whichever menu is open on a click anywhere outside its own button. */
  protected closeMenusOutside(event: MouseEvent): void {
    if (!this.showOverlays() && !this.showIndicators()) return;
    const target = event.target;
    const inside = (el: Element | null) => !!el && target instanceof Node && el.contains(target);
    const [overlayHost, indicatorHost] = Array.from(
      (this.hostElement.nativeElement as HTMLElement).querySelectorAll('.ind'),
    );
    if (this.showOverlays() && !inside(overlayHost)) this.showOverlays.set(false);
    if (this.showIndicators() && !inside(indicatorHost)) this.showIndicators.set(false);
  }

  protected closeMenus(): void {
    this.showOverlays.set(false);
    this.showIndicators.set(false);
  }
  /** One line series per selected period, keyed so it can be removed. */
  private readonly emaSeries = new Map<number, ISeriesApi<'Line'>>();
  /** Whether the session VWAP is drawn. Persisted, like the averages. */
  readonly showVwap = signal(false);
  /** The VWAP line, created only while it is on. */
  private vwapSeries?: ISeriesApi<'Line'>;

  /**
   * The session socket currently feeding {@link buffer}.
   *
   * Held so the *previous* one can be dropped when this panel moves to another
   * session. Without that, a restart leaves the old socket open and still
   * pushing candles into the same buffer — two instruments interleaved on one
   * chart, or the same instrument from two replays. It self-corrects for a
   * finished TEST session, whose socket completes on its terminal event, which
   * is exactly why it stayed invisible: the cases that break are a paced replay
   * restarted mid-flight and a LIVE chart, both of which stay open forever.
   */
  private stream: Subscription | null = null;

  /** The price lines currently on the chart, so they can be removed as a set. */
  private priceLines: IPriceLine[] = [];

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

  /**
   * The levels currently drawn, and the interval they were found on.
   *
   * The interval is kept beside them because it is what makes a set *stale*:
   * switching the chart from 1m to 15m does not change these numbers, it
   * changes whether they still describe the bars on screen.
   */
  readonly levels = signal<SupportResistanceLevel[]>([]);
  private levelsInterval: ChartInterval | null = null;
  private levelsPivotDate = signal<string | null>(null);
  /** Off until the session asks for levels, or the user presses S/R. */
  readonly showLevels = signal(false);
  readonly levelsLoading = signal(false);
  readonly levelsError = signal<string | null>(null);

  readonly retests = signal<ChartRetest[]>([]);
  private retestsInterval: ChartInterval | null = null;
  readonly showRetests = signal(false);
  readonly retestsLoading = signal(false);
  readonly retestsError = signal<string | null>(null);

  /**
   * The multi-timeframe engine's readings.
   *
   * Unlike the levels and the retests these are **not** interval-bound: the
   * engine reads five timeframes by definition, and which five is `chartSet`,
   * not the bar size on screen. So switching the chart from 1m to 15m does not
   * invalidate them — it only changes which bar each mark has to be snapped to.
   * That is the whole reason `refreshMarketEngine` is not called from the
   * interval effect, where the other two are.
   */
  readonly marketEngine = signal<MarketEngineResult | null>(null);
  readonly showMarketEngine = signal(false);
  readonly marketEngineLoading = signal(false);
  readonly marketEngineError = signal<string | null>(null);
  /**
   * Which bar sizes fill the cascade: `standard` is 4H/1H, `nse` is 125m/75m.
   *
   * Kept here rather than inside the panel because it is a *request* parameter
   * — changing it re-asks the backend — and a control whose effect is a fetch
   * belongs next to the fetch.
   */
  readonly chartSet = signal<ChartSet>('standard');

  /* Research results — the event log, replay parity and validation. */
  readonly engineIngest = signal<EventLogIngestResult | null>(null);
  readonly engineParity = signal<ParityCheckResult | null>(null);
  readonly engineValidation = signal<ValidationResult | null>(null);
  readonly engineResearchBusy = signal(false);
  readonly engineResearchError = signal<string | null>(null);
  /** Protected-level lines, kept apart from the S/R lines so either can clear alone. */
  private engineLines: IPriceLine[] = [];

  /* --- level rejection ------------------------------------------------ */
  /**
   * The previous-day level rejection overlay: levels, 5M rejections, 1M
   * confirmations and their outcomes, for the days the chart is showing.
   *
   * Session-independent like the previous day range — every level comes from a
   * closed day — so it needs only the request. Nothing but the chart shows it:
   * the levels as lines, each setup as marks.
   */
  readonly showLevelRejection = signal(false);
  readonly levelRejection = signal<LevelRejectionResponse | null>(null);
  readonly levelRejectionLoading = signal(false);
  readonly levelRejectionError = signal<string | null>(null);
  private levelRejectionLines: IPriceLine[] = [];

  /* --- trend ---------------------------------------------------------- */
  /**
   * The structure-first trend on every timeframe, from the session endpoint —
   * bounded by the session's clock server-side, and refreshed as each bar
   * closes. The candles show the swings and breaks of one timeframe, the
   * *focus*: the one matching the bar on screen unless the user picked another
   * in the panel.
   */
  readonly trend = signal<TrendResult | null>(null);
  readonly showTrend = signal(false);
  readonly trendLoading = signal(false);
  readonly trendError = signal<string | null>(null);
  /** The user's pick in the panel; `null` follows the chart's bar size. */
  private readonly trendFocusChoice = signal<TrendTimeframe | null>(null);
  private trendPriceLines: IPriceLine[] = [];
  /** One line series per drawn trendline, by the backend's line id. */
  private readonly trendlineSeries = new Map<number, ISeriesApi<'Line'>>();
  /** Ids of the trendlines drawn right now — the breaks a clean chart may mark. */
  private trendDrawnLines = new Set<number>();
  /** Clean by default: the current structure, not every swing ever printed. */
  readonly trendDetail = signal<TrendDetail>('clean');
  private trendRequest: Subscription | null = null;
  /** A new bar closed while a request was out: ask once more when it lands. */
  private trendMoved = false;
  /** Which session and bar count the held reading answers. */
  private trendFetchedFor: string | null = null;

  readonly trendFocus = computed<TrendTimeframe | null>(
    () =>
      this.trendFocusChoice() ??
      chartTimeframe(
        this.displaySeconds(),
        this.trend()?.timeframes.map((t) => t.timeframe) ?? DEFAULT_TREND_TIMEFRAMES,
      ),
  );

  /** Whether the drawn timeframe follows the chart's bar size or was picked. */
  readonly trendFocusIsAutomatic = computed(() => this.trendFocusChoice() === null);

  readonly focusedTrend = computed<TimeframeTrend | null>(
    () => this.trend()?.timeframes.find((t) => t.timeframe === this.trendFocus()) ?? null,
  );

  /**
   * While replaying, the close of the newest bar on screen: the trend may show
   * only what was known by then. `null` off replay. Keyed on `revision`
   * because the drawn series is not itself a signal.
   */
  readonly trendKnownAt = computed<number | null>(() => {
    this.revision();
    return this.knownAtNow();
  });

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
      time: this.displaySeconds() >= 86_400 ? formatIstDay(bar.time) : formatIstStamp(bar.time),
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

  /**
   * The one line of text the S/R bar shows: the level immediately above price
   * and the one immediately below it.
   *
   * Not a list of all thirteen. Those are already *on the chart*, which is
   * where a level belongs; what a header can add is the pair that matters
   * right now — where this is going and where it stops.
   *
   * Both fall out of the ordering with no searching: the backend returns
   * levels ascending by price and labels each one against the same reference
   * close, so the first `RESISTANCE` is the nearest above and the last
   * `SUPPORT` is the nearest below.
   */
  readonly levelBand = computed(() => {
    const levels = this.levels();
    if (!this.showLevels() || !levels.length) return null;
    const supports = levels.filter((l) => l.kind === 'SUPPORT');
    return {
      count: levels.length,
      above: levels.find((l) => l.kind === 'RESISTANCE') ?? null,
      below: supports[supports.length - 1] ?? null,
      interval: this.intervalLabel(),
      pivotDate: this.levelsPivotDate(),
    };
  });

  /**
   * The one line the RT bar shows: the most recent handful of retests.
   *
   * Newest first, as the backend returns them, and capped — the bands are
   * already *on the chart*, which is where a level belongs. What a header adds
   * is what just happened and how well it held.
   */
  readonly retestBand = computed(() => {
    const retests = this.retests();
    if (!this.showRetests() || !retests.length) return null;
    return {
      count: retests.length,
      shown: retests.slice(0, 3),
      unresolved: retests.filter((retest) => retest.unresolved).length,
      interval: this.intervalLabel(),
    };
  });

  /**
   * The numbers the PDR bar shows: the newest day's range.
   *
   * The newest rather than all of them, for the same reason the S/R bar shows
   * only the pair around price — the older days are already drawn *on* the
   * chart, above their own bars, which is where a level belongs. What a header
   * adds is the one set that applies to the session being watched now.
   */
  readonly previousDayBand = computed(() => {
    const ranges = this.previousDayRanges();
    const newest = ranges.at(-1);
    if (!this.showPreviousDayRange() || !newest) return null;
    return { ...newest, days: ranges.length };
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
      this.markers = createSeriesMarkers(this.candles, []);
      // Attached to the candle series, so the overlay is converted through
      // the same price scale and coordinate space as the bars themselves.
      this.overlay.attach(this.candles);
      const remembered = this.prefs.get(PREF.showPatterns, true);
      this.showPatterns.set(remembered);
      this.overlay.setVisible(remembered);

      this.candleOverlay.attach(this.candles);
      const rememberedCandles = this.prefs.get(PREF.showCandlePatterns, false);
      this.showCandlePatterns.set(rememberedCandles);
      this.candleOverlay.setVisible(rememberedCandles);

      // Restored before the first redraw, so a chart opens with the averages
      // it was left with rather than drawing them a frame later.
      const periods = this.prefs.get<readonly number[]>(PREF.emaPeriods, []);
      const known = periods.filter((n) => EMA_INDICATORS.some((i) => i.period === n));
      this.selectedEmas.set(known);
      for (const period of known) this.addEmaSeries(period);
      if (this.prefs.get(PREF.showVwap, false)) {
        this.showVwap.set(true);
        this.addVwapSeries();
      }
      this.chart.subscribeCrosshairMove(this.onCrosshair);
      // Levels and trades can both arrive before the canvas exists — a session
      // started with `levels` publishes its first set within milliseconds of
      // Start, and an instant replay finishes its whole simulation faster.
      this.drawLevels();
      this.drawMarkers();
      this.drawPaperLines();
    });

    // Starting is driven by the input rather than by a method the parent
    // calls, so a panel that appears because a second leg was selected starts
    // itself — the parent never has to reach into a `viewChild` that may not
    // exist yet on the turn it renders.
    //
    // `sessionId` wins when both are set: it means somebody has *already*
    // started the session this panel is meant to show, and starting a second
    // one would draw a different replay of the same instrument beside the marks
    // belonging to the first.
    effect(() => {
      const adopted = this.sessionId();
      const request = this.request();
      if (adopted) {
        untracked(() => this.adopt(adopted, request));
        return;
      }
      if (!request) return;
      untracked(() => this.start(request));
    });

    // Marks follow both the trades and the timeframe, because a marker's time
    // has to match a bar the chart is actually drawing — see `trade-markers.ts`.
    effect(() => {
      this.trades();
      this.displaySeconds();
      untracked(() => this.drawMarkers());
    });

    // Paper positions move both: the arrows, like any other mark, and the
    // entry/stop/target lines, which nothing else on the chart draws. The
    // lines are price-only and so do not depend on the interval — but the
    // marks do, and they share this effect because a position changing has to
    // republish both or the chart shows a stop line for a trade whose exit
    // arrow is missing.
    effect(() => {
      this.paperPositions();
      this.displaySeconds();
      untracked(() => {
        this.drawMarkers();
        this.drawPaperLines();
      });
    });

    // The replay cursor. A full redraw per step rather than an append, because
    // every overlay is derived from the drawn series and has to be re-derived
    // against the shorter one — an appended bar would leave the EMAs, the
    // patterns and the clipped marks describing a series that no longer
    // matches what is on screen.
    //
    // `refit` keeps the whole replayed span in view as it grows, which is what
    // the chart already does for bars arriving live, so a replay looks like the
    // session it is imitating rather than like a chart being scrolled.
    effect(() => {
      const until = this.playbackUntilMs();
      untracked(() => {
        // A cursor that moved *backwards* is a different series, not a longer
        // one: the replay restarting, or ending and restoring the full day. The
        // live tracker holds state about bars that are no longer drawn, so it
        // has to be reset and the scan forced. A cursor moving forwards is
        // exactly the live-feed case — one more bar on the end — which the
        // incremental scan inside `redraw` already handles, and forcing it per
        // bar would run full pattern detection 375 times for one replay.
        const rewound = until === null || this.lastCursor === null || until < this.lastCursor;
        this.lastCursor = until;

        if (rewound) this.tracker.reset();
        this.redraw({ refit: true });
        if (rewound) this.refreshPatterns({ force: true });

        // Marks are clipped to the newest drawn bar while replaying, and
        // `redraw` only republishes them when the *left* edge moves — which it
        // never does here. Without this the day's entries, exits and engine
        // marks would stay hidden for the whole replay.
        this.drawMarkers();
      });
    });

    // Redrawing on interval change reuses the bars already in the buffer, so
    // switching from 1m to 5m mid-replay costs nothing and loses nothing.
    effect(() => {
      this.displaySeconds();
      untracked(() => {
        // A new bar size is a different series with different pivots, and its
        // newest closed bar may be one the tracker has already seen — so the
        // scan has to be forced rather than waiting for the next close.
        this.tracker.reset();
        // The candlestick boxes go before the redraw rather than after it.
        // They are anchored to bar *open* times, and re-bucketing invents a
        // new set of those: a box on the 09:17 one-minute bar has no anchor in
        // a five-minute series, so it would not be removed by the diff — it
        // would simply stop being drawn, leaving the toolbar counting boxes
        // nobody can see. The re-request happens inside `redraw`, because the
        // key carries the interval.
        this.clearCandlePatterns();
        this.redraw({ refit: true });
        this.refreshPatterns({ force: true });
        // The bars are free to re-bucket; the levels are not. They were found
        // on a stated interval server-side, so the set on screen now describes
        // a series that is no longer drawn — re-ask for the new one.
        if (this.showLevels()) this.refreshLevels();
        // Retests are interval-bound in the same way, and more sharply: §4.7 of
        // the spec is precisely that a retest visible on one timeframe can be
        // absent on another, so a set found on 5m says nothing about the 15m
        // bars now on screen.
        if (this.showRetests()) this.refreshRetests();
        // The engine is deliberately *not* re-fetched. Its readings are not
        // found on the displayed interval — it reads five timeframes at once —
        // so the held set still describes this instrument correctly. What does
        // change is which bar each mark snaps to, and the redraw above has
        // already republished them.
      });
    });

    this.destroyRef.onDestroy(() => {
      this.emaSeries.clear();
      this.pdrSeries.clear();
      this.trendlineSeries.clear();
      this.vwapSeries = undefined;
      this.overlay.destroy();
      this.candleOverlay.destroy();
      this.chart?.unsubscribeCrosshairMove(this.onCrosshair);
      this.chart?.remove();
      this.chart = undefined;
      this.candles = undefined;
      this.volume = undefined;
      this.markers = undefined;
    });
  }

  start(request: StartStreamRequest): void {
    this.reset(request);

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

  /**
   * Attaches to a session somebody else started, instead of starting one.
   *
   * The socket is opened immediately rather than after the status call: the
   * backend replays the session's whole candle backlog to every connection, so
   * connecting is sufficient to receive the day, and waiting on a round trip
   * first would be a window in which live bars are missed. The status fetch is
   * only to fill the header in before the socket's first `SESSION_STATUS`
   * frame arrives, and a failure to get it is not worth failing the panel over.
   */
  private adopt(sessionId: string, request: StartStreamRequest | null): void {
    if (this.session()?.sessionId === sessionId) return;
    this.reset(request);

    this.listen(sessionId);

    this.api
      .status(sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => this.session.set(snapshot),
        error: () => {
          /* the socket's own SESSION_STATUS frame is the authority */
        },
      });
  }

  /** Everything both entry points clear before a new session's bars arrive. */
  private reset(request: StartStreamRequest | null): void {
    // The socket first: a still-open stream from the last session would refill
    // the buffer this is about to empty.
    this.stream?.unsubscribe();
    this.stream = null;
    this.error.set(null);
    this.session.set(null);
    this.buffer.clear();
    this.barCount.set(0);
    this.hovered.set(null);
    this.tooltipAt.set(null);
    // Levels belong to the series that produced them: carrying the last
    // session's lines onto a different instrument would draw confident,
    // completely wrong numbers.
    this.clearLevels();
    // Retests describe the same series, so they go with it.
    this.clearRetests();
    // Patterns belong to the series that produced them. Carrying the last
    // instrument’s shapes onto a new one would draw confident nonsense.
    this.clearPatterns();
    // And the candlestick boxes, for the same reason: they describe the bars
    // of the series that produced them.
    this.clearCandlePatterns();
    // Same for the previous-day levels, which are per instrument *and* per
    // date — see `pdrKey`.
    this.clearPreviousDayRange();
    // The overlay switches itself off for a new session rather than carrying
    // over: it is enabled by a click and fetches when enabled, so carrying it
    // across would annotate an instrument nobody asked about.
    this.showPreviousDayRange.set(false);
    this.removePdrSeries();
    // The request is what says whether this chart is annotated. Pressing S/R
    // afterwards still works either way — this only decides where it starts.
    this.showLevels.set(request?.levels !== undefined);
    // Never on by default: a retest is a completed label over history, not
    // something a chart needs the moment it opens.
    this.showRetests.set(false);
    // Same for the engine, and its readings belong to the instrument and date
    // that produced them — carrying them into a new session would describe one
    // chart over another. The chart set survives, because it is a preference
    // about how to read rather than a fact about this session.
    this.showMarketEngine.set(false);
    this.clearMarketEngine();
    // Levels and setups belong to the instrument and date that produced them.
    this.showLevelRejection.set(false);
    this.clearLevelRejection();
    // The trend belongs to the instrument that produced it; the focus pick is
    // about how that chart was being read.
    this.showTrend.set(false);
    this.trendFocusChoice.set(null);
    this.clearTrend();
    // The paper lines describe prices in the series being replaced. The
    // positions themselves are the page's to keep or clear — this only stops
    // the old instrument's levels being drawn over the new one's bars.
    this.drawPaperLines();
    this.redraw();
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
    this.stream?.unsubscribe();
    this.stream = this.socket
      .connect(sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        switch (event.type) {
          case 'CANDLE':
            this.buffer.add(event);
            // Emitted before the redraw is even scheduled: the engine reasons
            // on bars, not on pixels, and making it wait for a canvas would
            // mean an instant replay finished simulating a different set of
            // bars than it drew.
            this.candle.emit(event);
            // Batched by the microtask below rather than redrawn per bar: an
            // instant replay delivers a whole day in one burst of frames, and
            // a `setData` per frame is hundreds of full redraws for one
            // visible result.
            this.scheduleRedraw();
            break;
          case 'LEVELS':
            // Only a set found on the interval this chart is drawing. One
            // computed on another describes turns that are not on screen, and
            // the backend keeps publishing at the interval the session was
            // started with even after the user switches timeframe.
            if (event.interval === this.intervalName()) this.applyLevels(event);
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
            // The feed is over, so nothing will ever mark an open paper
            // position again. Saying so lets the page square it off at the
            // last traded price rather than leaving a position that appears
            // live but can never move or exit.
            this.sessionEnded.emit();
            this.session.update((s) =>
              s
                ? { ...s, status: event.type === 'SESSION_COMPLETED' ? 'COMPLETED' : 'STOPPED' }
                : s,
            );
            break;
        }
      });
  }

  // ---------------------------------------------------------------------------
  // Support & resistance
  // ---------------------------------------------------------------------------

  /**
   * Shows or hides the levels.
   *
   * Turning them *on* fetches when what is held is stale or absent, and simply
   * redraws when it is not — so pressing S/R twice does not cost two requests.
   * Turning them off keeps the last set: the next press is instant.
   */
  toggleLevels(): void {
    const next = !this.showLevels();
    this.showLevels.set(next);
    if (!next) {
      this.drawLevels();
      return;
    }
    if (this.levelsInterval === this.intervalName()) this.drawLevels();
    else this.refreshLevels();
  }

  /** Price, at the same precision the readout uses. */
  protected formatLevel(level: SupportResistanceLevel): string {
    return formatPrice(level.price);
  }

  /** The same precision again, for a bare number the template holds. */
  protected formatBand(price: number): string {
    return formatPrice(price);
  }

  /**
   * Asks the session for levels on the interval currently displayed.
   *
   * The *session* endpoint rather than the standalone one, deliberately: it
   * analyses the bars this session published — the series on screen — with
   * prior sessions folded in behind them, so the lines cannot describe a
   * different chart than the one they are drawn on.
   */
  private refreshLevels(): void {
    const sessionId = this.session()?.sessionId;
    if (!sessionId) return;

    this.levelsError.set(null);
    this.levelsLoading.set(true);
    this.api
      .sessionLevels(sessionId, {
        ...this.levelTuning(),
        interval: this.intervalName(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.levelsLoading.set(false);
          this.applyLevels(result);
        },
        error: (e: ChartStreamError) => {
          this.levelsLoading.set(false);
          // Its own line, not `error`: no levels is a chart without
          // annotations, and reporting it as a chart failure would be a lie
          // about the bars, which are fine.
          this.levelsError.set(`Support/resistance unavailable — ${describe(e)}`);
        },
      });
  }

  /**
   * The tuning the session was started with, reused for an on-demand fetch.
   *
   * So that pressing S/R on a chart started with `method: 'both'` gets pivots
   * too, rather than silently falling back to the defaults and showing the
   * user a different set of lines than the ones they configured.
   */
  private levelTuning(): SessionLevelsQuery {
    const configured = this.request()?.levels;
    if (!configured) return {};
    const { interval: _interval, refreshEveryBars: _refresh, ...tuning } = configured;
    return tuning;
  }

  private applyLevels(result: ChartLevels): void {
    this.levels.set(result.levels);
    this.levelsInterval = result.interval;
    this.levelsPivotDate.set(result.pivotBasis?.date ?? null);
    this.levelsError.set(null);
    this.drawLevels();
  }

  private clearLevels(): void {
    this.levels.set([]);
    this.levelsInterval = null;
    this.levelsPivotDate.set(null);
    this.levelsError.set(null);
    this.drawLevels();
  }

  /**
   * Shows or hides the retests.
   *
   * Same economy as {@link toggleLevels}: turning them on fetches only when
   * what is held is stale or absent, so pressing RT twice does not cost two
   * requests, and turning them off keeps the last set for an instant re-show.
   */
  toggleRetests(): void {
    const next = !this.showRetests();
    this.showRetests.set(next);
    if (!next) {
      this.drawRetests();
      return;
    }
    if (this.retestsInterval === this.intervalName()) this.drawRetests();
    else this.refreshRetests();
  }

  /** Scenario name for one retest — what the chip reads. */
  protected scenarioLabel(retest: ChartRetest): string {
    return SCENARIO_LABELS[retest.scenario];
  }

  /** Quality as a percentage, for the chip's trailing tag. */
  protected qualityLabel(retest: ChartRetest): string {
    return `${Math.round(retest.quality * 100)}%`;
  }

  /** The numbers behind the chip; see `retest-overlay.ts`. */
  protected describe(retest: ChartRetest): string {
    return describeRetest(retest);
  }

  /**
   * Asks the session for retests on the interval currently displayed.
   *
   * The session endpoint rather than the standalone one, for the same reason
   * the levels use it: it analyses the bars this session published — the
   * series on screen — so an annotation cannot describe a different chart than
   * the one it is drawn on.
   *
   * Unresolved retests are asked for explicitly. They are the ones happening
   * *now*, which on a live chart is the only reason to be looking; the drawing
   * keeps them visibly distinct rather than implying they resolved.
   */
  private refreshRetests(): void {
    const sessionId = this.session()?.sessionId;
    if (!sessionId) return;

    this.retestsError.set(null);
    this.retestsLoading.set(true);
    this.api
      .sessionRetests(sessionId, {
        interval: this.intervalName(),
        includeUnresolved: true,
      } satisfies SessionRetestsQuery)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.retestsLoading.set(false);
          this.applyRetests(result);
        },
        error: (e: ChartStreamError) => {
          this.retestsLoading.set(false);
          // Its own line, like `levelsError`: no retests is a chart without
          // annotations, and reporting it as a chart failure would be a lie
          // about the bars, which are fine.
          this.retestsError.set(`Retests unavailable — ${describe(e)}`);
        },
      });
  }

  /**
   * Shows or hides the multi-timeframe engine.
   *
   * Same economy as {@link toggleLevels} and {@link toggleRetests}: turning it
   * on fetches only when nothing is held, so toggling twice costs one request,
   * and turning it off keeps the last reading for an instant re-show.
   *
   * No interval check, unlike the retests. A reading is not bound to the bar
   * size on screen — see {@link marketEngine} — so what is held stays valid
   * when the chart switches timeframe.
   */
  toggleMarketEngine(): void {
    const next = !this.showMarketEngine();
    this.showMarketEngine.set(next);
    if (!next) {
      this.drawMarketEngine();
      return;
    }
    if (this.marketEngine()) this.drawMarketEngine();
    else this.refreshMarketEngine();
  }

  /**
   * Switches the cascade between 4H/1H and 125m/75m.
   *
   * Always a refetch, even when the engine is showing nothing: the chart set
   * decides which bars the context and structure layers are built from, so the
   * held reading describes a different pair of timeframes and cannot be reused.
   */
  protected setChartSet(chartSet: ChartSet): void {
    if (this.chartSet() === chartSet) return;
    this.chartSet.set(chartSet);
    this.marketEngine.set(null);
    if (this.showMarketEngine()) this.refreshMarketEngine();
  }

  /**
   * Asks the session for the engine's reading of the bars it has published.
   *
   * The session endpoint rather than the standalone one, and here the reason is
   * sharper than it is for levels or retests: the session's own clock is what
   * bounds the reading. A `TEST` replay part-way through a day must be read as
   * of that moment, and the standalone endpoint — which knows only a date —
   * would hand back the whole day, afternoon included.
   */
  private refreshMarketEngine(): void {
    const sessionId = this.session()?.sessionId;
    if (!sessionId) return;

    this.marketEngineError.set(null);
    this.marketEngineLoading.set(true);
    this.api
      .sessionMarketEngine(sessionId, {
        chartSet: this.chartSet(),
        roundNumberStep: this.roundNumberStep(),
      } satisfies SessionMarketEngineQuery)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.marketEngineLoading.set(false);
          this.marketEngine.set(result);
          this.marketEngineError.set(null);
          this.drawMarketEngine();
        },
        error: (e: ChartStreamError) => {
          this.marketEngineLoading.set(false);
          // Its own line, like the other two: no reading is a chart without
          // annotations, not a chart whose bars are wrong.
          this.marketEngineError.set(`Market engine unavailable — ${describe(e)}`);
        },
      });
  }

  /**
   * The round-number step the engine should place reference levels on.
   *
   * 100 for BANKNIFTY, 50 otherwise. Derived from the request rather than
   * configured, because there is exactly one right answer per instrument and
   * asking the user for it would be asking them to know the backend's
   * confluence rule.
   */
  private roundNumberStep(): number {
    return this.request()?.instrument.underlying === 'BANKNIFTY' ? 100 : 50;
  }

  private clearMarketEngine(): void {
    this.marketEngine.set(null);
    this.marketEngineError.set(null);
    // Research results belong to the instrument and date that produced them,
    // exactly like the readings.
    this.engineIngest.set(null);
    this.engineParity.set(null);
    this.engineValidation.set(null);
    this.engineResearchError.set(null);
    this.drawMarketEngine();
  }

  /**
   * The body every research endpoint takes, built from the chart's own request.
   *
   * `null` without a request, because the research actions are about the
   * instrument and date on screen and there is nothing sensible to default to.
   */
  private researchRequest(): (MarketEngineResearchRequest & { date?: string }) | null {
    const request = this.request();
    if (!request) return null;
    return {
      instrument: request.instrument,
      date: request.date,
      chartSet: this.chartSet(),
      roundNumberStep: this.roundNumberStep(),
    };
  }

  /** Appends this instrument's engine events to the stored log. */
  protected storeEngineEvents(): void {
    const body = this.researchRequest();
    if (!body) return;
    this.runResearch(this.api.ingestEngineEvents(body), (result) => this.engineIngest.set(result));
  }

  /**
   * Replays the chart's session and diffs it against the stored log.
   *
   * Needs a date: parity is about one session. On a LIVE chart there is none on
   * the request, so today is used — the session actually being drawn.
   */
  protected checkEngineParity(): void {
    const body = this.researchRequest();
    if (!body) return;
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    this.runResearch(this.api.checkEngineParity({ ...body, date }), (result) =>
      this.engineParity.set(result),
    );
  }

  /** Forward behaviour of every label, over the longest window the backend allows. */
  protected runEngineValidation(): void {
    const body = this.researchRequest();
    if (!body) return;
    this.runResearch(this.api.validateEngine(body), (result) => this.engineValidation.set(result));
  }

  /** One busy flag and one error line for all three actions. */
  private runResearch<T>(source: Observable<T>, apply: (result: T) => void): void {
    this.engineResearchError.set(null);
    this.engineResearchBusy.set(true);
    source.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.engineResearchBusy.set(false);
        apply(result);
      },
      error: (e: ChartStreamError) => {
        this.engineResearchBusy.set(false);
        this.engineResearchError.set(describe(e));
      },
    });
  }

  /**
   * Puts the engine's protected levels on the chart and republishes the marks.
   *
   * Protected levels are lines rather than marks because the *price* is the
   * whole point of one — a mark cannot say a price — and there are at most
   * three, which stays legible. Everything else the engine says is a mark or
   * lives in the panel.
   */
  private drawMarketEngine(): void {
    const series = this.candles;
    if (!series) return;

    for (const line of this.engineLines) series.removePriceLine(line);
    this.engineLines = [];

    if (this.showMarketEngine()) {
      const latest = this.marketEngine()?.readings.at(-1) ?? null;
      for (const line of protectedLines(latest)) {
        this.engineLines.push(
          series.createPriceLine({
            price: line.price,
            color: fade(line.bullish ? THEME.up : THEME.down, 0.75),
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            lineVisible: true,
            axisLabelVisible: true,
            title: line.title,
            axisLabelColor: '',
            axisLabelTextColor: '',
          }),
        );
      }

      // Zone edges: thin, dotted and unlabelled on the axis, so they never
      // compete with the protected levels for the price scale.
      for (const edge of zoneLines(latest)) {
        this.engineLines.push(
          series.createPriceLine({
            price: edge.price,
            color: fade(edge.bullish ? THEME.up : THEME.down, edge.spent ? 0.25 : 0.5),
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            lineVisible: true,
            axisLabelVisible: false,
            title: edge.title,
            axisLabelColor: '',
            axisLabelTextColor: '',
          }),
        );
      }
    }

    // The engine shares the one marker plugin with trades and retests, so
    // either changing means re-publishing all three.
    this.drawMarkers();
  }

  /**
   * Shows or hides the trend. Turning it on fetches when nothing is held;
   * turning it off keeps the reading for an instant re-show, and stops asking.
   */
  toggleTrend(): void {
    const next = !this.showTrend();
    this.showTrend.set(next);
    this.drawTrend();
    if (next) this.refreshTrend({ force: !this.trend() });
  }

  /** The panel picked a timeframe to draw; picking the automatic one follows the chart again. */
  protected setTrendFocus(timeframe: TrendTimeframe): void {
    const automatic = chartTimeframe(
      this.displaySeconds(),
      this.trend()?.timeframes.map((t) => t.timeframe) ?? DEFAULT_TREND_TIMEFRAMES,
    );
    this.trendFocusChoice.set(timeframe === automatic ? null : timeframe);
    this.drawTrend();
  }

  /**
   * Asks the session for its trend — once per newly closed bar.
   *
   * The session endpoint, not the standalone one, because the session's clock
   * is what bounds the reading: a TEST replay part-way through a day is read as
   * of that moment. At most one request is out; bars that close meanwhile are
   * folded into a single follow-up, the same economy the candlestick overlay
   * uses, so a fast replay cannot starve it and a live chart asks once a minute.
   */
  private refreshTrend(options: { force?: boolean } = {}): void {
    if (!this.showTrend()) return;
    const sessionId = this.session()?.sessionId;
    if (!sessionId) return;

    const key = `${sessionId}|${this.buffer.size}`;
    if (!options.force && key === this.trendFetchedFor) return;
    if (this.trendRequest) {
      this.trendMoved = true;
      return;
    }

    this.trendFetchedFor = key;
    this.trendLoading.set(true);
    this.trendRequest = this.api
      .sessionTrend(sessionId, { timeframes: DEFAULT_TREND_TIMEFRAMES.join(',') })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.trendRequest = null;
          this.trendLoading.set(false);
          this.trend.set(result);
          this.trendError.set(null);
          this.drawTrend();
          this.trendFollowUp();
        },
        error: (e: ChartStreamError) => {
          this.trendRequest = null;
          this.trendLoading.set(false);
          // Its own line: no trend is a chart without an annotation, not a
          // chart whose bars are wrong.
          this.trendError.set(`Trend unavailable — ${describe(e)}`);
          this.trendFollowUp();
        },
      });
  }

  private trendFollowUp(): void {
    if (!this.trendMoved) return;
    this.trendMoved = false;
    this.refreshTrend();
  }

  /**
   * The focus timeframe's lines: its protected swing, a broken level while it
   * is transitioning, a range's edges, the nearest support and resistance,
   * and its trendline. Swings and events go through the shared marker plugin.
   */
  private drawTrend(): void {
    const series = this.candles;
    if (!series || !this.chart) return;

    for (const line of this.trendPriceLines) series.removePriceLine(line);
    this.trendPriceLines = [];

    const focus = this.showTrend() ? this.focusedTrend() : null;
    const knownAt = this.knownAtNow();
    for (const line of trendLines(focus, knownAt, this.trendDetail())) {
      this.trendPriceLines.push(
        series.createPriceLine({
          price: line.price,
          color: line.color,
          lineWidth: line.width,
          lineStyle:
            line.style === 'solid'
              ? LineStyle.Solid
              : line.style === 'dashed'
                ? LineStyle.Dashed
                : LineStyle.Dotted,
          lineVisible: true,
          axisLabelVisible: line.axisLabel,
          title: line.title,
          axisLabelColor: '',
          axisLabelTextColor: '',
        }),
      );
    }

    // Trendlines: one two-point series each, reused by id, so a line that is
    // still active only has its end moved as bars arrive.
    const segments = trendlineSegments(
      focus,
      this.displaySeconds(),
      knownAt,
      this.trendDetail(),
      this.chartAxis(),
    );
    const keep = new Set(segments.map((s) => s.id));
    this.trendDrawnLines = keep;
    for (const [id, line] of this.trendlineSeries) {
      if (keep.has(id)) continue;
      this.chart.removeSeries(line);
      this.trendlineSeries.delete(id);
    }
    for (const segment of segments) {
      const colour = segment.kind === 'RESISTANCE' ? THEME.down : THEME.up;
      const options = {
        color: fade(colour, segment.broken ? 0.55 : 0.9),
        lineWidth: 2 as const,
        lineStyle: segment.broken ? LineStyle.Dashed : LineStyle.Solid,
      };
      let line = this.trendlineSeries.get(segment.id);
      if (line) line.applyOptions(options);
      else {
        line = this.chart.addSeries(LineSeries, {
          ...options,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        this.trendlineSeries.set(segment.id, line);
      }
      line.setData(segment.points);
    }

    this.drawMarkers();
  }

  /** Bar positions of the drawn series, for lines drawn in bar space. */
  private chartAxis(): ChartAxis | null {
    const bars = this.drawn;
    const first = bars[0];
    const last = bars.at(-1);
    if (!first || !last) return null;
    return {
      firstSec: first.time as number,
      lastSec: last.time as number,
      indexOf: (sec: number) => {
        let lo = 0;
        let hi = bars.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (((bars[mid] as Bar).time as number) <= sec) lo = mid;
          else hi = mid - 1;
        }
        return lo;
      },
    };
  }

  /** Clean or detailed — only what is drawn changes, not what is fetched. */
  protected setTrendDetail(detail: TrendDetail): void {
    this.trendDetail.set(detail);
    this.drawTrend();
  }

  private clearTrend(): void {
    this.trendRequest?.unsubscribe();
    this.trendRequest = null;
    this.trendMoved = false;
    this.trendFetchedFor = null;
    this.trend.set(null);
    this.trendError.set(null);
    this.trendLoading.set(false);
    this.drawTrend();
  }

  /** See {@link trendKnownAt}. */
  private knownAtNow(): number | null {
    if (this.playbackUntilMs() === null) return null;
    const last = this.lastBarTime();
    return last === null ? null : (last + this.displaySeconds()) * 1000;
  }

  /** The trend events on the hovered bar, explained for the hover card. */
  readonly trendNotes = computed<MarkNote[]>(() => {
    const bar = this.hovered();
    if (!bar || !this.showTrend()) return [];
    return eventNotesAtBar(
      this.focusedTrend(),
      this.displaySeconds(),
      bar.time as number,
      this.trendKnownAt(),
    );
  });

  private applyRetests(result: ChartRetests): void {
    this.retests.set(result.retests);
    this.retestsInterval = result.interval;
    this.retestsError.set(null);
    this.drawRetests();
  }

  private clearRetests(): void {
    this.retests.set([]);
    this.retestsInterval = null;
    this.retestsError.set(null);
    this.drawRetests();
  }

  /**
   * Puts the current retests on the chart, replacing whatever was there.
   *
   * Nothing to tear down: retests are marks, not price lines, and the marker
   * plugin takes a whole replacement set. The tag row and the table carry the
   * detail a band used to try to carry on the price scale.
   */
  private drawRetests(): void {
    if (!this.candles) return;

    // Retests and trades share one marker plugin, so either changing means
    // re-publishing both.
    this.drawMarkers();
  }

  /**
   * Puts the current set on the chart, replacing whatever was there.
   *
   * Torn down and rebuilt rather than diffed: a `LEVELS` message is a complete
   * replacement (a level that stopped qualifying is simply absent from it), and
   * at most a dozen price lines the rebuild is cheaper than the bookkeeping a
   * diff would need to stay correct.
   */
  private drawLevels(): void {
    const series = this.candles;
    if (!series) return;

    for (const line of this.priceLines) series.removePriceLine(line);
    this.priceLines = [];
    if (!this.showLevels()) return;

    for (const level of this.levels()) {
      this.priceLines.push(series.createPriceLine(priceLineFor(level)));
    }
  }

  /**
   * Draws the entry, stop and target of every live paper position.
   *
   * Price lines rather than marks because a *level* is the whole point: a mark
   * can say "a stop is set" but cannot say where, and where is the only thing
   * worth drawing. They are torn down and rebuilt rather than diffed, like the
   * S/R lines and for the same reason — at most a handful of lines, the rebuild
   * is cheaper than the bookkeeping a correct diff would need.
   *
   * Only live positions contribute, so a chart does not accumulate the levels
   * of every trade of the day; the exit arrow is the record of a closed one.
   */
  private drawPaperLines(): void {
    const series = this.candles;
    if (!series) return;

    for (const line of this.paperLines) series.removePriceLine(line);
    this.paperLines = [];

    for (const spec of paperPriceLines(this.paperPositions())) {
      this.paperLines.push(
        series.createPriceLine({
          price: spec.price,
          color: spec.colour,
          lineWidth: spec.width,
          lineStyle: spec.dashed ? LineStyle.Dashed : LineStyle.Solid,
          lineVisible: true,
          axisLabelVisible: true,
          title: spec.title,
          axisLabelColor: '',
          axisLabelTextColor: '',
        }),
      );
    }
  }

  /** The paper lines currently on the chart, so they can be removed again. */
  private paperLines: IPriceLine[] = [];

  /**
   * Draws the simulation's entry and exit arrows.
   *
   * A whole replacement set every time, like the levels: the run publishes its
   * complete trade list on every frame, and a chart that tried to append would
   * duplicate every mark the first time a socket reconnected.
   */
  private drawMarkers(): void {
    if (!this.markers) return;
    this.markersClippedAt = this.firstBarTime();
    this.markers.setMarkers(this.chartMarkers());
  }

  /** The left edge {@link drawMarkers} last clipped at — see {@link withinSeries}. */
  private markersClippedAt: number | null = null;

  /** The previous replay cursor, to tell a growing series from a rewound one. */
  private lastCursor: number | null = null;

  private firstBarTime(): number | null {
    return (this.drawn[0]?.time as number | undefined) ?? null;
  }

  /** The newest bar on screen — the replay's right edge. */
  private lastBarTime(): number | null {
    return (this.drawn.at(-1)?.time as number | undefined) ?? null;
  }

  /**
   * Every mark that belongs on the chart right now, from both sources.
   *
   * Separate from {@link drawMarkers} so that *what* is published is readable
   * without a canvas: the plugin holds one list and `setMarkers` replaces it,
   * so publishing either source alone would erase the other, and that is worth
   * being able to assert rather than infer.
   */
  chartMarkers(): SeriesMarker<UTCTimestamp>[] {
    const seconds = this.displaySeconds();
    const retests = this.showRetests() ? retestMarkers(this.retests(), seconds) : [];
    const engine =
      this.showMarketEngine() && this.marketEngine()
        ? marketStateMarkers(this.marketEngine()?.readings ?? [], seconds)
        : [];
    // Clipped to the drawn bars: a mark with no bar of its own is pinned to the
    // nearest one by the chart, which stacked ten days of engine history on the
    // first candle.
    return withinSeries(
      mergeMarkers(
        markersFor(this.trades(), seconds),
        // The paper book's own entries and exits. A fourth source rather than
        // a merge with `trades`: the two describe different books, and a user
        // running both must be able to tell which arrow was theirs.
        paperMarkers(this.paperPositions(), seconds),
        retests,
        engine,
        this.levelRejectionMarks(),
        this.showTrend()
          ? trendMarkers(
              this.focusedTrend(),
              this.displaySeconds(),
              this.knownAtNow(),
              this.trendDetail(),
              this.trendDrawnLines,
            )
          : [],
      ),
      this.firstBarTime(),
      // Only while replaying. On a normal chart the newest drawn bar is the
      // newest bar there is, so a right edge would clip nothing and cost a
      // comparison per mark per redraw.
      this.playbackUntilMs() === null ? null : this.lastBarTime(),
    );
  }

  /**
   * The engine marks on the hovered bar, explained — what the hover card adds
   * beneath the prices. Empty when the engine is off or the bar carries no mark.
   */
  readonly engineNotes = computed<MarkNote[]>(() => {
    const bar = this.hovered();
    const engine = this.marketEngine();
    if (!bar || !engine || !this.showMarketEngine()) return [];
    return marksAtBar(engine.readings, this.displaySeconds(), bar.time as number).map(explainMark);
  });

  /** The backend's name for the bar size on screen. */
  private intervalName(): ChartInterval {
    return intervalNameFor(this.displaySeconds());
  }

  /** The short form the S/R bar shows — `5m`, `1D`. */
  private intervalLabel(): string {
    return (
      DISPLAY_INTERVALS.find((i) => i.seconds === this.displaySeconds())?.label ??
      `${this.displaySeconds()}s`
    );
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
    // The replay cursor, applied to the resampled series rather than to the
    // buffer, so switching timeframe mid-replay re-buckets what is on screen
    // and stops at the same instant instead of at the same bar *count*.
    const until = this.playbackUntilMs();
    if (until !== null) {
      const cutoff = Math.floor(until / 1000);
      this.drawn = this.drawn.filter((bar) => (bar.time as number) <= cutoff);
    }
    this.drawnByTime = new Map(this.drawn.map((bar) => [bar.time as number, bar]));
    // Marks are clipped to the first drawn bar, so a series whose left edge
    // moved — the backlog arriving after the marks, or a longer history — has
    // to republish them or the clip is taken against the old edge.
    if (this.firstBarTime() !== this.markersClippedAt) this.drawMarkers();

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

    // After the bars, never before: detection reads exactly the series that
    // was just drawn, so an overlay can never describe bars that are not on
    // screen. Redraws are already batched to a microtask, so a replay that
    // delivers a whole day in one burst detects once rather than per bar.
    this.refreshPatterns();
    this.refreshCandlePatterns();
    this.drawEmas();
    this.drawVwap();
    this.drawPreviousDayRange();
    // Its marks stop at the newest drawn bar, so a replay that grows must
    // re-publish them or the entry it has just reached stays hidden.
    if (this.showLevelRejection()) this.drawLevelRejection();
    // Re-bucketed to the bars just drawn, clipped to a replay's cursor, and
    // re-asked once per newly closed bar.
    if (this.showTrend()) {
      this.drawTrend();
      this.refreshTrend();
    }
  }

  /**
   * Asks the backend about the drawn series, when there is a new question.
   *
   * The gate is {@link CandlePatternSync.shouldRequest} rather than a
   * bar-closed check, and the difference matters: this is a *network* call, so
   * the thing to avoid is not merely wasted CPU but a request per tick. The
   * key covers the instrument, the bar size, the window and the tuning, so a
   * redraw that changes none of them asks nothing.
   *
   * Works the same in both session modes, which is the whole reason the
   * endpoint takes bars rather than an instrument. A `TEST` replay sends the
   * bars it has reached and is annotated up to there; a `LIVE` chart sends its
   * closed bars and is annotated up to the last one. Neither can be told
   * about a bar it is not showing.
   */
  private refreshCandlePatterns(): void {
    if (!this.showCandlePatterns()) return;

    // A request is already out. Note that the series has moved and ask again
    // when it lands, rather than cancelling it.
    //
    // Cancelling was the original design, on the reasoning that two answers
    // landing out of order would leave the older one on screen. It starved:
    // every closed bar is a new question, so on a live chart or a paced replay
    // the next bar reliably arrives before the answer does, each arrival
    // cancelled the request before it landed, and the overlay stayed empty for
    // the whole session — the toggle looked broken because in effect it was.
    // Letting one request finish and coalescing everything that happened
    // meanwhile into a single follow-up keeps the ordering guarantee and
    // actually terminates.
    if (this.candleRequest) {
      this.candleSeriesMoved = true;
      return;
    }

    const bars = CandlePatternSync.closedBars(this.drawn, this.candleTuning.windowBars);
    if (bars.length === 0) {
      this.applyCandlePatterns([]);
      return;
    }

    const key = CandlePatternSync.key({
      seriesKey: this.session()?.instrumentKey ?? 'unknown',
      interval: this.intervalName(),
      bars,
      tuning: tuningKey(this.candleTuning),
    });
    if (!this.candleSync.shouldRequest(key)) return;

    this.candlePatternsLoading.set(true);

    this.candleRequest = this.candleApi
      .detect({
        interval: this.intervalName(),
        bars: CandlePatternSync.toWire(bars),
        confirmationBars: this.candleTuning.confirmationBars,
        extremeLookback: this.candleTuning.extremeLookback,
        minConfidence: this.candleTuning.minConfidence,
        patterns: [...this.candleTuning.patterns],
        maxHits: this.candleTuning.maxHits,
        // Lets the backend warm the trend and ATR up from the bars before the
        // first one on screen; without it the first couple of hours of a chart
        // opened with no history score too low to be drawn.
        instrument: this.request()?.instrument,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.candleRequest = undefined;
          this.candlePatternsLoading.set(false);
          this.candlePatternsError.set(null);
          this.candlePatternsRan.set(true);
          // Dropped if the user switched the overlay off while this was in
          // flight, so a late answer cannot redraw boxes they just hid.
          if (this.showCandlePatterns()) {
            this.candleLabels.set(response.labels);
            this.candleBarsAnalysed.set(response.barsAnalysed);
            this.applyCandlePatterns(withLabels(response.hits, response.labels));
          }
          this.askAgainIfSeriesMoved();
        },
        error: (error: ChartStreamError) => {
          this.candleRequest = undefined;
          this.candlePatternsLoading.set(false);
          // A degraded chart, not a broken one — the bars are already drawn.
          // The key is cleared so the next closed bar retries rather than the
          // overlay staying silently empty for the rest of the session.
          this.candlePatternsError.set(error.message);
          this.candlePatternsRan.set(true);
          this.candleSync.reset();
          this.askAgainIfSeriesMoved();
        },
      });
  }

  /**
   * Re-asks once for everything that arrived while a request was out.
   *
   * Once, not once per bar: the bars that closed in the meantime are already
   * in the series, so a single pass over the current window describes all of
   * them. The flag is cleared before the call so a request that fails
   * immediately cannot leave it set and spin.
   */
  private askAgainIfSeriesMoved(): void {
    if (!this.candleSeriesMoved) return;
    this.candleSeriesMoved = false;
    this.refreshCandlePatterns();
  }

  /** Syncs the overlay to a result, touching only what changed. */
  private applyCandlePatterns(hits: readonly RenderedCandlePattern[]): void {
    const { changed, removedIds } = this.candleSync.diff(hits);
    for (const id of removedIds) this.candleOverlay.remove(id);
    for (const hit of changed) this.candleOverlay.upsert(hit);
    this.candlePatterns.set([...hits]);
  }

  /**
   * Re-runs detection over the drawn series and syncs the overlay.
   *
   * Diffed by id rather than republished wholesale, which is what keeps the
   * overlay steady: a pattern that survived the pass is only repainted if
   * something about it actually changed.
   */
  private refreshPatterns(options: { force?: boolean } = {}): void {
    // Never per tick. A redraw happens on every candle event, including the
    // repeated rewrites of the bar still forming; only the appearance of a
    // *closed* bar is worth a scan. `force` is for the cases where the
    // series itself changed underneath us — a new timeframe, or the toggle
    // being switched back on — where the last closed bar is unchanged but
    // the answer is not.
    if (!options.force && !this.tracker.hasBarClosed(this.drawn)) return;

    const scanned = this.tracker.barsToScan(this.drawn, defaultPatternConfig.liveWindowBars);
    const { patterns } = detectPatterns(scanned);
    const { added, updated, removedIds } = this.tracker.diff(patterns);

    for (const id of removedIds) this.overlay.remove(id);
    for (const pattern of added) this.overlay.upsert(pattern);
    for (const pattern of updated) this.overlay.upsert(pattern);

    this.patterns.set(patterns);
    if (this.findingsOpen() && this.findingsTab() === 'timeframes') {
      this.refreshTimeframeTable();
    }
  }

  /**
   * The same series read at every bar size.
   *
   * Only while the table is open. Six extra passes are cheap — the buffer
   * resamples data already in memory — but they are not free, and a panel
   * nobody has expanded should not cost anything at all.
   */
  private refreshTimeframeTable(): void {
    this.timeframeRows.set(scanTimeframes((seconds) => this.buffer.resampled(seconds)));
  }

  /** The pattern’s display name, without the direction and status. */
  protected nameOf(pattern: DetectedPattern): string {
    return PATTERN_NAMES[pattern.type];
  }

  /* --- indicators ---------------------------------------------------- */

  protected toggleOverlayMenu(): void {
    this.showIndicators.set(false);
    this.showOverlays.update((open) => !open);
  }

  protected toggleIndicatorMenu(): void {
    this.showOverlays.set(false);
    this.showIndicators.update((open) => !open);
  }

  /**
   * What the candlestick overlay reports, in one short token.
   *
   * Four states an unmarked chart cannot tell apart on its own, which is the
   * failure this exists to end: a reader who switches the overlay on and sees
   * no boxes has no way to know whether the request is still out, came back
   * empty, or failed outright. `null` only while the overlay is off, when the
   * absence of boxes explains itself.
   */
  protected readonly candleBadge = computed<string | null>(() => {
    if (!this.showCandlePatterns()) return null;
    if (this.candlePatternsError()) return '!';
    if (this.candlePatternsLoading()) return '…';
    const found = this.candlePatterns().length;
    if (found > 0) return String(found);
    // Ran and found nothing. A real answer, and a different one from silence.
    return this.candlePatternsRan() ? '0' : '…';
  });

  /**
   * The one-line summary drawn above the chart while the overlay is on.
   *
   * Every other overlay already has one — S/R prints the nearest level either
   * side, the previous day's range prints its three prices — and the
   * candlesticks not having one is what made this feature fail silently. An
   * empty chart looked the same whether the overlay was still fetching, had
   * found nothing above the floor, or had never run at all, and the only way
   * to tell was to open a menu.
   *
   * The important case is `found: 0`. That is a real answer about a quiet
   * stretch of chart, and it has to read as one. Saying which floor nothing
   * cleared, and over how many bars, is what makes it actionable rather than
   * merely reassuring.
   *
   * `null` while the overlay is off, when an unmarked chart explains itself,
   * and on failure, which the error banner states more plainly.
   */
  protected readonly candleBand = computed(() => {
    if (!this.showCandlePatterns()) return null;
    if (this.candlePatternsError()) return null;

    const hits = this.candlePatterns();
    return {
      loading: this.candlePatternsLoading() || !this.candlePatternsRan(),
      found: hits.length,
      bullish: hits.filter((hit) => hit.reversalBias === 'BULLISH').length,
      bearish: hits.filter((hit) => hit.reversalBias === 'BEARISH').length,
      floor: this.candleTuning.minConfidence,
      bars: this.candleBarsAnalysed(),
    };
  });

  /** The whole story behind {@link candleBadge}, for the control's tooltip. */
  protected readonly candleStatus = computed(() => {
    const error = this.candlePatternsError();
    if (error) return `Candlesticks failed: ${error}`;
    if (!this.showCandlePatterns()) return 'Candlestick patterns — off';
    if (this.candlePatternsLoading() || !this.candlePatternsRan()) {
      return 'Candlesticks — reading the bars on screen';
    }
    const found = this.candlePatterns().length;
    return found > 0
      ? `${found} candlestick patterns on the bars on screen`
      : `No candlestick pattern reached ${this.candleTuning.minConfidence} on these bars`;
  });

  /**
   * How many things are currently drawn over the price.
   *
   * Everything the menu can switch on counts the same, because from the
   * reader's side they are the same kind of thing: a mark on the chart that
   * was not there before. The badge is what replaces six buttons each showing
   * their own state.
   */
  protected readonly overlayCount = computed(
    () =>
      (this.showLevels() ? 1 : 0) +
      (this.showRetests() ? 1 : 0) +
      (this.showMarketEngine() ? 1 : 0) +
      (this.showPreviousDayRange() ? 1 : 0) +
      (this.showLevelRejection() ? 1 : 0) +
      (this.showTrend() ? 1 : 0) +
      (this.showPatterns() ? 1 : 0) +
      (this.showCandlePatterns() ? 1 : 0),
  );

  /** How many indicators (EMAs, VWAP) are currently drawn — the Indicators
   *  button's own badge, separate from {@link overlayCount}. */
  protected readonly indicatorCount = computed(
    () => this.selectedEmas().length + (this.showVwap() ? 1 : 0),
  );

  /** Whether anything behind the menu is still fetching. */
  protected readonly overlaysBusy = computed(
    () =>
      this.levelsLoading() ||
      this.retestsLoading() ||
      this.marketEngineLoading() ||
      this.pdrLoading() ||
      this.levelRejectionLoading() ||
      this.trendLoading() ||
      this.candlePatternsLoading(),
  );

  /**
   * Switches everything off.
   *
   * Each toggle is called rather than each signal set, because turning an
   * overlay off is not only a flag: the line series are created and destroyed
   * so an overlay that is off costs nothing, and the pattern overlays have an
   * in-flight request to drop.
   */
  protected clearOverlays(): void {
    if (this.showLevels()) this.toggleLevels();
    if (this.showRetests()) this.toggleRetests();
    if (this.showMarketEngine()) this.toggleMarketEngine();
    if (this.showPreviousDayRange()) this.togglePreviousDayRange();
    if (this.showLevelRejection()) this.toggleLevelRejection();
    if (this.showTrend()) this.toggleTrend();
    if (this.showPatterns()) this.togglePatterns();
    if (this.showCandlePatterns()) this.toggleCandlePatterns();
  }

  /* --- the findings panel -------------------------------------------- */

  protected toggleFindings(): void {
    this.findingsOpen.update((open) => !open);
    // The timeframe table costs six extra detection passes, so it is only
    // computed while its own tab is the one on screen.
    if (this.findingsOpen() && this.findingsTab() === 'timeframes') {
      this.refreshTimeframeTable();
    }
  }

  protected showFindingsTab(tab: FindingsTab): void {
    this.findingsTab.set(tab);
    if (tab === 'timeframes') this.refreshTimeframeTable();
  }

  /**
   * The one line of summary on the collapsed panel.
   *
   * An error wins over a count: a reader who sees "12 candlesticks" has no way
   * to know the number is stale because the last request failed.
   */
  protected readonly findingsHint = computed(() => {
    const error = this.candlePatternsError();
    if (error) return error;
    const candles = this.candlePatterns().length;
    const shapes = this.patterns().length;
    if (!this.showCandlePatterns()) return `${shapes} chart shapes`;
    return `${candles} candlesticks · ${shapes} chart shapes`;
  });

  protected isEmaOn(period: number): boolean {
    return this.selectedEmas().includes(period);
  }

  /**
   * Adds or removes one average.
   *
   * The series is created and destroyed rather than hidden, so an unchecked
   * average costs nothing — no data held, no line in the price scale’s
   * autoscale, and no stale points to redraw when the timeframe changes.
   */
  protected toggleEma(period: number): void {
    const on = this.isEmaOn(period);
    this.selectedEmas.update((current) =>
      on ? current.filter((n) => n !== period) : [...current, period].sort((a, b) => a - b),
    );
    if (on) this.removeEmaSeries(period);
    else {
      this.addEmaSeries(period);
      this.drawEmas();
    }
    this.rememberEmas();
  }

  protected readonly vwapColor = VWAP_COLOR;

  /**
   * Shows or hides the session VWAP.
   *
   * The series is created and destroyed rather than hidden, for the same
   * reason the averages are: an indicator that is off holds no data and takes
   * no part in the price scale's autoscale.
   */
  protected toggleVwap(): void {
    const next = !this.showVwap();
    this.showVwap.set(next);
    if (next) {
      this.addVwapSeries();
      this.drawVwap();
    } else this.removeVwapSeries();
    this.prefs.set(PREF.showVwap, next);
  }

  protected clearIndicators(): void {
    this.clearEmas();
    if (this.showVwap()) this.toggleVwap();
  }

  protected clearEmas(): void {
    for (const period of this.selectedEmas()) this.removeEmaSeries(period);
    this.selectedEmas.set([]);
    this.rememberEmas();
  }

  private rememberEmas(): void {
    this.prefs.set(PREF.emaPeriods, this.selectedEmas());
  }

  private addEmaSeries(period: number): void {
    if (!this.chart || this.emaSeries.has(period)) return;
    const series = this.chart.addSeries(LineSeries, {
      color: emaColor(period),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      // Out of the crosshair’s way: the readout above the chart already
      // names the bar, and six averages each claiming a price-scale tag
      // would bury the price itself.
      crosshairMarkerVisible: false,
    });
    this.emaSeries.set(period, series);
  }

  private removeEmaSeries(period: number): void {
    const series = this.emaSeries.get(period);
    if (!series) return;
    this.chart?.removeSeries(series);
    this.emaSeries.delete(period);
  }

  /**
   * Recomputes every drawn average from the bars on screen.
   *
   * From `drawn`, which is the resampled series, so an average follows the
   * timeframe: a 21-period EMA on a five-minute chart is twenty-one
   * five-minute bars, which is what a reader means by it. Deriving it from
   * the one-minute buffer instead would draw a line nobody asked for.
   */
  private drawEmas(): void {
    if (!this.emaSeries.size) return;
    for (const [period, series] of this.emaSeries) {
      series.setData(
        ema(this.drawn, period).map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        })),
      );
    }
  }

  private addVwapSeries(): void {
    if (!this.chart || this.vwapSeries) return;
    this.vwapSeries = this.chart.addSeries(LineSeries, {
      color: VWAP_COLOR,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
  }

  private removeVwapSeries(): void {
    if (!this.vwapSeries) return;
    this.chart?.removeSeries(this.vwapSeries);
    this.vwapSeries = undefined;
  }

  /**
   * Redraws the VWAP from the bars on screen.
   *
   * Unlike the averages this is not a calculation. Every bar already carries
   * the backend's own cumulative figure and this only lifts it onto a line.
   * An instrument that reports no volume publishes no VWAP, so the line comes
   * out empty rather than flat — see `chart-indicators/vwap.ts`.
   */
  private drawVwap(): void {
    if (!this.vwapSeries) return;
    this.vwapSeries.setData(
      vwapLine(this.drawn).map((point) => ({
        time: point.time as UTCTimestamp,
        value: point.value,
      })),
    );
  }

  /* --- previous day range -------------------------------------------- */

  /**
   * Shows or hides PDH/PDL/mid.
   *
   * Turning it on fetches only when what is held does not belong to the
   * instrument and date on screen; otherwise it redraws what is already there,
   * so toggling twice costs one request rather than two. The values cannot go
   * stale within a session — they come from days that have closed — so there
   * is no refresh, on a timer or otherwise.
   */
  /**
   * Turns the level rejection overlay on or off.
   *
   * On, it fetches only when nothing is held — toggling twice costs one
   * request — over the days the chart is showing. Off, it keeps the result for
   * an instant re-show, like the market engine.
   */
  toggleLevelRejection(): void {
    const next = !this.showLevelRejection();
    this.showLevelRejection.set(next);
    if (next && !this.levelRejection() && !this.levelRejectionLoading()) {
      this.fetchLevelRejection();
    }
    this.drawLevelRejection();
  }

  /** Asks for the levels and setups over the days the chart is showing, on the default rules. */
  private fetchLevelRejection(): void {
    const request = this.request();
    const window = this.chartWindow();
    if (!request || !window) return;
    this.levelRejectionError.set(null);
    this.levelRejectionLoading.set(true);
    this.api
      .levelRejection({
        instrument: request.instrument,
        from: window.from,
        to: window.to,
        includeComparison: false,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.levelRejectionLoading.set(false);
          this.levelRejection.set(result);
          this.drawLevelRejection();
        },
        error: (e: ChartStreamError) => {
          this.levelRejectionLoading.set(false);
          this.levelRejectionError.set(`Level rejection unavailable — ${describe(e)}`);
        },
      });
  }

  /**
   * The trading days the chart is showing: its first drawn bar's date to its
   * last, or the request's date (today, live) when nothing is drawn yet.
   */
  private chartWindow(): { from: string; to: string } | null {
    const request = this.request();
    if (!request) return null;
    const first = this.drawn[0]?.time as number | undefined;
    const last = this.drawn.at(-1)?.time as number | undefined;
    const fallback = request.date ?? istDateKey(Math.floor(Date.now() / 1000));
    return {
      from: first === undefined ? fallback : istDateKey(first),
      to: last === undefined ? fallback : istDateKey(last),
    };
  }

  private clearLevelRejection(): void {
    this.levelRejection.set(null);
    this.levelRejectionError.set(null);
    this.drawLevelRejection();
  }

  /** The levels of the day on screen as price lines, and the marks republished. */
  private drawLevelRejection(): void {
    const series = this.candles;
    if (!series) return;

    for (const line of this.levelRejectionLines) series.removePriceLine(line);
    this.levelRejectionLines = [];

    const result = this.levelRejection();
    if (this.showLevelRejection() && result) {
      const last = this.drawn.at(-1)?.time as number | undefined;
      for (const line of levelLinesAt(result.result.days, last ?? null)) {
        this.levelRejectionLines.push(
          series.createPriceLine({
            price: line.price,
            color: fade(line.color, 0.8),
            lineWidth: 1,
            lineStyle: LineStyle.LargeDashed,
            lineVisible: true,
            axisLabelVisible: true,
            title: line.title,
            axisLabelColor: '',
            axisLabelTextColor: '',
          }),
        );
      }
    }
    this.drawMarkers();
  }

  /** Marks for every setup, stopping at the close of the newest drawn bar. */
  private levelRejectionMarks(): SeriesMarker<UTCTimestamp>[] {
    const result = this.levelRejection();
    const last = this.drawn.at(-1)?.time as number | undefined;
    if (!this.showLevelRejection() || !result || last === undefined) return [];
    const seconds = this.displaySeconds();
    return levelRejectionMarkers(result.result.setups, seconds, (last + seconds) * 1000);
  }

  togglePreviousDayRange(): void {
    const next = !this.showPreviousDayRange();
    this.showPreviousDayRange.set(next);

    if (!next) {
      this.removePdrSeries();
      return;
    }

    this.addPdrSeries();
    if (this.pdrFetchedFor === this.pdrKey()) this.drawPreviousDayRange();
    else this.fetchPreviousDayRange();
  }

  /**
   * What a held set of ranges belongs to.
   *
   * The date is part of it, not only the instrument: the same option replayed
   * on two different days has two different previous days, and a key that
   * ignored the date would reuse the first day's levels on the second.
   */
  private pdrKey(): string | null {
    const request = this.request();
    if (!request) return null;
    const { type, underlying, strike, expiry } = request.instrument;
    return [type, underlying, strike ?? '', expiry ?? '', request.date ?? 'live'].join('|');
  }

  /**
   * Asks the backend for one range per trading day this chart can show.
   *
   * `historyDays + 1` because the session's own day needs a range too, and the
   * prior days drawn behind it each need their own — a multi-day chart where
   * only the newest session is annotated is the bug this argument exists to
   * avoid.
   */
  private fetchPreviousDayRange(): void {
    const request = this.request();
    const key = this.pdrKey();
    if (!request || key === null) return;

    this.pdrError.set(null);
    this.pdrLoading.set(true);
    this.api
      .previousDayRange({
        instrument: request.instrument,
        // Omitted for LIVE, where the backend's "today" is the right anchor
        // and the browser's clock is not necessarily the exchange's.
        ...(request.date === undefined ? {} : { date: request.date }),
        lookbackDays: (request.historyDays ?? 0) + 1,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.pdrLoading.set(false);
          this.pdrFetchedFor = key;
          this.previousDayRanges.set(result.ranges);
          this.drawPreviousDayRange();
        },
        error: (e: ChartStreamError) => {
          this.pdrLoading.set(false);
          // Its own line rather than `error`: no previous-day lines is a
          // chart without an annotation, not a chart that is wrong about
          // its bars. No fallback is attempted — the only other source
          // available aggregates intraday bars, and on an option that
          // disagrees with the exchange daily candle by far more than a
          // tick.
          this.pdrError.set(`Previous day range unavailable — ${describe(e)}`);
        },
      });
  }

  private addPdrSeries(): void {
    if (!this.chart) return;
    for (const line of PDR_LINES) {
      if (this.pdrSeries.has(line)) continue;
      const style = PDR_STYLE[line];
      this.pdrSeries.set(
        line,
        this.chart.addSeries(LineSeries, {
          color: PDR_COLOR,
          lineWidth: style.width,
          lineStyle: style.dashed ? LineStyle.Dashed : LineStyle.Solid,
          // Flat across each day, vertical at the boundary — see the module.
          lineType: PDR_LINE_TYPE,
          // The label the requirement asks for: the title rides on the price
          // scale beside the value, so the line reads "PDH 22,450.00" against
          // the axis rather than needing a legend.
          title: style.title,
          lastValueVisible: true,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        }),
      );
    }
  }

  private removePdrSeries(): void {
    for (const series of this.pdrSeries.values()) this.chart?.removeSeries(series);
    this.pdrSeries.clear();
  }

  /**
   * Redraws the three lines over the bars on screen.
   *
   * Re-derived from `drawn` on every redraw rather than set once, because the
   * *placement* follows the bars even though the values do not: changing the
   * display interval re-buckets the x axis, and a series still holding
   * one-minute times would draw its levels against bars that are no longer
   * there.
   */
  private drawPreviousDayRange(): void {
    if (!this.pdrSeries.size) return;
    const lines = previousDayRangeLines(this.drawn, this.previousDayRanges());
    for (const [line, series] of this.pdrSeries) {
      series.setData(
        lines[line].map((point) => ({
          time: point.time as UTCTimestamp,
          ...(point.value === undefined ? {} : { value: point.value }),
        })),
      );
    }
  }

  private clearPreviousDayRange(): void {
    this.previousDayRanges.set([]);
    this.pdrFetchedFor = null;
    this.pdrError.set(null);
    this.pdrLoading.set(false);
    this.drawPreviousDayRange();
  }

  /** Shows or hides the overlay, and remembers which. */
  togglePatterns(): void {
    const next = !this.showPatterns();
    this.showPatterns.set(next);
    this.overlay.setVisible(next);
    this.prefs.set(PREF.showPatterns, next);
  }

  private clearPatterns(): void {
    this.overlay.clear();
    this.tracker.reset();
    this.patterns.set([]);
    this.timeframeRows.set([]);
  }

  /**
   * Turns the candlestick overlay on or off.
   *
   * Switching it on redraws what is already held if the series has not moved,
   * and otherwise asks — the same read-through the PDR toggle uses, and for
   * the same reason: a user toggling to compare should not pay for a request
   * each time.
   *
   * The boxes are hidden rather than discarded when it goes off, so switching
   * back is instant and costs nothing.
   */
  toggleCandlePatterns(): void {
    const next = !this.showCandlePatterns();
    this.showCandlePatterns.set(next);
    this.candleOverlay.setVisible(next);
    this.prefs.set(PREF.showCandlePatterns, next);

    if (next) {
      this.candlePatternsError.set(null);
      this.refreshCandlePatterns();
      return;
    }
    // Nothing in flight is worth finishing for an overlay nobody is looking
    // at, and a paced replay can leave a request outstanding for a while.
    this.candleRequest?.unsubscribe();
    this.candleRequest = undefined;
    this.candleSeriesMoved = false;
    this.candlePatternsLoading.set(false);
  }

  /**
   * Drops every box and forgets the last question.
   *
   * Both halves matter when the panel moves to another session. The boxes
   * belong to the series that produced them, and the remembered key would
   * suppress the first request for the new series if the old one happened to
   * match — two instruments charted on the same day share every bar time.
   */
  private clearCandlePatterns(): void {
    this.candleRequest?.unsubscribe();
    this.candleRequest = undefined;
    this.candleSeriesMoved = false;
    this.candleOverlay.clear();
    this.candleSync.reset();
    this.candlePatterns.set([]);
    this.candleLabels.set({});
    this.candlePatternsRan.set(false);
    this.candleBarsAnalysed.set(0);
    this.candlePatternsLoading.set(false);
    this.candlePatternsError.set(null);
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
    // never covers the bar it is describing. A card explaining an engine mark
    // is wider and taller, so it flips sooner and is pinned to the top of the
    // chart, where it has the most room to grow down.
    const width = this.chartHost().nativeElement.clientWidth;
    const explained = this.engineNotes().length > 0 || this.trendNotes().length > 0;
    const cardWidth = explained ? 300 : 156;
    const flip = point.x > width - cardWidth - 14;
    this.tooltipAt.set({
      x: flip ? Math.max(8, point.x - cardWidth - 16) : point.x + 16,
      y: explained ? 8 : Math.max(8, point.y - 12),
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
        vertLine: {
          color: THEME.crosshair,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#243444',
        },
        horzLine: {
          color: THEME.crosshair,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#243444',
        },
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
