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
