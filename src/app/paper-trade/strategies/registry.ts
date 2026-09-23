/**
 * Every strategy this build can paper-trade, and the only file that has to
 * change to add one.
 *
 * The engine imports {@link paperStrategyById} and nothing else from this
 * folder, so another strategy is: write the file, add the import, add the
 * entry. No engine change, no UI change — the picker renders whatever is in
 * this array.
 *
 * The order is the order the picker shows, and it is deliberate rather than
 * alphabetical: `manual` first because it is what someone reaching for a paper
 * trade on a chart they are already reading almost always wants, and because it
 * is the one whose behaviour needs no explaining.
 */

import { backendSignalStrategy } from './backend-signal.strategy';
import { manualStrategy } from './manual.strategy';
import type { PaperStrategy } from './paper-strategy';

export const PAPER_STRATEGIES: readonly PaperStrategy[] = [
  manualStrategy,
  // The dashboard's strategies, followed trade for trade from the backend.
  backendSignalStrategy({
    backendStrategyId: 'level-breakout',
    name: 'Level Breakout (index, momentum)',
    description:
      'Follows the backend: a 5-minute index candle breaks a previous-day level (PDH, PDL, ' +
      'PD50, the 13:15 hour) with momentum — ≥ 2.4 ATR beyond the 20 EMA — on a day with ' +
      'range. Buys this option (CE up, PE down); exits when the index falls back through the ' +
      'breakout candle, reaches 2R, or after 60 minutes.',
  }),
  backendSignalStrategy({
    backendStrategyId: 'trend-structure',
    name: 'Trend Structure',
    description:
      'Follows the backend: enters at the end of a pullback in the direction of the ' +
      '15-minute trend, with the backend’s own stop and exit.',
  }),
  backendSignalStrategy({
    backendStrategyId: 'liquidity-sweep',
    name: 'Liquidity Sweep',
    description:
      'Follows the backend: trades a failed run on the previous session’s high or low, ' +
      'with the backend’s own stop and exit.',
  }),
];

/** The default the setup form opens on. */
export const DEFAULT_PAPER_STRATEGY_ID = manualStrategy.id;

export function paperStrategyById(id: string): PaperStrategy | null {
  return PAPER_STRATEGIES.find((strategy) => strategy.id === id) ?? null;
}
