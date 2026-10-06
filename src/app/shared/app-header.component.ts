import { Component, DestroyRef, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { UpstoxAuthService } from '../auth/upstox-auth.service';

/**
 * The one header every page shares: the product, its sections, and the
 * Upstox session everything behind it depends on.
 *
 * Page-specific controls (the dashboard's Paper / Backtest switch) are
 * projected into the middle, so a page adds to the header rather than
 * replacing it.
 */
@Component({
  selector: 'app-header',
  standalone: true,
  imports: [DatePipe, RouterLink, RouterLinkActive],
  template: `
    <header class="bar">
      <a class="brand" routerLink="/chart" aria-label="autoTrader home">
        <span class="mark">◧</span>
        <span class="name">autoTrader</span>
      </a>

      <nav class="tabs" aria-label="Sections">
        <a routerLink="/chart" routerLinkActive="on">Charts</a>
        <a routerLink="/dashboard" routerLinkActive="on">Trading Dashboard</a>
      </nav>

      <div class="slot"><ng-content /></div>

      <div class="account">
        @if (auth.isAuthenticated()) {
          <span class="pill ok"><i class="dot"></i>Upstox</span>
          @if (auth.expiresAt(); as until) {
            <span class="until">until {{ until | date: 'shortTime' }}</span>
          }
          <button type="button" class="link" (click)="signOut()">Sign out</button>
        } @else {
          <a class="pill warn" routerLink="/login">Sign in to Upstox</a>
        }
      </div>
    </header>
  `,
  styles: `
    :host {
      position: sticky;
      top: 0;
      z-index: 20;
      display: block;
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem 1.25rem;
      padding: 0.6rem 1.5rem;
      border-bottom: 1px solid var(--border);
      background: rgba(11, 15, 20, 0.88);
      backdrop-filter: blur(8px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      color: var(--text);
      text-decoration: none;
    }
    .mark {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--accent), #1b6fae);
      color: #06121d;
      font-size: 0.95rem;
    }
    .name {
      font-size: 0.92rem;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .tabs {
      display: inline-flex;
      gap: 0.15rem;
      padding: 0.15rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }
    .tabs a {
      padding: 0.32rem 0.8rem;
      border-radius: 6px;
      color: var(--text-muted);
      font-size: 0.78rem;
      font-weight: 500;
      text-decoration: none;
      transition:
        background 0.12s ease,
        color 0.12s ease;
    }
    .tabs a:hover {
      color: var(--text);
    }
    .tabs a.on {
      background: var(--surface-3);
      color: var(--text);
    }
    .slot {
      display: flex;
      align-items: center;
      flex: 1 1 auto;
      min-width: 0;
    }
    .account {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .account a.pill {
      text-decoration: none;
    }
    @media (max-width: 640px) {
      .bar {
        padding: 0.6rem 1rem;
      }
      .slot {
        flex-basis: 100%;
        order: 5;
      }
    }
  `,
})
export class AppHeaderComponent {
  protected readonly auth = inject(UpstoxAuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Ends the Upstox session and returns to the login screen. */
  protected signOut(): void {
    this.auth
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.router.navigate(['/login']));
  }
}
