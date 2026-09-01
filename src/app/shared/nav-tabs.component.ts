import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * The top-level sections of the app.
 *
 * A component rather than markup copied into each page's header: the two pages
 * have genuinely different headers otherwise — one carries an instrument
 * picker's context, the other a dataset's — and extracting the whole bar to
 * share three links would couple them for no reason. The tab strip is the part
 * that must not drift, so the tab strip is the part that is shared.
 */
@Component({
  selector: 'app-nav-tabs',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="tabs" aria-label="Sections">
      <a routerLink="/chart" routerLinkActive="on" class="tab">Chart</a>
      <a routerLink="/backtest" routerLinkActive="on" class="tab">Backtest</a>
    </nav>
  `,
  styles: `
    .tabs {
      display: inline-flex;
      gap: 0.2rem;
      padding: 0.15rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-2, rgba(255, 255, 255, 0.02));
    }

    .tab {
      padding: 0.28rem 0.7rem;
      border-radius: 6px;
      color: var(--text-muted);
      font-size: 0.75rem;
      text-decoration: none;
      transition:
        background 0.12s ease,
        color 0.12s ease;
    }

    .tab:hover {
      color: var(--text);
    }

    .tab.on {
      background: var(--surface-3, rgba(255, 255, 255, 0.07));
      color: var(--text);
    }
  `,
})
export class NavTabsComponent {}
