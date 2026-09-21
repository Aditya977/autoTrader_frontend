import { Component, computed, input } from '@angular/core';
import { money, signedMoney, tone } from '../format';
import type { DashboardOverview } from '../trading.models';

interface Card {
  label: string;
  value: string;
  tone: 'pos' | 'neg' | 'flat';
  hint?: string;
}

/**
 * The "right now" row: balance, today, totals, open positions.
 *
 * Today's P&L includes open positions at their current mark, because an open
 * position is today's by definition; the realised part is shown beneath it so
 * the two are never confused.
 */
@Component({
  selector: 'app-overview-cards',
  standalone: true,
  template: `
    <div class="cards">
      @for (card of cards(); track card.label) {
        <div class="card">
          <span class="label">{{ card.label }}</span>
          <span class="value" [class]="card.tone">{{ card.value }}</span>
          @if (card.hint) {
            <span class="hint">{{ card.hint }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
      gap: 0.6rem;
    }
    .card {
      display: grid;
      gap: 0.15rem;
      padding: 0.75rem 0.85rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }
    .label {
      font-size: 0.7rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .value {
      font-family: var(--font-mono);
      font-size: 1.05rem;
      font-variant-numeric: tabular-nums;
    }
    .value.pos {
      color: var(--up);
    }
    .value.neg {
      color: var(--down);
    }
    .hint {
      font-size: 0.7rem;
      color: var(--text-faint);
    }
  `,
})
export class OverviewCardsComponent {
  readonly overview = input<DashboardOverview | null>(null);

  readonly cards = computed<Card[]>(() => {
    const o = this.overview();
    if (!o) return [];
    return [
      {
        label: 'Available balance',
        value: money(o.availableBalance),
        tone: 'flat',
        hint: o.liveSessionId ? 'live account' : `of ${money(o.capital)} capital`,
      },
      {
        label: "Today's P&L",
        value: signedMoney(o.todayPnl),
        tone: tone(o.todayPnl),
        hint: `realised ${signedMoney(o.todayRealisedPnl)}`,
      },
      {
        label: 'Trades today',
        value: String(o.tradesToday),
        tone: 'flat',
        hint: `${o.todayWins} won · ${o.todayLosses} lost`,
      },
      { label: 'Total P&L', value: signedMoney(o.totalPnl), tone: tone(o.totalPnl) },
      { label: 'Realised P&L', value: signedMoney(o.realisedPnl), tone: tone(o.realisedPnl) },
      {
        label: 'Unrealised P&L',
        value: signedMoney(o.unrealisedPnl),
        tone: tone(o.unrealisedPnl),
      },
      { label: 'Open positions', value: String(o.openPositions), tone: 'flat' },
    ];
  });
}
