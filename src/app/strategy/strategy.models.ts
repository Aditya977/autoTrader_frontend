import type { ChartSessionStatus, StartStreamRequest } from '../chart-stream/chart-stream.models';

/**
 * The strategy engine's wire contract, mirrored from
 * `src/strategy/api/simulation.types.ts` in the backend repo.
 *
 * Hand-mirrored rather than generated, exactly as `chart-stream.models.ts` is,
 * and the same rule applies: when the backend changes one of these shapes, this
 * file changes with it in the same breath. The doc comments here are the ones a
 * frontend needs — what a field means for rendering — not a copy of the
 * backend's reasoning.
 */

/** A strategy the backend can run. Authored in code; there is no create endpoint. */
export interface StrategyDescriptor {
  id: string;
  name: string;
  description: string;
  /** Bar size the strategy reasons on. The chart's own interval is independent. */
  timeframeMinutes: number;
  /** Bars it needs before its first real decision — why history matters. */
  warmupBars: number;
  params: Record<string, number>;
}

export type SimulationStatus = 'RUNNING' | 'COMPLETED' | 'STOPPED' | 'ERROR';

export type ExitReasonKind = 'SIGNAL' | 'STOP' | 'TARGET' | 'SQUARE_OFF' | 'SESSION_END';

/** One simulated position, open or closed. */
export interface SimTrade {
  id: number;
  strategyId: string;
  instrumentKey: string;
  tradingsymbol: string;
  side: 'BUY';
  status: 'OPEN' | 'CLOSED';
  quantity: number;
  lots: number;
  lotSize: number;
  /** Epoch MILLISECONDS UTC — the instant of the fill, i.e. a bar's close. */
  entryTime: number;
  entryPrice: number;
  entryReason: string;
  stopPrice: number | null;
  targetPrice: number | null;
  exitTime: number | null;
  exitPrice: number | null;
  exitReason: string | null;
  exitReasonKind: ExitReasonKind | null;
  /** Price movement only — before the sell charge. */
  grossPnl: number;
  costs: number;
  /** `grossPnl - costs`. Lead with this one. */
  netPnl: number;
  netPnlPct: number;
  /** Worst / best mark-to-market while held, in rupees. */
  mae: number;
  mfe: number;
  features: Record<string, number | null>;
}

/**
 * One strategy's book on one instrument — the row the panel renders.
 *
 * A run with two strategies over a call and a put has four of these. Each holds
 * its own `startingCapital`, so the P&L figures beside each other are directly
 * comparable rather than competing for one pot.
 */
export interface SimulationBook {
  /** `strategyId::sessionId` — unique within a run, and safe to key on. */
  bookId: string;
  strategyId: string;
  strategyName: string;
  /** The chart session this book's bars come from — how a book pairs to a panel. */
  sessionId: string;
  instrumentKey: string;
  tradingsymbol: string;
  label: string;
  leg: 'CE' | 'PE' | null;
  timeframeMinutes: number;
  startingCapital: number;
  cash: number;
  equity: number;
  realisedPnl: number;
  unrealisedPnl: number;
  totalPnl: number;
  totalPnlPct: number;
  costs: number;
  tradeCount: number;
  wins: number;
  losses: number;
  scratches: number;
  /** Percentage of settled trades; `null` until one settles. */
  winRate: number | null;
  openTrade: SimTrade | null;
  lastPrice: number | null;
  /** Why the last entry attempt was refused — render it, or a signal vanishes silently. */
  lastRejection: string | null;
  barsProcessed: number;
  /** Every trade, oldest first. Complete on every frame; never a delta. */
  trades: SimTrade[];
}

export interface SimulationChart {
  /** Open the candle WebSocket on this — it is an ordinary chart session. */
  sessionId: string;
  instrumentKey: string;
  tradingsymbol: string;
  label: string;
  leg: 'CE' | 'PE' | null;
  lotSize: number;
  status: ChartSessionStatus;
  barsConsumed: number;
}

export interface SimulationTotals {
  /** `capital × book count`. What `totalPnlPct` is measured against. */
  capitalDeployed: number;
  realisedPnl: number;
  unrealisedPnl: number;
  totalPnl: number;
  totalPnlPct: number;
  costs: number;
  trades: number;
  openTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

export interface SimulationRunSnapshot {
  runId: string;
  status: SimulationStatus;
  startedAt: string;
  sessionDate: string;
  /** Starting capital of **each** book, not of the run. */
  capital: number;
  noEntryAfterMs: number;
  squareOffMs: number;
  /** What the net figures cover — show it, so nobody reads net as final. */
  costModel: { label: string; includes: string[]; excludes: string[] };
  journalling: boolean;
  strategies: StrategyDescriptor[];
  charts: SimulationChart[];
  books: SimulationBook[];
  totals: SimulationTotals;
  error: string | null;
}

export interface StartSimulationRequest {
  capital: number;
  strategies: string[];
  /** One per chart. All must share a mode and a date. */
  charts: StartStreamRequest[];
  journal?: boolean;
}

/**
 * Every frame carries the run's **complete** state — never a delta.
 *
 * So the client's rule is one line: replace what you hold. A dropped frame
 * costs nothing, a reconnect needs no resynchronisation, and a run that
 * finished before the socket opened arrives whole.
 */
export type SimulationEvent =
  | { type: 'RUN_SNAPSHOT'; run: SimulationRunSnapshot }
  /**
   * Terminal, and always *after* the final snapshot. Close the socket on this
   * and on nothing else — a snapshot's `status` may already read `COMPLETED`
   * for an instant replay, and closing on that discards the state it carries.
   */
  | { type: 'RUN_ENDED'; run: SimulationRunSnapshot };

export const TERMINAL_SIMULATION_STATUSES: readonly SimulationStatus[] = [
  'COMPLETED',
  'STOPPED',
  'ERROR',
];
