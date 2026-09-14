import { TestBed } from '@angular/core/testing';
import { PREF, PreferencesService } from './preferences.service';

describe('PreferencesService', () => {
  let prefs: PreferencesService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    prefs = TestBed.inject(PreferencesService);
    window.localStorage.clear();
  });

  afterEach(() => window.localStorage.clear());

  it('returns the fallback when nothing is stored', () => {
    expect(prefs.get('missing', true)).toBe(true);
    expect(prefs.get('missing', 'x')).toBe('x');
  });

  it('round-trips a value', () => {
    prefs.set(PREF.showPatterns, false);
    expect(prefs.get(PREF.showPatterns, true)).toBe(false);
  });

  it('namespaces its keys, so it cannot collide with anything else', () => {
    prefs.set('thing', 1);
    expect(window.localStorage.getItem('autotrader.thing')).toBe('1');
    expect(window.localStorage.getItem('thing')).toBeNull();
  });

  it('removes a key', () => {
    prefs.set('thing', 1);
    prefs.remove('thing');
    expect(prefs.get('thing', 99)).toBe(99);
  });

  /**
   * Written by an older build, or corrupted. The fallback is a better answer
   * than a throw, and the bad value is left for the next `set` to overwrite.
   */
  it('falls back rather than throwing on unparseable stored text', () => {
    window.localStorage.setItem('autotrader.thing', '{not json');
    expect(() => prefs.get('thing', 7)).not.toThrow();
    expect(prefs.get('thing', 7)).toBe(7);
  });

  /**
   * A private window, blocked site data, or partitioned storage can make the
   * accessor itself throw. A lost preference is an inconvenience; a page that
   * fails to render is not.
   */
  it('survives storage that throws on every access', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage is blocked');
      },
    });

    try {
      expect(prefs.get('thing', 'fallback')).toBe('fallback');
      expect(() => prefs.set('thing', 1)).not.toThrow();
      expect(() => prefs.remove('thing')).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
