import { Component, computed, input, output } from '@angular/core';
import {
  CHECKLIST_LABELS,
  STATE_LABELS,
  describeDeveloping,
  describeReading,
} from './market-engine-overlay';
import type {
  ChartSet,
  EventLogIngestResult,
  MarketEngineResult,
  MarketReading,
  ParityCheckResult,
  TimeframeReading,
  ValidationResult,
} from './market-engine.models';

/**
 * The engine's reading, laid out the way a trader reads a chart: top down.
 *
 * Context first, then structure, setup, trigger, reaction — the cascade, with
 * each row indented one step further than the one above it, so the shape of the
 * panel is the shape of the argument. That is not decoration: the whole claim
 * the engine makes is that the higher timeframe is a *filter* on the lower one,
 * and a flat list of five equal rows says the opposite.
 *
 * Three things the panel is careful about, each of them a way a read-out can
 * quietly lie:
 *
 * 1. **The developing bar is shown apart from the confirmed one.** Today's 4H
 *    candle has not closed. Its running high and low are useful and its close
 *    does not exist, so the two are never mixed into one row.
 * 2. **An unavailable checklist item is not a failed one.** An index reports no
 *    volume; the volume row says "no data on this feed" rather than showing a
 *    cross, because a cross tells a user their setup was weak when the truth is
 *    that the feed cannot answer.
 * 3. **`null` is never rendered as zero.** A missing protected level is "—",
 *    not "0", and a missing depth is absent rather than 0%.
 */
@Component({
  selector: 'app-market-engine-panel',
  standalone: true,
  template: `
    @if (result(); as engine) {
      <section class="engine" [attr.aria-label]="'Market engine reading'">
        <header>
          <div class="ttl">
            <strong>Market engine</strong>
            <span class="rule">{{ engine.ruleVersion }}</span>
          </div>
          <div class="sets" role="group" aria-label="Chart set">
            @for (choice of chartSetChoices; track choice.value) {
              <button
                type="button"
                [attr.aria-pressed]="engine.chartSet === choice.value"
                [class.on]="engine.chartSet === choice.value"
                [title]="choice.hint"
                (click)="chartSetChange.emit(choice.value)"
              >
                {{ choice.label }}
              </button>
            }
          </div>
        </header>

        @if (latest(); as reading) {
          <p class="session">
            <span>{{ reading.session.date }}</span>
            @if (reading.session.gapKind) {
              <span class="tag">{{ gapLabel(reading) }}</span>
            }
            @if (reading.session.cprBand) {
              <span class="tag">CPR {{ reading.session.cprBand }}</span>
            }
            <span class="tag">{{ dayLabel(reading) }}</span>
            @for (flag of reading.session.flags; track flag) {
              <span class="tag warn">{{ flagLabel(flag) }}</span>
            }
            @for (name of reading.session.events; track name) {
              <span class="tag warn">{{ name }}</span>
            }
          </p>

          <ol class="cascade">
            @for (row of cascade(); track row.role) {
              <li [class]="'role-' + row.role" [title]="row.hint">
                <span class="tf">{{ row.view.timeframe }}</span>
                <span class="body">
                  <b [class.up]="row.up" [class.down]="row.down">{{ label(row.view) }}</b>
                  <span class="sub">
                    {{ row.role }}
                    @if (row.view.protectedLevel !== null) {
                      · protects {{ row.view.protectedLevel }}
                    }
                    @if (row.view.pullbackDepth !== null) {
                      · {{ pct(row.view.pullbackDepth) }} retraced
                    }
                    @if (row.view.leg) {
                      · {{ row.view.leg.character.toLowerCase() }} leg
                    }
                    @if (row.view.expiresAfterBars !== null) {
                      · {{ row.view.barsInState }}/{{ row.view.expiresAfterBars }} bars
                    }
                  </span>
                </span>
              </li>
            }
            <li class="role-reaction">
              <span class="tf">{{ engine.timeframes['reaction'] }}</span>
              <span class="body">
                <b [class.muted]="reading.reaction === 'ASLEEP'">{{ reactionLabel(reading) }}</b>
                <span class="sub">reaction · wakes only at the trigger level</span>
              </span>
            </li>
          </ol>

          @if (developing(); as line) {
            <p class="developing">{{ line }}</p>
          }

          @if (reading.transition) {
            <p class="transition">
              Context and structure disagree — market in transition, readings cap at C.
            </p>
          }

          @if (reading.sequence.length) {
            <p class="sequence">{{ reading.sequence.join(' → ') }}</p>
          }

          <!-- Where the stops are. The swept pool leads: it is why the move had fuel. -->
          @if (reading.liquidity.tookPool || reading.liquidity.resting.length) {
            <div class="block">
              <p class="block-head">Liquidity</p>
              @if (reading.liquidity.tookPool; as took) {
                <p class="took">{{ tookLabel(took) }}</p>
              }
              <ul class="rows">
                @for (pool of reading.liquidity.resting; track pool.source + pool.price) {
                  <li
                    [class.up]="pool.side === 'BUY_SIDE'"
                    [class.down]="pool.side === 'SELL_SIDE'"
                  >
                    <span>{{ pool.side === 'BUY_SIDE' ? '▲' : '▼' }} {{ pool.price }}</span>
                    <i>{{ poolText(pool.source, pool.touches) }}</i>
                  </li>
                }
              </ul>
            </div>
          }

          <!-- Zones, with status as of this reading — never as of the end of the day. -->
          @if (reading.zones.length) {
            <div class="block">
              <p class="block-head">Zones</p>
              <ul class="rows">
                @for (zone of reading.zones; track zone.kind + zone.createdAt + zone.low) {
                  <li
                    [class.up]="zone.direction === 'BULLISH'"
                    [class.down]="zone.direction === 'BEARISH'"
                    [class.spent]="zone.status === 'MITIGATED'"
                  >
                    <span>{{ zone.low }} – {{ zone.high }}</span>
                    <i>
                      {{ zone.kind === 'ORDER_BLOCK' ? 'OB' : 'FVG' }} ·
                      {{ zone.status.toLowerCase() }}
                      @if (zone.tests) {
                        · {{ zone.tests }} test{{ zone.tests === 1 ? '' : 's' }}
                      }
                      @if (zone.sweptLiquidity) {
                        · took liquidity
                      }
                    </i>
                  </li>
                }
              </ul>
            </div>
          }

          @if (reading.grade; as grade) {
            <div class="grade" [class]="'g-' + grade.value">
              <div class="letter" [attr.aria-label]="'Grade ' + grade.value">
                {{ grade.value }}
              </div>
              <ul class="checks">
                @for (item of grade.present; track item) {
                  <li class="yes">{{ checklist(item) }}</li>
                }
                @for (item of grade.partial; track item) {
                  <li class="part">{{ checklist(item) }}</li>
                }
                @for (item of grade.missing; track item) {
                  <li class="no">{{ checklist(item) }}</li>
                }
                @for (item of grade.unavailable; track item) {
                  <li class="na">{{ checklist(item) }} — no data on this feed</li>
                }
              </ul>
            </div>
            @if (grade.capReason) {
              <p class="cap">Capped: {{ grade.capReason }}</p>
            }
          }

          @if (reading.setup.invalidatedBy) {
            <p class="invalid">Invalidated by {{ reading.setup.invalidatedBy }}</p>
          }

          <p class="foot" [title]="tooltip()">
            {{ engine.readings.length }} of {{ engine.produced }} readings ·
            {{ engine.barsAnalysed }} bars · last {{ asTime(reading.at) }}
          </p>

          <!--
            Research: the event log, replay parity and forward validation.
            Collapsed by default — these are for studying the engine, not for
            reading the chart, and validation walks a long window.
          -->
          <details class="research">
            <summary>Research — event log, parity, validation</summary>

            <div class="actions">
              <button type="button" [disabled]="researchBusy()" (click)="ingest.emit()">
                Store events
              </button>
              <button type="button" [disabled]="researchBusy()" (click)="parity.emit()">
                Check replay parity
              </button>
              <button type="button" [disabled]="researchBusy()" (click)="validate.emit()">
                Run validation
              </button>
              @if (researchBusy()) {
                <i class="busy">working…</i>
              }
            </div>

            @if (researchError(); as message) {
              <p class="rerr">{{ message }}</p>
            }

            @if (ingestResult(); as log) {
              <p class="rline">
                Log {{ log.sessionDate ?? '—' }}: {{ log.written }} written,
                {{ log.skipped }} already stored ({{ log.produced }} produced)
              </p>
            }

            @if (parityResult(); as p) {
              <p class="rline" [class.ok]="p.identical" [class.bad]="!p.identical">
                Parity {{ p.sessionDate }}: {{ p.identical ? 'identical' : 'MISMATCH' }} —
                {{ p.matched }} matched, {{ p.onlyInReplay }} only in replay,
                {{ p.onlyInStored }} only stored, {{ p.changed }} changed
              </p>
              @for (example of p.examples; track example.kind + example.at + example.type) {
                <p class="rsub">{{ example.kind }} · {{ example.type }} · {{ example.detail }}</p>
              }
            }

            @if (validationResult(); as v) {
              <p class="rline">
                {{ v.events }} events over {{ v.sessions }} sessions · walk-forward
                {{ v.walkForward.tune }}/{{ v.walkForward.check }}/{{ v.walkForward.confirm }}
              </p>
              <p class="rnote">
                Edge = forward move in ATR minus a same-minute-of-session baseline, oriented to the
                label's claim. Near zero means the label adds nothing; small samples are noise.
              </p>
              <div class="table">
                <table>
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>n</th>
                      <th>3b</th>
                      <th>6b</th>
                      <th>12b</th>
                      <th>+1 first</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of validationRows(); track row.label) {
                      <tr>
                        <td>{{ row.label }}</td>
                        <td>{{ row.independentSamples }}</td>
                        <td [class]="edgeClass(row.edgeAtr[3])">{{ signed(row.edgeAtr[3]) }}</td>
                        <td [class]="edgeClass(row.edgeAtr[6])">{{ signed(row.edgeAtr[6]) }}</td>
                        <td [class]="edgeClass(row.edgeAtr[12])">{{ signed(row.edgeAtr[12]) }}</td>
                        <td [class]="edgeClass(row.upFirstEdge)">{{ pp(row.upFirstEdge) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <div class="table">
                <table>
                  <thead>
                    <tr>
                      <th>State</th>
                      <th>n</th>
                      <th>resumed</th>
                      <th>reversed</th>
                      <th>ranged</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of v.stateResolution; track row.state) {
                      <tr>
                        <td>{{ label2(row.state) }}</td>
                        <td>{{ row.samples }}</td>
                        <td>{{ pct(row.rates.RESUMED) }}</td>
                        <td>{{ pct(row.rates.REVERSED) }}</td>
                        <td>{{ pct(row.rates.RANGED) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </details>
        } @else {
          <p class="foot">
            No readings yet — the engine needs enough history for a confirmed higher-timeframe
            swing.
          </p>
        }
      </section>
    }
  `,
  styles: [
    `
      .engine {
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 12px;
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .ttl {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .rule {
        color: #5f7183;
        font-size: 11px;
      }
      .sets {
        display: flex;
        gap: 4px;
      }
      .sets button {
        font: inherit;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        border: 1px solid #212e3c;
        background: #111820;
        color: #8b9bad;
        cursor: pointer;
      }
      .sets button.on {
        background: #1d2b3a;
        color: #d6e0ea;
        border-color: #2f4459;
      }
      .session {
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        color: #8b9bad;
      }
      .tag {
        padding: 1px 6px;
        border-radius: 8px;
        background: #18222d;
        font-size: 11px;
      }
      .tag.warn {
        background: #3a2e14;
        color: #e9b44c;
      }
      .cascade {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      /* The indent is the argument: each timeframe filters the one below it. */
      .cascade li {
        display: flex;
        gap: 8px;
        align-items: baseline;
        border-left: 3px solid #212e3c;
        padding: 3px 0 3px 8px;
      }
      .role-structure {
        margin-left: 10px;
      }
      .role-setup {
        margin-left: 20px;
      }
      .role-trigger {
        margin-left: 30px;
      }
      .role-reaction {
        margin-left: 40px;
      }
      .tf {
        min-width: 34px;
        text-align: right;
        color: #5f7183;
        font-variant-numeric: tabular-nums;
      }
      .body {
        display: flex;
        flex-direction: column;
      }
      .body b {
        color: #d6e0ea;
        font-weight: 600;
      }
      .body b.up {
        color: #26a17b;
      }
      .body b.down {
        color: #ef5350;
      }
      .body b.muted {
        color: #5f7183;
        font-weight: 400;
      }
      .sub {
        color: #5f7183;
        font-size: 11px;
      }
      .developing {
        margin: 0;
        color: #7fa6e6;
        font-size: 11px;
      }
      .transition {
        margin: 0;
        color: #e9b44c;
      }
      .sequence {
        margin: 0;
        color: #8b9bad;
        font-family: ui-monospace, Menlo, Consolas, monospace;
        font-size: 11px;
      }
      .grade {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        border-top: 1px solid #212e3c;
        padding-top: 8px;
      }
      .letter {
        font-size: 26px;
        font-weight: 700;
        line-height: 1;
        min-width: 28px;
        text-align: center;
      }
      .g-A .letter {
        color: #26a17b;
      }
      .g-B .letter {
        color: #e9b44c;
      }
      .g-C .letter {
        color: #ef5350;
      }
      .checks {
        list-style: none;
        margin: 0;
        padding: 0;
        flex: 1;
      }
      .checks li {
        font-size: 11px;
      }
      .checks li::before {
        display: inline-block;
        width: 14px;
      }
      .checks .yes {
        color: #26a17b;
      }
      .checks .yes::before {
        content: '✓';
      }
      .checks .part {
        color: #e9b44c;
      }
      .checks .part::before {
        content: '~';
      }
      .checks .no {
        color: #ef5350;
      }
      .checks .no::before {
        content: '✕';
      }
      /* Not a cross: the feed cannot answer, which is not the same as a fail. */
      .checks .na {
        color: #5f7183;
      }
      .checks .na::before {
        content: '·';
      }
      .cap,
      .invalid {
        margin: 0;
        color: #8b9bad;
        font-size: 11px;
      }
      .foot {
        margin: 0;
        color: #5f7183;
        font-size: 11px;
      }
      .block {
        border-top: 1px solid #212e3c;
        padding-top: 6px;
      }
      .block-head {
        margin: 0 0 3px;
        color: #8b9bad;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .took {
        margin: 0 0 3px;
        color: #e9b44c;
        font-size: 11px;
      }
      .rows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .rows li {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }
      .rows li.up span {
        color: #26a17b;
      }
      .rows li.down span {
        color: #ef5350;
      }
      .rows li i {
        color: #5f7183;
        font-style: normal;
      }
      .rows li.spent {
        opacity: 0.6;
      }
      .research {
        border-top: 1px solid #212e3c;
        padding-top: 6px;
      }
      .research summary {
        cursor: pointer;
        color: #8b9bad;
        font-size: 11px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
        margin: 6px 0;
      }
      .actions button {
        font: inherit;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 4px;
        border: 1px solid #2f4459;
        background: #16212c;
        color: #d6e0ea;
        cursor: pointer;
      }
      .actions button:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .busy {
        color: #5f7183;
        font-size: 11px;
      }
      .rerr {
        margin: 0;
        color: #ef5350;
        font-size: 11px;
      }
      .rline {
        margin: 2px 0;
        font-size: 11px;
        color: #d6e0ea;
      }
      .rline.ok {
        color: #26a17b;
      }
      .rline.bad {
        color: #ef5350;
      }
      .rsub,
      .rnote {
        margin: 0;
        font-size: 10px;
        color: #5f7183;
      }
      .table {
        overflow-x: auto;
        margin-top: 4px;
      }
      table {
        border-collapse: collapse;
        width: 100%;
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }
      th,
      td {
        padding: 2px 4px;
        text-align: right;
        border-bottom: 1px solid #18222d;
        white-space: nowrap;
      }
      th:first-child,
      td:first-child {
        text-align: left;
      }
      th {
        color: #8b9bad;
        font-weight: 500;
      }
      td.pos {
        color: #26a17b;
      }
      td.neg {
        color: #ef5350;
      }
      td.flat {
        color: #5f7183;
      }
    `,
  ],
})
export class MarketEnginePanelComponent {
  readonly result = input<MarketEngineResult | null>(null);
  readonly chartSetChange = output<ChartSet>();

  /* Research: the host owns the requests, because it knows the instrument. */
  readonly ingestResult = input<EventLogIngestResult | null>(null);
  readonly parityResult = input<ParityCheckResult | null>(null);
  readonly validationResult = input<ValidationResult | null>(null);
  readonly researchBusy = input(false);
  readonly researchError = input<string | null>(null);
  readonly ingest = output<void>();
  readonly parity = output<void>();
  readonly validate = output<void>();

  /** Event labels then grades, in one table — grades last, since they aggregate. */
  protected readonly validationRows = computed(() => {
    const v = this.validationResult();
    return v ? [...v.byEventType, ...v.byGrade] : [];
  });

  protected flagLabel(flag: string): string {
    return flag.replace(/_/g, ' ').toLowerCase();
  }

  protected poolLabel(source: string): string {
    return source.replace(/_/g, ' ').toLowerCase();
  }

  /** `equal highs ×3` — the touch count only when there is more than one. */
  protected poolText(source: string, touches: number): string {
    return touches > 1 ? `${this.poolLabel(source)} ×${touches}` : this.poolLabel(source);
  }

  /** The swept pool as one sentence: what, where, and how far through. */
  protected tookLabel(took: {
    source: string;
    price: number;
    touches: number;
    penetrationAtr: number;
  }): string {
    return `Took ${this.poolText(took.source, took.touches)} at ${took.price} (${took.penetrationAtr.toFixed(2)} ATR through)`;
  }

  protected label2(state: TimeframeReading['state']): string {
    return STATE_LABELS[state];
  }

  /** A signed ATR edge to three places, or a dash for "no sample". */
  protected signed(value: number | null): string {
    if (value === null) return '—';
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
  }

  /** A rate difference in percentage points. */
  protected pp(value: number | null): string {
    if (value === null) return '—';
    return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}pp`;
  }

  /**
   * Colour for an edge — muted near zero on purpose.
   *
   * A tenth of an ATR on a few dozen samples is noise, and colouring it green
   * would invite exactly the conclusion the research section exists to prevent.
   */
  protected edgeClass(value: number | null): string {
    if (value === null || Math.abs(value) < 0.15) return 'flat';
    return value > 0 ? 'pos' : 'neg';
  }

  protected readonly chartSetChoices: {
    value: ChartSet;
    label: string;
    hint: string;
  }[] = [
    {
      value: 'standard',
      label: '4H / 1H',
      hint: 'Conventional bar sizes. The session leaves a 15-minute hourly stub and a 135-minute 4H bar; both are flagged partial and never mint a swing.',
    },
    {
      value: 'nse',
      label: '125m / 75m',
      hint: 'The NSE-equal set: 375 minutes is exactly 3 × 125 and 5 × 75, so every candle in the session is the same length and there is no stub.',
    },
  ];

  /**
   * The newest reading — what the panel is about.
   *
   * The engine returns the whole series so the chart can mark transitions
   * across it; the panel states where the market is *now*, which is the last
   * one.
   */
  protected readonly latest = computed<MarketReading | null>(
    () => this.result()?.readings.at(-1) ?? null,
  );

  protected readonly cascade = computed(() => {
    const reading = this.latest();
    if (!reading) return [];
    return (
      [
        ['context', reading.context, 'Confirmed bias and the dealing range price sits in'],
        [
          'structure',
          reading.structure,
          'Trend, pullback, at risk or reversal, by the protected level',
        ],
        ['setup', reading.setup, 'Price at a level, a sweep, an internal shift'],
        ['trigger', reading.trigger, 'A break with acceptance inside a time window'],
      ] as const
    ).map(([role, view, hint]) => ({
      role,
      view: view as TimeframeReading,
      hint,
      up: view.state.endsWith('_UP'),
      down: view.state.endsWith('_DOWN'),
    }));
  });

  protected readonly developing = computed(() => describeDeveloping(this.latest()));

  protected readonly tooltip = computed(() => {
    const reading = this.latest();
    return reading ? describeReading(reading) : '';
  });

  protected label(view: TimeframeReading): string {
    return STATE_LABELS[view.state];
  }

  protected checklist(item: string): string {
    return CHECKLIST_LABELS[item] ?? item;
  }

  protected pct(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  protected gapLabel(reading: MarketReading): string {
    const points = reading.session.gapPoints;
    const kind = (reading.session.gapKind ?? '').replace(/_/g, ' ').toLowerCase();
    return points === null ? kind : `${kind} ${points > 0 ? '+' : ''}${points.toFixed(0)}`;
  }

  protected dayLabel(reading: MarketReading): string {
    return reading.session.dayType.replace(/_/g, ' ').toLowerCase();
  }

  protected reactionLabel(reading: MarketReading): string {
    return reading.reaction === 'ASLEEP'
      ? 'asleep'
      : reading.reaction.replace('RETEST_', 'retest ').toLowerCase();
  }

  protected asTime(epochMs: number): string {
    return new Date(epochMs).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
