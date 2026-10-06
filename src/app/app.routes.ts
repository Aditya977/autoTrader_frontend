import { Routes } from '@angular/router';
import { authGuard, loginPageGuard } from './auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    // Guarded in the opposite direction: an already-signed-in user has no
    // business on a sign-in screen.
    canActivate: [loginPageGuard],
    loadComponent: () => import('./auth/login-page.component').then((m) => m.LoginPageComponent),
  },
  {
    path: 'dashboard',
    // Same guard as the chart: every endpoint this route calls sits behind an
    // Upstox session, so an unauthenticated visit would render a page whose
    // every request 401s.
    canActivate: [authGuard],
    loadComponent: () =>
      import('./trading/trading-dashboard-page.component').then(
        (m) => m.TradingDashboardPageComponent,
      ),
  },
  // The page this replaced. Kept as a redirect so an old bookmark still lands.
  { path: 'backtest', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'chart',
    // Every endpoint this route calls is behind an Upstox session, so an
    // unauthenticated visit would render a page whose every request 401s.
    canActivate: [authGuard],
    loadComponent: () =>
      import('./chart-stream/chart-stream-page.component').then((m) => m.ChartStreamPageComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: 'chart' },
  { path: '**', redirectTo: 'chart' },
];
