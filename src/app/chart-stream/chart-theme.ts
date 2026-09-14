/**
 * Chart colours, kept in TypeScript rather than read back out of CSS.
 *
 * The chart is a canvas: it cannot inherit a CSS custom property, so these
 * would have to be read with `getComputedStyle` at construction time and
 * re-read on every theme change. With a single committed theme (see
 * `styles.scss`) that indirection buys nothing, so the values are stated once
 * here and mirrored by the token of the same name.
 *
 * Their own module rather than locals in the chart component, because
 * everything drawn *over* the candles — support/resistance lines, retest bands
 * — has to use the same palette, and importing them back out of the component
 * that imports those helpers would be a cycle.
 */
export const THEME = {
  background: '#111820',
  text: '#8b9bad',
  grid: '#18222d',
  border: '#212e3c',
  crosshair: '#56718a',
  up: '#26a17b',
  down: '#ef5350',
  upFaded: 'rgba(38, 161, 123, 0.4)',
  downFaded: 'rgba(239, 83, 80, 0.4)',
} as const;

/** `#26a17b` + alpha → `rgba(…)`, so one palette entry can carry several weights. */
export function fade(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha)).toFixed(2)})`;
}
