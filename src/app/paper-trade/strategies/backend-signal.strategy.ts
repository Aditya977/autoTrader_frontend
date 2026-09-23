import type { PaperRetestSignal } from '../paper-trade.models';
import type { PaperPlan, PaperSignal, PaperStrategy, PaperStrategyContext } from './paper-strategy';

const BAR_MS = 60_000;

/** Two seconds before the candle closes, as the Green Retest stamps its fills. */
const FILL_OFFSET_MS = BAR_MS - 2_000;

/**
 * A paper strategy that follows one of the backend's strategies exactly.
 *
 * The rule itself is not re-implemented here. The page fetches the entries the
 * backend's live engine takes on this contract and day — the same code the
 * Trading Dashboard backtests and trades live — and this strategy enters on
 * the candle the backend entered on, with the backend's stop, and leaves on
 * the candle the backend left on. So the chart, the backtest and live trading
 * cannot disagree about a trade.
 *
 * The side of the order still matters: a BUY order follows the backend's long
 * entries and a SELL order its short ones.
 */
export function backendSignalStrategy(spec: {
  backendStrategyId: string;
  name: string;
  description: string;
}): PaperStrategy {
  const own = (ctx: PaperStrategyContext): PaperRetestSignal[] =>
    ctx.retests.filter(
      (signal) => signal.source === spec.backendStrategyId && signal.side === ctx.side,
    );

  /** The backend entry this position was opened on, matched by its candle. */
  const entryOf = (ctx: PaperStrategyContext): PaperRetestSignal | undefined => {
    const entryTime = ctx.position?.entryTime;
    const bar = entryTime === null || entryTime === undefined ? null : barOpenOf(entryTime);
    const at = bar ?? barOpenOf(ctx.update.timeMs);
    return own(ctx).find((signal) => barOpenOf(signal.atMs) === at);
  };

  return {
    id: `backend:${spec.backendStrategyId}`,
    name: spec.name,
    description: spec.description,
    warmupBars: 0,
    needsRetests: true,
    backendStrategyId: spec.backendStrategyId,
    fillOffsetMs: FILL_OFFSET_MS,
    continuous: true,
    paramSpecs: [],
    params: {},

    /** The backend's own stop for this entry; the backend never sets a target here. */
    plan(ctx: PaperStrategyContext): PaperPlan {
      return { stopLoss: entryOf(ctx)?.stopLoss ?? null, target: null };
    },

    entry(ctx: PaperStrategyContext): PaperSignal | null {
      if (!ctx.update.closed) return null;
      const bar = barOpenOf(ctx.update.timeMs);
      const signal = own(ctx).find((s) => barOpenOf(s.atMs) === bar);
      return signal ? { reason: signal.reason ?? spec.name } : null;
    },

    /**
     * Out on the candle the backend exited on. `>=` so a candle the feed never
     * delivered cannot keep the position open; an entry the backend still
     * holds has no exit yet and is left to the stop and the square-off.
     */
    exit(ctx: PaperStrategyContext): PaperSignal | null {
      if (!ctx.update.closed) return null;
      const exitAt = entryOf(ctx)?.exitAtMs;
      if (exitAt === null || exitAt === undefined) return null;
      if (barOpenOf(ctx.update.timeMs) < barOpenOf(exitAt)) return null;
      return { reason: entryOf(ctx)?.exitReason ?? 'backend exit' };
    },
  };
}

function barOpenOf(epochMs: number): number {
  return Math.floor(epochMs / BAR_MS) * BAR_MS;
}
