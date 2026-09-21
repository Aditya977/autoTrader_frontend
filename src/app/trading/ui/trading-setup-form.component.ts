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
 * Sizing is not asked for. Every entry takes the most whole lots the free
 * balance (capped by "max per trade", if set) affords at the fill price; the
 * backend does the arithmetic so the preview and the order cannot disagree.
 */
@Component({
  selector: 'app-trading-setup-form',
  standalone: true,
  imports: [FormsModule, InstrumentListEditorComponent],
  template: `
    <form class="form" (ngSubmit)="submit()">
      <div class="grid">
        <label>
          <span>Strategy</span>
          <select name="strategy" [ngModel]="strategyId()" (ngModelChange)="strategyId.set($event)">
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
          <span>Max per trade (₹, optional)</span>
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
            <input name="from" type="date" [ngModel]="from()" (ngModelChange)="from.set($event)" />
          </label>
          <label>
            <span>To</span>
            <input name="to" type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" />
          </label>
        }
      </div>

      @if (strategy(); as s) {
        <p class="desc">{{ s.description }}</p>
        @if (s.paramSpecs.length) {
          <div class="grid params">
            @for (spec of s.paramSpecs; track spec.key) {
              <label [title]="spec.description">
                <span>{{ spec.label }}</span>
                <input
                  type="number"
                  [name]="'p_' + spec.key"
                  [min]="spec.min"
                  [max]="spec.max"
                  [step]="spec.step"
                  [ngModel]="paramValue(spec.key, s)"
                  (ngModelChange)="setParam(spec.key, $event)"
                />
              </label>
            }
          </div>
        }
      }

      <div class="instruments">
        <span class="section">Instruments — each is streamed and traded independently</span>
        <app-instrument-list-editor [(value)]="instruments" />
      </div>

      <p class="note">
        Lots are sized automatically: the most whole lots the available balance
        @if (maxPerTrade()) {
          (capped at ₹{{ maxPerTrade() }} per trade)
        }
        buys at the fill price, after reserving the ₹40 exit charge.
      </p>

      <div class="actions">
        <button type="submit" class="primary" [disabled]="!!problem() || busy()">
          {{ busy() ? busyLabel() : submitLabel() }}
        </button>
        @if (problem(); as p) {
          <span class="why">{{ p }}</span>
        }
      </div>
    </form>
  `,
  styles: `
    .form {
      display: grid;
      gap: 0.75rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
      gap: 0.6rem;
    }
    label {
      display: grid;
      gap: 0.2rem;
      font-size: 0.72rem;
      color: var(--text-muted);
    }
    input,
    select {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.35rem 0.5rem;
      font: inherit;
      font-size: 0.8rem;
    }
    .desc,
    .note {
      margin: 0;
      font-size: 0.75rem;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .section {
      display: block;
      font-size: 0.72rem;
      color: var(--text-muted);
      margin-bottom: 0.35rem;
    }
    .actions {
      display: flex;
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
  private readonly params = signal<Record<string, number>>({});

  readonly strategy = computed(
    () => this.strategies().find((s) => s.id === this.strategyId()) ?? null,
  );

  readonly problem = computed<string | null>(() => {
    if (!this.strategy()) return 'Choose a strategy.';
    const capital = Number(this.capital());
    if (!Number.isFinite(capital) || capital <= 0) return 'Enter the capital.';
    if (this.instruments().length === 0) return 'Add at least one complete instrument.';
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

  paramValue(key: string, strategy: StrategyDescriptor): number {
    return this.params()[key] ?? strategy.params[key] ?? 0;
  }

  setParam(key: string, value: number | string): void {
    const n = Number(value);
    this.params.update((p) => {
      const next = { ...p };
      if (Number.isFinite(n) && value !== '') next[key] = n;
      else delete next[key];
      return next;
    });
  }

  submit(): void {
    const strategy = this.strategy();
    if (this.problem() || !strategy) return;
    const maxPerTrade = Number(this.maxPerTrade());
    // Only overrides that differ from the defaults travel: the run records
    // what was chosen, and a default restated is not a choice.
    const overrides = Object.fromEntries(
      Object.entries(this.params()).filter(([k, v]) => strategy.params[k] !== v),
    );
    const base: StartLiveTradingRequest = {
      strategyId: strategy.id,
      capital: Number(this.capital()),
      instruments: this.instruments(),
      ...(Number.isFinite(maxPerTrade) && maxPerTrade > 0
        ? { maxCapitalPerTrade: maxPerTrade }
        : {}),
      ...(Object.keys(overrides).length ? { params: overrides } : {}),
    };
    if (this.mode() === 'BACKTEST') {
      this.runBacktest.emit({ ...base, from: this.from(), to: this.to() });
    } else {
      this.startLive.emit(base);
    }
  }
}
