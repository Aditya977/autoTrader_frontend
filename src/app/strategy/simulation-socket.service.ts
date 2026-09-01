import { Injectable, NgZone, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { SimulationEvent } from './strategy.models';

@Injectable({ providedIn: 'root' })
export class SimulationSocketService {
  private readonly zone = inject(NgZone);

  /**
   * A run's state as it develops, with automatic reconnect.
   *
   * The same transport and the same rules as `ChartStreamSocketService`, and
   * one rule in particular is repeated here because getting it wrong is silent:
   * **the stream ends on `RUN_ENDED` and on nothing else.** A `RUN_SNAPSHOT`
   * whose `status` reads `COMPLETED` is not end-of-stream — for an instant
   * replay the run finishes before the browser has opened this socket, so the
   * *first* frame reads `COMPLETED`, and a client that closed on it would throw
   * away the very snapshot it was waiting for and show an empty panel. The
   * backend sends `RUN_ENDED` after the final snapshot precisely so that
   * waiting for it is both correct and sufficient.
   *
   * Every frame carries the complete run, so a reconnect needs no
   * resynchronisation: replace what you hold and carry on.
   *
   * Closing the socket does not stop the run — `api.stop(runId)` does that.
   */
  connect(runId: string): Observable<SimulationEvent> {
    return new Observable<SimulationEvent>((subscriber) => {
      let socket: WebSocket | null = null;
      let closedByUs = false;
      let attempt = 0;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;

      const url =
        `${environment.apiBase.replace(/^http/, 'ws')}` + `/strategy/simulation/${runId}/ws`;

      const open = () => {
        socket = new WebSocket(url);

        socket.onopen = () => {
          attempt = 0;
        };

        socket.onmessage = (message) => {
          let event: SimulationEvent;
          try {
            event = JSON.parse(message.data as string) as SimulationEvent;
          } catch {
            return; // never let a malformed frame kill the stream
          }

          // WebSocket callbacks land outside Angular's zone.
          this.zone.run(() => subscriber.next(event));

          if (event.type === 'RUN_ENDED') {
            closedByUs = true;
            socket?.close(1000, 'run finished');
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
          // `onclose` always follows; retrying there keeps the two paths from
          // both firing a reconnect.
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
