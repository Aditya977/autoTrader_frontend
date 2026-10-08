import { Component, input, output } from '@angular/core';
import type { PaperAllocation, StrategyDeployment } from '../trading.models';

/**
 * Which strategies paper trading runs. Only the enabled ones are deployed;
 * the capital and the lot size are the backend's, shown here, not set. A
 * strategy the backend trades at a different size (Key Zones v2: 3 lots, so
 * its 1/3 booking is a whole lot) shows its own size.
 */
@Component({
  selector: 'app-strategy-deployments',
  standalone: true,
  template: `
    <p class="lede">
      Only enabled strategies are deployed. Each gets
      @for (a of allocations(); track a.instrument; let last = $last) {
        <b>{{ rupees(a.capital) }}</b> on {{ a.instrument }}{{ last ? '' : ' and ' }}
      }
      — {{ lotsLabel() }} per trade, set by the backend{{
        hasOverrides() ? ', unless shown on the strategy' : ''
      }}.
    </p>
    @if (deployments().length === 0) {
      <p class="muted">No strategies in the catalogue.</p>
    }
    <ul>
      @for (d of deployments(); track d.strategy.id) {
        <li [class.on]="d.enabled">
          <label class="switch" [title]="d.enabled ? 'Disable' : 'Enable'">
            <input
              type="checkbox"
              role="switch"
              [checked]="d.enabled"
              [disabled]="busy()"
              [attr.aria-label]="(d.enabled ? 'Disable ' : 'Enable ') + d.strategy.name"
              (change)="flip(d, $event)"
            />
            <span class="track"><span class="knob"></span></span>
          </label>
          <div class="text">
            <span class="name">{{ d.strategy.name }}</span>
            <span class="state">{{ d.enabled ? 'Enabled' : 'Disabled' }}</span>
            @if (sizeOf(d.strategy.id); as size) {
              <span class="size">{{ size }}</span>
            }
            <p class="desc">{{ d.strategy.description }}</p>
          </div>
        </li>
      }
    </ul>
  `,
  styles: `
    .lede {
      margin: 0 0 0.75rem;
      font-size: 0.78rem;
      color: var(--text-muted);
    }
    .lede b {
      color: var(--text);
      font-family: var(--font-mono);
      font-weight: 500;
    }
    .muted {
      color: var(--text-muted);
      font-size: 0.78rem;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.4rem;
    }
    li {
      display: flex;
      gap: 0.75rem;
      align-items: flex-start;
      padding: 0.55rem 0.7rem;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    li.on {
      border-color: var(--accent);
    }
    .text {
      min-width: 0;
      flex: 1;
    }
    .name {
      font-size: 0.82rem;
      font-weight: 600;
    }
    .state {
      margin-left: 0.5rem;
      font-size: 0.7rem;
      color: var(--text-muted);
    }
    li.on .state {
      color: var(--up);
    }
    .size {
      margin-left: 0.5rem;
      font-size: 0.7rem;
      font-family: var(--font-mono);
      color: var(--text);
    }
    .desc {
      margin: 0.2rem 0 0;
      font-size: 0.72rem;
      color: var(--text-muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .switch {
      position: relative;
      flex: none;
      margin-top: 0.1rem;
      cursor: pointer;
    }
    .switch input {
      position: absolute;
      opacity: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      cursor: pointer;
    }
    .track {
      display: block;
      width: 32px;
      height: 18px;
      border-radius: 9px;
      background: var(--surface-3);
      border: 1px solid var(--border);
      transition: background 0.12s ease;
    }
    .knob {
      display: block;
      width: 12px;
      height: 12px;
      margin: 2px;
      border-radius: 50%;
      background: var(--text-muted);
      transition: transform 0.12s ease;
    }
    .switch input:checked + .track {
      background: var(--accent);
    }
    .switch input:checked + .track .knob {
      transform: translateX(14px);
      background: var(--bg, #fff);
    }
    .switch input:focus-visible + .track {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .switch input:disabled + .track {
      opacity: 0.5;
    }
  `,
})
export class StrategyDeploymentsComponent {
  readonly deployments = input<readonly StrategyDeployment[]>([]);
  readonly allocations = input<readonly PaperAllocation[]>([]);
  /** Strategies the backend trades at their own size, by id. */
  readonly strategyAllocations = input<Readonly<Record<string, readonly PaperAllocation[]>>>({});
  /** A session is trading now — disabling squares that strategy's positions off. */
  readonly running = input(false);
  readonly busy = input(false);

  readonly toggle = output<{ strategyId: string; enabled: boolean }>();

  /** Whole rupees — an allocation is a round number. */
  rupees(value: number): string {
    return `₹${value.toLocaleString('en-IN')}`;
  }

  lotsLabel(): string {
    const lots = [...new Set(this.allocations().map((a) => a.maxLots))];
    return lots.length === 1 ? `${lots[0]} lot${lots[0] === 1 ? '' : 's'}` : 'a fixed size';
  }

  hasOverrides(): boolean {
    return Object.keys(this.strategyAllocations()).length > 0;
  }

  /** "3 lots · ₹60,000 NIFTY · ₹1,20,000 BANKNIFTY" for a strategy with its own size, else null. */
  sizeOf(strategyId: string): string | null {
    const own = this.strategyAllocations()[strategyId];
    if (!own?.length) return null;
    const lots = [...new Set(own.map((a) => a.maxLots))];
    const size = lots.length === 1 ? `${lots[0]} lot${lots[0] === 1 ? '' : 's'}` : 'own size';
    return [size, ...own.map((a) => `${this.rupees(a.capital)} ${a.instrument}`)].join(' · ');
  }

  flip(d: StrategyDeployment, event: Event): void {
    const box = event.target as HTMLInputElement;
    const enabled = box.checked;
    if (
      !enabled &&
      this.running() &&
      !window.confirm(
        `Disable ${d.strategy.name}? Its open paper positions are squared off at the last price.`,
      )
    ) {
      box.checked = true;
      return;
    }
    this.toggle.emit({ strategyId: d.strategy.id, enabled });
  }
}
