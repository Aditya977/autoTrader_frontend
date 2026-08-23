import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { authInterceptor } from './auth/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // The interceptor sends an expired session back to the login screen, so
    // every request in the app is covered, not only those a route guard runs
    // for — a session can end mid-visit, long after the guard has passed.
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
  ],
};
