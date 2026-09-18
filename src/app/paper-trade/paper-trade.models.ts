/**
 * The paper-trading domain, stated without reference to a chart, a socket or
 * Angular.
 *
 * Everything the simulation engine knows lives in this file, and nothing in it
 * imports from `chart-stream/` or `@angular/core`. That is not tidiness for its
 * own sake: the same engine is meant to run behind a live feed, behind a
 * historical replay driven by a loop with no UI at all, and eventually behind a
 * performance report. A type that mentioned a `ChartCandleEvent` would tie all
 * three to whatever the streaming API happens to look like this month.
 *
 * The backend's own `strategy.models.ts` describes a *server* simulation and is
 * deliberately not reused here. That one allocates capital per book and decides
 * its own sizing; this one is the trade a person sized by hand, which is a
 * different object with a different lifecycle, and collapsing the two would
 * make both wrong.
 */

/**
 * The contract a paper trade is taken on.
 *
 * `lotSize` is carried on the contract rather than looked up when sizing,
 * because an option's lot size is a property of the contract as the exchange
 * lists it — and it changes between expiries. Sizing against a remembered
 * number would compute a real-looking quantity for a lot size that no longer
 * exists.
 */
export interface PaperContract {
  instrumentKey: string;
  tradingsymbol: string;
  underlying: string;
  /** `YYYY-MM-DD`, or `null` for an instrument that does not expire. */
  expiry: string | null;
  /** `null` for an index or an equity — only an option is struck at a price. */
  strike: number | null;
  /** `null` for anything that is not an option. */
  leg: 'CE' | 'PE' | null;
  lotSize: number;
  tickSize: number;
}

/**
 * The lifecycle, exactly as the three states it has.
 *
 * `CREATED` is not a formality. An order placed at 10:04 is not a position
 * until something fills it, and the gap between the two is where the strategy
 * gets to decide whether the entry still makes sense. Collapsing `CREATED` into
 * `ACTIVE` would mean every trade entered at whatever price happened to be on
 * screen when the button was pressed, which is the one thing paper trading is
 * supposed to teach you not to do.
 */
export type PaperTradeStatus = 'CREATED' | 'ACTIVE' | 'EXITED';

/**
 * Why a position closed.
 *
 * `SESSION_END` is separate from `STRATEGY_EXIT` because it is not a decision —
 * nothing was concluded, the day simply ran out — and a performance report that
 * counted the two together would credit or blame a strategy for the clock.
 */
export type PaperExitReason =
  'STOP_LOSS' | 'TARGET' | 'STRATEGY_EXIT' | 'MANUAL_EXIT' | 'SESSION_END';

/** Long or short. Buying a premium is `BUY`; every option leg here is one. */
export type PaperSide = 'BUY' | 'SELL';

/**
 * One paper position, at whatever point of its life it has reached.
 *
 * Open and closed trades are one type rather than two, with the exit fields
 * nullable, because the audit is the same row in both cases — the activity feed
 * and the position card show the same trade before and after it settles, and a
 * `ClosedTrade` that had to be constructed from an `OpenTrade` would be a place
 * for the two to disagree.
 */
export interface PaperPosition {
  /** Unique across the engine's whole life, and stable once issued. */
  id: string;
  strategyId: string;
  strategyName: string;
  contract: PaperContract;
  side: PaperSide;
  status: PaperTradeStatus;

  /** What the user committed. The engine never sizes above this. */
  investment: number;
  lots: number;
  lotSize: number;
  quantity: number;
  /** `entryPrice × quantity` once filled; the planned value before that. */
  capitalUsed: number;

  /** The price the order was sized against — before any fill. */
  referencePrice: number;
  /** Epoch ms the order was created. Always set; `CREATED` has only this. */
  createdAt: number;

  /** `null` until the fill. */
  entryPrice: number | null;
  /** Epoch ms of the fill. `null` until `ACTIVE`. */
  entryTime: number | null;
  entryReason: string | null;

  stopLoss: number | null;
  target: number | null;

  exitPrice: number | null;
  exitTime: number | null;
  exitReason: PaperExitReason | null;
  exitNote: string | null;

  /** Last price the engine marked this position at. */
  currentPrice: number | null;
  /** Epoch ms of that mark — how stale the P&L on screen is. */
  lastMarkedAt: number | null;

  /** Price movement only, before charges. Live while `ACTIVE`, frozen at exit. */
  grossPnl: number;
  /** Charges booked so far. Only a settled trade has any. */
  costs: number;
  /** `grossPnl - costs` — the figure to lead with. */
  netPnl: number;
  /** `netPnl` against {@link capitalUsed}, as a percentage. */
  netPnlPct: number;
  /** `netPnl` once `EXITED`, `0` before — what a report may sum. */
  realisedPnl: number;
  /** `netPnl` while `ACTIVE`, `0` otherwise — the complement of the above. */
  unrealisedPnl: number;

  /** Worst and best mark-to-market seen while held, in rupees. */
  mae: number;
  mfe: number;
  /** Feed updates seen since the fill — how much evidence the P&L rests on. */
  marksHeld: number;
}

/**
 * What happened, as the activity feed lists it.
 *
 * One flat kind rather than a discriminated union of payloads: every consumer
 * so far wants to render a line, and a union would force each of them to switch
 * over shapes to reach the two fields they actually print.
 */
export type PaperEventKind =
  | 'TRADE_CREATED'
  | 'TRADE_TAKEN'
  | 'STOP_LOSS_HIT'
  | 'TARGET_HIT'
  | 'STRATEGY_EXIT'
  | 'MANUAL_EXIT'
  | 'SESSION_END'
  | 'ORDER_CANCELLED'
  | 'ENTRY_REJECTED';

export interface PaperTradeEvent {
  /** Monotonic within one engine, so a feed can be keyed and sorted on it. */
  seq: number;
  kind: PaperEventKind;
  /** Epoch ms of the *market* instant, not of the browser's clock. */
  at: number;
  tradeId: string;
  strategyName: string;
  tradingsymbol: string;
  /** The price the event happened at, where one applies. */
  price: number | null;
  /** Realised P&L, on the events that settle a trade. */
  netPnl: number | null;
  /** One sentence, already written for a reader. */
  message: string;
}

/**
 * One price update, from whatever is producing prices.
 *
 * The engine's entire input. A live socket, a replayed session and a backtest
 * loop all reduce to a stream of these, which is what lets the same engine sit
 * behind all three without knowing which it is behind.
 *
 * `high`/`low` are optional but load-bearing when present: a stop that was
 * breached *inside* a one-minute bar did breach, and an engine that only ever
 * saw closes would report a day of near-misses that in reality were stopped
 * out. When they are absent the close is used for everything, which is the
 * honest reading of a bare tick.
 */
export interface PaperMarketUpdate {
  instrumentKey: string;
  /** Epoch ms. For a bar, its **open** time — the same stamp the chart uses. */
  timeMs: number;
  /** The mark. A bar's close, or the tick's price. */
  price: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  /**
   * Whether this update completes a bar.
   *
   * Strategies that reason on closed bars only — most of them — ignore updates
   * where this is false, so a forming bar can still move the P&L on screen and
   * still trigger a stop without also triggering an entry on a candle that has
   * not finished printing.
   */
  closed: boolean;
}

/** What the setup form hands the engine when the button is pressed. */
export interface PaperOrderRequest {
  contract: PaperContract;
  strategyId: string;
  side: PaperSide;
  /** Rupees the user is willing to commit. */
  investment: number;
  /** The price the plan was made against — the quote on screen. */
  referencePrice: number;
  lots: number;
  quantity: number;
  /** Overrides the strategy's own plan when set. */
  stopLoss?: number | null;
  target?: number | null;
}

/**
 * The engine's whole observable state.
 *
 * Emitted complete on every change rather than as deltas, for the same reason
 * the backend's run snapshots are: a consumer's rule becomes "replace what you
 * hold", and no missed notification can leave the UI describing a position that
 * has already closed.
 */
export interface PaperTradeSnapshot {
  positions: readonly PaperPosition[];
  events: readonly PaperTradeEvent[];
  totals: PaperTotals;
}

export interface PaperTotals {
  /** Capital in positions that are still open. */
  deployed: number;
  realisedPnl: number;
  unrealisedPnl: number;
  totalPnl: number;
  /** `totalPnl` against the capital committed across every trade taken. */
  totalPnlPct: number;
  costs: number;
  /** Orders placed, in any state. */
  trades: number;
  openTrades: number;
  wins: number;
  losses: number;
  /** Of settled trades; `null` until one settles. */
  winRate: number | null;
}

/** Which activity kinds settle a trade — the ones that carry a realised P&L. */
export const SETTLING_EVENT_KINDS: readonly PaperEventKind[] = [
  'STOP_LOSS_HIT',
  'TARGET_HIT',
  'STRATEGY_EXIT',
  'MANUAL_EXIT',
  'SESSION_END',
];

/** The activity label each kind reads as. */
export const PAPER_EVENT_LABEL: Record<PaperEventKind, string> = {
  TRADE_CREATED: 'Order placed',
  TRADE_TAKEN: 'Trade taken',
  STOP_LOSS_HIT: 'Stop loss hit',
  TARGET_HIT: 'Target hit',
  STRATEGY_EXIT: 'Strategy exit',
  MANUAL_EXIT: 'Manual exit',
  SESSION_END: 'Session end',
  ORDER_CANCELLED: 'Order cancelled',
  ENTRY_REJECTED: 'Entry rejected',
};

/** The exit reason each settling kind corresponds to. */
export const EXIT_REASON_LABEL: Record<PaperExitReason, string> = {
  STOP_LOSS: 'Stop loss',
  TARGET: 'Target',
  STRATEGY_EXIT: 'Strategy exit',
  MANUAL_EXIT: 'Manual exit',
  SESSION_END: 'Session end',
};
