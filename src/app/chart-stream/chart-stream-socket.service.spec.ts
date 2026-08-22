import { TestBed } from '@angular/core/testing';
import { ChartStreamSocketService } from './chart-stream-socket.service';
import { environment } from '../../environments/environment';
import type { ChartStreamEvent } from './chart-stream.models';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readonly closes: { code?: number; reason?: string }[] = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }

  /** Test helper: deliver a frame exactly as the browser would. */
  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  emitRaw(data: string): void {
    this.onmessage?.({ data });
  }

  /** Test helper: an unexpected drop, not initiated by the consumer. */
  drop(): void {
    this.onclose?.();
  }
}

const candle = (timestamp: number): ChartStreamEvent => ({
  type: 'CANDLE',
  sessionId: 's1',
  timestamp,
  emittedAt: timestamp,
  instrumentKey: 'NSE_INDEX|Nifty 50',
  timeframe: '1minute',
  open: 1,
  high: 2,
  low: 0,
  close: 1,
  volume: 0,
  openInterest: null,
  isSyntheticGap: false,
});

describe('ChartStreamSocketService', () => {
  let service: ChartStreamSocketService;
  let originalWebSocket: unknown;

  beforeEach(() => {
    originalWebSocket = (globalThis as Record<string, unknown>)['WebSocket'];
    MockWebSocket.instances = [];
    (globalThis as Record<string, unknown>)['WebSocket'] = MockWebSocket;

    TestBed.configureTestingModule({});
    service = TestBed.inject(ChartStreamSocketService);
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>)['WebSocket'] = originalWebSocket;
  });

  it('derives a ws:// url from the http apiBase', () => {
    const sub = service.connect('abc').subscribe();
    expect(MockWebSocket.instances[0].url).toBe(
      `${environment.apiBase.replace(/^http/, 'ws')}/streamer/stream/abc/ws`,
    );
    sub.unsubscribe();
  });

  it('emits parsed events to the subscriber', () => {
    const seen: ChartStreamEvent[] = [];
    const sub = service.connect('abc').subscribe((e) => seen.push(e));

    MockWebSocket.instances[0].emit(candle(1_755_000_000_000));

    expect(seen.length).toBe(1);
    expect(seen[0].type).toBe('CANDLE');
    sub.unsubscribe();
  });

  it('ignores a malformed frame instead of killing the stream', () => {
    const seen: ChartStreamEvent[] = [];
    let errored = false;
    const sub = service.connect('abc').subscribe({
      next: (e) => seen.push(e),
      error: () => (errored = true),
    });

    MockWebSocket.instances[0].emitRaw('not json {');
    MockWebSocket.instances[0].emit(candle(1_755_000_000_000));

    expect(errored).toBeFalse();
    expect(seen.length).toBe(1);
    sub.unsubscribe();
  });

  it('completes and closes cleanly on a terminal lifecycle event', () => {
    let completed = false;
    service.connect('abc').subscribe({ complete: () => (completed = true) });

    const socket = MockWebSocket.instances[0];
    socket.emit({ type: 'SESSION_COMPLETED', sessionId: 'abc', timestamp: 1 });

    expect(completed).toBeTrue();
    expect(socket.closes[0].code).toBe(1000);
  });

  it('completes when SESSION_STATUS reports an already-terminal session', () => {
    let completed = false;
    service.connect('abc').subscribe({ complete: () => (completed = true) });

    MockWebSocket.instances[0].emit({
      type: 'SESSION_STATUS',
      sessionId: 'abc',
      mode: 'TEST',
      status: 'STOPPED',
      instrumentKey: 'k',
      interval: '1minute',
      date: null,
      startedAt: '2026-08-14T03:45:00.000Z',
      error: null,
    });

    expect(completed).toBeTrue();
  });

  it('does not complete on a non-terminal SESSION_STATUS', () => {
    let completed = false;
    const sub = service.connect('abc').subscribe({ complete: () => (completed = true) });

    MockWebSocket.instances[0].emit({
      type: 'SESSION_STATUS',
      sessionId: 'abc',
      mode: 'TEST',
      status: 'RUNNING',
      instrumentKey: 'k',
      interval: '1minute',
      date: null,
      startedAt: '2026-08-14T03:45:00.000Z',
      error: null,
    });

    expect(completed).toBeFalse();
    expect(MockWebSocket.instances.length).toBe(1);
    sub.unsubscribe();
  });

  describe('reconnect', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('reconnects with capped exponential backoff after an unexpected drop', () => {
      const sub = service.connect('abc').subscribe();

      MockWebSocket.instances[0].drop();
      jasmine.clock().tick(999);
      expect(MockWebSocket.instances.length).toBe(1);
      jasmine.clock().tick(1);
      expect(MockWebSocket.instances.length).toBe(2);

      MockWebSocket.instances[1].drop();
      jasmine.clock().tick(2000);
      expect(MockWebSocket.instances.length).toBe(3);

      sub.unsubscribe();
    });

    it('resets the backoff once a connection opens', () => {
      const sub = service.connect('abc').subscribe();

      MockWebSocket.instances[0].drop();
      jasmine.clock().tick(1000);
      MockWebSocket.instances[1].onopen?.();
      MockWebSocket.instances[1].drop();

      jasmine.clock().tick(1000);
      expect(MockWebSocket.instances.length).toBe(3);
      sub.unsubscribe();
    });

    it('stops reconnecting after unsubscribe', () => {
      const sub = service.connect('abc').subscribe();
      sub.unsubscribe();

      MockWebSocket.instances[0].drop();
      jasmine.clock().tick(60_000);

      expect(MockWebSocket.instances.length).toBe(1);
    });

    it('does not reconnect after a terminal event', () => {
      service.connect('abc').subscribe();
      MockWebSocket.instances[0].emit({ type: 'SESSION_STOPPED', sessionId: 'abc', timestamp: 1 });

      MockWebSocket.instances[0].drop();
      jasmine.clock().tick(60_000);

      expect(MockWebSocket.instances.length).toBe(1);
    });
  });
});
