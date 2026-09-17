import { Component, computed, input, output } from '@angular/core';
import { TipDirective } from '../shared/tip.directive';
import {
  GRADE_HELP,
  GRADE_SCALE_HELP,
  MARK_MODIFIER_KEY,
  MARK_STATE_KEY,
  REACTION_HELP,
  ROLE_HELP,
  STATE_HELP,
  cprHelp,
  dayTypeHelp,
  explainGrade,
  flagHelp,
  gapHelp,
  poolHelp,
  zoneHelp,
  type CheckStatus,
} from './market-engine-glossary';
import { STATE_LABELS, describeDeveloping, describeReading } from './market-engine-overlay';
import type {
  ChartSet,
  EventLogIngestResult,
  LegCharacter,
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
  imports: [TipDirective],
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
                [appTip]="choice.hint"
                (click)="chartSetChange.emit(choice.value)"
              >
                {{ choice.label }}
              </button>
            }
          </div>
        </header>

        <!--
          The key to the chart's marks. Collapsed, because a person reads it
          once; hovering a marked candle explains that one mark in full.
        -->
        <details class="key">
          <summary>How to read the chart marks</summary>
          <p class="key-note">
            A mark appears where the {{ engine.timeframes['setup'] }} state <em>changes</em>. Hover a
            marked candle for the full explanation of that mark.
          </p>
          <dl class="key-list">
            @for (row of markStateKey; track row.sample) {
              <div>
                <dt>{{ row.sample }}</dt>
                <dd>{{ row.meaning }}</dd>
              </div>
            }
          </dl>
          <dl class="key-list">
            @for (row of markModifierKey; track row.sample) {
              <div>
                <dt>{{ row.sample }}</dt>
                <dd>{{ row.meaning }}</dd>
              </div>
            }
          </dl>
          <p class="key-note">
            Solid lines are protected levels — a close through one changes that timeframe's
            structure. Dotted lines are the nearest order blocks (OB) and fair value gaps (FVG).
          </p>
        </details>

        @if (latest(); as reading) {
          <p class="session">
            <span>{{ reading.session.date }}</span>
            @if (reading.session.gapKind) {
              <span class="tag" [appTip]="gapHelp(reading.session.gapKind)">{{ gapLabel(reading) }}</span>
            }
            @if (reading.session.cprBand) {
              <span class="tag" [appTip]="cprHelp(reading.session.cprBand)">
                CPR {{ reading.session.cprBand }}
              </span>
            }
            <span class="tag" [appTip]="dayTypeHelp(reading.session.dayType)">
              {{ dayLabel(reading) }}
            </span>
            @for (flag of reading.session.flags; track flag) {
              <span class="tag warn" [appTip]="flagHelp(flag)">{{ flagLabel(flag) }}</span>
            }
            @for (name of reading.session.events; track name) {
              <span class="tag warn" appTip="A scheduled market event on this date.">{{ name }}</span>
            }
          </p>

          <ol class="cascade">
            @for (row of cascade(); track row.role) {
              <li [class]="'role-' + row.role">
                <span class="tf" [appTip]="row.hint">{{ row.view.timeframe }}</span>
                <span class="body">
                  <b
                    [class.up]="row.up"
                    [class.down]="row.down"
                    [appTip]="stateHelp[row.view.state]"
                  >
                    {{ label(row.view) }}
                  </b>
                  <span class="sub">
                    <span [appTip]="row.hint">{{ row.role }}</span>
                    @if (row.view.protectedLevel !== null) {
                      ·
                      <span
                        appTip="The price whose close-through changes this timeframe's structure."
                      >
                        protects {{ row.view.protectedLevel }}
                      </span>
                    }
                    @if (row.view.pullbackDepth !== null) {
                      ·
                      <span
                        appTip="How much of the last impulse move has been given back. Past about 79% the trend is treated as at risk."
                      >
                        {{ pct(row.view.pullbackDepth) }} retraced
                      </span>
                    }
                    @if (row.view.leg; as leg) {
                      ·
                      <span [appTip]="legHelp(leg.character)">
                        {{ leg.character.toLowerCase() }} leg
                      </span>
                    }
                    @if (row.view.expiresAfterBars !== null) {
                      ·
                      <span
                        [appTip]="
                          'Setups expire. This one has lasted ' +
                          row.view.barsInState +
                          ' of the ' +
                          row.view.expiresAfterBars +
                          ' bars it is allowed before lapsing to range.'
                        "
                      >
                        {{ row.view.barsInState }}/{{ row.view.expiresAfterBars }} bars
                      </span>
                    }
                  </span>
                </span>
              </li>
            }
            <li class="role-reaction">
              <span class="tf" [appTip]="roleHelp['reaction']">{{ engine.timeframes['reaction'] }}</span>
              <span class="body">
                <b [class.muted]="reading.reaction === 'ASLEEP'" [appTip]="reactionHelp[reading.reaction]">
                  {{ reactionLabel(reading) }}
                </b>
                <span class="sub">reaction · wakes only at the trigger level</span>
              </span>
            </li>
          </ol>

          @if (developing(); as line) {
            <p
              class="developing"
              appTip="The higher-timeframe candle that has not closed yet. Its high and low so far are real; its close does not exist yet, so it never changes a state."
            >
              {{ line }}
            </p>
          }

          @if (reading.transition) {
            <p
              class="transition"
              appTip="The two highest timeframes point different ways. Until they agree, no reading can grade above C."
            >
              Context and structure disagree — market in transition, readings cap at C.
            </p>
          }

          @if (reading.sequence.length) {
            <p class="sequence" appTip="The named events that led to this reading, oldest first.">
              {{ reading.sequence.join(' → ') }}
            </p>
          }

          <!-- Where the stops are. The swept pool leads: it is why the move had fuel. -->
          @if (reading.liquidity.tookPool || reading.liquidity.resting.length) {
            <div class="block">
              <p
                class="block-head"
                appTip="Prices where stop orders cluster. Price is often drawn to them, and a sweep of one before a move is a sign of strength. ▲ above price, ▼ below."
              >
                Liquidity
              </p>
              @if (reading.liquidity.tookPool; as took) {
                <p
                  class="took"
                  appTip="The stop cluster this move ran through first. ATR through = how far past the level price traded, in average bar ranges."
                >
                  {{ tookLabel(took) }}
                </p>
              }
              <ul class="rows">
                @for (pool of reading.liquidity.resting; track pool.source + pool.price) {
                  <li
                    [class.up]="pool.side === 'BUY_SIDE'"
                    [class.down]="pool.side === 'SELL_SIDE'"
                    [appTip]="poolHelp(pool.source, pool.side)"
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
              <p
                class="block-head"
                appTip="Price areas the market is likely to react at: order blocks (OB) and fair value gaps (FVG), with their status as of this reading."
              >
                Zones
              </p>
              <ul class="rows">
                @for (zone of reading.zones; track zone.kind + zone.createdAt + zone.low) {
                  <li
                    [class.up]="zone.direction === 'BULLISH'"
                    [class.down]="zone.direction === 'BEARISH'"
                    [class.spent]="zone.status === 'MITIGATED'"
                    [appTip]="zoneHelp(zone)"
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

          <!--
            The grade, said in sentences. The letter alone, four symbol-coded
            lists and a terse cap reason were each correct and together
            unreadable: this states what is being graded, the score, why the
            letter is not higher, and each check with the reason it landed there.
          -->
          @if (gradeView(); as g) {
            <div class="grade" [class]="'g-' + g.grade">
              <p class="block-head" [appTip]="gradeScaleHelp">Setup grade</p>

              <div class="grade-head">
                <div class="letter" [attr.aria-label]="'Grade ' + g.grade" [appTip]="gradeHelp[g.grade]">
                  {{ g.grade }}
                </div>
                <div class="grade-sum">
                  <b>
                    {{ g.verdict }}
                    @if (g.subject) {
                      <span class="subject">{{ g.subject }}</span>
                    }
                  </b>
                  <span class="score">{{ g.score }}</span>
                </div>
              </div>

              @if (g.whyNotHigher) {
                <p class="why">{{ g.whyNotHigher }}</p>
              }

              <ul class="checks">
                @for (check of g.rows; track check.item) {
                  <li [class]="check.status">
                    <span class="pill" [appTip]="statusHelp[check.status]">
                      {{ statusLabel[check.status] }}
                    </span>
                    <span class="check-body">
                      <span class="check-name" [appTip]="check.help">{{ check.label }}</span>
                      <span class="check-detail">{{ check.detail }}</span>
                    </span>
                  </li>
                }
              </ul>

              @if (g.toReachA.length) {
                <p class="reach">
                  <span>To reach A, these still need to pass:</span>
                  {{ g.toReachA.join(' · ') }}
                </p>
              }
            </div>
          }

          @if (reading.setup.invalidatedBy) {
            <div
              class="invalid"
              appTip="The price action that would prove this reading wrong. If it happens, the state changes at the next bar close."
            >
              <p class="block-head">Invalidation</p>
              <p>
                This {{ reading.setup.timeframe }} reading is cancelled by a
                <b>{{ reading.setup.invalidatedBy }}</b>.
              </p>
            </div>
          }

          <p class="foot" [appTip]="tooltip()">
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
              <button
                type="button"
                [disabled]="researchBusy()"
                (click)="ingest.emit()"
                appTip="Save this session's engine events to the database, so later runs can be compared with them. Events already stored are skipped."
              >
                Store events
              </button>
              <button
                type="button"
                [disabled]="researchBusy()"
                (click)="parity.emit()"
                appTip="Replay the session and check the engine produces exactly the events that were stored. A mismatch means a rule changed."
              >
                Check replay parity
              </button>
              <button
                type="button"
                [disabled]="researchBusy()"
                (click)="validate.emit()"
                appTip="Measure what price actually did after each label over many past sessions, against a same-time-of-day baseline. Slow: it reads a long window."
              >
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
                      <th appTip="The event type or grade being measured.">Label</th>
                      <th appTip="Independent samples, after overlapping forward windows were thinned out.">n</th>
                      <th appTip="Edge 3 bars later, in ATR: how much further price went the label's way than the baseline did.">3b</th>
                      <th appTip="Edge 6 bars later, in ATR.">6b</th>
                      <th appTip="Edge 12 bars later, in ATR.">12b</th>
                      <th appTip="How much more often price rose 1 ATR before falling 1 ATR, compared with the baseline, in percentage points. Upward regardless of the label's direction.">
                        +1 first
                      </th>
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
                      <th appTip="A setup state, and how it resolved afterwards.">State</th>
                      <th appTip="How many times the state occurred.">n</th>
                      <th appTip="Share of times the trend carried on.">resumed</th>
                      <th appTip="Share of times the trend turned the other way.">reversed</th>
                      <th appTip="Share of times price went sideways.">ranged</th>
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
      .has-tip {
        cursor: help;
        text-decoration: underline dotted rgba(139, 155, 173, 0.45);
        text-underline-offset: 3px;
      }
      /* Buttons and whole rows announce themselves already; underlining them is noise. */
      button.has-tip,
      li.has-tip,
      .letter.has-tip,
      .invalid.has-tip {
        text-decoration: none;
      }
      .key {
        border: 1px solid #212e3c;
        border-radius: 6px;
        padding: 4px 8px;
        background: #111820;
      }
      .key summary {
        cursor: pointer;
        color: #8b9bad;
        font-size: 11px;
      }
      .key-note {
        margin: 6px 0;
        color: #8b9bad;
        font-size: 11px;
      }
      .key-list {
        margin: 6px 0;
        display: grid;
        gap: 3px;
      }
      .key-list div {
        display: grid;
        grid-template-columns: 130px 1fr;
        gap: 8px;
        font-size: 11px;
      }
      .key-list dt {
        color: #d6e0ea;
        font-family: ui-monospace, Menlo, Consolas, monospace;
      }
      .key-list dd {
        margin: 0;
        color: #8b9bad;
      }
      .grade {
        display: flex;
        flex-direction: column;
        gap: 6px;
        border-top: 1px solid #212e3c;
        padding-top: 6px;
      }
      .grade-head {
        display: flex;
        gap: 10px;
        align-items: center;
      }
      .letter {
        font-size: 26px;
        font-weight: 700;
        line-height: 1;
        min-width: 32px;
        padding: 3px 0;
        text-align: center;
        border-radius: 6px;
        background: #18222d;
      }
      .g-A .letter,
      .g-A .grade-sum b {
        color: #26a17b;
      }
      .g-B .letter,
      .g-B .grade-sum b {
        color: #e9b44c;
      }
      .g-C .letter,
      .g-C .grade-sum b {
        color: #ef5350;
      }
      .grade-sum {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .grade-sum b {
        font-size: 13px;
        font-weight: 600;
      }
      .subject {
        color: #8b9bad;
        font-weight: 400;
        font-size: 11px;
        margin-left: 4px;
      }
      .score {
        color: #8b9bad;
        font-size: 11px;
      }
      .why {
        margin: 0;
        padding: 5px 8px;
        border-left: 3px solid #2f4459;
        background: #111820;
        color: #d6e0ea;
        font-size: 11px;
      }
      .checks {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .checks li {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        font-size: 11px;
      }
      /* A word, not a symbol: "~" was read as "roughly agrees". */
      .pill {
        flex: none;
        min-width: 50px;
        text-align: center;
        padding: 1px 0;
        border-radius: 8px;
        font-size: 10px;
        font-weight: 600;
        text-decoration: none;
      }
      .check-body {
        display: flex;
        flex-direction: column;
      }
      .check-name {
        color: #d6e0ea;
        align-self: flex-start;
      }
      .check-detail {
        color: #8b9bad;
      }
      .checks .pass .pill {
        background: rgba(38, 161, 123, 0.16);
        color: #26a17b;
      }
      .checks .partial .pill {
        background: rgba(233, 180, 76, 0.16);
        color: #e9b44c;
      }
      .checks .fail .pill {
        background: rgba(239, 83, 80, 0.16);
        color: #ef5350;
      }
      /* Not a fail: the feed cannot answer, which is not the same thing. */
      .checks .na .pill {
        background: #18222d;
        color: #8b9bad;
      }
      .checks .na .check-name {
        color: #8b9bad;
      }
      .reach {
        margin: 0;
        color: #d6e0ea;
        font-size: 11px;
      }
      .reach span {
        color: #8b9bad;
        margin-right: 4px;
      }
      .invalid {
        border-top: 1px solid #212e3c;
        padding-top: 6px;
      }
      .invalid p:last-child {
        margin: 0;
        color: #8b9bad;
        font-size: 11px;
      }
      .invalid b {
        color: #d6e0ea;
        font-weight: 600;
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
        ['context', reading.context],
        ['structure', reading.structure],
        ['setup', reading.setup],
        ['trigger', reading.trigger],
      ] as const
    ).map(([role, view]) => ({
      role,
      view: view as TimeframeReading,
      hint: ROLE_HELP[role],
      up: view.state.endsWith('_UP'),
      down: view.state.endsWith('_DOWN'),
    }));
  });

  /** The newest reading's grade, taken apart into sentences — `null` when ungraded. */
  protected readonly gradeView = computed(() => {
    const reading = this.latest();
    return reading?.grade ? explainGrade(reading) : null;
  });

  protected readonly developing = computed(() => describeDeveloping(this.latest()));

  protected readonly tooltip = computed(() => {
    const reading = this.latest();
    return reading ? describeReading(reading) : '';
  });

  /* The glossary, exposed to the template. */
  protected readonly stateHelp = STATE_HELP;
  protected readonly roleHelp = ROLE_HELP;
  protected readonly reactionHelp = REACTION_HELP;
  protected readonly gradeHelp = GRADE_HELP;
  protected readonly gradeScaleHelp = GRADE_SCALE_HELP;
  protected readonly markStateKey = MARK_STATE_KEY;
  protected readonly markModifierKey = MARK_MODIFIER_KEY;
  protected readonly gapHelp = gapHelp;
  protected readonly cprHelp = cprHelp;
  protected readonly dayTypeHelp = dayTypeHelp;
  protected readonly flagHelp = flagHelp;
  protected readonly poolHelp = poolHelp;
  protected readonly zoneHelp = zoneHelp;

  protected readonly statusLabel: Readonly<Record<CheckStatus, string>> = {
    pass: 'Pass',
    partial: 'Partial',
    fail: 'Fail',
    na: 'N/A',
  };

  protected readonly statusHelp: Readonly<Record<CheckStatus, string>> = {
    pass: 'This check is fully met.',
    partial: 'Half met — neither for nor against. Does not cap the grade on its own.',
    fail: 'This check is not met. Two failures cap the grade at C.',
    na: 'The data needed for this check does not exist on this feed. It is left out of the score rather than counted as a fail.',
  };

  protected legHelp(character: LegCharacter): string {
    return character === 'IMPULSIVE'
      ? 'Impulsive leg — wide candles with little overlap. The move has intent.'
      : character === 'CORRECTIVE'
        ? 'Corrective leg — small, overlapping candles. Typical of a pullback rather than a new trend.'
        : 'Mixed leg — neither clearly impulsive nor clearly corrective.';
  }

  protected label(view: TimeframeReading): string {
    return STATE_LABELS[view.state];
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
