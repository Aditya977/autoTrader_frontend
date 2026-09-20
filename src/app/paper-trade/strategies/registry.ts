/**
 * Every strategy this build can paper-trade, and the only file that has to
 * change to add one.
 *
 * The engine imports {@link paperStrategyById} and nothing else from this
 * folder, so a fourth strategy is: write the file, add the import, add the
 * entry. No engine change, no UI change — the picker renders whatever is in
 * this array.
 *
 * The order is the order the picker shows, and it is deliberate rather than
 * alphabetical: `manual` first because it is what someone reaching for a paper
 * trade on a chart they are already reading almost always wants, and because it
 * is the one whose behaviour needs no explaining.
 */

import { greenRetestHoldStrategy } from './green-retest-hold.strategy';
import { manualStrategy } from './manual.strategy';
import type { PaperStrategy } from './paper-strategy';

export const PAPER_STRATEGIES: readonly PaperStrategy[] = [manualStrategy, greenRetestHoldStrategy];

/** The default the setup form opens on. */
export const DEFAULT_PAPER_STRATEGY_ID = manualStrategy.id;

export function paperStrategyById(id: string): PaperStrategy | null {
  return PAPER_STRATEGIES.find((strategy) => strategy.id === id) ?? null;
}
