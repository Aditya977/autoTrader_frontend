/**
 * The paper-trading engine.
 *
 * A plain class. No Angular, no RxJS, no chart, no network — its entire input
 * is {@link PaperMarketUpdate} and its entire output is a snapshot plus a
 * callback. That is what lets the same code run behind:
 *
 * - **live paper trading** — a socket pushes updates as they arrive;
 * - **historical backtesting** — a loop pushes a year of bars as fast as the
 *   CPU allows, with no UI attached at all;
 * - **strategy testing** — the same bars through two engines with different
 *   strategies, compared;
 * - **performance analytics** — {@link PaperTradeEngine.snapshot} is already
 *   the full trade ledger a report would read.
 *
 * and why none of those needed to be designed for beyond keeping the boundary
 * honest. The Angular service that wraps this owns signals and change
 * detection; this file owns the trade.
 *
 * ## The one rule that makes it reproducible
 *
 * **No clock.** Every timestamp written to a position or an event comes from
 * `update.timeMs` — the market's instant — never from `Date.now()`. A replay of
 * yesterday's session therefore stamps yesterday's times, a backtest of March
 * stamps March, and the same bars always produce the same ledger. An engine
 * that read the wall clock would give a different answer every time it ran,
 * which would quietly make every backtest worthless.
 *
 * ## Multiple positions
 *
 * Positions are held in a map and every update is applied to all of them that
 * name its instrument. Two strategies on the same contract, or one strategy on
 * a call and another on a put, are the ordinary case rather than a mode.
 */

import {
  type PaperContract,
  type PaperEventKind,
  type PaperExitReason,
  type PaperMarketUpdate,
  type PaperOrderRequest,
  type PaperPosition,
  type PaperRetestSignal,
  type PaperTotals,
  type PaperTradeEvent,
  type PaperTradeSnapshot,
} from './paper-trade.models';
import { grossPnlFor, planLots, planSize, pnlPct } from './sizing';
import {
  type PaperBar,
  type PaperStrategy,
  type PaperStrategyContext,
  resolveParams,
} from './strategies/paper-strategy';
import { paperStrategyById } from './strategies/registry';

export interface PaperTradeEngineOptions {
  /**
   * Flat charge booked when a position closes, in rupees.
   *
   * A charge on the exit only, matching how the backend simulation models it,
   * and stated rather than hidden: on a frequent intraday option strategy it is
   * a large fraction of the edge, and a "net" P&L that quietly excluded it
   * would show profit that does not exist.
   */
  exitCost?: number;
  /**
   * Closed bars kept per instrument.
   *
   * A cap, not a tuning knob: a strategy reads a window, and an unbounded array
   * behind a multi-day replay is the one way this engine could leak.
   */
  historyBars?: number;
  /** Activity events kept. Oldest are dropped; the ledger in `positions` is complete. */
  maxEvents?: number;
  /** Injectable id source, so a test can assert on ids. */
  idFactory?: () => string;
}

const DEFAULTS = {
  exitCost: 40,
  historyBars: 2_000,
  maxEvents: 500,
};

export class PaperTradeEngine {
  private readonly positions = new Map<string, PaperPosition>();
  /** Insertion order, so the ledger reads oldest-first without sorting. */
  private readonly order: string[] = [];
  private readonly events: PaperTradeEvent[] = [];
  /** Closed bars per instrument key — what a strategy reads as history. */
  private readonly history = new Map<string, PaperBar[]>();
  /** Params per position, resolved once at placement so a later edit cannot alter a live trade. */
  private readonly paramsByTrade = new Map<string, Record<string, number>>();
  /** Last price seen per instrument, for sizing a new order against the feed. */
  private readonly lastPrice = new Map<string, number>();

  /**
   * Retest signals per instrument, for the strategies that read them.
   *
   * Supplied from outside rather than derived here: they come from the same
   * overlay the chart draws, and re-deriving them would mean a strategy could
   * act on a retest the user cannot see.
   */
  private readonly retests = new Map<string, readonly PaperRetestSignal[]>();

  /**
   * The order behind each position, kept so a continuous strategy can be
   * re-armed on the same terms after one of its trades settles.
   */
  private readonly requestByTrade = new Map<string, PaperOrderRequest>();

  private readonly listeners = new Set<(snapshot: PaperTradeSnapshot) => void>();
  private readonly options: Required<Omit<PaperTradeEngineOptions, 'idFactory'>>;
  private readonly newId: () => string;
  private seq = 0;
  private counter = 0;

  constructor(options: PaperTradeEngineOptions = {}) {
    this.options = {
      exitCost: options.exitCost ?? DEFAULTS.exitCost,
      historyBars: options.historyBars ?? DEFAULTS.historyBars,
      maxEvents: options.maxEvents ?? DEFAULTS.maxEvents,
    };
    this.newId = options.idFactory ?? (() => `PT-${String(++this.counter).padStart(4, '0')}`);
  }

  /** Called after every state change, with the complete state. */
  subscribe(listener: (snapshot: PaperTradeSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  /* ---------------------------------------------------------------------
   * Placing and closing
   * ------------------------------------------------------------------ */

  /**
   * Places an order. Returns the position in `CREATED`, or a rejection.
   *
   * Nothing is sent anywhere. There is no broker client in this module, no
   * order endpoint, and no code path from here to one — the position exists in
   * this map and nowhere else, which is the guarantee the feature rests on.
   *
   * The sizing is recomputed here rather than trusted from the request, so a
   * stale preview — the price moved between the form rendering and the button
   * being pressed — cannot commit more capital than the user typed.
   */
  place(request: PaperOrderRequest): { position: PaperPosition } | { error: string } {
    const strategy = paperStrategyById(request.strategyId);
    if (!strategy) return { error: `Unknown strategy “${request.strategyId}”.` };

    const price = this.lastPrice.get(request.contract.instrumentKey) ?? request.referencePrice;
    // Re-sized against the live price either way — the form's preview may be a
    // few seconds and several rupees stale — but along the axis the user left
    // free. See {@link PaperSizingMode}.
    const plan =
      request.sizing === 'LOTS'
        ? planLots(request.contract, price, request.lots)
        : planSize(request.contract, price, request.investment);
    if (!plan.valid) return { error: plan.message };

    const id = this.newId();
    // The market's own instant where the feed has given one; falling back to
    // the wall clock only for an order placed before a single bar has arrived,
    // where there is no market instant to use.
    const at = this.clockFor(request.contract.instrumentKey);

    const position: PaperPosition = {
      id,
      strategyId: strategy.id,
      strategyName: strategy.name,
      contract: request.contract,
      side: request.side,
      status: 'CREATED',
      // The plan's figure, not the request's: sizing by lots derives the
      // investment from the size, and echoing the request here would show a
      // committed amount that the fill does not match.
      investment: plan.investment,
      lots: plan.lots,
      lotSize: plan.lotSize,
      quantity: plan.quantity,
      capitalUsed: plan.requiredCapital,
      referencePrice: price,
      createdAt: at,
      entryPrice: null,
      entryTime: null,
      entryReason: null,
      // The user's levels are held from placement; the strategy's own plan
      // fills in whichever of the two they left alone, at the fill.
      stopLoss: request.stopLoss ?? null,
      target: request.target ?? null,
      exitPrice: null,
      exitTime: null,
      exitReason: null,
      exitNote: null,
      currentPrice: price,
      lastMarkedAt: null,
      grossPnl: 0,
      costs: 0,
      netPnl: 0,
      netPnlPct: 0,
      realisedPnl: 0,
      unrealisedPnl: 0,
      mae: 0,
      mfe: 0,
      marksHeld: 0,
    };

    this.positions.set(id, position);
    this.order.push(id);
    this.paramsByTrade.set(id, resolveParams(strategy));
    this.requestByTrade.set(id, request);

    this.record('TRADE_CREATED', position, {
      at,
      price,
      message:
        `${plan.lots} lot${plan.lots === 1 ? '' : 's'} (${plan.quantity}) of ` +
        `${request.contract.tradingsymbol} queued on ${strategy.name}` +
        `${strategy.warmupBars > 0 ? `, waiting for ${strategy.warmupBars} bars` : ''}.`,
    });

    this.publish();
    return { position: this.positions.get(id)! };
  }

  /**
   * Closes a position at the last price the engine marked it at.
   *
   * The *marked* price rather than a fresh one: there is no fresh one to get —
   * the engine has no feed of its own, by design — and inventing one would make
   * a manual exit fill at a price no bar ever printed.
   */
  closeManually(id: string): void {
    const position = this.positions.get(id);
    if (!position) return;

    if (position.status === 'CREATED') {
      this.cancel(id);
      return;
    }
    if (position.status !== 'ACTIVE') return;

    const price = position.currentPrice ?? position.entryPrice ?? position.referencePrice;
    this.settle(position, price, this.clockFor(position.contract.instrumentKey), 'MANUAL_EXIT', {
      note: 'closed by hand',
    });
    this.publish();
  }

  /** Drops an order that never filled. Not an exit — nothing was ever held. */
  cancel(id: string): void {
    const position = this.positions.get(id);
    if (!position || position.status !== 'CREATED') return;

    this.positions.set(id, {
      ...position,
      status: 'EXITED',
      exitReason: 'MANUAL_EXIT',
      exitNote: 'cancelled before entry',
      exitTime: this.clockFor(position.contract.instrumentKey),
    });
    this.record('ORDER_CANCELLED', position, {
      at: this.clockFor(position.contract.instrumentKey),
      price: null,
      message: `Order on ${position.contract.tradingsymbol} cancelled before it filled.`,
    });
    this.publish();
  }

  /**
   * Squares off everything still open — the close of a replay or of the day.
   *
   * Its own exit reason rather than a manual one: nothing was decided here, the
   * session simply ended, and an analytics pass that counted these as strategy
   * exits would grade a strategy on the clock.
   */
  endSession(instrumentKey?: string): void {
    let changed = false;
    for (const id of this.order) {
      const position = this.positions.get(id);
      if (!position) continue;
      if (instrumentKey && position.contract.instrumentKey !== instrumentKey) continue;

      if (position.status === 'ACTIVE') {
        const price = position.currentPrice ?? position.entryPrice ?? position.referencePrice;
        this.settle(
          position,
          price,
          this.clockFor(position.contract.instrumentKey),
          'SESSION_END',
          {
            note: 'squared off at session end',
          },
        );
        changed = true;
      } else if (position.status === 'CREATED') {
        this.cancelSilently(position, 'session ended before the entry signal');
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  /** Forgets everything. The page calls this when a new session is started. */
  reset(): void {
    this.positions.clear();
    this.order.length = 0;
    this.events.length = 0;
    this.history.clear();
    this.paramsByTrade.clear();
    this.requestByTrade.clear();
    this.retests.clear();
    this.lastPrice.clear();
    this.publish();
  }

  /* ---------------------------------------------------------------------
   * The feed
   * ------------------------------------------------------------------ */

  /**
   * One price update. The engine's only driver.
   *
   * Order of business per position, and it is not arbitrary:
   *
   * 1. **stop**, then 2. **target**, then 3. the strategy's exit.
   *
   * Stop before target because when a single bar's range covers both, there is
   * no way to know from OHLC which came first, and assuming the good one is how
   * a backtest talks itself into profit it would never have made. The strategy
   * is asked last because its levels are already represented by the first two,
   * so consulting it first would let it override a stop that had already been
   * hit.
   */
  onUpdate(update: PaperMarketUpdate): void {
    if (!Number.isFinite(update.price)) return;

    this.lastPrice.set(update.instrumentKey, update.price);
    if (update.closed) this.appendBar(update);

    let changed = false;
    // Collected rather than opened inside the loop: `this.order` is being
    // iterated, and standing the next order up mid-pass would let it be
    // offered the very bar that closed its predecessor.
    const rearm: PaperOrderRequest[] = [];
    for (const id of [...this.order]) {
      const position = this.positions.get(id);
      if (!position) continue;
      if (position.contract.instrumentKey !== update.instrumentKey) continue;
      if (position.status === 'EXITED') continue;

      changed = this.applyTo(position, update, rearm) || changed;
    }
    for (const request of rearm) {
      // A refusal here is not worth surfacing: the mandate simply cannot be
      // re-sized at the current price, and the run is over rather than broken.
      this.place(request);
      changed = true;
    }

    // Published even when nothing transitioned, because the mark itself moved:
    // the position card's "current price" and live P&L are state, and holding
    // them back until a transition would freeze the panel between trades.
    if (changed || this.hasOpenOn(update.instrumentKey)) this.publish();
  }

  /** Convenience for a caller holding bars rather than a socket — a backtest. */
  replay(updates: Iterable<PaperMarketUpdate>): void {
    for (const update of updates) this.onUpdate(update);
  }

  /* ---------------------------------------------------------------------
   * Reading
   * ------------------------------------------------------------------ */

  snapshot(): PaperTradeSnapshot {
    const positions = this.order
      .map((id) => this.positions.get(id))
      .filter((p): p is PaperPosition => p !== undefined);
    return {
      positions,
      events: [...this.events],
      totals: totalsFor(positions),
    };
  }

  /** The newest price the engine has seen for an instrument, if any. */
  priceOf(instrumentKey: string): number | null {
    return this.lastPrice.get(instrumentKey) ?? null;
  }

  /**
   * Hands the engine the retests the overlay found for an instrument.
   *
   * A complete replacement, like every other set in this codebase that comes
   * from the backend: a retest that stopped qualifying is simply absent from
   * the next call.
   */
  setRetests(instrumentKey: string, signals: readonly PaperRetestSignal[]): void {
    this.retests.set(
      instrumentKey,
      [...signals].sort((a, b) => a.atMs - b.atMs),
    );
  }

  /** Whether retests have been supplied for an instrument yet. */
  hasRetests(instrumentKey: string): boolean {
    return this.retests.has(instrumentKey);
  }

  /**
   * Forgets the bar history, so a re-run rebuilds it as it goes.
   *
   * The fix for a look-ahead that is invisible until a strategy reads history.
   * A recorded session is replayed by feeding its bars back through the
   * engine, but by then the engine already holds every bar of that session
   * from the live pass — and {@link appendBar} *replaces* a bar of the same
   * instant rather than truncating what comes after it. So on the first
   * replayed bar the history is still 375 bars long, and a strategy asking
   * "what has happened so far" is handed the whole day including its end.
   *
   * It costs nothing for a strategy that only reads the update it was given,
   * which is why this went unnoticed: the first strategy to read `ctx.bars`
   * was the first one to see the future, and it simply took no trades rather
   * than taking wrong ones.
   *
   * Positions, events and supplied retests are untouched — this is about what
   * the engine believes it has *seen*, not about what it has done.
   */
  rewindHistory(instrumentKey?: string): void {
    if (instrumentKey === undefined) this.history.clear();
    else this.history.delete(instrumentKey);
  }

  /**
   * The closed bars the engine holds for an instrument, oldest first.
   *
   * The series every strategy decision was actually made against, which is
   * what makes it worth exposing: when a strategy's window looks wrong, the
   * first question is whether the bars underneath it are, and there is
   * otherwise no way to ask. A backtest harness reading the engine's own view
   * of history wants the same thing.
   */
  barsOf(instrumentKey: string): readonly PaperBar[] {
    return this.history.get(instrumentKey) ?? EMPTY_BARS;
  }

  /* ---------------------------------------------------------------------
   * Internals
   * ------------------------------------------------------------------ */

  /** Returns whether the position changed state (as opposed to merely marking). */
  private applyTo(
    position: PaperPosition,
    update: PaperMarketUpdate,
    rearm: PaperOrderRequest[],
  ): boolean {
    const strategy = paperStrategyById(position.strategyId);
    if (!strategy) return false;

    const ctx = this.contextFor(position, update, strategy);

    if (position.status === 'CREATED') return this.tryEntry(position, update, strategy, ctx);

    // The instant this bar's decisions are stamped with. The bar's own time
    // unless the strategy says otherwise — see {@link PaperStrategy.fillOffsetMs}.
    const at = update.timeMs + this.offsetOf(strategy);

    // ACTIVE from here: mark first, so an exit below settles against a position
    // whose MAE/MFE already include this update.
    let marked = this.mark(position, update);

    // A moving target is resolved before the levels are tested, so this bar is
    // judged against this bar's level rather than the previous one's. No-op
    // for a strategy that does not implement it, which is all of them unless
    // their target is a line — see {@link PaperStrategy.retarget}.
    if (strategy.retarget) {
      const moved = strategy.retarget({ ...ctx, position: marked });
      if (moved !== marked.target) marked = { ...marked, target: moved };
    }

    const stop = this.stopHit(marked, update);
    if (stop !== null) {
      this.settle(marked, stop, at, 'STOP_LOSS', { note: 'stop loss hit' });
      this.considerRearm(strategy, marked, rearm);
      return true;
    }

    const target = this.targetHit(marked, update);
    if (target !== null) {
      this.settle(marked, target, at, 'TARGET', { note: 'target reached' });
      this.considerRearm(strategy, marked, rearm);
      return true;
    }

    const exit = strategy.exit({ ...ctx, position: marked });
    if (exit) {
      this.settle(marked, update.price, at, 'STRATEGY_EXIT', { note: exit.reason });
      this.considerRearm(strategy, marked, rearm);
      return true;
    }

    this.positions.set(marked.id, marked);
    return false;
  }

  /**
   * Stands the next order up behind a continuous strategy's settled trade.
   *
   * Only after a trade the *market* closed — a stop, a target, or the
   * strategy's own exit. A manual exit or a session square-off is the user or
   * the clock saying stop, and re-arming through either would be the engine
   * refusing to be switched off.
   *
   * Does nothing at all for an ordinary strategy, which is what keeps this an
   * addition rather than a change: a mandate without {@link
   * PaperStrategy.continuous} ends exactly where it always did.
   */
  private considerRearm(
    strategy: PaperStrategy,
    settled: PaperPosition,
    rearm: PaperOrderRequest[],
  ): void {
    if (!strategy.continuous) return;
    const request = this.requestByTrade.get(settled.id);
    if (request) rearm.push(request);
  }

  private tryEntry(
    position: PaperPosition,
    update: PaperMarketUpdate,
    strategy: PaperStrategy,
    ctx: PaperStrategyContext,
  ): boolean {
    const bars = ctx.bars.length;
    if (bars < strategy.warmupBars) {
      // Kept off the activity feed on purpose: a line per declined bar during a
      // 21-bar warm-up would bury the entry it is waiting for. The position
      // card shows it as waiting, which is where that belongs.
      this.positions.set(position.id, { ...position, currentPrice: update.price });
      return false;
    }

    const signal = strategy.entry(ctx);
    if (!signal) {
      this.positions.set(position.id, { ...position, currentPrice: update.price });
      return false;
    }

    // Filled at the update's price, not at the price the form was sized
    // against: between placing and filling, the market moved, and pretending
    // otherwise is the single most flattering lie a paper trader can tell.
    const entryPrice = update.price;
    const at = update.timeMs + this.offsetOf(strategy);

    // A budget order is re-sized to the most whole lots the budget buys **at
    // the fill price**. For a signal strategy the order may have been sized an
    // hour ago at a very different premium; filling the stale lot count would
    // commit more — or less — than the amount the user typed. A lot-count order
    // keeps its lots: that number was the user's decision.
    const request = this.requestByTrade.get(position.id);
    let sized = position;
    if ((request?.sizing ?? 'AMOUNT') === 'AMOUNT') {
      const plan = planSize(position.contract, entryPrice, request?.investment ?? position.investment);
      if (!plan.valid) {
        this.positions.set(position.id, { ...position, currentPrice: update.price });
        this.record('ENTRY_REJECTED', position, {
          at,
          price: entryPrice,
          message: `Signal on ${position.contract.tradingsymbol} skipped — ${plan.message}`,
        });
        return false;
      }
      sized = { ...position, lots: plan.lots, quantity: plan.quantity };
    }

    const planned = strategy.plan({ ...ctx, position: null }, entryPrice);

    const filled: PaperPosition = {
      ...sized,
      status: 'ACTIVE',
      entryPrice,
      entryTime: at,
      entryReason: signal.reason,
      // The user's own level wins where they set one; the strategy fills the rest.
      stopLoss: position.stopLoss ?? planned.stopLoss,
      target: position.target ?? planned.target,
      capitalUsed: entryPrice * sized.quantity,
      currentPrice: entryPrice,
      lastMarkedAt: at,
      marksHeld: 0,
    };

    this.positions.set(filled.id, filled);
    this.record('TRADE_TAKEN', filled, {
      at,
      price: entryPrice,
      message:
        `Bought ${filled.quantity} of ${filled.contract.tradingsymbol} at ₹${fmt(entryPrice)} — ` +
        `${signal.reason}.`,
    });
    return true;
  }

  /** Mark-to-market, without deciding anything. Returns the updated copy. */
  private mark(position: PaperPosition, update: PaperMarketUpdate): PaperPosition {
    const entryPrice = position.entryPrice;
    if (entryPrice === null) return position;

    const grossPnl = grossPnlFor(position.side, entryPrice, update.price, position.quantity);
    // Costs are not booked until the exit, so an open position's net is its
    // gross. Charging on entry would show every fresh trade ₹40 down before the
    // market has done anything, which reads as a loss rather than as a fee.
    const netPnl = grossPnl;

    // The extremes use the bar's own range where there is one: a position that
    // was ₹4,000 down inside the minute genuinely was, and MAE computed from
    // closes alone reports a calm trade that never happened.
    const worst = this.excursion(position, update, 'worst');
    const best = this.excursion(position, update, 'best');

    return {
      ...position,
      currentPrice: update.price,
      lastMarkedAt: update.timeMs,
      marksHeld: position.marksHeld + 1,
      grossPnl,
      netPnl,
      netPnlPct: pnlPct(netPnl, position.capitalUsed),
      unrealisedPnl: netPnl,
      realisedPnl: 0,
      mae: Math.min(position.mae, worst),
      mfe: Math.max(position.mfe, best),
    };
  }

  private excursion(
    position: PaperPosition,
    update: PaperMarketUpdate,
    which: 'worst' | 'best',
  ): number {
    const entryPrice = position.entryPrice!;
    const long = position.side === 'BUY';
    const adverse = long ? (update.low ?? update.price) : (update.high ?? update.price);
    const favourable = long ? (update.high ?? update.price) : (update.low ?? update.price);
    const price = which === 'worst' ? adverse : favourable;
    return grossPnlFor(position.side, entryPrice, price, position.quantity);
  }

  /**
   * The price a stop filled at, or `null` if it did not.
   *
   * Filled *at the stop*, not at the bar's close: a stop is a resting order, so
   * once price trades through it the fill is the level, and settling at the
   * close would book whatever further damage the bar did afterwards as if the
   * stop had not been there. Where the bar gapped straight past it — the open
   * is already beyond — the open is the honest fill.
   */
  private stopHit(position: PaperPosition, update: PaperMarketUpdate): number | null {
    const stop = position.stopLoss;
    if (stop === null) return null;

    const long = position.side === 'BUY';
    const extreme = long ? (update.low ?? update.price) : (update.high ?? update.price);
    const breached = long ? extreme <= stop : extreme >= stop;
    if (!breached) return null;

    const open = update.open;
    if (open !== undefined && (long ? open <= stop : open >= stop)) return open;
    return stop;
  }

  /** The same reasoning, on the profitable side. */
  private targetHit(position: PaperPosition, update: PaperMarketUpdate): number | null {
    const target = position.target;
    if (target === null) return null;

    const long = position.side === 'BUY';
    const extreme = long ? (update.high ?? update.price) : (update.low ?? update.price);
    const reached = long ? extreme >= target : extreme <= target;
    if (!reached) return null;

    const open = update.open;
    if (open !== undefined && (long ? open >= target : open <= target)) return open;
    return target;
  }

  /** CREATED/ACTIVE → EXITED, with the P&L frozen and the event written. */
  private settle(
    position: PaperPosition,
    exitPrice: number,
    at: number,
    reason: PaperExitReason,
    detail: { note: string },
  ): void {
    const entryPrice = position.entryPrice ?? exitPrice;
    const grossPnl = grossPnlFor(position.side, entryPrice, exitPrice, position.quantity);
    const costs = this.options.exitCost;
    const netPnl = grossPnl - costs;

    const closed: PaperPosition = {
      ...position,
      status: 'EXITED',
      exitPrice,
      exitTime: at,
      exitReason: reason,
      exitNote: detail.note,
      currentPrice: exitPrice,
      lastMarkedAt: at,
      grossPnl,
      costs,
      netPnl,
      netPnlPct: pnlPct(netPnl, position.capitalUsed),
      realisedPnl: netPnl,
      unrealisedPnl: 0,
    };

    this.positions.set(closed.id, closed);
    this.record(EXIT_EVENT[reason], closed, {
      at,
      price: exitPrice,
      netPnl,
      message:
        `${position.contract.tradingsymbol} closed at ₹${fmt(exitPrice)} — ${detail.note}. ` +
        `Net ${signed(netPnl)}.`,
    });
  }

  private cancelSilently(position: PaperPosition, note: string): void {
    this.positions.set(position.id, {
      ...position,
      status: 'EXITED',
      exitReason: 'SESSION_END',
      exitNote: note,
      exitTime: this.clockFor(position.contract.instrumentKey),
    });
    this.record('ORDER_CANCELLED', position, {
      at: this.clockFor(position.contract.instrumentKey),
      price: null,
      message: `Order on ${position.contract.tradingsymbol} expired — ${note}.`,
    });
  }

  private contextFor(
    position: PaperPosition,
    update: PaperMarketUpdate,
    strategy: PaperStrategy,
  ): PaperStrategyContext {
    return {
      update,
      bars: this.history.get(update.instrumentKey) ?? EMPTY_BARS,
      price: update.price,
      position: position.status === 'CREATED' ? null : position,
      side: position.side,
      params: this.paramsByTrade.get(position.id) ?? strategy.params,
      // Only for a strategy that asked. Handing them to every strategy would
      // cost a copy per bar per position for a list almost none of them read.
      retests: strategy.needsRetests
        ? (this.retests.get(update.instrumentKey) ?? EMPTY_RETESTS)
        : EMPTY_RETESTS,
      contract: { lotSize: position.contract.lotSize, tickSize: position.contract.tickSize },
    };
  }

  /**
   * Where inside its bar this strategy's fills are stamped.
   *
   * `0` for everything that has no opinion, which is the bar's own timestamp
   * and exactly what the engine did before the option existed.
   */
  private offsetOf(strategy: PaperStrategy): number {
    const offset = strategy.fillOffsetMs ?? 0;
    return Number.isFinite(offset) && offset > 0 ? offset : 0;
  }

  /**
   * Appends a closed bar, replacing rather than duplicating a repeat of the
   * newest stamp.
   *
   * **Idempotent by bar time, anywhere in the window** — not merely against the
   * newest bar. Two things re-send bars the engine has already seen: a
   * reconnecting socket replaying its backlog, and a paced re-run of a session
   * that has already streamed (which is how a trade placed after an instant
   * replay gets simulated at all). Deduplicating only against the last bar
   * would let the second of those splice a whole duplicate day into the middle
   * of the history, and every window a strategy measures would silently double.
   */
  private appendBar(update: PaperMarketUpdate): void {
    const bars = this.history.get(update.instrumentKey) ?? [];
    const bar: PaperBar = {
      timeMs: update.timeMs,
      open: update.open ?? update.price,
      high: update.high ?? update.price,
      low: update.low ?? update.price,
      close: update.price,
      volume: update.volume ?? 0,
    };

    const last = bars.at(-1);
    if (last && last.timeMs === bar.timeMs) bars[bars.length - 1] = bar;
    else if (last && last.timeMs > bar.timeMs) {
      // Out of order: either a backlog behind a live bar, or a re-run. Replace
      // the bar of the same instant where there is one, and otherwise insert
      // where it belongs so the window a strategy reads stays in time order.
      const at = bars.findIndex((b) => b.timeMs >= bar.timeMs);
      if (at >= 0 && bars[at]!.timeMs === bar.timeMs) bars[at] = bar;
      else bars.splice(at < 0 ? bars.length : at, 0, bar);
    } else bars.push(bar);

    if (bars.length > this.options.historyBars) {
      bars.splice(0, bars.length - this.options.historyBars);
    }
    this.history.set(update.instrumentKey, bars);
  }

  private hasOpenOn(instrumentKey: string): boolean {
    for (const position of this.positions.values()) {
      if (position.contract.instrumentKey !== instrumentKey) continue;
      if (position.status !== 'EXITED') return true;
    }
    return false;
  }

  /** The market instant, or the wall clock where the feed has not spoken yet. */
  private clockFor(instrumentKey: string): number {
    const bars = this.history.get(instrumentKey);
    return bars?.at(-1)?.timeMs ?? Date.now();
  }

  private record(
    kind: PaperEventKind,
    position: PaperPosition,
    detail: { at: number; price: number | null; netPnl?: number; message: string },
  ): void {
    this.events.push({
      seq: ++this.seq,
      kind,
      at: detail.at,
      tradeId: position.id,
      strategyName: position.strategyName,
      tradingsymbol: position.contract.tradingsymbol,
      price: detail.price,
      netPnl: detail.netPnl ?? null,
      message: detail.message,
    });
    if (this.events.length > this.options.maxEvents) {
      this.events.splice(0, this.events.length - this.options.maxEvents);
    }
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

const EMPTY_BARS: readonly PaperBar[] = [];
const EMPTY_RETESTS: readonly PaperRetestSignal[] = [];

const EXIT_EVENT: Record<PaperExitReason, PaperEventKind> = {
  STOP_LOSS: 'STOP_LOSS_HIT',
  TARGET: 'TARGET_HIT',
  STRATEGY_EXIT: 'STRATEGY_EXIT',
  MANUAL_EXIT: 'MANUAL_EXIT',
  SESSION_END: 'SESSION_END',
};

/**
 * The book-level figures, derived rather than accumulated.
 *
 * Recomputed from the positions on every snapshot, so there is no running total
 * that can drift out of step with the trades it claims to summarise — the
 * classic way a P&L panel ends up disagreeing with the table beneath it.
 */
export function totalsFor(positions: readonly PaperPosition[]): PaperTotals {
  let deployed = 0;
  let realisedPnl = 0;
  let unrealisedPnl = 0;
  let costs = 0;
  let openTrades = 0;
  let wins = 0;
  let losses = 0;
  let settled = 0;
  let committed = 0;

  for (const position of positions) {
    costs += position.costs;
    if (position.status === 'ACTIVE') {
      deployed += position.capitalUsed;
      committed += position.capitalUsed;
      unrealisedPnl += position.unrealisedPnl;
      openTrades++;
    } else if (position.status === 'EXITED' && position.entryPrice !== null) {
      committed += position.capitalUsed;
      realisedPnl += position.realisedPnl;
      settled++;
      if (position.realisedPnl > 0) wins++;
      else if (position.realisedPnl < 0) losses++;
    }
  }

  const totalPnl = realisedPnl + unrealisedPnl;
  return {
    deployed,
    realisedPnl,
    unrealisedPnl,
    totalPnl,
    totalPnlPct: committed ? (totalPnl / committed) * 100 : 0,
    costs,
    trades: positions.length,
    openTrades,
    wins,
    losses,
    winRate: settled ? Math.round((wins / settled) * 100) : null,
  };
}

/** Contract fields a caller has to fill; here so the UI need not restate them. */
export type { PaperContract };

function fmt(value: number): string {
  return value.toFixed(2);
}

function signed(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? '+' : '−'}₹${Math.abs(rounded).toLocaleString('en-IN')}`;
}
