import { Component } from '@angular/core';
import { NavTabsComponent } from '../shared/nav-tabs.component';

/**
 * Backtest — cleared, pending a redesign.
 *
 * The previous page and its whole client (the run form, the result view, the
 * API service and the models) were deleted rather than left commented out or
 * hidden behind a flag. Dead code that still compiles gets maintained by
 * accident: it turns up in searches, it constrains refactors of everything it
 * touches, and it gets quietly updated to keep a build green long after
 * anybody knows what it was for. The git history holds it if it is wanted.
 *
 * The route and the tab stay so the shape of the app is unchanged and a
 * bookmark still lands somewhere that explains itself.
 *
 * The backend's `/strategy/backtest` endpoints went with it. What survives on
 * that side is the `strategy_backtests` table and its migration, kept
 * deliberately: dropping a migration that a database has already run breaks
 * the chain for every deployment that ran it, and that is a schema decision
 * rather than a code cleanup.
 */
@Component({
  selector: 'app-backtest-page',
  standalone: true,
  imports: [NavTabsComponent],
  template: `
    <header class="topbar">
      <div class="brand">
        <span class="mark">B</span>
        <h1>Backtest</h1>
      </div>
      <app-nav-tabs />
    </header>

    <main>
      <section class="placeholder">
        <h2>Being rebuilt</h2>
        <p>
          The backtest page has been cleared while it is redesigned. Nothing here
          runs, and no results are stored.
        </p>
      </section>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1.5rem;
      border-bottom: 1px solid var(--border);
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
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 0.85rem;
      font-weight: 600;
    }

    h1 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }

    main {
      padding: 2.5rem 1.5rem;
      display: grid;
      place-items: center;
    }

    .placeholder {
      max-width: 46ch;
      text-align: center;
      border: 1px dashed var(--border);
      border-radius: var(--radius);
      padding: 2rem 1.5rem;
    }

    .placeholder h2 {
      margin: 0 0 0.5rem;
      font-size: 0.95rem;
      font-weight: 600;
    }

    .placeholder p {
      margin: 0;
      font-size: 0.8rem;
      line-height: 1.6;
      color: var(--text-muted);
    }
  `,
})
export class BacktestPageComponent {}
