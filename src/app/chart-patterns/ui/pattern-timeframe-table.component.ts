import { Component, computed, input } from '@angular/core';
import { PATTERN_NAMES, type DetectedPattern } from '../types';
import type { TimeframeRow } from '../engine/timeframe-scan';

/** One row, already reduced to what the template draws. */
interface Row {
  seconds: number;
  label: string;
  name: string;
  bars: number;
  current: boolean;
  patterns: {
    id: string;
    name: string;
    direction: DetectedPattern['direction'];
    status: DetectedPattern['status'];
    confidence: number;
    percent: string;
  }[];
  /** Why the row is empty, when it is. */
  empty: 'none' | 'thin' | null;
}

/**
 * What each timeframe is showing, as a list of cards rather than a grid.
 *
 * The shape of the data decided the shape of the component. A table wants one
 * value per cell, and a timeframe here has *zero or several* patterns — which
 * a table can only express by repeating the timeframe down a column and
 * leaving most cells blank, so the eye has to reconstruct the grouping that
 * the data already had. A card per timeframe keeps that grouping visible and
 * gives the empty case somewhere to say what it means.
 *
 * It also survives a narrow chart. A five-column table at 400px either scrolls
 * sideways or crushes every column; a card stack reflows.
 *
 * ## The empty states are two different statements
 *
 * "Nothing forming" means the engine looked and found nothing above the
 * confidence floor. "Not enough bars" means it could not look — a daily
 * timeframe holds one bar per session, so a chart showing today alone has
 * nothing to measure. Rendering both as a blank cell would be the most
 * misleading option available, since a reader would take the second for the
 * first and conclude the market was quiet.
 */
@Component({
  selector: 'app-pattern-timeframe-table',
  standalone: true,
  template: `
    <div class="grid">
      @for (row of rows(); track row.seconds) {
        <section class="card" [class.current]="row.current">
          <header>
            <span class="tf">{{ row.label }}</span>
            <span class="name">{{ row.name }}</span>
            @if (row.current) {
              <span class="badge">on chart</span>
            }
            <span class="bars">{{ row.bars }} bars</span>
          </header>

          @if (row.patterns.length) {
            <ul class="patterns">
              @for (p of row.patterns; track p.id) {
                <li>
                  <span class="dot" [class]="p.direction"></span>
                  <span class="pname">{{ p.name }}</span>
                  <span class="status" [class]="p.status">{{ p.status }}</span>
                  <span class="score">
                    <span class="meter">
                      <span
                        class="fill"
                        [class]="p.direction"
                        [style.width.%]="p.confidence * 100"
                      ></span>
                    </span>
                    <b>{{ p.percent }}</b>
                  </span>
                </li>
              }
            </ul>
          } @else {
            <p class="empty">
              @if (row.empty === 'thin') {
                Not enough bars at this size yet.
              } @else {
                No pattern above 75%.
              }
            </p>
          }
        </section>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 0.5rem;
      padding: 0.1rem 0.6rem 0.6rem;
    }

    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      padding: 0.5rem 0.6rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      min-width: 0;
    }

    .card.current {
      border-color: var(--accent-dim);
    }

    header {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      min-width: 0;
    }

    .tf {
      font-size: 0.78rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .name {
      font-size: 0.66rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .badge {
      font-size: 0.58rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--accent);
      border: 1px solid var(--accent-dim);
      border-radius: 999px;
      padding: 0.02rem 0.32rem;
      white-space: nowrap;
    }

    .bars {
      margin-left: auto;
      font-size: 0.62rem;
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .patterns {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }

    .patterns li {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 0.35rem;
      min-width: 0;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      display: inline-block;
    }

    /* The pattern hues, so the colour here names the colour on the chart.
       Green and red are spent twice over already — on the candles and on the
       support and resistance lines. */
    .dot.bullish,
    .fill.bullish {
      background: var(--pattern-bullish);
    }
    .dot.bearish,
    .fill.bearish {
      background: var(--pattern-bearish);
    }
    .dot.neutral,
    .fill.neutral {
      background: var(--pattern-neutral);
    }

    .pname {
      font-size: 0.72rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .status {
      grid-column: 2;
      font-size: 0.6rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-faint);
    }

    .status.forming {
      color: var(--warn);
    }

    .score {
      grid-row: 1 / span 2;
      grid-column: 3;
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.68rem;
      font-variant-numeric: tabular-nums;
    }

    .meter {
      display: inline-block;
      width: 30px;
      height: 4px;
      border-radius: 2px;
      background: var(--surface-3, rgba(255, 255, 255, 0.08));
      overflow: hidden;
    }

    .meter .fill {
      display: block;
      height: 100%;
      opacity: 0.85;
    }

    .empty {
      margin: 0;
      font-size: 0.66rem;
      line-height: 1.5;
      color: var(--text-faint);
    }
  `,
})
export class PatternTimeframeTableComponent {
  readonly timeframes = input.required<readonly TimeframeRow[]>();
  /** Bar size the chart itself is drawing, so its card can be marked. */
  readonly currentSeconds = input<number | null>(null);

  /**
   * Below this, a timeframe has too little to say rather than nothing to say.
   *
   * The engine refuses a series shorter than its own warm-up plus the smallest
   * pattern it can describe, so anything under that never had a chance.
   */
  private readonly THIN_BARS = 30;

  protected readonly rows = computed<Row[]>(() =>
    this.timeframes().map((row) => ({
      seconds: row.seconds,
      label: row.label,
      name: row.name,
      bars: row.bars,
      current: row.seconds === this.currentSeconds(),
      patterns: row.patterns.map((p) => ({
        id: p.id,
        name: PATTERN_NAMES[p.type],
        direction: p.direction,
        status: p.status,
        confidence: p.confidence,
        percent: `${Math.round(p.confidence * 100)}%`,
      })),
      empty: row.patterns.length ? null : row.bars < this.THIN_BARS ? 'thin' : 'none',
    })),
  );
}
