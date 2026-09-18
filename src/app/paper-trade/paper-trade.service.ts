/**
 * The engine, as Angular state.
 *
 * Deliberately thin, and deliberately the *only* file that knows both halves:
 * {@link PaperTradeEngine} knows nothing about Angular, the components know
 * nothing about the engine's internals, and this sits between them turning one
 * callback into signals. Keeping the adapter this small is what keeps the
 * engine reusable — a backtest harness or a Node script instantiates the engine
 * directly and never loads this file.
 *
 * It also owns the one translation from the streaming API's candle shape to the
 * engine's neutral update, for the same reason: the engine must not import
 * `chart-stream.models`, and exactly one place should have to change when that
 * wire format does.
 */

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { ChartCandleEvent } from '../chart-stream/chart-stream.models';
import { PaperTradeEngine } from './paper-trade-engine';
import type {
  PaperMarketUpdate,
  PaperOrderRequest,
  PaperPosition,
  PaperTradeEvent,
  PaperTradeSnapshot,
} from './paper-trade.models';

@Injectable({ providedIn: 'root' })
export class PaperTradeService {
  private readonly engine = new PaperTradeEngine();

  private readonly state = signal<PaperTradeSnapshot>({
    positions: [],
    events: [],
    totals: {
      deployed: 0,
      realisedPnl: 0,
      unrealisedPnl: 0,
      totalPnl: 0,
      totalPnlPct: 0,
      costs: 0,
      trades: 0,
      openTrades: 0,
      wins: 0,
      losses: 0,
      winRate: null,
    },
  });

  readonly positions = computed(() => this.state().positions);
  readonly totals = computed(() => this.state().totals);

  /** Positions still working — `CREATED` or `ACTIVE`. What the panel leads with. */
  readonly live = computed(() => this.positions().filter((p) => p.status !== 'EXITED'));

  /** Newest first: the activity feed is read from the top. */
  readonly events = computed(() => [...this.state().events].sort((a, b) => b.seq - a.seq));

  /**
   * Positions by instrument, for the chart panel that draws that instrument.
   *
   * Computed into a map so each panel gets a stable array identity between
   * frames — the chart redraws its marks when the input reference changes, and
   * a fresh array per change-detection pass would rebuild every mark on every
   * mouse move. Same reasoning as `tradesBySession` on the chart page.
   */
  private readonly byInstrument = computed(() => {
    const map = new Map<string, PaperPosition[]>();
    for (const position of this.positions()) {
      const key = position.contract.instrumentKey;
      const existing = map.get(key);
      if (existing) existing.push(position);
      else map.set(key, [position]);
    }
    return map;
  });

  /**
   * Every bar the page has seen, per instrument, in arrival order.
   *
   * Held even when nothing is trading, because the trade that needs them has
   * not been placed yet. At the default "Instant — whole day at once" replay
   * speed the entire session arrives within a second of pressing Start, long
   * before anyone has chosen a contract and typed an amount — so without this
   * buffer a trade placed afterwards would wait for a bar that is never coming.
   * That was exactly the stuck-on-"waiting" bug.
   *
   * A day of one-minute bars is ~375 entries per instrument. Two legs is 750.
   * Not worth capping.
   */
  private readonly bars = new Map<string, PaperMarketUpdate[]>();

  /** Instruments whose feed has finished — no further bar will ever arrive. */
  private readonly finished = new Set<string>();

  /**
   * The paced re-run currently on screen, if any.
   *
   * A trade placed on a session that has already streamed is simulated by
   * feeding the buffered bars back through the engine — but *slowly*, over
   * {@link PLAYBACK_MS}, rather than in one synchronous burst. The burst would
   * be correct and completely useless: the entry, the stop and the exit would
   * all appear in the same frame, and the whole point of watching a paper trade
   * is seeing it develop.
   */
  private playback: ReturnType<typeof setInterval> | null = null;

  /** Whether a paced re-run is under way, and how far through it is (0–1). */
  readonly simulating = signal(false);
  readonly progress = signal(0);

  constructor() {
    this.engine.subscribe((snapshot) => this.state.set(snapshot));
    // A page teardown must not leave a timer feeding a detached engine.
    inject(DestroyRef).onDestroy(() => this.stopPlayback());
  }

  /** The positions on one instrument, or a shared empty list. */
  positionsFor(instrumentKey: string | null): readonly PaperPosition[] {
    if (!instrumentKey) return NONE;
    return this.byInstrument().get(instrumentKey) ?? NONE;
  }

  /**
   * Last traded price per instrument, as a signal.
   *
   * The engine holds this too, but as a plain map — it has no signals, by
   * design. Mirroring it here is what makes the setup form re-price itself as
   * the feed moves: a `computed` reading the engine's map directly would be
   * calculated once and never again, and the sizing would quietly go on
   * describing the price at the moment the page loaded.
   */
  private readonly prices = signal<ReadonlyMap<string, number>>(new Map());

  /** The newest price seen for an instrument, or `null` before its first bar. */
  priceOf(instrumentKey: string | null): number | null {
    if (!instrumentKey) return null;
    return this.prices().get(instrumentKey) ?? null;
  }

  /**
   * Places a paper trade, and makes sure something will actually happen to it.
   *
   * Three cases, and the middle one is the whole reason this is more than a
   * delegation:
   *
   * 1. The feed is **still running** — the order waits for the next bar, which
   *    is ordinary forward paper trading.
   * 2. The feed has **finished but was recorded** — the buffered session is
   *    re-run through the engine over {@link PLAYBACK_MS}, so the trade plays
   *    out in about three minutes instead of waiting forever.
   * 3. The feed has finished and there is **nothing buffered** — refused, with
   *    a reason. Accepting it would create a position that can never move,
   *    which is the silent failure this method exists to prevent.
   */
  place(request: PaperOrderRequest): { position: PaperPosition } | { error: string } {
    const key = request.contract.instrumentKey;
    const recorded = this.bars.get(key) ?? [];
    const over = this.finished.has(key);

    if (over && recorded.length === 0) {
      return {
        error:
          'This chart has no bars to simulate against. Press Start to stream the session, ' +
          'then place the trade.',
      };
    }

    const result = this.engine.place(request);
    if ('error' in result) return result;

    // Only a finished feed is re-run. A live one is already delivering bars,
    // and replaying its history underneath would simulate the morning again
    // while the afternoon arrives.
    if (over) this.startPlayback(key, recorded);

    return result;
  }

  /**
   * Feeds a recorded session back through the engine, paced to finish in about
   * three minutes.
   *
   * Safe to re-feed bars the engine has already seen: its history is idempotent
   * by bar time, so a re-run replaces bars rather than duplicating them.
   * Positions that already settled are `EXITED` and skipped, so a re-run cannot
   * reopen or re-decide a finished trade — only the order just placed is still
   * live enough to act on them.
   */
  private startPlayback(instrumentKey: string, recorded: readonly PaperMarketUpdate[]): void {
    this.stopPlayback();
    if (recorded.length === 0) return;

    // Evenly spread, with a floor so a long session does not outrun the
    // browser's timer resolution — below ~16ms a setInterval simply misses
    // ticks and the run silently takes longer than it promised.
    const step = Math.max(16, Math.round(PLAYBACK_MS / recorded.length));
    // How many bars each tick must carry to still finish on time once the floor
    // above has capped the step.
    const perTick = Math.max(1, Math.ceil(recorded.length / Math.max(1, PLAYBACK_MS / step)));
    let index = 0;

    this.simulating.set(true);
    this.progress.set(0);

    this.playback = setInterval(() => {
      for (let n = 0; n < perTick && index < recorded.length; n++) {
        this.engine.onUpdate(recorded[index++]!);
      }
      this.progress.set(index / recorded.length);

      if (index >= recorded.length) {
        this.stopPlayback();
        // The recording ended, so the day ended: square off anything the
        // strategy left open rather than leaving a position that looks live on
        // a chart with no more bars to move it.
        this.engine.endSession(instrumentKey);
      }
    }, step);
  }

  private stopPlayback(): void {
    if (this.playback !== null) clearInterval(this.playback);
    this.playback = null;
    this.simulating.set(false);
  }

  /**
   * Keeps one copy of each bar, so a session can be re-run later.
   *
   * Written only by the live feed, never by the playback itself — the guard is
   * {@link playback} being null. Recording the re-run would append the whole
   * day to the buffer a second time, and the next trade placed would re-run a
   * session twice as long as the one that happened.
   *
   * Replaced in place when a bar of the same instant arrives again, which is
   * what a reconnecting socket's backlog does.
   */
  private record(update: PaperMarketUpdate): void {
    if (this.playback !== null) return;

    const recorded = this.bars.get(update.instrumentKey) ?? [];
    const last = recorded.at(-1);
    if (last && last.timeMs === update.timeMs) recorded[recorded.length - 1] = update;
    else recorded.push(update);
    this.bars.set(update.instrumentKey, recorded);
  }

  close(id: string): void {
    this.engine.closeManually(id);
  }

  cancel(id: string): void {
    this.engine.cancel(id);
  }

  /**
   * Records that a feed has finished, and squares off what it was carrying.
   *
   * The flag matters more than the square-off: it is what lets {@link place}
   * tell "waiting for the next bar" from "there is no next bar", which are
   * indistinguishable from the engine's side and produced a position that sat
   * on `waiting` forever.
   */
  endSession(instrumentKey?: string): void {
    if (instrumentKey) this.finished.add(instrumentKey);
    // Never while a re-run is in flight: a `SESSION_COMPLETED` arriving as the
    // replay finishes would otherwise square off the very position the re-run
    // was started to simulate.
    if (this.playback !== null) return;
    this.engine.endSession(instrumentKey);
  }

  /** Clears the book. Called when the page starts a different session. */
  reset(): void {
    this.stopPlayback();
    this.engine.reset();
    this.prices.set(new Map());
    this.bars.clear();
    this.finished.clear();
    this.progress.set(0);
  }

  /**
   * A candle from the chart's socket, fed to the engine.
   *
   * Every streamed candle is treated as **closed**. That is true of this feed:
   * the backend publishes a bar when it completes, both live and in replay — it
   * does not push a forming bar tick by tick. Were that to change, this one
   * line is where it would be read from the event rather than assumed, and
   * nothing downstream would need touching.
   */
  onCandle(event: ChartCandleEvent): void {
    this.onUpdate(toUpdate(event));
  }

  /** The raw door, for a caller holding updates rather than candles. */
  onUpdate(update: PaperMarketUpdate): void {
    this.record(update);
    this.engine.onUpdate(update);
    // A new map rather than a mutation: a signal holding the same reference
    // notifies nothing, and the form would stop re-pricing after the first bar.
    const next = new Map(this.prices());
    next.set(update.instrumentKey, update.price);
    this.prices.set(next);
  }
}

const NONE: readonly PaperPosition[] = [];

/**
 * How long a re-run of a recorded session takes, in milliseconds.
 *
 * Three minutes: long enough to watch an entry, a drawdown and an exit happen
 * as separate events, short enough that nobody walks away from it.
 */
const PLAYBACK_MS = 180_000;

/** The one place the streaming wire format meets the engine's own. */
export function toUpdate(event: ChartCandleEvent): PaperMarketUpdate {
  return {
    instrumentKey: event.instrumentKey,
    timeMs: event.timestamp,
    price: event.close,
    open: event.open,
    high: event.high,
    low: event.low,
    volume: event.volume,
    closed: true,
  };
}

export type { PaperTradeEvent };
