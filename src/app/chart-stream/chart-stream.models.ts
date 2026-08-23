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

/** One tradable option contract, as `GET /streamer/instruments/chain` lists it. */
export interface OptionContract {
  instrumentKey: string;
  tradingsymbol: string;
  /**
   * Strike price — what the contract is struck at, not its live premium. The
   * instrument master carries no premium, and the backend does not invent one.
   */
  strike: number;
  lotSize: number;
  tickSize: number;
}

/**
 * An {@link OptionContract} with market data attached.
 *
 * Every field is nullable and `null` never means zero — an untraded strike has
 * no price, and showing 0 would put a real-looking number on a contract nobody
 * has paid for. Render an em dash instead.
 */
export interface PricedOptionContract extends OptionContract {
  /** Last traded premium: live when quoting now, the close on a past date. */
  ltp: number | null;
  /** Closing premium — the previous session's when live. */
  close: number | null;
  openInterest: number | null;
  volume: number | null;
  /** Implied volatility as the broker reports it. */
  iv: number | null;
}

/** Both legs of one underlying/expiry, each ascending by strike. */
export interface OptionChain {
  underlying: string;
  expiry: string;
  calls: PricedOptionContract[];
  puts: PricedOptionContract[];
  /**
   * `null` when the numbers are live, or the trading date they are the close
   * of — so a historical close is never shown as a current price.
   */
  pricedOn: string | null;
  /** The underlying's own price, read alongside the strikes. */
  underlyingPrice: number | null;
}

export interface StartStreamRequest {
  mode: ChartSessionMode;
  instrument: InstrumentRequest;
  interval: ChartInterval;
  /** TEST only. `YYYY-MM-DD`. */
  date?: string;
  /** TEST only. 0 = as fast as possible, 1 = real recorded pace. */
  replaySpeed?: number;
  /**
   * Prior *trading* days of already-closed bars to send before the stream
   * starts. Counted back from `date` (TEST) or today (LIVE), so asking for 1
   * on a Monday yields the previous Friday.
   */
  historyDays?: number;
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
