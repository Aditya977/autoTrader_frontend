import type { InstrumentRequest } from '../chart-stream/chart-stream.models';

/**
 * Wire types for `/streamer/stream/vwap-ema` — the chart's 1-minute VWAP + 21
 * EMA trend-pullback overlay.
 *
 * Mirrors `src/streamer/analysis/vwap-ema` and `chart-vwap-ema.service.ts` in
 * the backend, whose README states the rules. Nothing here decides anything.
 */

export type Direction = 'LONG' | 'SHORT';
export type StopMode = 'SWING' | 'CONFIRMATION';
export type TrailMode = 'EMA' | 'SWING';
export type ExitReason =
  'STOP' | 'EMA_TRAIL' | 'SWING_TRAIL' | 'SQUARE_OFF' | 'MAX_HOLD' | 'END_OF_DATA';
export type TradeResult = 'WIN' | 'LOSS' | 'BREAKEVEN';
export type SetupOutcome =
  | 'ENTERED'
  | 'INVALIDATED'
  | 'EXPIRED'
  | 'POSITION_OPEN'
  | 'RISK_TOO_LARGE'
  | 'INVALID_RISK'
  | 'AFTER_LAST_ENTRY'
  | 'NOT_TRADABLE'
  | 'DAY_STOPPED'
  | 'END_OF_DAY';

export interface VwapEmaOptions {
  sessionOpen: string;
  sessionClose: string;
  emaPeriod: number;
  atrPeriod: number;
  slopeLookback: number;
  swingStrength: number;
  direction: 1 | 0 | -1;
  minEmaSlopeAtr: number;
  minEmaVwapGapAtr: number;
  maxVwapCrosses: number;
  chopLookback: number;
  pullbackAtr: number;
  minConfirmCloseLoc: number;
  minConfirmBody: number;
  holdVwap: boolean;
  maxBreakBars: number;
  stopMode: StopMode;
  stopBufferAtr: number;
  maxRiskAtr: number;
  partialR: number;
  partialFraction: number;
  trailMode: TrailMode;
  costPoints: number;
  tickSize: number;
  maxConsecutiveLosses: number;
  firstSetupTime: string;
  lastEntryTime: string;
  squareOffTime: string;
  maxHoldMinutes: number;
  onePositionAtATime: boolean;
}

export type VwapEmaOverrides = Partial<
  Omit<VwapEmaOptions, 'sessionOpen' | 'sessionClose' | 'tickSize'>
>;

export interface Trade {
  setupId: string;
  date: string;
  direction: Direction;
  entryTs: number;
  entry: number;
  stop: number;
  riskPoints: number;
  scaleOut: { price: number; ts: number; fraction: number } | null;
  exitTs: number;
  exit: number;
  exitReason: ExitReason;
  pnlPoints: number;
  rMultiple: number;
  result: TradeResult;
  mfePoints: number;
  maePoints: number;
  mfeR: number;
  maeR: number;
  holdMinutes: number;
}

export type WireTrade = Trade & { instrument: string };

export interface Setup {
  id: string;
  date: string;
  direction: Direction;
  bias: { ts: number; vwap: number; ema: number; atr: number };
  confirmation: { barTs: number; o: number; h: number; l: number; c: number };
  triggerPrice: number;
  outcome: SetupOutcome;
  outcomeTs: number;
  note: string;
  trade: Trade | null;
}

export interface PerformanceSummary {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  totalR: number;
  averageR: number | null;
  totalPoints: number;
  expectancyPoints: number | null;
  profitFactor: number | null;
  averageWinR: number | null;
  averageLossR: number | null;
  averageWinPoints: number | null;
  averageLossPoints: number | null;
  maxDrawdownR: number;
  maxDrawdownPoints: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  averageMfeR: number | null;
  averageMaeR: number | null;
  averageHoldMinutes: number | null;
  averageRiskPoints: number | null;
  scaledOut: number;
}

export interface EdgeTest {
  trades: number;
  meanR: number | null;
  stdevR: number | null;
  standardError: number | null;
  tStat: number | null;
  ci95Low: number | null;
  ci95High: number | null;
  minSample: number;
  verdict: 'INSUFFICIENT_SAMPLE' | 'POSITIVE_EDGE' | 'NEGATIVE_EDGE' | 'NOT_SIGNIFICANT';
  explanation: string;
}

export interface BreakdownRow {
  key: string;
  summary: PerformanceSummary;
}

export interface SequenceFunnel {
  tradingDays: number;
  confirmations: number;
  entries: number;
  outcomes: Record<SetupOutcome, number>;
}

export interface PerformanceReport {
  summary: PerformanceSummary;
  edge: EdgeTest;
  byDirection: BreakdownRow[];
  byTimeOfDay: BreakdownRow[];
  byExitReason: BreakdownRow[];
  equity: { ts: number; cumulativeR: number; cumulativePoints: number; drawdownR: number }[];
}

export interface VwapEmaRequest {
  instrument: InstrumentRequest;
  from: string;
  to: string;
  options?: VwapEmaOverrides;
  minSample?: number;
  maxSetups?: number;
}

export interface VwapEmaResponse {
  instrumentKey: string;
  tradingsymbol: string;
  from: string;
  to: string;
  options: VwapEmaOptions;
  dataWarnings: string[];
  result: {
    funnel: SequenceFunnel;
    report: PerformanceReport;
    trades: WireTrade[];
    setups: Setup[];
    setupsTotal: number;
  };
}
