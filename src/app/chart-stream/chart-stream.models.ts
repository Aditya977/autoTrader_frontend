export type ChartSessionMode = 'LIVE' | 'TEST';

export type ChartSessionStatus = 'STARTING' | 'RUNNING' | 'COMPLETED' | 'STOPPED' | 'ERROR';

export type ChartInterval =
  | '1minute'
  | '3minute'
  | '5minute'
  | '15minute'
  | '30minute'
  | '1hour'
  | '1day';

export type InstrumentType = 'INDEX' | 'EQUITY' | 'FUTURE' | 'CE' | 'PE';

export interface InstrumentRequest {
  type: InstrumentType;
  underlying: string;
  /** Required for CE / PE. */
  strike?: number;
  /** Required for FUTURE / CE / PE. `YYYY-MM-DD`. */
  expiry?: string;
}

export interface ResolvedInstrument {
  instrumentKey: string;
  tradingsymbol: string;
  instrumentType: string;
  underlyingSymbol: string;
  strike: number | null;
  expiryDate: string | null;
  lotSize: number;
  tickSize: number;
}

export interface StartStreamRequest {
  mode: ChartSessionMode;
  instrument: InstrumentRequest;
  interval: ChartInterval;
  /** TEST only. `YYYY-MM-DD`. */
  date?: string;
  /** TEST only. 0 = as fast as possible, 1 = real recorded pace. */
  replaySpeed?: number;
}

export interface ChartSessionSnapshot {
  sessionId: string;
  mode: ChartSessionMode;
  status: ChartSessionStatus;
  instrumentKey: string;
  interval: ChartInterval;
  date: string | null;
  startedAt: string;
  error: string | null;
}

export interface ChartCandleEvent {
  type: 'CANDLE';
  sessionId: string;
  /** Bar OPEN time, epoch MILLISECONDS UTC. This is the x-axis value. */
  timestamp: number;
  /** Wall-clock instant the event was published. Rarely needed. */
  emittedAt: number;
  instrumentKey: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number | null;
  isSyntheticGap: boolean;
}

/** Sent once, immediately on connect. Carries the snapshot, not a timestamp. */
export interface ChartSessionStatusEvent extends ChartSessionSnapshot {
  type: 'SESSION_STATUS';
}

export interface ChartLifecycleEvent {
  type: 'SESSION_STARTED' | 'SESSION_COMPLETED' | 'SESSION_STOPPED';
  sessionId: string;
  timestamp: number;
}

export interface ChartErrorEvent {
  type: 'SESSION_ERROR';
  sessionId: string;
  timestamp: number;
  message: string;
}

export type ChartStreamEvent =
  | ChartCandleEvent
  | ChartSessionStatusEvent
  | ChartLifecycleEvent
  | ChartErrorEvent;

/** Shape of every non-2xx response body. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Present only for VALIDATION_ERROR (HTTP 400). */
    issues?: { path: string; message: string }[];
  };
}

export const TERMINAL_STATUSES: readonly ChartSessionStatus[] = ['COMPLETED', 'STOPPED', 'ERROR'];
