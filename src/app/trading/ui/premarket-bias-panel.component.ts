import { Component, computed, input } from '@angular/core';
import { percent } from '../format';
import type {
  PremarketBiasView,
  PremarketHistory,
  PremarketScoreLine,
  PremarketTargetCheck,
} from '../trading.models';

/**
 * The NIFTY pre-market bias the pre-market scraper publishes each morning:
 * the day's call, how sure it is and why, and — once the day is over — how
 * it turned out on the opening gap, the first 30 minutes and open to close.
 * Below it, the recent days and the running scorecard.
 *
 * A bias is an indication from the pre-open auction, not a trade instruction;
 * the scorecard is there so nobody has to take it on trust.
 */
@Component({
  selector: 'app-premarket-bias-panel',
  standalone: true,
  template: `
    @if (bias(); as b) {
      <div class="today">
        <div class="call" [class]="directionClass(b.score)">
          <span class="label">{{ b.label ?? 'No bias' }}</span>
          <span class="score">{{ scoreText(b.score) }}</span>
        </div>
        <div class="facts">
          <div class="pills">
            <span class="pill" [class.ok]="b.isFinal" [class.warn]="!b.isFinal">
              <i class="dot"></i>{{ b.isFinal ? 'Final' : 'Provisional' }}
            </span>
            @if (b.confidence.label) {
              <span class="pill" [class]="confidenceClass(b.confidence.label)">
                {{ b.confidence.label }} confidence
                @if (b.confidence.score !== null) {
                  · {{ b.confidence.score }}
                }
              </span>
            }
            <span class="muted">{{ b.date }} · {{ b.runStatus }}</span>
          </div>
          <dl>
            <dt>Index gap</dt>
            <dd [class]="toneOf(b.indexGapPct)">{{ percent(b.indexGapPct) }}</dd>
            <dt>Breadth</dt>
            <dd>
              @if (b.advancers !== null && b.decliners !== null) {
                <span class="pos">{{ b.advancers }} up</span> /
                <span class="neg">{{ b.decliners }} down</span>
              } @else {
                —
              }
            </dd>
            <dt>Outcome</dt>
            <dd class="checks">
              <span [class]="checkClass(b.evaluation.openGap)" title="Opening gap">
                Gap {{ checkText(b.evaluation.openGap) }}
              </span>
              <span [class]="checkClass(b.evaluation.open30m)" title="Open to 30 minutes">
                30m {{ checkText(b.evaluation.open30m) }}
              </span>
              <span [class]="checkClass(b.evaluation.openToClose)" title="Open to close">
                Close {{ checkText(b.evaluation.openToClose) }}
              </span>
            </dd>
          </dl>
        </div>
      </div>

      @if (explanation(); as text) {
        <p class="why">{{ text }}</p>
      }
      @if (movers().length) {
        <p class="movers">
          @for (m of movers(); track m.symbol) {
            <span [class]="toneOf(m.gap_pct)">{{ m.symbol }} {{ percent(m.gap_pct) }}</span>
          }
        </p>
      }
    } @else if (error()) {
      <p class="empty">{{ error() }}</p>
    } @else {
      <p class="empty">Loading…</p>
    }

    @if (history(); as h) {
      @if (h.days.length) {
        <div class="score-head">
          <h3>Track record</h3>
          <span class="muted">
            {{ h.scorecard.calls }} call(s) in {{ h.scorecard.days }} day(s) · gap
            {{ scoreLine(h.scorecard.openGap) }} · 30m {{ scoreLine(h.scorecard.open30m) }} · close
            {{ scoreLine(h.scorecard.openToClose) }}
          </span>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Bias</th>
                <th class="num">Score</th>
                <th>Confidence</th>
                <th class="num">Gap</th>
                <th class="num">30m</th>
                <th class="num">Close</th>
              </tr>
            </thead>
            <tbody>
              @for (d of h.days; track d.date) {
                <tr>
                  <td>{{ d.date }}</td>
                  <td [class]="directionClass(d.score)">{{ d.label ?? '—' }}</td>
                  <td class="num">{{ scoreText(d.score) }}</td>
                  <td class="muted">{{ d.confidence.label ?? '—' }}</td>
                  <td class="num" [class]="checkClass(d.evaluation.openGap)">
                    {{ moveText(d.evaluation.openGap) }}
                  </td>
                  <td class="num" [class]="checkClass(d.evaluation.open30m)">
                    {{ moveText(d.evaluation.open30m) }}
                  </td>
                  <td class="num" [class]="checkClass(d.evaluation.openToClose)">
                    {{ moveText(d.evaluation.openToClose) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="note faint">
          A call is a score of ±10 or more; a move within ±0.10% counts as flat. ✓ / ✗ mark whether
          the call matched the move; neutral days make no call.
        </p>
      }
    }
  `,
  styles: `
    .today {
      display: grid;
      grid-template-columns: minmax(9rem, auto) 1fr;
      gap: 1rem;
      align-items: start;
    }
    @media (max-width: 640px) {
      .today {
        grid-template-columns: 1fr;
      }
    }
    .call {
      display: grid;
      gap: 0.15rem;
      padding: 0.8rem 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface-2);
    }
    .call .label {
      font-size: 1rem;
      font-weight: 600;
    }
    .call .score {
      font-family: var(--font-mono);
      font-size: 1.6rem;
    }
    .call.up {
      border-color: var(--up);
      color: var(--up);
    }
    .call.down {
      border-color: var(--down);
      color: var(--down);
    }
    .pills {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem 0.6rem;
      font-size: 0.78rem;
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.3rem 0.9rem;
      margin: 0.7rem 0 0;
      font-size: 0.8rem;
    }
    dt {
      color: var(--text-muted);
    }
    dd {
      margin: 0;
    }
    .checks {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
    }
    .why {
      margin: 0.8rem 0 0;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .movers {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem 0.8rem;
      margin: 0.5rem 0 0;
      font-family: var(--font-mono);
      font-size: 0.74rem;
    }
    .score-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.4rem 0.8rem;
      margin: 1.1rem 0 0.5rem;
      font-size: 0.78rem;
    }
    .score-head h3 {
      margin: 0;
      font-size: 0.85rem;
    }
    .note {
      margin: 0.5rem 0 0;
      font-size: 0.72rem;
    }
    .hit {
      color: var(--up);
    }
    .miss {
      color: var(--down);
    }
    .up {
      color: var(--up);
    }
    .down {
      color: var(--down);
    }
  `,
})
export class PremarketBiasPanelComponent {
  /** The newest day, with its full analysis; `null` before the first push. */
  readonly bias = input<PremarketBiasView | null>(null);
  readonly history = input<PremarketHistory | null>(null);
  /** Why the latest bias could not be shown. */
  readonly error = input<string | null>(null);

  readonly percent = percent;

  readonly explanation = computed(() => {
    const e = this.bias()?.analysis.explanations;
    return e?.conclusion ?? e?.opening_indication?.text ?? null;
  });

  /** The three biggest gaps either way among the NIFTY 50. */
  readonly movers = computed(() => {
    const breadth = this.bias()?.analysis.breadth;
    return [
      ...(breadth?.top_positive ?? []).slice(0, 3),
      ...(breadth?.top_negative ?? []).slice(0, 3),
    ];
  });

  scoreText(score: number | null): string {
    if (score === null) return '—';
    // As the scraper rounds it (2 dp): toFixed(1) would turn 63.15 into 63.1.
    return `${score > 0 ? '+' : score < 0 ? '−' : ''}${Math.abs(score)}`;
  }

  /** The call's direction, by the backend's ±10 rule. */
  directionClass(score: number | null): string {
    if (score === null) return '';
    return score >= 10 ? 'up' : score <= -10 ? 'down' : '';
  }

  confidenceClass(label: string): string {
    return label === 'High' ? 'ok' : label === 'Moderate' ? 'warn' : 'bad';
  }

  toneOf(value: number | null | undefined): string {
    if (value === null || value === undefined || value === 0) return '';
    return value > 0 ? 'pos' : 'neg';
  }

  checkClass(check: PremarketTargetCheck): string {
    return check.correct === true ? 'hit' : check.correct === false ? 'miss' : 'faint';
  }

  /** `✓ up`, `✗ down`, `flat`, or `pending` before the outcome is in. */
  checkText(check: PremarketTargetCheck): string {
    if (check.actual === null) return 'pending';
    const mark = check.correct === true ? '✓ ' : check.correct === false ? '✗ ' : '';
    return `${mark}${check.actual}`;
  }

  moveText(check: PremarketTargetCheck): string {
    if (check.movePct === null) return '—';
    const mark = check.correct === true ? ' ✓' : check.correct === false ? ' ✗' : '';
    return `${percent(check.movePct)}${mark}`;
  }

  scoreLine(line: PremarketScoreLine): string {
    return line.checked ? `${line.correct}/${line.checked}` : '—';
  }
}
