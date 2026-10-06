import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import type { PaperBook, PaperTradeRecord } from '../trading/trading.models';
import { bucketStartMs } from './chart-time';

/**
 * Paper trades → what the chart draws for them: an arrow at each entry and
 * exit, and, while a position is open, its entry and stop-loss lines.
 *
 * The trades are the backend's — the strategies deployed to paper trading,
 * on the live feed. The chart only shows them on the contract they traded.
 *
 * ## Why the times are snapped, and why to `time - 1`
 *
 * A fill is stamped with the **close** of the bar that produced it, which is
 * the next bar's open, and Lightweight Charts drops a marker whose time is not
 * a drawn bar. So each time is pulled back a millisecond onto the bar that
 * decided it, then snapped to the interval on screen.
 */
export interface ChartPaperTrade {
  tradeId: string;
  strategyName: string;
  side: 'BUY' | 'SELL';
  lots: number;
  /** Epoch ms — the close of the entry bar. */
  entryAt: number;
  entryPrice: number;
  stopLoss: number | null;
  exitAt: number | null;
  exitPrice: number | null;
  netPnl: number | null;
  /** `STOP`, `TARGET`, `SQUARE_OFF`, … — `null` while open. */
  exitReason: string | null;
}

export interface PaperPriceLine {
  price: number;
  colour: string;
  title: string;
  dashed: boolean;
}

const ENTRY_COLOUR = '#4fd1a5';
const STOP_COLOUR = '#ef5350';
const EXIT_WIN_COLOUR = '#26a17b';
const EXIT_LOSS_COLOUR = '#ef5350';
const EXIT_FLAT_COLOUR = '#8b9bad';

/** Short label per exit kind — the chart has room for two or three characters. */
const EXIT_LABEL: Record<string, string> = {
  STOP: 'SL',
  TARGET: 'TP',
  TIME_EXIT: 'T',
  SQUARE_OFF: 'SQ',
  SESSION_END: 'EOD',
  MANUAL: 'M',
};

/** A closed trade from the paper-trading report. */
export function fromRecord(record: PaperTradeRecord): ChartPaperTrade {
  return {
    tradeId: record.tradeId,
    strategyName: record.strategyName,
    side: record.side,
    lots: record.lots,
    entryAt: record.entryAt,
    entryPrice: record.entryPrice,
    stopLoss: record.stopLoss,
    exitAt: record.exitAt,
    exitPrice: record.exitPrice,
    netPnl: record.netPnl,
    exitReason: record.exitReason,
  };
}

/** The open position of a running paper book, or `null` when it is flat. */
export function fromOpenBook(book: PaperBook): ChartPaperTrade | null {
  const open = book.openTrade;
  if (!open) return null;
  return {
    tradeId: open.tradeKey,
    strategyName: book.strategyName,
    side: open.side,
    lots: open.lots,
    entryAt: open.entryTime,
    entryPrice: open.entryPrice,
    stopLoss: open.stopLoss,
    exitAt: null,
    exitPrice: null,
    netPnl: null,
    exitReason: null,
  };
}

/** Entry and exit arrows, ascending in time as `setMarkers` requires. */
export function paperMarkers(
  trades: readonly ChartPaperTrade[],
  displaySeconds: number,
): SeriesMarker<UTCTimestamp>[] {
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  for (const trade of trades) {
    markers.push({
      time: snap(trade.entryAt, displaySeconds),
      position: trade.side === 'BUY' ? 'belowBar' : 'aboveBar',
      color: ENTRY_COLOUR,
      shape: trade.side === 'BUY' ? 'arrowUp' : 'arrowDown',
      text: `${trade.side === 'BUY' ? 'B' : 'S'} ${shortName(trade.strategyName)}`,
    });
    if (trade.exitAt !== null) {
      const pnl = trade.netPnl ?? 0;
      markers.push({
        time: snap(trade.exitAt, displaySeconds),
        position: trade.side === 'BUY' ? 'aboveBar' : 'belowBar',
        color: pnl > 0 ? EXIT_WIN_COLOUR : pnl < 0 ? EXIT_LOSS_COLOUR : EXIT_FLAT_COLOUR,
        shape: trade.side === 'BUY' ? 'arrowDown' : 'arrowUp',
        text: `${EXIT_LABEL[trade.exitReason ?? ''] ?? 'X'} ${formatSigned(pnl)}`,
      });
    }
  }
  return markers.sort((a, b) => (a.time as number) - (b.time as number));
}

/** Entry and stop-loss lines for the positions still open. */
export function paperPriceLines(trades: readonly ChartPaperTrade[]): PaperPriceLine[] {
  const lines: PaperPriceLine[] = [];
  for (const trade of trades) {
    if (trade.exitAt !== null) continue;
    const name = shortName(trade.strategyName);
    lines.push({
      price: trade.entryPrice,
      colour: ENTRY_COLOUR,
      title: `${name} entry`,
      dashed: false,
    });
    if (trade.stopLoss !== null) {
      lines.push({ price: trade.stopLoss, colour: STOP_COLOUR, title: `${name} SL`, dashed: true });
    }
  }
  return lines;
}

/** The first word of a strategy's name — `FibMo v2 (…)` → `FibMo`. */
function shortName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

function snap(epochMs: number, displaySeconds: number): UTCTimestamp {
  return Math.floor(bucketStartMs(epochMs - 1, displaySeconds) / 1000) as UTCTimestamp;
}

function formatSigned(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString('en-IN')}`;
}
