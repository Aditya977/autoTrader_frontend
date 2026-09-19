import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Subscription } from 'rxjs';
import { NavTabsComponent } from '../shared/nav-tabs.component';
import { ChartStreamComponent } from './chart-stream.component';
import { ChartStreamApiService, ChartStreamError } from './chart-stream-api.service';
import { StrategyApiService } from '../strategy/strategy-api.service';
import { SimulationSocketService } from '../strategy/simulation-socket.service';
import { StrategyPanelComponent } from '../strategy/strategy-panel.component';
import { PaperTradeService } from '../paper-trade/paper-trade.service';
import {
  PaperTradeSetupComponent,
  type PaperTradeChoice,
} from '../paper-trade/ui/paper-trade-setup.component';
import { PaperPositionsComponent } from '../paper-trade/ui/paper-positions.component';
import { TradeActivityComponent } from '../paper-trade/ui/trade-activity.component';
import type { PaperContract, PaperOrderRequest } from '../paper-trade/paper-trade.models';
import { paperStrategyById } from '../paper-trade/strategies/registry';
import type {
  SimTrade,
  SimulationRunSnapshot,
  StrategyDescriptor,
} from '../strategy/strategy.models';
import { UpstoxAuthService } from '../auth/upstox-auth.service';
import { DISPLAY_INTERVALS, intervalNameFor } from './chart-time';
import type {
  ChartCandleEvent,
  ChartSessionMode,
  InstrumentRequest,
  InstrumentType,
  LevelMethod,
  PricedOptionContract,
  StartStreamRequest,
  StreamLevelsOptions,
} from './chart-stream.models';

/**
 * What the picker offers.
 *
 * `EQUITY` is deliberately absent: the backend accepts it in the schema but
 * rejects it at resolution every time (this deployment's instrument master
 * syncs only index derivatives), and an option that always fails is worse than
 * one that is not there.
 *
 * `OPTIONS` is one entry rather than the CE/PE pair the backend's
 * `InstrumentType` uses, because a call and a put are no longer alternatives
 * here — either or both can be charted, and forcing the user to declare a leg
 * before picking a strike is what made charting both impossible.
 */
type InstrumentKind = 'INDEX' | 'FUTURE' | 'OPTIONS';

const INSTRUMENT_KINDS: { value: InstrumentKind; label: string }[] = [
  { value: 'OPTIONS', label: 'Options' },
  { value: 'INDEX', label: 'Index' },
  { value: 'FUTURE', label: 'Future' },
];

/**
 * Replay pace, as choices rather than a free number.
 *
 * `0` is the useful default: the backend replays its whole backlog to whoever
 * connects, so "instant" genuinely means the day appears at once. The paced
 * options remain for watching a session unfold.
 */
const REPLAY_SPEEDS: { value: number; label: string }[] = [
  { value: 0, label: 'Instant — whole day at once' },
  { value: 120, label: 'Very fast (120×)' },
  { value: 60, label: 'Fast (60×)' },
  { value: 30, label: 'Medium (30×)' },
  { value: 5, label: 'Slow (5×)' },
  { value: 1, label: 'Real time (1×)' },
];

/** Prior trading days of context to draw to the left of the streamed session. */
const HISTORY_CHOICES: { value: number; label: string }[] = [
  { value: 0, label: 'This day only' },
  { value: 1, label: '+ previous day' },
  { value: 2, label: '+ previous 2 days' },
  { value: 5, label: '+ previous 5 days' },
  { value: 10, label: '+ previous 10 days' },
];

/**
 * How support and resistance should be found, as the three answers that
 * actually differ rather than as five numeric knobs.
 *
 * `off` is a real option and the default: annotations are a choice, and a
 * chart nobody asked to annotate should not pay for the extra history fetch
 * that finding levels costs.
 */
type LevelChoice = 'off' | LevelMethod;

const LEVEL_CHOICES: { value: LevelChoice; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'swing', label: 'Swing levels' },
  { value: 'pivot', label: 'Pivot points' },
  { value: 'both', label: 'Swings + pivots' },
];

/**
 * How hard to look for swing levels, as the trade-off it really is.
 *
 * One control instead of four: `swingLookback` decides how big a turn has to
 * be, `minTouches` how often it must have been tested, and moving them
 * independently mostly produces combinations nobody wants. These three are the
 * useful diagonal through that space.
 */
const LEVEL_SENSITIVITIES: {
  value: string;
  label: string;
  tuning: { swingLookback: number; minTouches: number; maxLevels: number; tolerancePct: number };
}[] = [
  {
    value: 'major',
    label: 'Major only',
    tuning: { swingLookback: 6, minTouches: 2, maxLevels: 4, tolerancePct: 0.35 },
  },
  {
    value: 'balanced',
    label: 'Balanced',
    tuning: { swingLookback: 3, minTouches: 2, maxLevels: 6, tolerancePct: 0.25 },
  },
  {
    value: 'detailed',
    label: 'Detailed',
    tuning: { swingLookback: 2, minTouches: 1, maxLevels: 10, tolerancePct: 0.15 },
  },
];

/**
 * The most recent weekday before today, as `YYYY-MM-DD` in IST.
 *
 * A starting point, not a claim about the exchange calendar — it does not know
 * about holidays, and a holiday simply comes back with no bars and says so. The
 * point is that the date field opens on something replayable instead of empty,
 * which is otherwise the single most common reason Start fails on first use.
 */
function lastWeekdayKey(now: Date): string {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  do {
    ist.setUTCDate(ist.getUTCDate() - 1);
  } while (ist.getUTCDay() === 0 || ist.getUTCDay() === 6);
  return ist.toISOString().slice(0, 10);
}

/** Capital defaults, offered as choices so the field opens on something usable. */
const DEFAULT_CAPITAL = 100_000;

/** Nothing to show for a panel with no simulation behind it. Shared, so the
 *  identity is stable and the chart's marker effect does not re-run each pass. */
const NO_TRADES: readonly SimTrade[] = [];

/** One running chart: an instrument, and the session request that fills it. */
interface ChartPanel {
  /**
   * Identity for `@for`, so the CE panel keeps its chart instance when the PE
   * panel is added or removed beside it. Deliberately excludes the run counter:
   * pressing Start again should restart the same panel, not tear down its
   * canvas and build a new one.
   */
  key: string;
  label: string;
  leg: 'CE' | 'PE' | null;
  request: StartStreamRequest;
  /**
   * Set when a strategy run started the session and the panel should attach to
   * it rather than start its own — otherwise the chart on screen would be a
   * second replay of the same instrument, and the trade marks drawn on it would
   * belong to the other one.
   */
  sessionId: string | null;
  /**
   * The contract this panel charts, when it is one that can be paper-traded.
   *
   * `null` for an index or a future. Not an oversight: sizing needs an
   * instrument key, a lot size and a tick size, and the option chain is the
   * only endpoint the page calls that supplies all three. An index carries no
   * lot size because it is not tradable, and a future's would need a resolve
   * call this page does not make — so rather than invent a lot size, those
   * panels are simply not offered for paper trading.
   */
  contract: PaperContract | null;
  /** `contract.instrumentKey`, hoisted — the key the feed and engine agree on. */
  instrumentKey: string | null;
}

@Component({
  selector: 'app-chart-stream-page',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    NavTabsComponent,
    ChartStreamComponent,
    StrategyPanelComponent,
    PaperTradeSetupComponent,
    PaperPositionsComponent,
    TradeActivityComponent,
  ],
  template: `
    <header class="topbar">
      <div class="brand">
        <span class="mark">◧</span>
        <div>
          <h1>Chart stream</h1>
          <span class="sub">Upstox live &amp; replay</span>
        </div>
      </div>

      <app-nav-tabs />

      <div class="account">
        <span class="badge"><i class="dot"></i>Signed in</span>
        @if (auth.expiresAt(); as until) {
          <span class="until">until {{ until | date: 'shortTime' }}</span>
        }
        <button type="button" class="link" (click)="signOut()">Sign out</button>
      </div>
    </header>

    <main>
      <section class="controls" [class.busy]="chainLoading()">
        <div class="groups">
          <!-- Instrument and Replay sit side by side: TEST mode's replay
               fields are a handful of controls, not enough to earn a full row
               of their own next to Instrument's wider one. -->
          <div class="top-row">
          <!-- Instrument: the fields every session needs, always visible. -->
          <fieldset class="group">
            <legend>Instrument</legend>
            <div class="row">
              <label>
                <span>Mode</span>
                <select [(ngModel)]="mode" name="mode" (ngModelChange)="onModeChange()">
                  <option value="TEST">Test — replay a past day</option>
                  <option value="LIVE">Live</option>
                </select>
              </label>

              <label>
                <span>Kind</span>
                <select [(ngModel)]="kind" name="kind" (ngModelChange)="onKindChange()">
                  @for (k of instrumentKinds; track k.value) {
                    <option [value]="k.value">{{ k.label }}</option>
                  }
                </select>
              </label>

              <label>
                <span>Underlying</span>
                <select
                  [(ngModel)]="underlying"
                  name="underlying"
                  (ngModelChange)="onUnderlyingChange()"
                  [disabled]="underlyings().length === 0"
                >
                  @for (u of underlyings(); track u) {
                    <option [value]="u">{{ u }}</option>
                  }
                </select>
              </label>

              @if (needsExpiry()) {
                <label>
                  <span>Expiry</span>
                  <select
                    [(ngModel)]="expiry"
                    name="expiry"
                    (ngModelChange)="onExpiryChange()"
                    [disabled]="expiries().length === 0"
                  >
                    @for (e of expiries(); track e) {
                      <option [value]="e">{{ e }}{{ e === nextExpiry() ? ' · next' : '' }}</option>
                    }
                  </select>
                </label>
              }
            </div>

            @if (isOption()) {
              <div class="row legs">
                <label class="leg call">
                  <span>Call (CE)</span>
                  <select
                    [ngModel]="callStrike()"
                    name="call"
                    (ngModelChange)="callStrike.set($event)"
                    [disabled]="calls().length === 0"
                  >
                    <option [ngValue]="null">{{ chainPlaceholder(calls().length) }}</option>
                    @for (c of calls(); track c.instrumentKey) {
                      <option [ngValue]="c.strike">{{ optionLabel(c) }}</option>
                    }
                  </select>
                </label>

                <label class="leg put">
                  <span>Put (PE)</span>
                  <select
                    [ngModel]="putStrike()"
                    name="put"
                    (ngModelChange)="putStrike.set($event)"
                    [disabled]="puts().length === 0"
                  >
                    <option [ngValue]="null">{{ chainPlaceholder(puts().length) }}</option>
                    @for (p of puts(); track p.instrumentKey) {
                      <option [ngValue]="p.strike">{{ optionLabel(p) }}</option>
                    }
                  </select>
                </label>
              </div>

              @if (calls().length) {
                <p class="hint">
                  @if (pricedOn()) {
                    Close on <strong>{{ pricedOn() }}</strong> (spot {{ underlyingClose() ?? '—' }}) —
                    strikes far from the money show <code>—</code> but stay selectable.
                  } @else {
                    <strong>Live</strong> last-traded (spot {{ underlyingClose() ?? '—' }}).
                  }
                  Pick a call, a put, or both to chart side by side.
                </p>
              }
            }
          </fieldset>

          <!-- Replay: only meaningful in TEST mode, so it only exists then. -->
          @if (mode() === 'TEST') {
            <fieldset class="group">
              <legend>Replay</legend>
              <div class="row">
                <label>
                  <span>Session date</span>
                  <input
                    type="date"
                    [(ngModel)]="date"
                    name="date"
                    (ngModelChange)="onDateChange()"
                  />
                </label>

                <label>
                  <span>Speed</span>
                  <select [(ngModel)]="replaySpeed" name="replaySpeed">
                    @for (s of speeds; track s.value) {
                      <option [ngValue]="s.value">{{ s.label }}</option>
                    }
                  </select>
                </label>
              </div>
            </fieldset>
          }
          </div>

          <!-- Levels & history: opt-in annotation, collapsed by default. -->
          <details class="group collapsible">
            <summary>
              Levels &amp; history
              @if (levelChoice() !== 'off') {
                <span class="pill">{{ levelChoiceLabel() }}</span>
              }
            </summary>
            <div class="row">
              <label>
                <span>History</span>
                <select [(ngModel)]="historyDays" name="historyDays">
                  @for (h of historyChoices; track h.value) {
                    <option [ngValue]="h.value">{{ h.label }}</option>
                  }
                </select>
              </label>

              <label>
                <span>Support / resistance</span>
                <select [(ngModel)]="levelChoice" name="levels">
                  @for (l of levelChoices; track l.value) {
                    <option [ngValue]="l.value">{{ l.label }}</option>
                  }
                </select>
              </label>

              @if (levelChoice() !== 'off') {
                <label>
                  <span>S/R detail</span>
                  <select [(ngModel)]="levelSensitivity" name="levelSensitivity">
                    @for (s of levelSensitivities; track s.value) {
                      <option [ngValue]="s.value">{{ s.label }}</option>
                    }
                  </select>
                </label>
              }
            </div>
          </details>

          <!-- Strategies: also opt-in, collapsed by default. -->
          <details class="group collapsible" [open]="selected().length > 0">
            <summary>
              Strategies
              @if (selected().length) {
                <span class="pill">{{ selected().length }} on</span>
              }
            </summary>

            <div class="picker">
              <div class="chips">
                @for (s of catalogue(); track s.id) {
                  <button
                    type="button"
                    class="chip"
                    [class.on]="isSelected(s.id)"
                    [attr.aria-pressed]="isSelected(s.id)"
                    [title]="s.description"
                    (click)="toggleStrategy(s.id)"
                  >
                    <i class="mark">{{ isSelected(s.id) ? '✓' : '+' }}</i>
                    {{ s.name }}
                    <em>{{ s.timeframeMinutes }}m</em>
                  </button>
                } @empty {
                  <span class="none">{{ catalogueNote() }}</span>
                }
              </div>
            </div>

            <div class="row">
              <label class="capital">
                <span>Capital per strategy</span>
                <input
                  type="number"
                  min="1000"
                  step="5000"
                  [(ngModel)]="capital"
                  name="capital"
                  [disabled]="selected().length === 0"
                />
              </label>

              <label class="toggle">
                <input
                  type="checkbox"
                  [(ngModel)]="journal"
                  name="journal"
                  [disabled]="selected().length === 0"
                />
                <span>Record to journal</span>
              </label>
            </div>

            @if (selected().length) {
              <p class="hint">
                Each strategy gets its own ₹{{ capitalLabel() }} book per chart —
                {{ bookCount() }} book{{ bookCount() === 1 ? '' : 's' }} total. Exits are charged
                ₹40 flat; entries are not.
              </p>
            }
          </details>
        </div>

        <!-- Highest-priority controls: what to run, and at what bar width.
             Kept last so it sits immediately above the chart it starts. -->
        <div class="action-bar">
          <div class="timeframe" role="group" aria-label="Bar interval">
            @for (i of displayIntervals; track i.seconds) {
              <button
                type="button"
                [class.on]="displaySeconds() === i.seconds"
                (click)="displaySeconds.set(i.seconds)"
              >
                {{ i.label }}
              </button>
            }
          </div>

          <p class="plan">{{ plan() }}</p>

          <button type="button" class="primary" [disabled]="starting()" (click)="start()">
            {{ starting() ? 'Starting…' : 'Start' }}
          </button>
        </div>

        @if (formError(); as message) {
          <p class="notice warn">{{ message }}</p>
        }
      </section>

      @if (run(); as r) {
        <app-strategy-panel [run]="r" (stop)="stopRun()" />
      }

      <!-- Paper trading. Above the chart because it is a *decision*: the
           amount and the sizing are read before the chart is looked at, and a
           setup form below the fold is one nobody finds. The activity feed and
           the positions go underneath, where a result belongs. -->
      <app-paper-trade-setup
        [choices]="paperChoices()"
        [error]="paperError()"
        (placed)="placePaperTrade($event)"
      />

      <!-- The re-run, while it is happening. Without this the three minutes
           after pressing Simulate Trade look like the stall they used to be:
           the trade is developing, but until the strategy signals an entry
           nothing on screen has moved yet. -->
      @if (paper.simulating()) {
        <section class="simulating">
          <div class="bar"><i [style.width.%]="paper.progress() * 100"></i></div>
          <div class="say">
            <p>
              Replaying the session from the open — {{ simulationPct() }}%. The charts are drawing
              the day one bar at a time, with the indicators, levels and patterns plotting as they
              are reached.
            </p>
            <button type="button" class="ghost" (click)="stopSimulation()">Stop simulation</button>
          </div>
        </section>
      }

      <app-paper-positions
        [positions]="paper.positions()"
        [totals]="paper.totals()"
        (close)="closePaperTrade($event)"
      />

      @if (panels().length) {
        <section class="grid" [class.pair]="panels().length > 1">
          @for (panel of panels(); track panel.key) {
            <app-chart-stream
              [request]="panel.request"
              [sessionId]="panel.sessionId"
              [trades]="tradesFor(panel.sessionId)"
              [paperPositions]="paper.positionsFor(keyFor(panel))"
              [label]="panel.label"
              [leg]="panel.leg"
              [displaySeconds]="displaySeconds()"
              [playbackUntilMs]="paper.playbackAt()"
              (candle)="onCandle(panel, $event)"
              (sessionEnded)="onSessionEnded(keyFor(panel))"
            />
          }
        </section>

      } @else {
        <section class="placeholder">
          <p>Nothing streaming yet.</p>
          <p class="hint">
            Choose an instrument above and press <strong>Start</strong>. Select a call
            <em>and</em> a put to watch both legs of a strategy at once.
          </p>
        </section>
      }

      <!-- Below the chart, and outside the @if on purpose: the feed of a
           session that has just been replaced is still the record of what
           happened, and hiding it the moment the panels go would delete the
           only place that record is readable. -->
      <app-trade-activity [events]="paper.events()" />
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1.5rem;
      border-bottom: 1px solid var(--border);
      background: rgba(11, 15, 20, 0.85);
      backdrop-filter: blur(8px);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.7rem;
    }

    .mark {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--accent), #1b6fae);
      color: #06121d;
      font-size: 1rem;
    }

    h1 {
      font-size: 0.95rem;
      line-height: 1.2;
    }

    .sub {
      font-size: 0.72rem;
      color: var(--text-faint);
    }

    .account {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.2rem 0.5rem;
      border-radius: 99px;
      background: rgba(38, 161, 123, 0.14);
      color: #4fd1a5;
      font-weight: 500;
    }

    .badge .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    main {
      max-width: 1600px;
      margin: 0 auto;
      padding: 1.25rem 1.5rem 3rem;
      display: grid;
      gap: 1.25rem;
    }

    .simulating {
      display: grid;
      gap: 0.4rem;
      padding: 0.6rem 0.9rem;
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: var(--radius);
      background: rgba(56, 189, 248, 0.07);
    }

    .simulating .bar {
      height: 4px;
      border-radius: 99px;
      background: rgba(255, 255, 255, 0.08);
      overflow: hidden;
    }

    .simulating .bar i {
      display: block;
      height: 100%;
      background: var(--accent);
      transition: width 0.2s linear;
    }

    .simulating .say {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .simulating p {
      margin: 0;
      font-size: 0.73rem;
      color: var(--text-muted);
    }

    .simulating .ghost {
      padding: 0.3rem 0.7rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: transparent;
      color: var(--text-muted);
      font-size: 0.72rem;
      cursor: pointer;
      white-space: nowrap;
    }

    .simulating .ghost:hover {
      color: var(--text);
      border-color: var(--text-faint);
    }

    .controls {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      padding: 1rem 1.1rem;
      transition: opacity 0.15s ease;
    }

    .controls.busy .groups {
      opacity: 0.7;
    }

    /* --- action bar: Start + timeframe, the two things used every time --- */

    .action-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.9rem;
      padding-top: 0.9rem;
      margin-top: 1rem;
      border-top: 1px solid var(--border);
    }

    .action-bar .plan {
      flex: 1 1 240px;
      margin: 0;
      font-size: 0.78rem;
      color: var(--text-muted);
    }

    .action-bar .primary {
      padding: 0.55rem 1.4rem;
      font-size: 0.85rem;
      font-weight: 700;
      box-shadow: 0 0 0 1px rgba(59, 167, 255, 0.15);
    }

    /* --- grouped fields: clusters instead of one flat row ---------------- */

    .groups {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .top-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    /* Instrument is the wider of the two — Kind/Underlying/Expiry plus the
       leg pickers — so it gets more of the row than Replay's two fields. */
    .top-row > fieldset.group:first-child {
      flex: 2 1 360px;
    }

    .top-row > fieldset.group:last-child {
      flex: 1 1 220px;
    }

    .group {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      padding: 0.75rem 0.85rem;
      margin: 0;
    }

    fieldset.group {
      min-width: 0;
    }

    .group legend,
    .group summary {
      padding: 0 0.2rem;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--text-faint);
    }

    .group.collapsible summary {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0;
      cursor: pointer;
      list-style: none;
    }

    .group.collapsible summary::-webkit-details-marker {
      display: none;
    }

    .group.collapsible summary::before {
      content: '▸';
      font-size: 0.6rem;
      color: var(--text-faint);
      transition: transform 0.12s ease;
    }

    .group.collapsible[open] summary::before {
      transform: rotate(90deg);
    }

    .group.collapsible[open] summary {
      margin-bottom: 0.65rem;
    }

    .group summary .pill {
      padding: 0.05rem 0.45rem;
      border-radius: 99px;
      background: rgba(59, 167, 255, 0.14);
      color: var(--accent);
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: none;
    }

    .group .row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 0.65rem 0.8rem;
      margin-top: 0.65rem;
    }

    .group legend + .row,
    .group .row:first-child {
      margin-top: 0.65rem;
    }

    .row.legs {
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }

    .group .hint {
      margin: 0.65rem 0 0;
      font-size: 0.72rem;
      line-height: 1.5;
      color: var(--text-faint);
    }

    .group .hint code {
      color: var(--text-muted);
    }

    /* --- strategy picker ------------------------------------------------- */

    .picker {
      min-width: 0;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    /* Chips rather than a multi-select: a native multiple-select needs a
       modifier key nobody discovers, and hides the description a strategy
       needs to be chosen on. */
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.3rem 0.6rem;
      border: 1px solid var(--border);
      border-radius: 99px;
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.75rem;
      cursor: pointer;
      transition:
        border-color 0.12s ease,
        color 0.12s ease,
        background 0.12s ease;
    }

    .chip:hover {
      border-color: var(--accent);
      color: var(--text);
    }

    .chip.on {
      border-color: rgba(79, 209, 165, 0.6);
      background: rgba(38, 161, 123, 0.14);
      color: #4fd1a5;
    }

    .chip .mark {
      font-style: normal;
      font-size: 0.7rem;
      opacity: 0.8;
    }

    .chip em {
      font-style: normal;
      font-size: 0.66rem;
      opacity: 0.6;
      font-variant-numeric: tabular-nums;
    }

    .chips .none {
      font-size: 0.72rem;
      color: var(--text-faint);
    }

    label.toggle {
      flex-direction: row;
      align-items: center;
      gap: 0.4rem;
      justify-self: start;
      align-self: end;
      padding-bottom: 0.35rem;
    }

    label.toggle > span {
      font-size: 0.72rem;
      text-transform: none;
      letter-spacing: 0;
      font-weight: 400;
      color: var(--text-muted);
    }

    label.toggle input {
      width: auto;
      accent-color: var(--accent);
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      min-width: 0;
    }

    label > span {
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-faint);
    }

    /* The two option legs are the only place colour carries meaning in the
       form, and it is the same green/red the charts use for direction. */
    label.leg.call > span {
      color: #4fd1a5;
    }

    label.leg.put > span {
      color: #ff8a87;
    }

    label.leg.call select:hover:not(:disabled) {
      border-color: rgba(79, 209, 165, 0.6);
    }

    label.leg.put select:hover:not(:disabled) {
      border-color: rgba(255, 138, 135, 0.6);
    }

    .timeframe {
      display: inline-flex;
      padding: 2px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface-2);
    }

    .timeframe button {
      border: 0;
      background: none;
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
    }

    .timeframe button.on {
      background: var(--surface-3);
      color: var(--text);
    }

    .notice {
      margin: 0.85rem 0 0;
      padding: 0.5rem 0.7rem;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      font-size: 0.78rem;
      color: var(--text-muted);
      line-height: 1.55;
    }

    .notice.warn {
      background: rgba(224, 164, 88, 0.12);
      color: #f0c48a;
    }

    .notice strong {
      color: var(--text);
    }

    .grid {
      display: grid;
      gap: 1rem;
    }

    /* Two legs sit side by side once there is room for both to stay readable;
       below that they stack, which is still a comparison, just a vertical one. */
    @media (min-width: 1180px) {
      .grid.pair {
        grid-template-columns: 1fr 1fr;
      }
    }

    .placeholder {
      display: grid;
      place-content: center;
      gap: 0.35rem;
      min-height: 320px;
      padding: 2rem;
      border: 1px dashed var(--border-strong);
      border-radius: var(--radius);
      text-align: center;
      color: var(--text-muted);
    }

    .placeholder p {
      margin: 0;
    }

    .placeholder .hint {
      max-width: 46ch;
      font-size: 0.82rem;
      color: var(--text-faint);
    }
  `,
})
export class ChartStreamPageComponent {
  private readonly api = inject(ChartStreamApiService);
  private readonly strategyApi = inject(StrategyApiService);
  private readonly simulation = inject(SimulationSocketService);
  /** Protected: the template reads its positions, totals and events directly. */
  protected readonly paper = inject(PaperTradeService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(UpstoxAuthService);
  private readonly router = inject(Router);

  protected readonly instrumentKinds = INSTRUMENT_KINDS;
  protected readonly speeds = REPLAY_SPEEDS;
  protected readonly historyChoices = HISTORY_CHOICES;
  protected readonly displayIntervals = DISPLAY_INTERVALS;
  protected readonly levelChoices = LEVEL_CHOICES;
  protected readonly levelSensitivities = LEVEL_SENSITIVITIES;

  protected readonly mode = signal<ChartSessionMode>('TEST');
  protected readonly kind = signal<InstrumentKind>('OPTIONS');
  protected readonly underlying = signal('');
  /** The two legs are independent: either, neither, or both may be charted. */
  protected readonly callStrike = signal<number | null>(null);
  protected readonly putStrike = signal<number | null>(null);
  protected readonly expiry = signal('');
  protected readonly date = signal(lastWeekdayKey(new Date()));
  protected readonly replaySpeed = signal(0);
  protected readonly historyDays = signal(0);
  /**
   * Whether — and how — to plot support and resistance with the chart.
   *
   * A *request* field rather than a display toggle, unlike the bar interval:
   * finding levels needs bars the chart itself may not have (a LIVE session
   * opened at 09:20 has five), so the backend fetches prior sessions for the
   * analysis. Each panel's own S/R button still turns the drawn lines on and
   * off afterwards without restarting anything.
   */
  protected readonly levelChoice = signal<LevelChoice>('off');
  protected readonly levelSensitivity = signal('balanced');
  /**
   * Bar width on screen, in seconds.
   *
   * A *display* concern, not a request field: the backend streams one-minute
   * bars and the chart resamples them, so changing this re-buckets what is
   * already on screen instead of restarting the session. That is also what
   * lets LIVE mode offer every interval — the wire is always `1minute`, which
   * is the only thing the live candle builder produces.
   */
  protected readonly displaySeconds = signal<number>(60);

  /**
   * Every list below is server-supplied and never hardcoded — the instrument
   * master resyncs daily, contracts expire, and strike ladders move with the
   * underlying. A baked-in list is wrong by the next trading day.
   */
  protected readonly underlyings = signal<string[]>([]);
  protected readonly expiries = signal<string[]>([]);
  protected readonly calls = signal<PricedOptionContract[]>([]);
  protected readonly puts = signal<PricedOptionContract[]>([]);
  protected readonly chainLoading = signal(false);
  /** The date the listed closes belong to; empty when the chain is unpriced. */
  protected readonly pricedOn = signal('');
  protected readonly underlyingClose = signal<number | null>(null);

  protected readonly formError = signal<string | null>(null);
  protected readonly panels = signal<ChartPanel[]>([]);

  /* --- paper trading ---------------------------------------------------- */

  /**
   * Why the engine refused the last order.
   *
   * Separate from {@link formError}, which is about starting a session: a
   * rejected paper order leaves a perfectly good chart running, and putting the
   * two in one field would have a sizing complaint appear above the instrument
   * picker.
   */
  protected readonly paperError = signal<string | null>(null);

  /**
   * Instrument keys learned from the feed, by panel key.
   *
   * An option's key comes from the chain, which lists it alongside the lot size
   * and tick size. An index or a future has no such listing on this page — but
   * every candle carries the key of the instrument it belongs to, so the first
   * bar a panel receives identifies it exactly. That is what lets an index or a
   * future be paper-traded at all: the user supplies the lot size, and the feed
   * supplies the key, and between them there is nothing left to resolve.
   */
  private readonly discoveredKeys = signal<ReadonlyMap<string, string>>(new Map());

  /**
   * The contracts on screen, with the best price available for each.
   *
   * The feed's price wins over the chain's whenever a bar has arrived: the
   * chain is a *close* — the previous session's when live, the replayed day's
   * when testing — and sizing a trade against it three hours into a replay
   * would size against a number the chart has long since left behind. Until the
   * first bar lands there is nothing better, so the chain's premium is used and
   * labelled as such rather than showing an em dash on a contract that does
   * have a known price.
   */
  protected readonly paperChoices = computed<PaperTradeChoice[]>(() => {
    const choices: PaperTradeChoice[] = [];
    for (const panel of this.panels()) {
      const key = this.keyFor(panel);
      // No key yet means no bar has arrived for this panel and the chain does
      // not list it. There is nothing to trade against until one does.
      if (!key) continue;

      const contract = panel.contract ?? this.contractFromPanel(panel, key);
      const live = this.paper.priceOf(key);
      const quoted = panel.contract ? this.chainPriceFor(panel.contract) : null;
      choices.push({
        contract,
        price: live ?? quoted,
        source: live !== null ? 'feed' : 'chain',
      });
    }
    return choices;
  });

  /* --- strategy simulation ---------------------------------------------- */

  protected readonly catalogue = signal<StrategyDescriptor[]>([]);
  protected readonly catalogueNote = signal('Loading…');
  /** Ids, in the order they were picked. Empty = chart only, no simulation. */
  protected readonly selected = signal<string[]>([]);
  protected readonly capital = signal(DEFAULT_CAPITAL);
  protected readonly journal = signal(false);
  protected readonly starting = signal(false);

  /**
   * The run as the backend last described it.
   *
   * Replaced wholesale on every socket frame — each one carries the complete
   * run — so nothing here reconciles or accumulates, and a reconnect needs no
   * special case.
   */
  protected readonly run = signal<SimulationRunSnapshot | null>(null);
  private runSocket: Subscription | null = null;

  /**
   * Trades keyed by the chart session that produced them.
   *
   * Computed rather than filtered in the template so each panel gets a *stable*
   * array reference between frames: the chart redraws its markers whenever the
   * input identity changes, and a fresh array per change-detection pass would
   * rebuild every marker on every mouse move.
   */
  private readonly tradesBySession = computed(() => {
    const bySession = new Map<string, SimTrade[]>();
    for (const book of this.run()?.books ?? []) {
      const existing = bySession.get(book.sessionId);
      if (existing) existing.push(...book.trades);
      else bySession.set(book.sessionId, [...book.trades]);
    }
    return bySession;
  });

  protected readonly isOption = computed(() => this.kind() === 'OPTIONS');
  protected readonly needsExpiry = computed(() => this.kind() !== 'INDEX');

  /** Expiries arrive ascending, so the nearest one is simply the first. */
  protected readonly nextExpiry = computed(() => this.expiries()[0] ?? '');

  /** What pressing Start will do, stated before it is pressed. */
  protected readonly plan = computed(() => {
    const legs = this.selectedLegs();
    if (!legs.length) {
      return this.isOption()
        ? 'Select a call and/or a put to chart.'
        : `Charts ${this.underlying() || 'the underlying'}.`;
    }
    const what =
      legs.length === 1
        ? `Charts ${legs[0].label}.`
        : `Charts ${legs[0].label} and ${legs[1].label} side by side.`;
    return `${what}${this.levelPlan()}${this.strategyPlan()}`;
  });

  /** The simulation half of the plan line — empty when no strategy is picked. */
  private readonly strategyPlan = computed(() => {
    const count = this.selected().length;
    if (count === 0) return '';
    const books = this.bookCount();
    return ` Runs ${count} ${count === 1 ? 'strategy' : 'strategies'} over ${books} paper book${
      books === 1 ? '' : 's'
    }.`;
  });

  /** The S/R half of the plan line — empty when levels are off. */
  private readonly levelPlan = computed(() => {
    switch (this.levelChoice()) {
      case 'swing':
        return ' Plots swing support & resistance.';
      case 'pivot':
        return ' Plots the previous session’s pivot points.';
      case 'both':
        return ' Plots swing levels and pivot points.';
      default:
        return '';
    }
  });

  /**
   * The contracts currently chosen, in call-then-put order.
   *
   * One list rather than two nullable fields because everything downstream —
   * validation, the plan line, the panels — wants "what is selected", and the
   * count is the only thing that differs between one chart and two.
   */
  private readonly selectedLegs = computed<{ leg: 'CE' | 'PE'; strike: number; label: string }[]>(
    () => {
      if (!this.isOption()) return [];
      const legs: { leg: 'CE' | 'PE'; strike: number; label: string }[] = [];
      const call = this.callStrike();
      if (call !== null) {
        legs.push({ leg: 'CE', strike: call, label: this.contractName('CE', call) });
      }
      const put = this.putStrike();
      if (put !== null) {
        legs.push({ leg: 'PE', strike: put, label: this.contractName('PE', put) });
      }
      return legs;
    },
  );

  /** What a run will cost in books: one per strategy per chart. */
  protected readonly bookCount = computed(
    () => this.selected().length * Math.max(1, this.plannedCharts()),
  );

  /** Charts a Start would open, given what is selected right now. */
  private readonly plannedCharts = computed(() =>
    this.isOption() ? this.selectedLegs().length : 1,
  );

  protected readonly capitalLabel = computed(() =>
    Math.round(Number(this.capital()) || 0).toLocaleString('en-IN'),
  );

  /** The short label for the current S/R choice, for the collapsed group's pill. */
  protected readonly levelChoiceLabel = computed(
    () => LEVEL_CHOICES.find((l) => l.value === this.levelChoice())?.label ?? '',
  );

  constructor() {
    this.loadUnderlyings();
    this.loadCatalogue();
  }

  protected isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  protected toggleStrategy(id: string): void {
    this.selected.update((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );
  }

  /** The trades to mark on one panel's chart, or a shared empty list. */
  protected tradesFor(sessionId: string | null): readonly SimTrade[] {
    if (!sessionId) return NO_TRADES;
    return this.tradesBySession().get(sessionId) ?? NO_TRADES;
  }

  /* --- paper trading ---------------------------------------------------- */

  /**
   * A bar from one of the panels, handed to the simulation engine.
   *
   * Every panel's candles go into the one engine, which routes them by
   * instrument key — so a call and a put streaming side by side each mark their
   * own positions, and a position on a contract nothing is charting simply
   * never moves. No filtering is needed here, and doing any would be the page
   * second-guessing a routing decision the engine already makes correctly.
   */
  /**
   * Ends the replay early and puts the charts back as they were.
   *
   * "As they were" is literal and costs nothing: the replay only ever narrowed
   * what was drawn, so clearing the cursor redraws the full session from the
   * buffer each panel still holds. No session is restarted and nothing is
   * refetched.
   */
  protected stopSimulation(): void {
    this.paper.stopSimulation();
  }

  /** Whole percent, so the label does not flicker through decimals. */
  protected simulationPct(): number {
    return Math.round(this.paper.progress() * 100);
  }

  protected onCandle(panel: ChartPanel, event: ChartCandleEvent): void {
    // The first bar names the instrument. Recorded once and then left alone, so
    // this is not a signal write per candle — an instant replay delivers a
    // whole day in one burst, and a write per bar would be a change-detection
    // pass per bar for a value that never changes after the first.
    if (!this.keyFor(panel)) {
      this.discoveredKeys.update((keys) => new Map(keys).set(panel.key, event.instrumentKey));
    }
    this.paper.onCandle(event);
  }

  /**
   * The instrument key for a panel: the chain's if it had one, else the feed's.
   *
   * `null` only in the window between a panel starting and its first bar
   * arriving, which for an option is never — the chain has already said.
   */
  protected keyFor(panel: ChartPanel): string | null {
    return panel.instrumentKey ?? this.discoveredKeys().get(panel.key) ?? null;
  }

  /**
   * A tradable contract for a panel the option chain never described.
   *
   * The lot size is deliberately `0`: this page has no honest source for an
   * index's or a future's lot, and guessing one would size every trade wrongly
   * while looking authoritative. The setup form asks the user for it, and
   * refuses to place the order until it has one.
   */
  private contractFromPanel(panel: ChartPanel, instrumentKey: string): PaperContract {
    return {
      instrumentKey,
      tradingsymbol: panel.label,
      underlying: panel.request.instrument.underlying,
      expiry: panel.request.instrument.expiry ?? null,
      strike: panel.request.instrument.strike ?? null,
      leg: panel.leg,
      lotSize: 0,
      tickSize: 0.05,
    };
  }

  /**
   * A panel's feed has ended, so anything still open on it is squared off.
   *
   * Scoped to the instrument rather than squaring off the book: with a call and
   * a put on screen, one leg's replay finishing says nothing about the other,
   * and closing both would exit a live position because an unrelated one ran
   * out of bars.
   */
  protected onSessionEnded(instrumentKey: string | null): void {
    if (!instrumentKey) return;
    this.paper.endSession(instrumentKey);
  }

  /**
   * Places a paper trade. Nothing is sent to a broker — see the engine.
   *
   * The engine re-derives the sizing and can still refuse, even though the form
   * only enables the button on a valid plan: the price moves between the render
   * and the click, and the engine sizing against the newer one is the whole
   * reason it is allowed to say no.
   */
  protected placePaperTrade(request: PaperOrderRequest): void {
    this.paperError.set(null);

    // A signal strategy needs the overlay's retests in hand *before* the order
    // is placed: the engine re-runs the recorded session the moment it accepts
    // one, and retests arriving a round trip later would miss every signal of
    // the morning. Fetched once per contract and then reused.
    const strategy = paperStrategyById(request.strategyId);
    const key = request.contract.instrumentKey;
    if (strategy?.needsRetests && !this.paper.hasRetests(key)) {
      this.loadRetestsThenPlace(request);
      return;
    }

    this.commitPaperTrade(request);
  }

  private commitPaperTrade(request: PaperOrderRequest): void {
    const result = this.paper.place(request);
    if ('error' in result) this.paperError.set(result.error);
  }

  /**
   * Fetches the retests for a contract, then places the order behind them.
   *
   * The **standalone** endpoint rather than the session one, and at
   * `1minute` regardless of the interval on screen. Both parts matter: the
   * strategy's rule is written in one-minute candles, so asking for the
   * displayed interval would hand it signals found on 15-minute bars and its
   * "signal candle" would mean something else entirely. The standalone
   * endpoint takes an instrument and a date, so it also works for a session
   * that has already completed — which, at the default replay speed, is every
   * session by the time anyone presses the button.
   *
   * This is the overlay's own detection, unchanged: the same endpoint the
   * chart's Retests toggle calls, with the same defaults.
   */
  private loadRetestsThenPlace(request: PaperOrderRequest): void {
    const contract = request.contract;
    const panel = this.panels().find((p) => this.keyFor(p) === contract.instrumentKey);
    if (!panel) {
      this.paperError.set('That contract is no longer charted.');
      return;
    }

    this.paperError.set('Loading retest signals…');
    this.api
      .retests({
        instrument: panel.request.instrument,
        interval: '1minute',
        ...(panel.request.date ? { date: panel.request.date } : {}),
        // Unresolved retests are the ones happening *now*, which on a live
        // chart are the only ones there are to trade.
        includeUnresolved: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (found) => {
          this.paper.setRetests(contract.instrumentKey, found.retests);
          this.paperError.set(null);
          this.commitPaperTrade(request);
        },
        error: (e: ChartStreamError) =>
          this.paperError.set(`Could not load retest signals — ${e.message}`),
      });
  }

  /** Exits an open position at the last marked price, or drops an unfilled order. */
  protected closePaperTrade(id: string): void {
    this.paper.close(id);
  }

  /**
   * The premium the option chain lists for a contract, if it lists one.
   *
   * Searched by instrument key rather than by strike: the two ladders are
   * rebuilt whenever the expiry or the date changes, and a strike alone does not
   * say which leg it belongs to.
   */
  private chainPriceFor(contract: PaperContract): number | null {
    const ladder = contract.leg === 'PE' ? this.puts() : this.calls();
    return ladder.find((c) => c.instrumentKey === contract.instrumentKey)?.ltp ?? null;
  }

  protected stopRun(): void {
    const runId = this.run()?.runId;
    if (!runId) return;
    this.strategyApi
      .stop(runId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (run) => this.run.set(run),
        error: (e: ChartStreamError) => this.formError.set(e.message),
      });
  }

  private loadCatalogue(): void {
    this.strategyApi
      .catalogue()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ strategies }) => {
          this.catalogue.set(strategies);
          this.catalogueNote.set(strategies.length ? '' : 'This build ships no strategies.');
        },
        // Not `formError`: a catalogue that cannot be read is a missing
        // feature, not a broken form, and charting still works without it.
        error: (e: ChartStreamError) =>
          this.catalogueNote.set(`Could not load strategies — ${e.message}`),
      });
  }

  /**
   * Ends the Upstox session and returns to the login screen.
   *
   * Navigated explicitly rather than left to the interceptor: nothing is
   * in flight to receive a 401, so without this the user would sit on a page
   * whose next request happens to fail.
   */
  protected signOut(): void {
    this.auth
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.router.navigate(['/login']));
  }

  protected chainPlaceholder(count: number): string {
    if (this.chainLoading()) return 'Loading…';
    return count === 0 ? 'No contracts' : 'None';
  }

  /**
   * `24500 · ₹99.65 — NIFTY 24500 CE 25 AUG 26`
   *
   * Strike first because that is what the eye scans for, then the premium so
   * the ladder reads as a price ladder. An unpriced contract keeps its slot and
   * shows a dash rather than being hidden — it is still selectable.
   */
  protected optionLabel(contract: PricedOptionContract): string {
    const price = contract.ltp === null ? '—' : `₹${contract.ltp}`;
    return `${contract.strike} · ${price} — ${contract.tradingsymbol}`;
  }

  /** The tradingsymbol for a chosen strike, falling back to a readable name. */
  private contractName(leg: 'CE' | 'PE', strike: number): string {
    const ladder = leg === 'CE' ? this.calls() : this.puts();
    return (
      ladder.find((c) => c.strike === strike)?.tradingsymbol ??
      `${this.underlying()} ${strike} ${leg}`
    );
  }

  /** Underlyings first: everything else is scoped by whichever one is chosen. */
  private loadUnderlyings(): void {
    this.api
      .underlyings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ underlyings }) => {
          this.underlyings.set(underlyings);
          if (!underlyings.includes(this.underlying())) {
            this.underlying.set(underlyings[0] ?? '');
          }
          this.onUnderlyingChange();
        },
        error: (e: ChartStreamError) => this.formError.set(e.message),
      });
  }

  protected onKindChange(): void {
    this.clearLegs();
    if (this.needsExpiry()) this.loadExpiries();
  }

  protected onUnderlyingChange(): void {
    this.clearLegs();
    this.expiry.set('');
    this.calls.set([]);
    this.puts.set([]);
    if (this.needsExpiry()) this.loadExpiries();
  }

  protected onExpiryChange(): void {
    this.clearLegs();
    this.loadChain();
  }

  /**
   * The listed closes are as of the replay date, so changing the date changes
   * the prices. The strikes survive — the same contract at a different date is
   * still the contract the user picked.
   */
  protected onDateChange(): void {
    this.loadChain();
  }

  /** LIVE prices the chain as it stands now; TEST prices it as of the date. */
  protected onModeChange(): void {
    this.loadChain();
  }

  private clearLegs(): void {
    // A strike carried over would name a contract that may not exist on the
    // new underlying or expiry.
    this.callStrike.set(null);
    this.putStrike.set(null);
  }

  protected loadExpiries(): void {
    const underlying = this.underlying().trim();
    if (!underlying) return;
    this.api
      .expiries(underlying)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ expiries }) => {
          this.expiries.set(expiries);
          // Default to the nearest expiry rather than leaving it blank — that
          // is the one a user asking for "NIFTY calls" almost always means.
          if (!expiries.includes(this.expiry())) this.expiry.set(expiries[0] ?? '');
          this.loadChain();
        },
        error: (e: ChartStreamError) => this.formError.set(e.message),
      });
  }

  private loadChain(): void {
    const underlying = this.underlying().trim();
    const expiry = this.expiry();
    if (!this.isOption() || !underlying || !expiry) {
      this.calls.set([]);
      this.puts.set([]);
      return;
    }

    this.chainLoading.set(true);
    // A date asks for that session's closes; no date asks for the chain as it
    // stands now, which the backend answers in one authenticated call covering
    // every strike. LIVE mode therefore shows real last-traded premiums.
    const pricedOn = this.mode() === 'TEST' ? this.date() : '';
    this.api
      .chain(underlying, expiry, pricedOn || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (chain) => {
          this.calls.set(chain.calls);
          this.puts.set(chain.puts);
          this.pricedOn.set(chain.pricedOn ?? '');
          this.underlyingClose.set(chain.underlyingPrice ?? null);
          this.chainLoading.set(false);
        },
        error: (e: ChartStreamError) => {
          this.calls.set([]);
          this.puts.set([]);
          this.pricedOn.set('');
          this.underlyingClose.set(null);
          this.chainLoading.set(false);
          this.formError.set(e.message);
        },
      });
  }

  /**
   * Builds one session request per selected leg and hands them to the charts.
   *
   * Two legs are two independent backend sessions, not one multi-instrument
   * session: they are already independent on the wire (a session streams one
   * instrument key), and keeping them separate means one leg failing to
   * resolve leaves the other charting rather than taking both down.
   */
  protected start(): void {
    this.formError.set(null);

    const underlying = this.underlying().trim();
    if (!underlying) {
      this.formError.set('Pick an underlying.');
      return;
    }
    if (this.needsExpiry() && !this.expiry()) {
      this.formError.set('Expiry is required for futures and options.');
      return;
    }
    // TEST without a date is a 400 from the backend, not an ignored field.
    if (this.mode() === 'TEST' && !this.date()) {
      this.formError.set('Pick the session date to replay.');
      return;
    }

    const panels = this.isOption()
      ? this.selectedLegs().map((leg) =>
          this.panelFor(
            { type: leg.leg, underlying, strike: leg.strike, expiry: this.expiry() },
            leg.label,
            leg.leg,
            this.contractFor(leg.leg, leg.strike),
          ),
        )
      : [
          this.panelFor(
            {
              type: this.kind() as InstrumentType,
              underlying,
              ...(this.needsExpiry() ? { expiry: this.expiry() } : {}),
            },
            underlying,
            null,
          ),
        ];

    if (!panels.length) {
      this.formError.set('Pick a call, a put, or both.');
      return;
    }

    // Whatever was running is finished with — its socket, and the numbers on
    // screen that belong to it.
    this.releaseRun();
    // And the paper book with it. Its positions were marked against the series
    // being replaced, so carrying them into a different day — or a different
    // instrument — would show a P&L computed from one chart on top of another.
    this.paper.reset();
    this.paperError.set(null);
    // Keyed by panel key, which survives a restart — so a stale entry would
    // point a new session's panel at the previous instrument.
    this.discoveredKeys.set(new Map());

    const strategies = this.selected();
    if (strategies.length === 0) {
      // No strategies: the panels start their own sessions exactly as before.
      this.panels.set(panels);
      return;
    }

    const capital = Number(this.capital());
    if (!Number.isFinite(capital) || capital <= 0) {
      this.formError.set('Capital must be a positive number.');
      return;
    }

    // With strategies selected the *simulation* starts the sessions, because it
    // has to be subscribed to them before their bars are published — at
    // `replaySpeed: 0` the whole day is over in milliseconds. The panels then
    // attach to the very sessions the strategies are reading, so the marks and
    // the candles under them come from one replay rather than two.
    this.starting.set(true);
    this.strategyApi
      .start({
        capital,
        strategies,
        charts: panels.map((panel) => panel.request),
        journal: this.journal(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (run) => {
          this.starting.set(false);
          this.run.set(run);
          // Paired by position: the backend starts one session per entry of
          // `charts`, in the order it was given them.
          this.panels.set(
            panels.map((panel, index) => ({
              ...panel,
              sessionId: run.charts[index]?.sessionId ?? null,
            })),
          );
          this.listenToRun(run.runId);
        },
        error: (e: ChartStreamError) => {
          this.starting.set(false);
          this.formError.set(e.message);
        },
      });
  }

  /**
   * Follows a run to its end.
   *
   * Every frame is a complete snapshot, so this is a straight assignment — no
   * merge, no reconciliation, and a dropped frame or a reconnect costs nothing.
   */
  private listenToRun(runId: string): void {
    this.runSocket?.unsubscribe();
    this.runSocket = this.simulation
      .connect(runId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => this.run.set(event.run),
        error: () => {
          /* the socket reconnects itself; the last snapshot stays on screen */
        },
      });
  }

  /**
   * Lets go of the current run without stopping it.
   *
   * Deliberately not a `POST …/stop`: pressing Start again is "show me this
   * instead", and silently stopping a live run the user may still have been
   * reading would be a surprise. The run ages out of the backend on its own.
   */
  private releaseRun(): void {
    this.runSocket?.unsubscribe();
    this.runSocket = null;
    this.run.set(null);
  }

  /**
   * The `levels` block for a start request, or `null` for an un-annotated chart.
   *
   * `interval` is the one field the chart cannot leave to the backend default:
   * the wire is always `1minute` and the chart resamples on screen, so without
   * naming the *displayed* interval here the backend would find levels in
   * one-minute wiggles and the browser would draw them over 15-minute bars.
   */
  private levelOptions(): StreamLevelsOptions | null {
    const choice = this.levelChoice();
    if (choice === 'off') return null;

    const sensitivity =
      LEVEL_SENSITIVITIES.find((s) => s.value === this.levelSensitivity()) ??
      LEVEL_SENSITIVITIES[1]!;

    return {
      method: choice,
      interval: intervalNameFor(this.displaySeconds()),
      ...sensitivity.tuning,
    };
  }

  private panelFor(
    instrument: InstrumentRequest,
    label: string,
    leg: 'CE' | 'PE' | null,
    contract: PaperContract | null = null,
  ): ChartPanel {
    const live = this.mode() === 'LIVE';
    const history = Number(this.historyDays());
    // `date` and `replaySpeed` are TEST-only: sending either with LIVE is a
    // 400, not an ignored field. `historyDays` is the exception — prior
    // sessions are just as useful behind a live chart — so it goes on both,
    // and only when non-zero.
    //
    // `interval` is always `1minute`: it is the only bar the live builder
    // produces, it is the finest a replay can source, and the chart resamples
    // it on screen. Asking the backend for coarser bars would fix the
    // timeframe for the life of the session and buy nothing.
    //
    // `levels` is the exception to the LIVE/TEST split below: both modes
    // publish the same CANDLE events through the same aggregator, so both are
    // annotated by the same code and a replay behaves exactly as live does.
    const levels = this.levelOptions();
    const request: StartStreamRequest = live
      ? {
          mode: 'LIVE',
          instrument,
          interval: '1minute',
          ...(history > 0 ? { historyDays: history } : {}),
          ...(levels ? { levels } : {}),
        }
      : {
          mode: 'TEST',
          instrument,
          interval: '1minute',
          date: this.date(),
          replaySpeed: Number(this.replaySpeed()),
          ...(history > 0 ? { historyDays: history } : {}),
          ...(levels ? { levels } : {}),
        };

    return {
      key: `${instrument.type}:${instrument.underlying}:${instrument.expiry ?? ''}:${
        instrument.strike ?? ''
      }`,
      label,
      leg,
      request,
      // Filled in by `start()` when a simulation supplies the session.
      sessionId: null,
      contract,
      instrumentKey: contract?.instrumentKey ?? null,
    };
  }

  /**
   * The chain row for a chosen strike, as a contract the engine can size.
   *
   * `null` when the ladder has no such row — a strike selected before the chain
   * reloaded for a new date. Returning `null` costs only the paper-trade option
   * on that panel; the chart itself still starts, because the backend resolves
   * the instrument from the request rather than from this.
   */
  private contractFor(leg: 'CE' | 'PE', strike: number): PaperContract | null {
    const row = (leg === 'CE' ? this.calls() : this.puts()).find((c) => c.strike === strike);
    if (!row) return null;
    return {
      instrumentKey: row.instrumentKey,
      tradingsymbol: row.tradingsymbol,
      underlying: this.underlying().trim(),
      expiry: this.expiry() || null,
      strike: row.strike,
      leg,
      lotSize: row.lotSize,
      tickSize: row.tickSize,
    };
  }
}
