import type { DetectedPattern } from '../types';

/**
 * What the chart integration is allowed to ask of a drawing surface.
 *
 * The engine knows nothing about charts and the chart knows nothing about
 * patterns; this is the seam between them. Everything library-specific lives
 * behind it, so swapping Lightweight Charts for something else is one new
 * implementation rather than a rewrite of the feature.
 *
 * `upsert` rather than `add` is the important verb. A pattern keeps its id
 * across recomputations, so the caller re-publishes the same id every pass and
 * the overlay is updated in place. An add/remove pair would tear the drawing
 * down and rebuild it on every closed bar, which reads as a flicker.
 */
export interface PatternOverlayAdapter {
  /** Adds the pattern, or updates the one already drawn under this id. */
  upsert(pattern: DetectedPattern): void;
  remove(id: string): void;
  clear(): void;
  setVisible(visible: boolean): void;
  /**
   * No-op while the app ships a single dark theme.
   *
   * Kept on the interface rather than dropped: the colours are read from CSS
   * tokens, so a light theme would mostly work already, and the hook is where
   * the re-read would go.
   */
  setTheme(theme: 'light' | 'dark'): void;
  destroy(): void;
}
