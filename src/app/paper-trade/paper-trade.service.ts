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
import { istDateKey } from '../chart-stream/chart-time';
import type { ChartCandleEvent } from '../chart-stream/chart-stream.models';
import { PaperTradeEngine } from './paper-trade-engine';
import { paperStrategyById } from './strategies/registry';
import type { ChartRetest } from '../chart-stream/chart-stream.models';
import type {
  PaperMarketUpdate,
  PaperOrderRequest,
  PaperPosition,
  PaperRetestSignal,
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

  /** Backend signals per instrument, per strategy that produced them. */
  private readonly signalsBySource = new Map<string, Map<string, PaperRetestSignal[]>>();

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

  /**
   * How far through the session the re-run has reached, as epoch ms — or
   * `null` when nothing is replaying.
   *
   * The charts bind to this and draw only up to it, which is what rewinds them
   * to the open and lets the day arrive one bar at a time. One cursor for every
   * panel on purpose: a call and a put are the same session, and animating them
   * on separate clocks would show two different moments side by side.
   *
   * Back to `null` when the run ends or is stopped, which restores each chart
   * to the complete session it was showing before — nothing was discarded to
   * produce the replay, so nothing has to be refetched to undo it.
   */
  readonly playbackAt = signal<number | null>(null);

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
  /**
   * Hands the engine the retests the overlay found, as engine-shaped signals.
   *
   * The mapping lives here rather than in the engine because this is the layer
   * that is allowed to know both shapes — the same reason `toUpdate` does.
   */
  setRetests(instrumentKey: string, retests: readonly ChartRetest[]): void {
    this.engine.setRetests(instrumentKey, retests.map(toSignal).filter(isSignal));
  }

  /**
   * Hands the engine ready-made signals — the entries the backend's live
   * engine would take — rather than retests to interpret.
   *
   * This is what the Green Retest rule reads now. Retests fetched for a whole
   * day carry the future: a retest's mark sits on its approach candle, but it
   * is only known to be a retest once price has resumed, bars later. The
   * backend's entries are computed bar by bar from closed bars only, by the
   * same code the Trading Dashboard runs, so the chart cannot see ahead and
   * cannot disagree with the dashboard.
   */
  setSignals(
    instrumentKey: string,
    source: string,
    signals: readonly PaperRetestSignal[],
  ): void {
    // Several backend strategies can trade one instrument; each fetch replaces
    // only its own source's signals, and the engine holds them all.
    const bySource = this.signalsBySource.get(instrumentKey) ?? new Map();
    bySource.set(
      source,
      signals.map((signal) => ({ ...signal, source })),
    );
    this.signalsBySource.set(instrumentKey, bySource);
    this.engine.setRetests(instrumentKey, [...bySource.values()].flat());
  }

  /** Whether a backend source's signals have been fetched for an instrument. */
  hasSignalsFrom(instrumentKey: string, source: string): boolean {
    return this.signalsBySource.get(instrumentKey)?.has(source) ?? false;
  }

  /** Backend strategies an order or position on this instrument is following. */
  signalSourcesFor(instrumentKey: string): string[] {
    const sources = new Set<string>();
    for (const p of this.live()) {
      if (p.contract.instrumentKey !== instrumentKey) continue;
      const id = paperStrategyById(p.strategyId)?.backendStrategyId;
      if (id) sources.add(id);
    }
    return [...sources];
  }

  /** Whether an order or position on this instrument is waiting on retest signals. */
  needsSignals(instrumentKey: string): boolean {
    return this.live().some(
      (p) =>
        p.contract.instrumentKey === instrumentKey &&
        paperStrategyById(p.strategyId)?.needsRetests === true,
    );
  }

  /** Whether retests have been supplied for an instrument yet. */
  hasRetests(instrumentKey: string): boolean {
    return this.engine.hasRetests(instrumentKey);
  }

  /** How many bars the engine currently believes it has seen. */
  barsSeen(instrumentKey: string): number {
    return this.engine.barsOf(instrumentKey).length;
  }

  /** The newest bar the engine holds, for asserting a replay has not run ahead. */
  newestBarTime(instrumentKey: string): number | null {
    return this.engine.barsOf(instrumentKey).at(-1)?.timeMs ?? null;
  }

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
    if (over) this.startPlayback();

    return result;
  }

  /**
   * Ends a re-run early, at the user's word.
   *
   * Two things have to happen together. The charts go back to the full session
   * — that is just clearing the cursor, because the replay never removed a bar
   * from anything. And any position still open is closed, because stopping the
   * clock means no further bar will ever move it, and a position left `ACTIVE`
   * against a chart that has stopped advancing is the same silent lie as the
   * original stuck-on-"waiting" bug.
   */
  stopSimulation(): void {
    if (this.playback === null) return;
    this.stopPlayback();
    for (const position of this.positions()) {
      if (position.status !== 'EXITED') this.engine.closeManually(position.id);
    }
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
  private startPlayback(): void {
    this.stopPlayback();

    const { warmup, session } = this.split();
    if (session.length === 0) return;

    // The engine has already seen this whole session once, live. Replaying it
    // on top of that history would let a strategy reading `ctx.bars` see the
    // end of the day on the first bar of the re-run — a look-ahead that makes
    // every decision meaningless. Rewinding makes the re-run rebuild history
    // exactly as the live pass did.
    this.engine.rewindHistory();

    // History goes in at once, silently. A strategy with a 21-bar warm-up has
    // to be warm *at the open* — replaying the previous two days at the same
    // pace as the day being watched would spend most of the three minutes on
    // bars nobody asked to see, and would still leave the strategy cold when
    // the session it cares about started.
    for (const update of warmup) this.engine.onUpdate(update);

    // Evenly spread, with a floor so a long session does not outrun the
    // browser's timer resolution — below ~16ms a setInterval simply misses
    // ticks and the run silently takes longer than it promised.
    const step = Math.max(16, Math.round(PLAYBACK_MS / session.length));
    // How many bars each tick must carry to still finish on time once the floor
    // above has capped the step.
    const perTick = Math.max(1, Math.ceil(session.length / Math.max(1, PLAYBACK_MS / step)));
    let index = 0;

    this.simulating.set(true);
    this.progress.set(0);
    // Just before the first session bar: the charts show the history they had
    // and none of the day, which is the rewound state the replay starts from.
    this.playbackAt.set(session[0]!.timeMs - 1);

    this.playback = setInterval(() => {
      for (let n = 0; n < perTick && index < session.length; n++) {
        this.engine.onUpdate(session[index++]!);
      }
      this.progress.set(index / session.length);
      // The bar just consumed. The charts draw up to and including it.
      this.playbackAt.set(session[Math.min(index, session.length) - 1]!.timeMs);

      if (index >= session.length) {
        this.stopPlayback();
        // The recording ended, so the day ended: square off anything the
        // strategy left open rather than leaving a position that looks live on
        // a chart with no more bars to move it.
        for (const key of this.bars.keys()) this.engine.endSession(key);
      }
    }, step);
  }

  /**
   * Every recorded bar in time order, split at the start of the session day.
   *
   * "The session day" is the IST day of the newest bar recorded — by
   * construction the day being replayed, however many prior days of context
   * were streamed behind it. Splitting on the calendar rather than on a bar
   * count is what makes "the chart replays from 09:15" true regardless of how
   * much history the user asked for.
   *
   * Instruments are merged into one stream so a call and a put replay against
   * one clock, and a position on each is simulated by the same pass.
   */
  private split(): { warmup: PaperMarketUpdate[]; session: PaperMarketUpdate[] } {
    const all = [...this.bars.values()].flat().sort((a, b) => a.timeMs - b.timeMs);
    const newest = all.at(-1);
    if (!newest) return { warmup: [], session: [] };

    const day = istDateKey(Math.floor(newest.timeMs / 1000));
    const warmup: PaperMarketUpdate[] = [];
    const session: PaperMarketUpdate[] = [];
    for (const update of all) {
      if (istDateKey(Math.floor(update.timeMs / 1000)) === day) session.push(update);
      else warmup.push(update);
    }
    return { warmup, session };
  }

  private stopPlayback(): void {
    if (this.playback !== null) clearInterval(this.playback);
    this.playback = null;
    this.simulating.set(false);
    // The charts go back to the whole session. Clearing the cursor is the
    // entire undo — the buffer behind each chart was never touched.
    this.playbackAt.set(null);
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
    this.playbackAt.set(null);
    this.engine.reset();
    this.prices.set(new Map());
    this.bars.clear();
    this.finished.clear();
    this.signalsBySource.clear();
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

/**
 * A chart retest → the signal a strategy sees.
 *
 * `resumptionAt ?? approachAt` and `direction === 'BULLISH'` are taken
 * verbatim from how `retestMarkers` picks the marked bar and its colour, so a
 * strategy acting on "a green retest on this candle" is acting on precisely
 * the mark the user can see. Nothing is re-derived and nothing is filtered —
 * the overlay's logic is the signal, untouched.
 *
 * `null` for a retest with neither timestamp: it has no bar to claim, which is
 * the same reason the overlay leaves it out of the marks and in the table.
 */
function toSignal(retest: ChartRetest): PaperRetestSignal | null {
  const atMs = retest.resumptionAt ?? retest.approachAt;
  if (atMs === null) return null;
  return {
    atMs,
    bullish: retest.direction === 'BULLISH',
    quality: retest.quality,
    valid: retest.valid,
    scenario: retest.scenario,
  };
}

function isSignal(signal: PaperRetestSignal | null): signal is PaperRetestSignal {
  return signal !== null;
}

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
