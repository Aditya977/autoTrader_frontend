/**
 * The trade setup: pick a contract, say what to put into it, see exactly what
 * that buys, and start a paper trade.
 *
 * The whole point of the section is the line above the button. A form that
 * accepted an amount and then quietly rounded it into some quantity would
 * teach nothing — the thing worth learning from paper trading is precisely
 * that ₹18,000 does not buy three lots of a ₹94 option, it buys two and leaves
 * ₹3,900 idle. So the lot size, the quantity, the required capital and the
 * leftover are all on screen *before* the button is pressed, and the button is
 * off with a stated reason whenever they do not add up.
 *
 * Presentational: it holds the form's own state and emits a request. It does
 * not know the engine exists, which is what lets the same section be dropped
 * onto a backtest page later without dragging a live feed behind it.
 */

import { Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PaperContract, PaperOrderRequest } from '../paper-trade.models';

import { planSize } from '../sizing';
import { DEFAULT_PAPER_STRATEGY_ID, PAPER_STRATEGIES } from '../strategies/registry';

/**
 * One contract the user may trade, with the price it is currently quoted at.
 *
 * `price` is nullable and `null` never means free — it means nothing has traded
 * on this strike, which is exactly when sizing must refuse rather than divide
 * by a zero it invented.
 */
export interface PaperTradeChoice {
  contract: PaperContract;
  price: number | null;
  /**
   * Where the price came from, shown beside it.
   *
   * Load-bearing, not decoration: a premium from the option chain is a
   * *closing* price on a replayed day, and sizing a trade against it while
   * watching a chart that has streamed three hours past it would be sizing
   * against a number that is hours stale. Saying which it is lets the user see
   * the difference.
   */
  source: 'feed' | 'chain';
}

@Component({
  selector: 'app-paper-trade-setup',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="setup">
      <header class="head">
        <div class="ident">
          <h2>Paper trade</h2>
          <span class="key">Simulated only — no order reaches a broker or an exchange.</span>
        </div>
        @if (choices().length === 0) {
          <span class="idle">Chart a call or a put to trade it</span>
        }
      </header>

      <div class="fields">
        <label class="wide">
          <span>Contract</span>
          <select
            [ngModel]="selectedKey()"
            name="paperContract"
            (ngModelChange)="selectedKey.set($event)"
            [disabled]="choices().length === 0"
          >
            @for (choice of choices(); track choice.contract.instrumentKey) {
              <option [ngValue]="choice.contract.instrumentKey">
                {{ choice.contract.tradingsymbol }}
              </option>
            } @empty {
              <option [ngValue]="null">No contract streaming</option>
            }
          </select>
        </label>

        <label>
          <span>Strategy</span>
          <select
            [ngModel]="strategyId()"
            name="paperStrategy"
            (ngModelChange)="strategyId.set($event)"
          >
            @for (s of strategies; track s.id) {
              <option [ngValue]="s.id">{{ s.name }}</option>
            }
          </select>
        </label>

        <label>
          <span>Investment (₹)</span>
          <input
            type="number"
            min="0"
            step="1000"
            [ngModel]="investment()"
            name="paperInvestment"
            (ngModelChange)="investment.set($event)"
            [disabled]="!selected()"
          />
        </label>
      </div>

      @if (choices().length === 0) {
        <!-- Stated rather than left as an empty picker: an index carries no lot
             size because it is not tradable, so paper trading is offered on the
             option legs on screen and a chart of the index alone has nothing to
             size against. -->
        <p class="note">
          Paper trading needs a contract with a lot size, so it is offered on the call and put legs
          you chart. Pick a strike above and press Start.
        </p>
      } @else if (strategyNote(); as note) {
        <p class="note">{{ note }}</p>
      }

      <!-- The quote, on its own row: it is the number every other number below
           is derived from, so it should not be hunted for among the inputs. -->
      <div class="quote" [class.stale]="priceSource() === 'chain'">
        <div class="price">
          <span class="lbl">Current price</span>
          <strong>{{ price() === null ? '—' : '₹' + money(price()!) }}</strong>
          <span class="src">
            @if (price() === null) {
              no quote yet
            } @else if (priceSource() === 'feed') {
              live from the chart feed
            } @else {
              option chain close — waiting for the first bar
            }
          </span>
        </div>
        <label class="lot">
          <span class="lbl">Lot size</span>
          <input
            type="number"
            min="1"
            step="1"
            [ngModel]="lotSize()"
            name="paperLotSize"
            (ngModelChange)="lotSize.set($event)"
            [disabled]="!selected()"
          />
          <span class="src">
            @if (listedLotSize() > 0 && lotSize() !== listedLotSize()) {
              exchange lists {{ listedLotSize() }} —
              <button type="button" class="reset" (click)="lotSize.set(listedLotSize())">
                use that
              </button>
            } @else if (listedLotSize() > 0) {
              as the exchange lists it
            } @else {
              not listed for this instrument — enter it
            }
          </span>
        </label>
      </div>

      <!-- The plan. Always rendered, even when invalid, so the numbers the
           amount *would* buy stay visible while it is being corrected. -->
      <dl class="plan" [class.bad]="!plan().valid">
        <div>
          <dt>Lots</dt>
          <dd>{{ plan().lots }}</dd>
        </div>
        <div>
          <dt>Quantity</dt>
          <dd>{{ plan().quantity }}</dd>
        </div>
        <div>
          <dt>One lot costs</dt>
          <dd>{{ plan().costPerLot ? '₹' + money(plan().costPerLot) : '—' }}</dd>
        </div>
        <div class="strong">
          <dt>Required capital</dt>
          <dd>{{ plan().requiredCapital ? '₹' + money(plan().requiredCapital) : '—' }}</dd>
        </div>
        <div class="strong">
          <dt>Order value</dt>
          <dd>{{ plan().orderValue ? '₹' + money(plan().orderValue) : '—' }}</dd>
        </div>
        <div>
          <dt>Unused</dt>
          <dd>{{ plan().valid ? '₹' + money(plan().leftover) : '—' }}</dd>
        </div>
      </dl>

      <div class="action">
        <p class="verdict" [class.bad]="!plan().valid">
          @if (plan().valid) {
            {{ plan().lots }} lot{{ plan().lots === 1 ? '' : 's' }} × {{ plan().lotSize }} =
            <strong>{{ plan().quantity }}</strong> of {{ selected()?.contract?.tradingsymbol }} for
            <strong>₹{{ money(plan().orderValue) }}</strong
            >, on {{ strategyName() }}.
          } @else {
            {{ plan().message }}
          }
        </p>

        <button type="button" class="primary" [disabled]="!plan().valid" (click)="submit()">
          Simulate Trade
        </button>
      </div>

      @if (error(); as message) {
        <p class="error">{{ message }}</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .setup {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      padding: 0.9rem 1.1rem 1rem;
    }

    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      padding-bottom: 0.7rem;
      border-bottom: 1px solid var(--border);
    }

    h2 {
      font-size: 0.85rem;
      margin: 0;
    }

    .key {
      display: block;
      margin-top: 0.15rem;
      font-size: 0.7rem;
      color: var(--text-faint);
    }

    .idle {
      font-size: 0.72rem;
      color: var(--text-faint);
    }

    .fields {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 0.85rem;
    }

    label {
      display: grid;
      gap: 0.25rem;
      font-size: 0.7rem;
      color: var(--text-muted);
      flex: 1 1 150px;
    }

    label.wide {
      flex: 2 1 260px;
    }

    select,
    input {
      padding: 0.4rem 0.5rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text);
      font-size: 0.8rem;
      font-variant-numeric: tabular-nums;
    }

    .note {
      margin: 0.6rem 0 0;
      font-size: 0.7rem;
      color: var(--text-faint);
      line-height: 1.5;
    }

    .quote {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5rem;
      margin-top: 0.85rem;
      padding: 0.6rem 0.75rem;
      border-radius: 8px;
      background: rgba(56, 189, 248, 0.07);
      border: 1px solid rgba(56, 189, 248, 0.18);
    }

    .quote.stale {
      background: rgba(255, 255, 255, 0.03);
      border-color: var(--border);
    }

    .quote > div {
      display: grid;
      gap: 0.1rem;
    }

    .quote .lbl {
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-faint);
    }

    .quote strong {
      font-size: 1.05rem;
      font-variant-numeric: tabular-nums;
    }

    .quote .src {
      font-size: 0.66rem;
      color: var(--text-faint);
    }

    /* Sized to the number it holds, so an editable lot size does not read as a
       full-width form field beside the price it sits next to. */
    .quote .lot input {
      width: 7rem;
      padding: 0.15rem 0.4rem;
      font-size: 1.05rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
      color: var(--text);
    }

    .reset {
      padding: 0;
      border: none;
      background: none;
      color: var(--accent);
      font-size: 0.66rem;
      cursor: pointer;
      text-decoration: underline;
    }

    .plan {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
      gap: 0.5rem;
      margin: 0.85rem 0 0;
      padding: 0.7rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .plan.bad {
      opacity: 0.55;
    }

    .plan > div {
      display: grid;
      gap: 0.15rem;
    }

    .plan dt {
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-faint);
    }

    .plan dd {
      margin: 0;
      font-size: 0.85rem;
      font-variant-numeric: tabular-nums;
      color: var(--text);
    }

    .plan .strong dd {
      font-weight: 700;
      color: #4fd1a5;
    }

    .action {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.9rem;
      margin-top: 0.85rem;
    }

    .verdict {
      flex: 1 1 260px;
      margin: 0;
      font-size: 0.75rem;
      color: var(--text-muted);
      line-height: 1.5;
    }

    .verdict.bad {
      color: #f0a44a;
    }

    .primary {
      padding: 0.55rem 1.4rem;
      border: none;
      border-radius: 8px;
      background: var(--accent);
      color: #06121d;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
    }

    .primary:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .error {
      margin: 0.6rem 0 0;
      font-size: 0.75rem;
      color: #ef5350;
    }
  `,
})
export class PaperTradeSetupComponent {
  /** The contracts currently streaming, with their quotes. */
  readonly choices = input<readonly PaperTradeChoice[]>([]);
  /** Shown when the engine refuses the order — a race the form could not see. */
  readonly error = input<string | null>(null);

  readonly placed = output<PaperOrderRequest>();

  protected readonly strategies = PAPER_STRATEGIES;

  protected readonly selectedKey = signal<string | null>(null);
  protected readonly strategyId = signal<string>(DEFAULT_PAPER_STRATEGY_ID);
  protected readonly investment = signal<number>(20_000);

  /**
   * The lot size to size against — the user's, not necessarily the exchange's.
   *
   * Editable rather than read-only for two reasons. It lets an instrument the
   * chain does not price (an index or a future, where this page has no lot size
   * to offer) still be paper-traded by naming its lot. And it lets a contract
   * whose lot size has been revised between expiries be traded correctly
   * without waiting for the instrument master to resync — a real event, and one
   * that otherwise silently sizes every trade wrong.
   *
   * Seeded from the contract whenever the chain does list one, so the common
   * case needs no typing.
   */
  protected readonly lotSize = signal<number>(0);

  protected readonly selected = computed(
    () => this.choices().find((c) => c.contract.instrumentKey === this.selectedKey()) ?? null,
  );

  protected readonly price = computed(() => this.selected()?.price ?? null);
  protected readonly priceSource = computed(() => this.selected()?.source ?? 'chain');

  /** What the exchange says, for the "use that" hint. `0` when it says nothing. */
  protected readonly listedLotSize = computed(() => this.selected()?.contract.lotSize ?? 0);

  /**
   * The contract as the *user* has described it.
   *
   * One object, built once, used by both the preview and the order — so the
   * number on screen and the number the engine sizes against cannot drift
   * apart. That is the same reason `planSize` is shared with the engine rather
   * than reimplemented for display.
   */
  protected readonly contract = computed<PaperContract | null>(() => {
    const chosen = this.selected()?.contract;
    if (!chosen) return null;
    return { ...chosen, lotSize: Math.trunc(Number(this.lotSize())) || 0 };
  });

  /** The sizing, recomputed on every keystroke and every tick of the feed. */
  protected readonly plan = computed(() =>
    planSize(this.contract(), this.price(), Number(this.investment())),
  );

  protected readonly strategyName = computed(
    () => PAPER_STRATEGIES.find((s) => s.id === this.strategyId())?.name ?? '—',
  );

  /** What the chosen strategy will do once the order is placed, said plainly. */
  protected readonly strategyNote = computed(() => {
    const strategy = PAPER_STRATEGIES.find((s) => s.id === this.strategyId());
    if (!strategy) return '';
    const warmup =
      strategy.warmupBars > 0
        ? ` It waits for ${strategy.warmupBars} closed bars before it can act.`
        : '';
    return `${strategy.description}${warmup}`;
  });

  constructor() {
    // Keeps the picker pointed at something real as panels come and go. A
    // selection that survived its chart being closed would size a trade against
    // a contract nothing is streaming, and the price would never update again.
    effect(() => {
      const choices = this.choices();
      untracked(() => {
        const current = this.selectedKey();
        if (current && choices.some((c) => c.contract.instrumentKey === current)) return;
        this.selectedKey.set(choices[0]?.contract.instrumentKey ?? null);
      });
    });

    // Adopt the listed lot size when the contract changes, so switching from a
    // call to a put does not silently carry the previous leg's lot across. An
    // instrument the chain does not list keeps whatever was typed — there is
    // nothing better to offer, and clearing it would erase the user's own
    // answer every time the price ticked.
    effect(() => {
      const listed = this.selected()?.contract.lotSize ?? 0;
      untracked(() => {
        if (listed > 0) this.lotSize.set(listed);
      });
    });
  }

  protected submit(): void {
    const contract = this.contract();
    const plan = this.plan();
    if (!contract || !plan.valid) return;

    this.placed.emit({
      contract,
      strategyId: this.strategyId(),
      // Buying the premium. A sold leg is a different risk profile — margin
      // rather than debit — and the sizing above would be wrong for it, so the
      // form does not offer one until the margin model does.
      side: 'BUY',
      investment: Number(this.investment()),
      referencePrice: plan.price,
      lots: plan.lots,
      quantity: plan.quantity,
    });
  }

  protected money(value: number): string {
    return Math.round(value).toLocaleString('en-IN');
  }
}
