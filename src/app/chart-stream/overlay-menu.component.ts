import { Component, input, output } from '@angular/core';

/** One toggle row in the overlay menu. */
export interface OverlayItem {
  id: string;
  name: string;
  /** One line on what it draws. */
  hint: string;
  /** Class of the colour key, matching what is drawn on the chart. */
  swatch: 'sr' | 'pdr' | 'rt' | 'lrj' | 'mte' | 'pat' | 'candles';
  /** Why it cannot be switched on yet, or `null` when it can. */
  blocked: () => string | null;
  on: () => boolean;
  toggle: () => void;
  /** A count or "…" at the end of the row; `null` for nothing. */
  note: () => string | null;
  bad?: () => boolean;
}

export interface OverlayGroup {
  title: string;
  items: readonly OverlayItem[];
}

/** An indicator switched on with a chip rather than a row: EMAs and VWAP. */
export interface OverlayChip {
  id: string;
  name: string;
  color: string;
  on: () => boolean;
  toggle: () => void;
}

/** "12 levels", "1 level"; `null` for zero so an empty row stays quiet. */
export function countLabel(n: number, one: string, many = `${one}s`): string | null {
  return n > 0 ? `${n} ${n === 1 ? one : many}` : null;
}

/**
 * The overlay dropdown's panel: everything that can be drawn over the price.
 *
 * Grouped by what a reader is looking for rather than by how each overlay is
 * computed — where price may turn, what happened when it got there,
 * recognisable shapes, plain indicators. Every row says in one line what it
 * draws, and a row that cannot be used yet says why instead of only dimming.
 *
 * Presentational: the chart owns what each toggle does and when the panel is
 * open; this only lays the choices out.
 */
@Component({
  selector: 'app-overlay-menu',
  standalone: true,
  template: `
    <div class="menu" role="group" aria-label="Chart overlays">
      <div class="menu-top">
        <span class="menu-title">Overlays</span>
        <span class="menu-count">{{ count() ? count() + ' on' : 'None on' }}</span>
        <button type="button" class="menu-clear" [disabled]="!count()" (click)="clearAll.emit()">
          Clear all
        </button>
      </div>

      <div class="menu-body">
        @for (group of groups(); track group.title) {
          <section class="menu-group">
            <p class="menu-head">{{ group.title }}</p>
            @for (item of group.items; track item.id) {
              <label class="opt" [class.off]="item.blocked()" [class.active]="item.on()">
                <input
                  type="checkbox"
                  [checked]="item.on()"
                  [disabled]="!!item.blocked()"
                  (change)="item.toggle()"
                />
                <span [class]="'swatch ' + item.swatch"></span>
                <span class="opt-text">
                  <span class="opt-name">{{ item.name }}</span>
                  <span class="opt-hint">{{ item.blocked() ?? item.hint }}</span>
                </span>
                @if (item.note(); as note) {
                  <i class="opt-note" [class.bad]="item.bad?.()">{{ note }}</i>
                }
              </label>
            }
          </section>
        }

        @if (chips().length) {
          <section class="menu-group">
            <p class="menu-head">Indicators</p>
            <div class="chips">
              @for (chip of chips(); track chip.id) {
                <label class="chip" [class.active]="chip.on()">
                  <input type="checkbox" [checked]="chip.on()" (change)="chip.toggle()" />
                  <span class="swatch" [style.background]="chip.color"></span>
                  <span class="opt-name">{{ chip.name }}</span>
                </label>
              }
            </div>
          </section>
        }
      </div>
    </div>
  `,
  styles: `
    .menu {
      position: absolute;
      top: calc(100% + 0.3rem);
      right: 0;
      z-index: 20;
      width: min(19rem, calc(100vw - 2rem));
      /* Scrolls inside itself rather than running off a short screen. */
      max-height: min(34rem, calc(100vh - 8rem));
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    }
    .menu-top {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 0.6rem;
      border-bottom: 1px solid var(--border);
    }
    .menu-title {
      font-size: 0.78rem;
      font-weight: 600;
    }
    .menu-count {
      font-size: 0.68rem;
      color: var(--text-muted);
    }
    .menu-clear {
      margin-left: auto;
      padding: 0.15rem 0.5rem;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: none;
      color: var(--text-muted);
      font: inherit;
      font-size: 0.66rem;
    }
    .menu-clear:hover:not(:disabled) {
      color: var(--text);
      border-color: var(--border-strong);
    }
    .menu-clear:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .menu-body {
      overflow-y: auto;
      padding: 0.3rem 0.35rem 0.45rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .menu-group {
      display: flex;
      flex-direction: column;
      gap: 0.05rem;
    }
    .menu-group + .menu-group {
      padding-top: 0.35rem;
      border-top: 1px solid var(--border);
    }
    .menu-head {
      margin: 0 0 0.15rem;
      padding: 0 0.3rem;
      font-size: 0.6rem;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-muted);
    }
    .opt {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.3rem 0.35rem;
      border-radius: 4px;
      cursor: pointer;
    }
    .opt:hover {
      background: var(--surface-3);
    }
    .opt.off {
      opacity: 0.55;
      cursor: default;
    }
    .opt.off:hover {
      background: none;
    }
    .opt.active .opt-name,
    .chip.active .opt-name {
      color: var(--text);
    }
    input {
      margin: 0;
      accent-color: var(--accent);
      cursor: pointer;
    }
    .opt-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      line-height: 1.25;
    }
    .opt-name {
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .opt-hint {
      font-size: 0.64rem;
      color: var(--text-faint);
    }
    /* A count, or "…" while fetching, at the end of the row. */
    .opt-note {
      margin-left: auto;
      padding-left: 0.5rem;
      font-style: normal;
      font-size: 0.66rem;
      color: var(--text-faint);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .opt-note.bad {
      color: var(--down);
      font-weight: 700;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      padding: 0.1rem 0.3rem;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.2rem 0.5rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      cursor: pointer;
    }
    .chip:hover {
      border-color: var(--border-strong);
    }
    .chip.active {
      border-color: var(--accent-dim);
      background: var(--surface-3);
    }
    /* The colour the overlay is drawn in, so the menu doubles as the legend. */
    .swatch {
      width: 14px;
      height: 3px;
      border-radius: 1px;
      flex: none;
    }
    .swatch.sr {
      background: var(--accent);
    }
    /* Both directions' colours: these draw bullish and bearish marks alike. */
    .swatch.rt {
      background: linear-gradient(to right, var(--up) 50%, var(--down) 50%);
    }
    .swatch.mte {
      background: linear-gradient(to right, var(--up) 40%, #7fa6e6 40% 60%, var(--down) 60%);
    }
    .swatch.pdr {
      background: #c3d94e;
    }
    .swatch.lrj {
      background: linear-gradient(to right, var(--down) 30%, #e0a458 30% 70%, var(--up) 70%);
    }
    .swatch.pat {
      background: var(--pattern-bullish);
    }
    .swatch.candles {
      background: var(--up);
    }
  `,
})
export class OverlayMenuComponent {
  readonly groups = input.required<readonly OverlayGroup[]>();
  readonly chips = input<readonly OverlayChip[]>([]);
  /** Overlays currently on. */
  readonly count = input(0);
  readonly clearAll = output<void>();
}
