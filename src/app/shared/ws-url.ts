import { environment } from '../../environments/environment';

/**
 * The WebSocket URL for a backend path.
 *
 * In production the app is served from the same origin as the API
 * (`apiBase` is `''`), so the socket's host is the page's own.
 */
export function wsUrl(path: string): string {
  const base = environment.apiBase || window.location.origin;
  return base.replace(/^http/, 'ws') + path;
}
