/**
 * The contract every paper strategy implements, and the only thing the engine
 * knows about strategies.
 *
 * ## What "extensible" has to mean here
 *
 * Adding a strategy must not touch the engine. So the engine never asks *which*
 * strategy it is holding — it asks three questions and does as it is told:
 *
 * 1. {@link PaperStrategy.plan} — where do the protective levels go?
 * 2. {@link PaperStrategy.entry} — is this the bar to get in on?
 * 3. {@link PaperStrategy.exit} — is this the bar to get out on?
 *
 * A new strategy is a new file exporting one of these plus a line in
 * `registry.ts`. Nothing else in the module changes, and nothing in the engine
 * needs to know the file exists. That is the whole design, and the reason the
 * three methods are deliberately boring: the moment one of them returns
 * something the engine has to interpret differently per strategy, the extension
 * point is gone.
 *
 * ## Why the strategy cannot close the position itself
 *
 * It returns a *decision*, not an action. The engine owns every state
 * transition, so a strategy cannot leave a position half-exited, cannot exit a
 * position twice, and cannot exit one it does not own. It also means a
 * backtest harness can run the same strategy over a decade of bars and get the
 * same transitions the live engine would make, which is the point of the split.
 */

import type {
  PaperMarketUpdate,
  PaperPosition,
  PaperRetestSignal,
  PaperSide,
} from '../paper-trade.models';

/** One tunable number with the bounds that make it safe to tune. */
export interface PaperParamSpec {
  key: string;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
}

/**
 * A closed bar, as a strategy sees history.
 *
 * Deliberately the minimum: a strategy that needs more than OHLCV is describing
 * something the feed does not carry, and should say so rather than reach around
 * the engine for it.
 */
export interface PaperBar {
  /** Epoch ms, bar open. */
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Everything a strategy is allowed to look at.
 *
 * Read-only throughout, and it carries no clock: `update.timeMs` is the market
 * instant, and a strategy that consulted `Date.now()` would behave differently
 * in a replay than it did live, which would make every backtest a lie.
 */
export interface PaperStrategyContext {
  /** The update being processed. */
  readonly update: PaperMarketUpdate;
  /** Closed bars for this instrument, oldest first, including this one. */
  readonly bars: readonly PaperBar[];
  /** The mark. `update.price`, hoisted because every strategy wants it. */
  readonly price: number;
  /** The position this decision concerns; `null` while it is still `CREATED`. */
  readonly position: PaperPosition | null;
  /** The side the order was placed on. */
  readonly side: PaperSide;
  /** Merged defaults and overrides. */
  readonly params: Readonly<Record<string, number>>;
  /**
   * The retests the overlay has found for this instrument, oldest first.
   *
   * Empty unless the strategy asked for them with
   * {@link PaperStrategy.needsRetests} — there is no reason to fetch and carry
   * them for a strategy that reads price alone.
   */
  readonly retests: readonly PaperRetestSignal[];
  /**
   * The contract's lot and tick size.
   *
   * A stop "one tick under the low" is a different number of rupees on every
   * contract, and an order priced off the tick grid is rejected rather than
   * filled — so a strategy that prices its own stop needs the tick. Optional so
   * a context built by a test without a contract still type-checks.
   */
  readonly contract?: { readonly lotSize: number; readonly tickSize: number };
}

/** Where the protective levels go, decided once, at the fill. */
export interface PaperPlan {
  stopLoss: number | null;
  target: number | null;
}

/** A strategy's answer to "now?" — `null` for no. */
export interface PaperSignal {
  /** One phrase, shown verbatim in the activity feed. */
  reason: string;
}

export interface PaperStrategy {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  /* --- optional capabilities ------------------------------------------
   *
   * Every member below is optional and every one of them is a no-op when
   * absent, so a strategy that does not care about it says nothing and the
   * engine behaves for it exactly as it did before the member existed. That
   * is the whole reason they are optional rather than required-with-defaults:
   * adding a capability must not mean editing every strategy already written.
   */

  /**
   * Whether this strategy reads the retest overlay's signals.
   *
   * Declared rather than inferred so the page knows to fetch them before the
   * order is placed. A strategy that needs them and is run without them takes
   * no trades at all, which looks exactly like a quiet market.
   */
  readonly needsRetests?: boolean;

  /**
   * The backend strategy whose entries this one follows — the id the page
   * asks `/strategy/signals/entries` for. Signals arrive tagged with it, and
   * the strategy reads only those. Implies {@link needsRetests}.
   */
  readonly backendStrategyId?: string;

  /**
   * Where inside its bar a fill is stamped, in milliseconds after the bar's
   * open. Defaults to `0` — the bar's own timestamp.
   *
   * The engine decides on *closed* bars, so economically a fill is always at
   * the closing price whatever this says. What it changes is the **recorded
   * time**, and for a strategy whose rule is "enter two seconds before the
   * candle closes" that time is the rule: a trade stamped 11:14:00 when it was
   * taken at 11:14:58 would misreport itself in the journal and in the
   * activity feed.
   *
   * It must stay inside the bar (under 60,000 for one-minute bars), because
   * the chart snaps a mark to the bucket its timestamp falls in — overshoot it
   * and the entry arrow moves to the following candle.
   */
  readonly fillOffsetMs?: number;

  /**
   * Whether one press keeps trading, or buys once and is done.
   *
   * `false` (the default) is a single mandate: the order fills, the position
   * runs, and when it exits that is the end of it. `true` re-arms — as soon as
   * a position closes the engine stands a fresh order behind it, waiting for
   * the next signal, until the session ends or the user stops.
   *
   * A signal strategy is meaningless without this: it would take the first
   * retest of the day and ignore the other eleven.
   */
  readonly continuous?: boolean;
  /**
   * Closed bars before the first real decision.
   *
   * The engine holds an entry in `CREATED` until this many bars have been seen,
   * and says so in the activity feed. Without it, a strategy whose averages are
   * not warm yet answers "no" for reasons that have nothing to do with the
   * market, and the trade looks stuck rather than waiting.
   */
  readonly warmupBars: number;
  readonly paramSpecs: readonly PaperParamSpec[];
  readonly params: Readonly<Record<string, number>>;

  /**
   * Where the stop and target go for a position about to be filled.
   *
   * Called once, at the fill, with `position` still `null` — the levels are
   * part of taking the trade, not something revised afterwards. A strategy with
   * no opinion returns nulls and the position simply runs until it says exit.
   */
  plan(ctx: PaperStrategyContext, entryPrice: number): PaperPlan;

  /**
   * Whether to fill the order on this update.
   *
   * Returning `null` is an ordinary answer and the engine keeps asking. It is
   * not an error and produces no activity line — a feed that logged every bar a
   * strategy declined would bury the ones it acted on.
   */
  entry(ctx: PaperStrategyContext): PaperSignal | null;

  /**
   * Whether to close an `ACTIVE` position on this update.
   *
   * Only consulted after stop and target have both been checked and neither
   * fired, so a strategy never has to re-implement its own risk levels.
   */
  exit(ctx: PaperStrategyContext): PaperSignal | null;

  /**
   * A target that moves, recomputed before the levels are tested each bar.
   *
   * Optional, and absent for every strategy whose target is a price decided
   * once at the fill — {@link plan} already covers those, and the engine skips
   * this entirely when it is not implemented.
   *
   * It exists for a target that is a *line* rather than a number: "exit at the
   * 14 EMA" names a level that is somewhere else on every bar. Handling that
   * in {@link exit} instead would look equivalent and quietly lose two things.
   * The exit would fill at the bar's close rather than at the level price, so
   * a bar that ran well through the EMA would book the overshoot as profit
   * that was never available; and it would be recorded as a strategy exit
   * rather than a target, so the win came out of the analytics under the wrong
   * heading. Returning the level here instead lets the engine's own
   * stop-and-target logic fill it exactly as it fills a fixed one, intrabar
   * touch included.
   *
   * Returning `null` means there is no target on this bar, which is not the
   * same as never having one: a level that is currently the wrong side of
   * price is simply not a target yet, and clearing it is safer than leaving a
   * stale one behind to fire the moment it is crossed from the wrong
   * direction.
   */
  retarget?(ctx: PaperStrategyContext): number | null;
}

/**
 * Merges a strategy's defaults with whatever the caller overrode.
 *
 * Clamped to each spec's bounds rather than trusted: overrides reach this from
 * a form, and a stop multiple of `-3` is not a bold strategy, it is a target.
 */
export function resolveParams(
  strategy: PaperStrategy,
  overrides: Readonly<Record<string, number>> = {},
): Record<string, number> {
  const params: Record<string, number> = { ...strategy.params };
  for (const spec of strategy.paramSpecs) {
    const override = overrides[spec.key];
    if (override === undefined || !Number.isFinite(override)) continue;
    params[spec.key] = Math.min(spec.max, Math.max(spec.min, override));
  }
  return params;
}
