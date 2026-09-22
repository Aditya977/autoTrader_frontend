import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PreferencesService } from '../../shared/preferences.service';
import type { StrategyDescriptor } from '../../strategy/strategy.models';
import { addDays, todayKey } from '../format';
import type {
  RunBacktestRequest,
  StartLiveTradingRequest,
  TradingInstrument,
} from '../trading.models';
import { InstrumentListEditorComponent } from './instrument-list-editor.component';

/**
 * What to trade and with how much — one form for live trading and for a
 * backtest.
 *
 * One form on purpose: a backtest exists to say what a live session would have
 * done, and two forms would drift until the backtest was configured unlike the
 * live run it is supposed to predict. The backtest variant adds a date range
 * and nothing else.
 *
 * **The strategy's rules are not editable here.** Its stop buffer, quality
 * floor and the rest are defined in the strategy itself and shown read-only,
 * so every run — live or backtest — trades exactly the rule that was written
 * and reviewed, not a variant somebody typed into a box.
 *
 * Sizing is not asked for either: every entry takes the most whole lots the
 * free balance (capped by "max per trade", if set) affords at the fill price.
 */
@Component({
  selector: 'app-trading-setup-form',
  standalone: true,
  imports: [FormsModule, InstrumentListEditorComponent],
  template: `
    <form class="form" (ngSubmit)="submit()">
      <div class="columns">
        <div class="col">
          <h3>Account &amp; strategy</h3>
          <div class="grid">
            <label class="wide">
              <span>Strategy</span>
              <select
                name="strategy"
                [ngModel]="strategyId()"
                (ngModelChange)="strategyId.set($event)"
              >
                @for (s of strategies(); track s.id) {
                  <option [value]="s.id">{{ s.name }}</option>
                }
              </select>
            </label>
            <label>
              <span>Capital (₹)</span>
              <input
                name="capital"
                type="number"
                min="1"
                step="1000"
                [ngModel]="capital()"
                (ngModelChange)="capital.set($event)"
              />
            </label>
            <label>
              <span>Max per trade (₹)</span>
              <input
                name="maxPerTrade"
                type="number"
                min="0"
                step="1000"
                placeholder="whole balance"
                [ngModel]="maxPerTrade()"
                (ngModelChange)="maxPerTrade.set($event)"
              />
            </label>
            @if (mode() === 'BACKTEST') {
              <label>
                <span>From</span>
                <input
                  name="from"
                  type="date"
                  [ngModel]="from()"
                  (ngModelChange)="from.set($event)"
                />
              </label>
              <label>
                <span>To</span>
                <input name="to" type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" />
              </label>
            }
          </div>

          @if (strategy(); as s) {
            <div class="rule">
              <p>{{ s.description }}</p>
              @if (s.paramSpecs.length) {
                <dl>
                  @for (spec of s.paramSpecs; track spec.key) {
                    <div [title]="spec.description">
                      <dt>{{ spec.label }}</dt>
                      <dd>{{ s.params[spec.key] }}</dd>
                    </div>
                  }
                </dl>
                <span class="fixed">Defined in the strategy — the same for every run.</span>
              }
            </div>
          }
        </div>

        <div class="col">
          <h3>
            Instruments
            <span class="count">{{ instruments().length }}</span>
          </h3>
          <p class="sub">Each one is streamed and traded independently.</p>
          <app-instrument-list-editor [(value)]="instruments" />
        </div>
      </div>

      <div class="actions">
        <button type="submit" class="primary" [disabled]="!!problem() || busy()">
          {{ busy() ? busyLabel() : submitLabel() }}
        </button>
        @if (problem(); as p) {
          <span class="why">{{ p }}</span>
        } @else {
          <span class="note">
            Lots sized automatically: the most whole lots the available balance
            @if (maxPerTrade()) {
              (up to ₹{{ maxPerTrade() }} a trade)
            }
            buys at the fill price.
          </span>
        }
      </div>
    </form>
  `,
  styles: `
    .form {
      display: grid;
      gap: 0.9rem;
    }
    .columns {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
      gap: 1rem;
    }
    @media (max-width: 900px) {
      .columns {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .col {
      display: grid;
      gap: 0.6rem;
      align-content: start;
      padding: 0.85rem;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      min-width: 0;
    }
    h3 {
      margin: 0;
      font-size: 0.78rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .count {
      font-size: 0.68rem;
      font-weight: 500;
      padding: 0 0.4rem;
      border-radius: 999px;
      background: var(--surface-3);
      color: var(--text-muted);
    }
    .sub {
      margin: -0.35rem 0 0;
      font-size: 0.72rem;
      color: var(--text-muted);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.55rem;
    }
    .wide {
      grid-column: 1 / -1;
    }
    label {
      display: grid;
      gap: 0.2rem;
      font-size: 0.7rem;
      color: var(--text-muted);
    }
    input,
    select {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.35rem 0.5rem;
      font: inherit;
      font-size: 0.8rem;
      min-width: 0;
    }
    .rule {
      display: grid;
      gap: 0.45rem;
      font-size: 0.72rem;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .rule p {
      margin: 0;
    }
    dl {
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    dl div {
      display: inline-flex;
      gap: 0.35rem;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      background: var(--surface-3);
    }
    dt {
      color: var(--text-muted);
    }
    dd {
      margin: 0;
      color: var(--text);
      font-family: var(--font-mono);
    }
    .fixed {
      font-size: 0.66rem;
      color: var(--text-faint);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: center;
    }
    .primary {
      background: var(--accent);
      color: #04111d;
      border: 0;
      border-radius: var(--radius-sm);
      padding: 0.45rem 1rem;
      font-weight: 600;
      cursor: pointer;
    }
    .primary:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .why {
      font-size: 0.75rem;
      color: var(--warn);
    }
    .note {
      font-size: 0.72rem;
      color: var(--text-muted);
    }
  `,
})
export class TradingSetupFormComponent {
  private readonly prefs = inject(PreferencesService);

  readonly mode = input<'LIVE' | 'BACKTEST'>('LIVE');
  readonly strategies = input<readonly StrategyDescriptor[]>([]);
  readonly busy = input(false);
  readonly submitLabel = input('Start');
  readonly busyLabel = input('Working…');

  readonly startLive = output<StartLiveTradingRequest>();
  readonly runBacktest = output<RunBacktestRequest>();

  readonly strategyId = signal<string>('');
  readonly capital = signal<number | null>(
    this.prefs.get<number | null>('trading.capital', 100_000),
  );
  readonly maxPerTrade = signal<number | null>(
    this.prefs.get<number | null>('trading.maxPerTrade', null),
  );
  readonly from = signal<string>(addDays(todayKey(), -30));
  readonly to = signal<string>(addDays(todayKey(), -1));
  readonly instruments = signal<TradingInstrument[]>(
    this.prefs.get<TradingInstrument[]>('trading.instruments', []),
  );

  readonly strategy = computed(
    () => this.strategies().find((s) => s.id === this.strategyId()) ?? null,
  );

  readonly problem = computed<string | null>(() => {
    if (!this.strategy()) return 'Choose a strategy.';
    const capital = Number(this.capital());
    if (!Number.isFinite(capital) || capital <= 0) return 'Enter the capital.';
    if (this.instruments().length === 0) return 'Add at least one instrument.';
    if (this.mode() === 'BACKTEST') {
      if (!this.from() || !this.to()) return 'Choose a date range.';
      if (this.from() > this.to()) return '“From” is after “To”.';
    }
    return null;
  });

  constructor() {
    // Default to the first strategy once the catalogue arrives.
    effect(() => {
      const list = this.strategies();
      if (!this.strategyId() && list.length) this.strategyId.set(list[0]!.id);
    });
    // Remember the account setup between visits — a convenience, not state.
    effect(() => {
      this.prefs.set('trading.capital', this.capital());
      this.prefs.set('trading.maxPerTrade', this.maxPerTrade());
      this.prefs.set('trading.instruments', this.instruments());
    });
  }

  submit(): void {
    const strategy = this.strategy();
    if (this.problem() || !strategy) return;
    const maxPerTrade = Number(this.maxPerTrade());
    // No `params`: the strategy's own values are the rule.
    const base: StartLiveTradingRequest = {
      strategyId: strategy.id,
      capital: Number(this.capital()),
      instruments: this.instruments(),
      ...(Number.isFinite(maxPerTrade) && maxPerTrade > 0
        ? { maxCapitalPerTrade: maxPerTrade }
        : {}),
    };
    if (this.mode() === 'BACKTEST') {
      this.runBacktest.emit({ ...base, from: this.from(), to: this.to() });
    } else {
      this.startLive.emit(base);
    }
  }
}
