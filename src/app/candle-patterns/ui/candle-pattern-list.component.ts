import { Component, computed, input } from '@angular/core';
import type { RenderedCandlePattern } from '../render/candle-pattern-overlay';

/** One row, already reduced to what the template draws. */
interface Row {
  id: string;
  time: string;
  name: string;
  /** The other readings of the same bar, already named. Empty when there are none. */
  also: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  context: string;
  status: string;
  statusClass: string;
  confidence: number;
}

/**
 * Every candlestick pattern found, in the order they happened.
 *
 * The chart can only carry one name per box and one line of context beneath
 * it. Three things do not fit there and are the reason this list exists:
 *
 * - **the other readings.** A bar that is a harami *and* an inside bar *and* a
 *   tweezer bottom is one box on the chart. Dropping the other two names from
 *   the interface entirely would be the chart quietly deciding they did not
 *   happen.
 * - **the time.** A box sits above a candle; which candle is a matter of
 *   squinting at the axis.
 * - **the score, side by side.** Two boxes twenty minutes apart cannot be
 *   compared by eye, and a column of them can.
 *
 * A list rather than a table, and per row rather than grouped: these are
 * events in a sequence, which is the one thing a reader wants to scan.
 */
@Component({
  selector: 'app-candle-pattern-list',
  standalone: true,
  template: `
    @if (rows().length) {
      <ul class="hits">
        @for (row of rows(); track row.id) {
          <li>
            <span class="dot" [class]="row.bias"></span>
            <span class="when">{{ row.time }}</span>
            <span class="what">
              <b>{{ row.name }}</b>
              @if (row.also) {
                <i class="also">also {{ row.also }}</i>
              }
            </span>
            <span class="ctx">{{ row.context }}</span>
            <span class="status" [class]="row.statusClass">{{ row.status }}</span>
            <span class="score">
              <span class="meter">
                <span class="fill" [class]="row.bias" [style.width.%]="row.confidence"></span>
              </span>
              <b>{{ row.confidence }}</b>
            </span>
          </li>
        }
      </ul>
    } @else {
      <p class="empty">No candlestick pattern above the confidence floor.</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .hits {
      list-style: none;
      margin: 0;
      padding: 0.1rem 0.6rem 0.6rem;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    li {
      display: grid;
      /* The name column is the one that must not be truncated, so it takes the
         slack; everything else is sized to its content. */
      grid-template-columns: 8px 3.2rem minmax(0, 1fr) auto auto 4.6rem;
      align-items: center;
      gap: 0.45rem;
      padding: 0.25rem 0.4rem;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      font-size: 0.72rem;
      min-width: 0;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--text-muted);
    }
    .dot.bullish {
      background: var(--up);
    }
    .dot.bearish {
      background: var(--down);
    }

    .when {
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }

    .what {
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.35rem;
    }

    .what b {
      font-weight: 600;
    }

    /* The secondary readings are real but subordinate: the box on the chart
       says the first name, and this says what else the same bar was. */
    .also {
      font-style: normal;
      color: var(--text-muted);
      font-size: 0.66rem;
    }

    .ctx,
    .status {
      color: var(--text-muted);
      white-space: nowrap;
    }

    .status.confirmed {
      color: var(--up);
    }
    /* Unresolved is not a weaker finding than confirmed — it is a newer one,
       and on a live chart the newest bar is always here. It must not read as
       a failure. */
    .status.pending {
      color: var(--text);
    }
    .status.failed {
      color: var(--down);
      opacity: 0.75;
    }

    .score {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      justify-content: flex-end;
    }

    .meter {
      width: 2.2rem;
      height: 3px;
      border-radius: 2px;
      background: var(--border);
      overflow: hidden;
    }

    .fill {
      display: block;
      height: 100%;
      background: var(--text-muted);
    }
    .fill.bullish {
      background: var(--up);
    }
    .fill.bearish {
      background: var(--down);
    }

    .score b {
      font-variant-numeric: tabular-nums;
      min-width: 1.6rem;
      text-align: right;
    }

    .empty {
      margin: 0;
      padding: 0.1rem 0.6rem 0.6rem;
      color: var(--text-muted);
      font-size: 0.72rem;
    }

    @media (max-width: 620px) {
      /* The context and the status are the first things to go: both are
         repeated on the chart itself, beneath the box. */
      li {
        grid-template-columns: 8px 3.2rem minmax(0, 1fr) 4.6rem;
      }
      .ctx,
      .status {
        display: none;
      }
    }
  `,
})
export class CandlePatternListComponent {
  readonly hits = input<readonly RenderedCandlePattern[]>([]);
  /**
   * Formats a bar's open time. Injected rather than imported so this component
   * has no opinion about the exchange's timezone.
   */
  readonly formatTime = input<(ms: number) => string>((ms) => String(ms));
  /** Names for the secondary patterns, as the backend supplied them. */
  readonly labels = input<Record<string, string>>({});

  protected readonly rows = computed<Row[]>(() =>
    [...this.hits()]
      // Newest first: on a chart that has been running a while, the patterns
      // worth reading are the recent ones, and a reader should not have to
      // scroll a day of history to reach them.
      .sort((a, b) => b.endTime - a.endTime)
      .map((hit) => this.toRow(hit)),
  );

  private toRow(hit: RenderedCandlePattern): Row {
    const labels = this.labels();
    const also = hit.patterns
      .slice(1)
      .map((name) => labels[name] ?? name)
      .join(', ');

    return {
      id: hit.id,
      time: this.formatTime()(hit.endTime),
      name: hit.label,
      also,
      bias:
        hit.reversalBias === 'BULLISH'
          ? 'bullish'
          : hit.reversalBias === 'BEARISH'
            ? 'bearish'
            : 'neutral',
      context: CONTEXT[hit.directionContext],
      status: STATUS[hit.status],
      statusClass: hit.status,
      confidence: hit.confidence,
    };
  }
}

/**
 * Where the candle sat.
 *
 * `UNKNOWN` reads as a dash rather than as a word. "The trend average has not
 * seen its own period in bars yet" is true, and is a statement about the
 * warm-up rather than about the market — putting it in a column beside
 * "after a decline" would invite it to be read as a third kind of trend.
 */
const CONTEXT: Readonly<Record<RenderedCandlePattern['directionContext'], string>> = {
  BEARISH: 'after a decline',
  BULLISH: 'after a rise',
  NEUTRAL: 'in a range',
  UNKNOWN: '—',
};

/**
 * What price did next.
 *
 * `none` is blank rather than "n/a": the pattern makes no directional claim,
 * so there is nothing that could have been confirmed, and a word in the column
 * would imply a test that was run.
 */
const STATUS: Readonly<Record<RenderedCandlePattern['status'], string>> = {
  confirmed: 'confirmed',
  failed: 'not confirmed',
  pending: 'unresolved',
  none: '',
};
