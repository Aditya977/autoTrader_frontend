import { Injectable } from '@angular/core';

/**
 * Small, typed, per-browser preferences.
 *
 * The app had no persistence of any kind before this — no `localStorage`, no
 * store, nothing — so a chart toggle that survived a reload needed somewhere to
 * live. This is that somewhere, kept deliberately small: a get, a set, and a
 * remove.
 *
 * ## Every access is guarded
 *
 * `localStorage` is not always there and not always willing. A private window,
 * a browser configured to block site data, or an iframe with storage
 * partitioned off will throw on the *property access itself*, not merely on
 * the read — so a bare `localStorage.getItem` in a constructor can take a page
 * down. Every path here fails soft and hands back the caller's fallback,
 * because a lost preference is an inconvenience and a blank page is not.
 *
 * What lives here is per-browser convenience, never anything that has to be
 * right: it is silently absent on another device and can vanish at any time.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly prefix = 'autotrader.';

  /** The stored value, or `fallback` when it is absent or unreadable. */
  get<T>(key: string, fallback: T): T {
    const raw = this.read(this.prefix + key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Written by an older build, or corrupted. The fallback is a better
      // answer than a throw, and the bad value is left for `set` to overwrite.
      return fallback;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      window.localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      // Storage full, blocked, or unavailable. Nothing here is worth failing
      // a user action over.
    }
  }

  remove(key: string): void {
    try {
      window.localStorage.removeItem(this.prefix + key);
    } catch {
      /* see `set` */
    }
  }

  private read(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

/** Keys in one place, so two components cannot disagree about a name. */
export const PREF = {
  showPatterns: 'chart.showPatterns',
  showCandlePatterns: 'chart.showCandlePatterns',
  emaPeriods: 'chart.emaPeriods',
  showVwap: 'chart.showVwap',
} as const;
