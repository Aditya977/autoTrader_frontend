import { Component, computed, input, output } from '@angular/core';
import { TipDirective } from '../shared/tip.directive';
import {
  BREAK_LABELS,
  COMPONENT_LABELS,
  DIRECTION_LABELS,
  PHASE_HELP,
  PHASE_LABELS,
  RANGE_EVIDENCE_LABELS,
  WEAKENING_LABELS,
  latestKnown,
  readingAt,
  type TrendDetail,
} from './trend-overlay';
import type {
  CompactReading,
  TimeframeTrend,
  TrendDirection,
  TrendResult,
  TrendTimeframe,
} from './trend.models';

interface Row {
  timeframe: TrendTimeframe;
  reading: CompactReading | null;
  bars: number;
}

/**
 * Every timeframe's trend at a glance, then the focus timeframe in detail.
 *
 * Read top to bottom the way the spec reads a market: each timeframe on its
 * own line, because a bearish 5m move inside a bullish 4h trend is two facts,
 * not a contradiction to be averaged away. Clicking a row makes it the
 * timeframe drawn on the chart.
 *
 * During a replay every row shows the reading as of the bar on screen; the
 * detail block, which comes from the newest reading only, waits until the
 * replay reaches it rather than show the future.
 */
@Component({
  selector: 'app-trend-panel',
  standalone: true,
  imports: [TipDirective],
  template: `
    @if (result(); as trend) {
      <section class="trend" aria-label="Trend reading">
        <header>
          <strong>Trend</strong>
          <span class="muted">
            chart shows {{ focus() }} structure{{
              automatic() ? ' (one step up from the candles)' : ''
            }}
            · click a row to draw another
          </span>
          <span class="modes" role="group" aria-label="Chart detail">
            @for (mode of modes; track mode.value) {
              <button
                type="button"
                [class.on]="detail() === mode.value"
                [attr.aria-pressed]="detail() === mode.value"
                [appTip]="mode.hint"
                (click)="detailChange.emit(mode.value)"
              >
                {{ mode.label }}
              </button>
            }
          </span>
        </header>

        <table>
          <thead>
            <tr>
              <th>TF</th>
              <th>Direction</th>
              <th>Phase</th>
              <th
                appTip="How strongly price is behaving like a trend, 0–100. Separate from direction."
              >
                Strength
              </th>
              <th appTip="All evidence combined, −100 (bearish) to +100 (bullish).">Score</th>
              <th appTip="Newest swing-high label, then newest swing-low label.">Structure</th>
              <th>Break</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.timeframe) {
              <tr
                [class.focus]="row.timeframe === focus()"
                (click)="focusChange.emit(row.timeframe)"
              >
                <td class="tf">{{ row.timeframe }}</td>
                @if (row.reading; as r) {
                  <td [class]="dirClass(r.direction)">{{ directionLabels[r.direction] }}</td>
                  <td [appTip]="phaseHelp[r.phase]">{{ phaseLabels[r.phase] }}</td>
                  <td>
                    <span class="bar"><span [style.width.%]="r.strength"></span></span>
                    <span class="num">{{ r.strength }}</span>
                  </td>
                  <td class="num" [class.up]="r.trendScore > 0" [class.down]="r.trendScore < 0">
                    {{ r.trendScore > 0 ? '+' : '' }}{{ r.trendScore }}
                  </td>
                  <td class="mono">{{ r.structure }}</td>
                  <td [class.warn]="r.breakState !== 'NONE'">{{ breakLabels[r.breakState] }}</td>
                } @else {
                  <td class="muted" colspan="6">
                    {{ row.bars === 0 ? 'no closed bars yet' : 'not enough structure yet' }}
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>

        @if (focusLatest(); as d) {
          <div class="detail">
            <div class="title">
              <b>{{ d.timeframe }}</b>
              <span [class]="dirClass(d.direction)">{{ directionLabels[d.direction] }}</span>
              <span>{{ phaseLabels[d.phase] }}</span>
              @if (d.protectedLevel !== null) {
                <span
                  class="tag"
                  appTip="A close through this swing breaks the trend on this timeframe."
                >
                  protected {{ d.protectedLevel }}
                </span>
              }
              @if (d.htf.alignment !== null) {
                <span
                  class="tag"
                  [class.up]="d.htf.alignment > 0.2"
                  [class.down]="d.htf.alignment < -0.2"
                  appTip="Higher timeframes' directions, the higher ones weighted more: −1 all bearish, +1 all bullish."
                >
                  HTF {{ d.htf.alignment > 0 ? '+' : '' }}{{ d.htf.alignment }}
                </span>
              }
            </div>

            @if (d.transition; as t) {
              <p class="warn">
                {{ t.from === 'BULLISH' ? 'Higher low' : 'Lower high' }} {{ t.brokenLevel }} broken
                {{ t.barsSinceBreak }} bar(s) ago · went {{ t.maxBeyondAtr }} ATR beyond · retest
                {{ t.retest === 'REJECTED' ? 'rejected' : 'not yet' }} ·
                {{
                  t.oppositeSwing === null
                    ? 'no opposite swing yet'
                    : 'opposite swing ' + t.oppositeSwing
                }}
                · break quality {{ pct(t.breakQuality) }}
              </p>
            }

            @if (d.weakening.length) {
              <p>
                <span class="label">Weakening</span>
                @for (w of d.weakening; track w) {
                  <span class="tag warn">{{ weakeningLabels[w] ?? w }}</span>
                }
              </p>
            }

            @if (d.range; as range) {
              <p>
                <span class="label">Range {{ range.low }} – {{ range.high }}</span>
                @for (e of range.evidence; track e) {
                  <span class="tag">{{ rangeLabels[e] ?? e }}</span>
                }
              </p>
            }

            <div class="components">
              @for (c of components(); track c.key) {
                <div class="component" [appTip]="c.hint">
                  <span class="label">{{ c.label }}</span>
                  @if (c.value === null) {
                    <span class="muted">n/a</span>
                  } @else {
                    <span class="gauge">
                      <span
                        [class.up]="c.value > 0"
                        [class.down]="c.value < 0"
                        [style.left.%]="c.value >= 0 ? 50 : 50 + c.value * 50"
                        [style.width.%]="Math.abs(c.value) * 50"
                      ></span>
                    </span>
                  }
                </div>
              }
            </div>

            @if (d.levels; as lv) {
              <p class="muted">
                Support
                {{
                  lv.nearestSupport
                    ? lv.nearestSupport.high + ' (' + lv.distanceToSupportAtr + ' ATR)'
                    : '—'
                }}
                · Resistance
                {{
                  lv.nearestResistance
                    ? lv.nearestResistance.low + ' (' + lv.distanceToResistanceAtr + ' ATR)'
                    : '—'
                }}
                · RSI {{ d.features.rsi ?? '—' }} · ADX {{ d.features.adx ?? '—' }} · ATR
                {{ d.features.atr ?? '—' }}
              </p>
            }
          </div>
        } @else if (focusTimeframe()) {
          <p class="muted">
            Details for {{ focus() }} appear once the replay reaches its newest bar.
          </p>
        }
      </section>
    }
  `,
  styles: [
    `
      .trend {
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 12px;
      }
      header {
        display: flex;
        align-items: baseline;
        gap: 8px;
        flex-wrap: wrap;
      }
      .modes {
        margin-left: auto;
        display: flex;
        gap: 4px;
      }
      .modes button {
        font: inherit;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        border: 1px solid #212e3c;
        background: #111820;
        color: #8b9bad;
        cursor: pointer;
      }
      .modes button.on {
        background: #1d2b3a;
        color: #d6e0ea;
        border-color: #2f4459;
      }
      .muted {
        color: #5f7183;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th {
        text-align: left;
        font-weight: 400;
        color: #5f7183;
        padding: 2px 6px;
        border-bottom: 1px solid #212e3c;
      }
      td {
        padding: 3px 6px;
        color: #d6e0ea;
        white-space: nowrap;
      }
      tbody tr {
        cursor: pointer;
        border-left: 3px solid transparent;
      }
      tbody tr:hover {
        background: #141d27;
      }
      tbody tr.focus {
        background: #18222d;
        border-left-color: #56718a;
      }
      .tf {
        color: #8b9bad;
        font-variant-numeric: tabular-nums;
      }
      .num {
        font-variant-numeric: tabular-nums;
      }
      .mono {
        font-family: ui-monospace, Menlo, Consolas, monospace;
        font-size: 11px;
      }
      .up {
        color: #26a17b;
      }
      .down {
        color: #ef5350;
      }
      .neutral {
        color: #8b9bad;
      }
      .warn {
        color: #e9b44c;
      }
      .bar {
        display: inline-block;
        width: 48px;
        height: 5px;
        background: #18222d;
        border-radius: 3px;
        margin-right: 6px;
        vertical-align: middle;
        overflow: hidden;
      }
      .bar span {
        display: block;
        height: 100%;
        background: #56718a;
      }
      .detail {
        display: flex;
        flex-direction: column;
        gap: 6px;
        border-left: 3px solid #212e3c;
        padding-left: 8px;
      }
      .detail p {
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      .title {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .tag {
        padding: 1px 6px;
        border-radius: 8px;
        background: #18222d;
        font-size: 11px;
        color: #8b9bad;
      }
      .tag.warn {
        background: #3a2e14;
        color: #e9b44c;
      }
      .label {
        color: #8b9bad;
      }
      .components {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 4px 12px;
      }
      .component {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 6px;
      }
      .gauge {
        position: relative;
        width: 70px;
        height: 6px;
        background: #18222d;
        border-radius: 3px;
      }
      .gauge::after {
        content: '';
        position: absolute;
        left: 50%;
        top: -1px;
        width: 1px;
        height: 8px;
        background: #2f4459;
      }
      .gauge span {
        position: absolute;
        top: 0;
        height: 100%;
        border-radius: 3px;
      }
      .gauge span.up {
        background: #26a17b;
      }
      .gauge span.down {
        background: #ef5350;
      }
    `,
  ],
})
export class TrendPanelComponent {
  readonly result = input<TrendResult | null>(null);
  readonly focus = input<TrendTimeframe | null>(null);
  /** Close of the newest bar on screen while replaying; `null` otherwise. */
  readonly knownAtMs = input<number | null>(null);
  /** Whether the drawn timeframe follows the candles or was picked here. */
  readonly automatic = input(true);
  readonly detail = input<TrendDetail>('clean');
  readonly focusChange = output<TrendTimeframe>();
  readonly detailChange = output<TrendDetail>();

  protected readonly modes: readonly { value: TrendDetail; label: string; hint: string }[] = [
    {
      value: 'clean',
      label: 'Clean',
      hint: 'Active trendlines, lines broken on screen, the current swings, the protected level, and the events that change the trend.',
    },
    {
      value: 'detailed',
      label: 'Detailed',
      hint: 'Every swing label, every event (false breaks, retests, range), and the nearest support and resistance.',
    },
  ];

  protected readonly Math = Math;
  protected readonly directionLabels = DIRECTION_LABELS;
  protected readonly phaseLabels = PHASE_LABELS;
  protected readonly phaseHelp = PHASE_HELP;
  protected readonly breakLabels = BREAK_LABELS;
  protected readonly weakeningLabels = WEAKENING_LABELS;
  protected readonly rangeLabels = RANGE_EVIDENCE_LABELS;

  protected readonly rows = computed<Row[]>(() =>
    (this.result()?.timeframes ?? []).map((tf) => ({
      timeframe: tf.timeframe,
      reading: readingAt(tf, this.knownAtMs()),
      bars: tf.barsAnalysed,
    })),
  );

  protected readonly focusTimeframe = computed<TimeframeTrend | null>(
    () => this.result()?.timeframes.find((t) => t.timeframe === this.focus()) ?? null,
  );

  protected readonly focusLatest = computed(() =>
    latestKnown(this.focusTimeframe(), this.knownAtMs()),
  );

  protected readonly components = computed(() => {
    const d = this.focusLatest();
    if (!d) return [];
    return Object.entries(d.components).map(([key, value]) => ({
      key,
      label: COMPONENT_LABELS[key] ?? key,
      value,
      hint:
        value === null
          ? 'No data for this evidence on this feed or timeframe yet.'
          : `${value > 0 ? '+' : ''}${value} — −1 fully bearish, +1 fully bullish`,
    }));
  });

  protected dirClass(direction: TrendDirection): string {
    return direction === 'BULLISH' ? 'up' : direction === 'BEARISH' ? 'down' : 'neutral';
  }

  protected pct(value: number): string {
    return `${Math.round(value * 100)}%`;
  }
}
