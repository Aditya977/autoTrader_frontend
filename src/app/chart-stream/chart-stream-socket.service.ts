import { Injectable, NgZone, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { TERMINAL_STATUSES, type ChartStreamEvent } from './chart-stream.models';

@Injectable({ providedIn: 'root' })
export class ChartStreamSocketService {
  private readonly zone = inject(NgZone);

  /**
   * Events for one session, with automatic reconnect.
   *
   * Completes on a terminal event (COMPLETED / STOPPED / ERROR) and on
   * unsubscribe. Reconnects on an unexpected drop — the backend re-sends the
   * full candle backlog each time, so no bar is lost, but the consumer must
   * key bars by time rather than appending them (see CandleSeriesBuffer).
   *
   * Closing the socket does NOT stop the session; call `api.stop(sessionId)`
   * when you actually mean it.
   */
  connect(sessionId: string): Observable<ChartStreamEvent> {
    return new Observable<ChartStreamEvent>((subscriber) => {
      let socket: WebSocket | null = null;
      let closedByUs = false;
      let attempt = 0;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;

      const url =
        `${environment.apiBase.replace(/^http/, 'ws')}` + `/streamer/stream/${sessionId}/ws`;

      const open = () => {
        socket = new WebSocket(url);

        socket.onopen = () => {
          attempt = 0;
        };

        socket.onmessage = (message) => {
          let event: ChartStreamEvent;
          try {
            event = JSON.parse(message.data as string) as ChartStreamEvent;
          } catch {
            return; // never let a malformed frame kill the stream
          }

          // Angular change detection: WebSocket callbacks are outside the zone.
          this.zone.run(() => subscriber.next(event));

          const done =
            event.type === 'SESSION_COMPLETED' ||
            event.type === 'SESSION_STOPPED' ||
            event.type === 'SESSION_ERROR' ||
            (event.type === 'SESSION_STATUS' && TERMINAL_STATUSES.includes(event.status));

          if (done) {
            closedByUs = true;
            socket?.close(1000, 'session finished');
            this.zone.run(() => subscriber.complete());
          }
        };

        socket.onclose = () => {
          if (closedByUs) return;
          // Capped exponential backoff: 1s, 2s, 4s, 8s, 10s, 10s…
          const delay = Math.min(1000 * 2 ** attempt++, 10_000);
          retryTimer = setTimeout(open, delay);
        };

        socket.onerror = () => {
          // `onclose` always follows; reconnect is handled there so the two
          // paths cannot both fire a retry.
          socket?.close();
        };
      };

      open();

      return () => {
        closedByUs = true;
        clearTimeout(retryTimer);
        socket?.close(1000, 'unsubscribed');
      };
    });
  }
}
