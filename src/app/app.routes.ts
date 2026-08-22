import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'chart',
    loadComponent: () =>
      import('./chart-stream/chart-stream-page.component').then((m) => m.ChartStreamPageComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: 'chart' },
  { path: '**', redirectTo: 'chart' },
];
