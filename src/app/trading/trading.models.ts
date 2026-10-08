/**
 * The Trading Dashboard's wire types — mirrors of the backend's
 * `/strategy/paper`, `/strategy/backtest` and `/strategy/dashboard` responses.
 *
 * Times are epoch milliseconds unless a field says ISO. Money is rupees, net of
 * the modelled brokerage (₹40 flat on the sell order).
 */

import type { InstrumentRequest } from '../chart-stream/chart-stream.models';
import type { StrategyDescriptor } from '../strategy/strategy.models';

/** `PAPER`: paper trading on the live feed. `BACKTEST`: runs over history. */
export type TradeMode = 'PAPER' | 'BACKTEST';

/** One instrument to backtest. */
export interface TradingInstrument {
  instrument: InstrumentRequest;
  /** Only for a contract that trades on margin; a bought option pays in full. */
  marginPerLot?: number;
}

export interface RunBacktestRequest {
  strategyId: string;
  capital: number;
  maxCapitalPerTrade?: number;
  instruments: TradingInstrument[];
  from: string;
  to: string;
  label?: string;
}

/** A trade row, whichever path recorded it. */
export interface DashboardTrade {
  id: number;
  /** The unique id the trade is stored under in trade_history. */
  tradeId: string;
  mode: TradeMode;
  runId: string | null;
  strategyId: string;
  strategyName: string;
  instrumentKey: string;
  tradingsymbol: string;
  side: 'BUY' | 'SELL';
  status: 'OPEN' | 'CLOSED';
  quantity: number;
  lots: number | null;
  lotSize: number | null;
  entryAt: number;
  entryPrice: number;
  exitAt: number | null;
  exitPrice: number | null;
  stopLoss: number | null;
  target: number | null;
  grossPnl: number | null;
  costs: number;
  netPnl: number | null;
  netPnlPct: number | null;
  /** STOP, TARGET, TIME_EXIT, STRATEGY_EXIT, SQUARE_OFF, SESSION_END, MANUAL. */
  exitReason: string | null;
  /** Human detail: "held 2 candles", "stop hit at 102.45". */
  exitNote: string | null;
  entryOrderId: string | null;
  exitOrderId: string | null;
}

export interface PnlStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number;
  grossPnl: number;
  costs: number;
  avgPnl: number | null;
  avgProfit: number | null;
  avgLoss: number | null;
  best: number | null;
  worst: number | null;
}

export interface PnlBucket extends PnlStats {
  period: string;
}

export interface DashboardOverview {
  mode: TradeMode;
  today: string;
  paperSessionId: string | null;
  capital: number;
  availableBalance: number;
  todayPnl: number;
  todayRealisedPnl: number;
  tradesToday: number;
  todayWins: number;
  todayLosses: number;
  totalPnl: number;
  realisedPnl: number;
  unrealisedPnl: number;
  openPositions: number;
  openTrades: DashboardTrade[];
}

export interface DashboardPerformance {
  from: string | null;
  to: string | null;
  range: PnlStats;
  daily: PnlBucket[];
  weekly: PnlBucket[];
  monthly: PnlBucket[];
}

export type PaperInstrument = 'NIFTY' | 'BANKNIFTY';

/** What paper trading gives each strategy on one index. Fixed by the backend. */
export interface PaperAllocation {
  instrument: PaperInstrument;
  capital: number;
  maxLots: number;
}

/** A strategy and whether it is deployed to paper trading. */
export interface StrategyDeployment {
  strategy: StrategyDescriptor;
  enabled: boolean;
  updatedAt: string | null;
}

export type PaperSessionStatus = 'STARTING' | 'RUNNING' | 'STOPPED' | 'COMPLETED' | 'ERROR';

export interface PaperOpenTrade {
  tradeKey: string;
  instrumentKey: string;
  tradingsymbol: string;
  side: 'BUY' | 'SELL';
  lots: number;
  lotSize: number;
  quantity: number;
  entryTime: number;
  entryPrice: number;
  stopLoss: number | null;
  target: number | null;
}

/** A contract the day's session streams: the ATM call or put of one index. */
export interface PaperContract {
  instrument: PaperInstrument;
  instrumentKey: string;
  tradingsymbol: string;
  optionType: 'CE' | 'PE';
  strike: number | null;
  expiry: string | null;
  lotSize: number;
  ticks: number;
  lastTickAt: number | null;
  lastPrice: number | null;
}

/** One strategy's book on one index. */
export interface PaperBook {
  strategyId: string;
  strategyName: string;
  instrument: PaperInstrument;
  capital: number;
  maxLots: number;
  availableBalance: number;
  realisedPnl: number;
  unrealisedPnl: number;
  tradeCount: number;
  openTrade: PaperOpenTrade | null;
  lastRejection: string | null;
  error: string | null;
}

export interface PaperActivity {
  at: number;
  strategyId: string | null;
  tradingsymbol: string | null;
  kind: 'ENTRY' | 'EXIT' | 'REJECTED' | 'FEED_DOWN' | 'FEED_UP' | 'FEED_RESTART' | 'ERROR' | 'INFO';
  message: string;
}

export interface PaperSession {
  sessionId: string;
  status: PaperSessionStatus;
  tradeDate: string;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  feed: { healthy: boolean; disconnects: number; restarts: number };
  contracts: PaperContract[];
  books: PaperBook[];
  activity: PaperActivity[];
}

export interface PaperTradingStatus {
  state: 'STARTING' | 'RUNNING' | 'IDLE';
  /** Why nothing is running; `null` while running. */
  reason: string | null;
  paused: boolean;
  allocations: PaperAllocation[];
  /** Strategies traded at a different size than `allocations` (more lots, capital scaled), by id. */
  strategyAllocations?: Record<string, PaperAllocation[]>;
  enabledStrategies: string[];
  /** The running session, or today's latest. */
  session: PaperSession | null;
}

/** One row of the paper-trading report (`paper_trades`). */
export interface PaperTradeRecord {
  id: number;
  tradeId: string;
  sessionId: string;
  /** IST date of the entry. */
  date: string;
  /** IST time of the entry, `HH:mm:ss`. */
  time: string;
  lots: number;
  instrument: PaperInstrument;
  strategyId: string;
  strategyName: string;
  tradingsymbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  profitable: boolean;
  stopLoss: number | null;
  stopLossHit: boolean;
  entryAt: number;
  exitAt: number;
  exitReason: string;
  charges: number;
  netPnl: number;
}

export interface BacktestRunSummary {
  runId: string;
  label: string | null;
  strategyId: string;
  strategyName: string;
  params: Record<string, number>;
  from: string;
  to: string;
  instruments: { instrumentKey: string; tradingsymbol: string; bars: number }[];
  capital: number;
  endingCash: number;
  barsProcessed: number;
  rejections: number;
  recorded: number;
  stats: PnlStats;
  trades: DashboardTrade[];
  /** Each instrument's traded bars: `[openTimeMs, open, high, low, close]`. */
  charts: BacktestChart[];
}

export interface BacktestChart {
  instrumentKey: string;
  tradingsymbol: string;
  bars: [number, number, number, number, number][];
}

export interface TradeHistoryQuery {
  mode: TradeMode;
  from?: string;
  to?: string;
  runId?: string;
  limit?: number;
}
