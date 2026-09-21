/**
 * The Trading Dashboard's wire types — mirrors of the backend's
 * `/strategy/live`, `/strategy/backtest` and `/strategy/dashboard` responses.
 *
 * Times are epoch milliseconds unless a field says ISO. Money is rupees, net of
 * the modelled brokerage (₹40 flat on the sell order).
 */

import type { InstrumentRequest } from '../chart-stream/chart-stream.models';

export type TradeMode = 'LIVE' | 'BACKTEST';

/** One instrument to trade, as the start and backtest requests carry it. */
export interface TradingInstrument {
  instrument: InstrumentRequest;
  /** Only for a contract that trades on margin; a bought option pays in full. */
  marginPerLot?: number;
}

export interface StartLiveTradingRequest {
  strategyId: string;
  params?: Record<string, number>;
  capital: number;
  maxCapitalPerTrade?: number;
  instruments: TradingInstrument[];
}

export interface RunBacktestRequest extends StartLiveTradingRequest {
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
  liveSessionId: string | null;
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

export type LiveSessionStatus = 'STARTING' | 'RUNNING' | 'STOPPED' | 'COMPLETED' | 'ERROR';

export interface LiveLaneTrade {
  tradeKey: string;
  side: 'BUY' | 'SELL';
  lots: number;
  lotSize: number;
  quantity: number;
  entryTime: number;
  entryPrice: number;
  stopLoss: number | null;
  target: number | null;
  entryOrderId: string;
}

export interface LiveLane {
  instrumentKey: string;
  tradingsymbol: string;
  lotSize: number;
  tickSize: number;
  sessionDate: string | null;
  barsSeen: number;
  lastBarTime: number | null;
  lastPrice: number | null;
  openTrade: LiveLaneTrade | null;
  tradeCount: number;
  realisedPnl: number;
  unrealisedPnl: number;
  lastRejection: string | null;
  ticks: number;
  lastTickAt: number | null;
  error: string | null;
  warmupBars: number;
}

export interface LiveActivity {
  at: number;
  instrumentKey: string | null;
  tradingsymbol: string | null;
  kind: 'ENTRY' | 'EXIT' | 'REJECTED' | 'FEED_DOWN' | 'FEED_UP' | 'FEED_RESTART' | 'ERROR' | 'INFO';
  message: string;
}

export interface LiveSessionSnapshot {
  sessionId: string;
  status: LiveSessionStatus;
  strategyId: string;
  strategyName: string;
  params: Record<string, number>;
  tradeDate: string;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  account: {
    capital: number;
    availableBalance: number;
    lockedCapital: number;
    realisedPnl: number;
    unrealisedPnl: number;
    maxCapitalPerTrade: number | null;
  };
  feed: { healthy: boolean; disconnects: number; restarts: number };
  instruments: LiveLane[];
  activity: LiveActivity[];
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
}

export interface TradeHistoryQuery {
  mode: TradeMode;
  from?: string;
  to?: string;
  runId?: string;
  limit?: number;
}
