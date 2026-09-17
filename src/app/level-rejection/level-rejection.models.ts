import type { InstrumentRequest } from '../chart-stream/chart-stream.models';

/**
 * Wire types for `/streamer/stream/level-rejection` — the chart's
 * previous-day level rejection overlay.
 *
 * Mirrors `src/streamer/analysis/level-rejection` and
 * `chart-level-rejection.service.ts` in the backend, whose README states the
 * rules. Nothing here decides anything.
 */

export type LevelType = 'PDH' | 'PDL' | 'PD50' | 'S1H_HIGH' | 'S1H_LOW';
export type Direction = 'LONG' | 'SHORT';
export type RejectionType = 'PIN' | 'RECLAIM' | 'SWEEP_PIN' | 'SWEEP_RECLAIM';
export type EntryTrigger = 'STRUCTURE_BREAK' | 'STRUCTURE_RETEST' | 'REJECTION_CLOSE';
export type StopMode = 'REJECTION_EXTREME' | 'STRUCTURE';
export type TargetMode = 'NEXT_LEVEL' | 'FIXED_RR';
export type ExitReason = 'TARGET' | 'STOP' | 'SQUARE_OFF' | 'MAX_HOLD' | 'END_OF_DATA';
export type SetupOutcome =
  | 'ENTERED'
  | 'INVALIDATED'
  | 'EXPIRED'
  | 'NO_RETEST'
  | 'POSITION_OPEN'
  | 'RISK_TOO_LARGE'
  | 'RR_TOO_LOW'
  | 'NO_TARGET'
  | 'INVALID_RISK'
  | 'AFTER_LAST_ENTRY'
  | 'END_OF_DAY';

export interface LevelRejectionOptions {
  sessionOpen: string;
  sessionClose: string;
  specialCandleStart: string;
  minSpecialCandleBars: number;
  touchTolerance: number;
  clusterTolerance: number;
  rearmDistance: number;
  maxSweepDepth: number;
  minCloseLocation: number;
  minWickRatio: number;
  minBodyRatio: number;
  approachLookbackBars: number;
  sweepLookbackBars: number;
  swingStrength: number;
  requireStructurePivot: boolean;
  maxConfirmationMinutes: number;
  entryTrigger: EntryTrigger;
  maxRetestMinutes: number;
  stopMode: StopMode;
  stopBuffer: number;
  targetMode: TargetMode;
  rewardRisk: number;
  fallbackToFixedRr: boolean;
  minRewardRisk: number;
  maxRisk: number;
  costPoints: number;
  firstSetupTime: string;
  lastEntryTime: string;
  squareOffTime: string;
  maxHoldMinutes: number;
  onePositionAtATime: boolean;
}

/** What a request may override — session times come from the backend's config. */
export type LevelRejectionOverrides = Partial<
  Omit<LevelRejectionOptions, 'sessionOpen' | 'sessionClose'>
>;

export interface ReferenceLevel {
  type: LevelType;
  price: number;
}

export interface LevelZone {
  id: string;
  low: number;
  high: number;
  members: ReferenceLevel[];
}

export interface CandleWindow {
  openTs: number;
  closeTs: number;
  high: number;
  low: number;
  bars: number;
}

export interface DayLevels {
  date: string;
  referenceDate: string;
  daily: { high: number; low: number; mid: number; range: number; source: 'DAILY' | 'INTRADAY' };
  fourHour: CandleWindow | null;
  specialHour: CandleWindow | null;
  specialHourMissing: string | null;
  levels: ReferenceLevel[];
  zones: LevelZone[];
  tolerance: number;
}

export interface StructureConfirmation {
  swingPrice: number;
  swingTs: number;
  pivotPrice: number | null;
  pivotTs: number | null;
  breakTs: number;
  breakClose: number;
  retestTs: number | null;
  description: string;
}

export interface Trade {
  setupId: string;
  date: string;
  direction: Direction;
  entryTs: number;
  entry: number;
  stop: number;
  target: number;
  targetSource: 'NEXT_LEVEL' | 'FIXED_RR';
  targetLevel: string | null;
  riskPoints: number;
  rewardPoints: number;
  plannedRewardRisk: number;
  exitTs: number;
  exit: number;
  exitReason: ExitReason;
  pnlPoints: number;
  rMultiple: number;
  result: 'WIN' | 'LOSS' | 'BREAKEVEN';
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
  zoneId: string;
  zoneLow: number;
  zoneHigh: number;
  levels: ReferenceLevel[];
  primaryLevel: LevelType;
  primaryLevelPrice: number;
  rejection: {
    type: RejectionType;
    barTs: number;
    o: number;
    h: number;
    l: number;
    c: number;
    extreme: number;
    extremeTs: number;
    swept: boolean;
  };
  structure: StructureConfirmation | null;
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
  daysWithLevels: number;
  daysWithoutSpecialHour: number;
  levelInteractions: number;
  rejections: number;
  structureConfirmations: number;
  entries: number;
  outcomes: Record<SetupOutcome, number>;
}

export interface PerformanceReport {
  summary: PerformanceSummary;
  edge: EdgeTest;
  byLevel: BreakdownRow[];
  byZone: BreakdownRow[];
  byDirection: BreakdownRow[];
  byTimeOfDay: BreakdownRow[];
  byRejectionType: BreakdownRow[];
  byExitReason: BreakdownRow[];
  equity: { ts: number; cumulativeR: number; cumulativePoints: number; drawdownR: number }[];
}

export interface LevelRejectionRequest {
  instrument: InstrumentRequest;
  from: string;
  to: string;
  options?: LevelRejectionOverrides;
  includeComparison?: boolean;
  minSample?: number;
  maxSetups?: number;
}

export interface LevelRejectionResponse {
  instrumentKey: string;
  tradingsymbol: string;
  from: string;
  to: string;
  options: LevelRejectionOptions;
  dataWarnings: string[];
  skippedDays: { date: string; reason: string }[];
  result: {
    funnel: SequenceFunnel;
    report: PerformanceReport;
    trades: WireTrade[];
    setups: Setup[];
    setupsTotal: number;
    days: DayLevels[];
  };
  comparison: {
    entryTrigger: 'REJECTION_CLOSE';
    funnel: SequenceFunnel;
    report: Omit<PerformanceReport, 'equity' | 'byZone' | 'byExitReason'>;
  } | null;
}
