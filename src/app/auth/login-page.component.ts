import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UpstoxAuthService } from './upstox-auth.service';

/**
 * Why the user is here, in their words rather than a status code.
 *
 * `reason` arrives from two different places — the interceptor when a request
 * comes back `401`, and the backend's own OAuth callback when consent fails —
 * so unknown values are expected and fall through to a generic line rather
 * than being rendered raw.
 */
const REASONS: Record<string, string> = {
  'session-expired': 'Your Upstox session ended. Sign in again to continue.',
  'invalid or expired state': 'That login attempt timed out. Please try again.',
  'missing code or state': 'Upstox did not complete the login. Please try again.',
  access_denied: 'Login was declined at Upstox.',
};

@Component({
  selector: 'app-login-page',
  standalone: true,
  template: `
    <main>
      <section class="card">
        <span class="mark">◧</span>
        <h1>Sign in to Upstox</h1>

        <p class="lead">
          Charts, option chains and live prices all read your own Upstox account, so this app needs
          your permission before it can show any market data.
        </p>

        @if (message(); as text) {
          <p class="notice">{{ text }}</p>
        }

        <button type="button" class="primary" (click)="login()" [disabled]="busy()">
          {{ busy() ? 'Opening Upstox…' : 'Continue with Upstox' }}
        </button>

        <p class="fine">
          You will be taken to Upstox to approve access, then returned here. This app never sees or
          stores your Upstox password or access token — they stay with Upstox and your backend.
        </p>
      </section>
    </main>
  `,
  styles: `
    :host {
      display: block;
    }

    main {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 1.5rem;
      /* A single soft light source behind the card, so the sign-in screen is
         not simply a flat rectangle on a flat page. */
      background:
        radial-gradient(60rem 40rem at 50% -10%, rgba(59, 167, 255, 0.12), transparent 70%),
        var(--bg);
    }

    .card {
      width: min(28rem, 100%);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      padding: 2rem;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
    }

    .mark {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      margin-bottom: 1rem;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--accent), #1b6fae);
      color: #06121d;
      font-size: 1.2rem;
    }

    h1 {
      margin: 0 0 0.6rem;
      font-size: 1.15rem;
    }

    .lead {
      margin: 0 0 1.25rem;
      font-size: 0.875rem;
      line-height: 1.6;
      color: var(--text-muted);
    }

    .notice {
      margin: 0 0 1.25rem;
      padding: 0.6rem 0.75rem;
      border-radius: var(--radius-sm);
      background: rgba(224, 164, 88, 0.12);
      border: 1px solid rgba(224, 164, 88, 0.3);
      color: #f0c48a;
      font-size: 0.82rem;
    }

    button.primary {
      width: 100%;
      padding: 0.6rem 1rem;
      font-size: 0.9rem;
    }

    .fine {
      margin: 1.25rem 0 0;
      font-size: 0.78rem;
      line-height: 1.6;
      color: var(--text-faint);
    }
  `,
})
export class LoginPageComponent {
  private readonly auth = inject(UpstoxAuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly busy = signal(false);
  private readonly reason = signal<string | null>(null);

  protected readonly message = computed(() => {
    const reason = this.reason();
    if (!reason) return null;
    return REASONS[reason] ?? 'That login attempt did not complete. Please try again.';
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.reason.set(params.get('reason'));
    });

    // The backend's success redirect lands here with no session yet reflected
    // in this tab's state; a re-check moves an already-authenticated user on
    // rather than showing them a sign-in button they do not need.
    this.auth
      .refresh()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => {
        if (status.authenticated) void this.router.navigateByUrl(this.returnTo());
      });
  }

  protected login(): void {
    this.busy.set(true);
    this.auth.login();
  }

  /**
   * Where to land after signing in.
   *
   * Only same-app paths are honoured — a `returnTo` is a query parameter, and
   * anyone can put an absolute URL in one. Navigating to it unchecked would
   * make this page an open redirect.
   */
  private returnTo(): string {
    const target = this.route.snapshot.queryParamMap.get('returnTo');
    return target?.startsWith('/') && !target.startsWith('//') ? target : '/chart';
  }
}
