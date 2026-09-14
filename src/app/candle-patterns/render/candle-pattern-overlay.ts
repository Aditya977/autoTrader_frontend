import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type { CandlePatternHit } from '../candle-patterns.models';
import {
  ARROW,
  BOX,
  LABEL,
  STATUS_ALPHA,
  STATUS_DASH,
  colorForBias,
  readCandlePalette,
  withAlpha,
  type CandlePalette,
} from './styles';

/**
 * The drawing surface a candlestick overlay needs.
 *
 * The seam between the feature and the charting library: everything
 * library-specific lives behind it, so replacing Lightweight Charts is one new
 * implementation rather than a rewrite.
 *
 * `upsert` rather than `add` is the important verb. A hit keeps its id across
 * recomputations, so the caller re-publishes the same id each pass and the
 * drawing is updated in place; an add/remove pair would tear down and rebuild
 * every box on each closed bar, which reads as a flicker.
 */
export interface CandlePatternOverlayAdapter {
  upsert(hit: RenderedCandlePattern): void;
  remove(id: string): void;
  clear(): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

/**
 * A hit with its display name resolved.
 *
 * The backend ships names in a `labels` map beside the results, keyed by
 * pattern, rather than repeating a long string on every hit. Resolving it at
 * the boundary keeps that saving without making the renderer carry a lookup
 * table it could get out of step with — and makes the label something the
 * caller can override for a test without a document.
 */
export interface RenderedCandlePattern extends CandlePatternHit {
  label: string;
}

/** A box already converted to canvas coordinates. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  color: string;
  alpha: number;
  dash: readonly number[] | null;
}

interface Arrow {
  /** Tail, at the box edge. */
  x1: number;
  y1: number;
  /** Tip, pointing away from the bars. */
  x2: number;
  y2: number;
  color: string;
  alpha: number;
}

interface Plate {
  x: number;
  y: number;
  text: string;
  /** The second line: the context, or nothing. */
  sub: string | null;
  color: string;
  alpha: number;
  /** Which way the plate is stacked from `y`. */
  above: boolean;
}

interface Frame {
  boxes: Box[];
  arrows: Arrow[];
  plates: Plate[];
}

/** Bar-open time in **seconds**, which is the chart's own x value. */
const toChartSeconds = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp;

/**
 * Draws every detected candlestick pattern, as one series primitive.
 *
 * One primitive for all of them rather than one each: the library recomputes
 * primitives on every pan, zoom and data change, and fifty primitives each
 * converting their own coordinates would do fifty times the work for one
 * picture. The whole frame is rebuilt in `updateAllViews` and the renderer
 * only paints.
 *
 * ## Why the library draws this rather than a DOM layer
 *
 * Every point is anchored by time and price and converted through the chart's
 * own `timeToCoordinate` and `priceToCoordinate`, which is what makes the
 * boxes follow pan and zoom exactly, with no listener to keep in sync and no
 * chance of them lagging the candles by a frame.
 *
 * It depends on a property the backend guarantees: **every time in a hit is a
 * real bar's time.** `timeToCoordinate` answers `null` for an instant that is
 * not in the data, so a box anchored to an invented timestamp would silently
 * vanish. The engine only ever reports bars it was given.
 */
class CandlePatternPrimitive implements ISeriesPrimitive<Time> {
  private readonly hits = new Map<string, RenderedCandlePattern>();
  private palette: CandlePalette = readCandlePalette();
  private visible = true;
  private frame: Frame = empty();

  private chart?: IChartApi;
  private series?: ISeriesApi<SeriesType, Time>;
  private requestUpdate?: () => void;

  private readonly view: IPrimitivePaneView = {
    // Above the candles: a box hidden behind a wick describes nothing.
    zOrder: () => 'top',
    renderer: (): IPrimitivePaneRenderer | null => {
      if (!this.visible) return null;
      const frame = this.frame;
      if (!frame.boxes.length && !frame.plates.length && !frame.arrows.length) {
        return null;
      }
      return {
        draw: (target) => {
          target.useMediaCoordinateSpace((scope) => {
            paint(scope.context, frame);
          });
        },
      };
    },
  };

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
    this.palette = readCandlePalette();
  }

  detached(): void {
    this.chart = undefined;
    this.series = undefined;
    this.requestUpdate = undefined;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  updateAllViews(): void {
    this.frame = this.visible ? this.build() : empty();
  }

  set(hit: RenderedCandlePattern): void {
    this.hits.set(hit.id, hit);
    this.refresh();
  }

  delete(id: string): void {
    if (this.hits.delete(id)) this.refresh();
  }

  reset(): void {
    if (this.hits.size === 0) return;
    this.hits.clear();
    this.refresh();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.refresh();
  }

  rereadTheme(): void {
    this.palette = readCandlePalette();
    this.refresh();
  }

  get count(): number {
    return this.hits.size;
  }

  private refresh(): void {
    this.updateAllViews();
    this.requestUpdate?.();
  }

  /* --- time and price into pixels ------------------------------------ */

  private build(): Frame {
    const frame = empty();
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series) return frame;

    const timeScale = chart.timeScale();
    const x = (ms: number): number | null => timeScale.timeToCoordinate(toChartSeconds(ms));
    const y = (price: number): number | null => series.priceToCoordinate(price);

    // Half a bar's width, so a box wraps the candles rather than cutting
    // through their centres. Read from the scale so it is right at every zoom;
    // the fallback covers a chart too narrow for the scale to report one.
    const spacing = timeScale.options().barSpacing;
    const halfWidth =
      Number.isFinite(spacing) && spacing > 0 ? Math.max(2, spacing / 2) : BOX.fallbackHalfWidth;

    // Newest first, so when plates are pushed apart the most recent pattern
    // keeps the position it asked for.
    const ordered = [...this.hits.values()].sort((a, b) => b.endTime - a.endTime);

    for (const hit of ordered) {
      const x1 = x(hit.startTime);
      const x2 = x(hit.endTime);
      const top = y(hit.patternHigh);
      const bottom = y(hit.patternLow);
      if (x1 === null || x2 === null || top === null || bottom === null) continue;

      const color = colorForBias(this.palette, hit.reversalBias);
      const alpha = STATUS_ALPHA[hit.status];

      const box: Box = {
        left: Math.min(x1, x2) - halfWidth - BOX.padX,
        right: Math.max(x1, x2) + halfWidth + BOX.padX,
        // `top` is the smaller canvas y, because the axis runs downward.
        top: Math.min(top, bottom) - BOX.padY,
        bottom: Math.max(top, bottom) + BOX.padY,
        color,
        alpha,
        dash: STATUS_DASH[hit.status],
      };
      frame.boxes.push(box);

      // A bullish reading is annotated below the bars and a bearish one above,
      // so the arrow points away from the box and into the move it expects —
      // and so the note never sits on top of the price action it describes.
      const above = hit.reversalBias === 'BEARISH';
      const midX = (box.left + box.right) / 2;
      const edgeY = above ? box.top : box.bottom;
      const tipY = above ? edgeY - ARROW.length : edgeY + ARROW.length;

      if (hit.reversalBias !== 'NEUTRAL') {
        frame.arrows.push({
          // Leaning, so it reads as a direction rather than a tick mark.
          x1: midX - ARROW.lean,
          y1: tipY,
          x2: midX,
          y2: edgeY,
          color,
          alpha,
        });
      }

      const plateY = above
        ? tipY - ARROW.headLength - LABEL.offset
        : tipY + ARROW.headLength + LABEL.offset;

      frame.plates.push({
        x: midX - (hit.reversalBias === 'NEUTRAL' ? 0 : ARROW.lean),
        y: plateY,
        text: `${hit.label} · ${hit.confidence}`,
        sub: subtitleFor(hit),
        color,
        alpha,
        above,
      });
    }

    spreadPlates(frame.plates);
    return frame;
  }
}

const empty = (): Frame => ({ boxes: [], arrows: [], plates: [] });

/**
 * The second line: the context, and the confirmation once there is one.
 *
 * The three things the product is meant to keep separate, kept separate on
 * screen as well — the name says what the candle is, this says where it sat
 * and what price did next. `UNKNOWN` context is omitted rather than shown,
 * because "we have not seen enough bars yet" is not information a reader of a
 * chart needs on the chart.
 */
function subtitleFor(hit: CandlePatternHit): string | null {
  const parts: string[] = [];

  if (hit.directionContext === 'BEARISH') parts.push('after a decline');
  else if (hit.directionContext === 'BULLISH') parts.push('after a rise');
  else if (hit.directionContext === 'NEUTRAL') parts.push('in a range');

  if (hit.status === 'confirmed') parts.push('confirmed');
  else if (hit.status === 'failed') parts.push('not confirmed');
  else if (hit.status === 'pending') parts.push('unresolved');

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Pushes overlapping plates apart, away from the bars.
 *
 * Only vertically, and only outward from where each asked to sit — a plate
 * above the bars moves further up, one below moves further down. Nudging
 * horizontally would slide a label away from the candle it names, which is
 * worse than a label sitting a little further out than ideal.
 */
function spreadPlates(plates: Plate[]): void {
  const byColumn = new Map<string, Plate[]>();
  for (const plate of plates) {
    // Bucketed by rough x *and* by side, so a label above the bars never
    // competes for room with one below them.
    const key = `${plate.above ? 'a' : 'b'}:${Math.round(plate.x / 90)}`;
    const list = byColumn.get(key);
    if (list) list.push(plate);
    else byColumn.set(key, [plate]);
  }

  for (const list of byColumn.values()) {
    const gap = LABEL.minGap + (list.some((p) => p.sub) ? LABEL.height : 0);
    if (list[0]?.above) {
      // Upward: the highest plate stays, the rest stack above it.
      list.sort((a, b) => b.y - a.y);
      for (let i = 1; i < list.length; i++) {
        const previous = list[i - 1] as Plate;
        const current = list[i] as Plate;
        if (previous.y - current.y < gap) current.y = previous.y - gap;
      }
      continue;
    }
    list.sort((a, b) => a.y - b.y);
    for (let i = 1; i < list.length; i++) {
      const previous = list[i - 1] as Plate;
      const current = list[i] as Plate;
      if (current.y - previous.y < gap) current.y = previous.y + gap;
    }
  }
}

function paint(ctx: CanvasRenderingContext2D, frame: Frame): void {
  ctx.save();

  for (const box of frame.boxes) {
    ctx.globalAlpha = box.alpha;
    // A faint wash inside, so a box reads as enclosing the bars rather than
    // as four unrelated lines near them. Kept very low: the candles are the
    // subject, and a tint that competes with them hides what it points at.
    ctx.fillStyle = withAlpha(box.color, 0.1);
    roundRect(ctx, box.left, box.top, box.right - box.left, box.bottom - box.top, BOX.radius);
    ctx.fill();

    ctx.strokeStyle = box.color;
    ctx.lineWidth = BOX.lineWidth;
    ctx.setLineDash(box.dash ? [...box.dash] : []);
    roundRect(ctx, box.left, box.top, box.right - box.left, box.bottom - box.top, BOX.radius);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const arrow of frame.arrows) {
    ctx.globalAlpha = arrow.alpha;
    ctx.strokeStyle = arrow.color;
    ctx.fillStyle = arrow.color;
    ctx.lineWidth = ARROW.lineWidth;
    ctx.beginPath();
    ctx.moveTo(arrow.x1, arrow.y1);
    ctx.lineTo(arrow.x2, arrow.y2);
    ctx.stroke();
    arrowHead(ctx, arrow);
  }

  ctx.textBaseline = 'middle';
  for (const plate of frame.plates) {
    ctx.globalAlpha = plate.alpha;
    ctx.font = LABEL.font;
    const titleWidth = ctx.measureText(plate.text).width;
    ctx.font = LABEL.smallFont;
    const subWidth = plate.sub ? ctx.measureText(plate.sub).width : 0;

    const width = Math.max(titleWidth, subWidth) + LABEL.paddingX * 2;
    const height = LABEL.height * (plate.sub ? 2 : 1) + LABEL.paddingY;
    const left = plate.x - width / 2;
    // `plate.y` is the edge nearest the bars, so a two-line plate grows away
    // from them rather than back over the candles it describes.
    const top = plate.above ? plate.y - height : plate.y;

    ctx.fillStyle = withAlpha(plate.color, 0.16);
    roundRect(ctx, left, top, width, height, LABEL.radius);
    ctx.fill();
    ctx.strokeStyle = withAlpha(plate.color, 0.6);
    ctx.lineWidth = 1;
    roundRect(ctx, left, top, width, height, LABEL.radius);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = LABEL.font;
    ctx.fillStyle = plate.color;
    const titleY = top + LABEL.paddingY / 2 + LABEL.height / 2;
    ctx.fillText(plate.text, plate.x, titleY);

    if (plate.sub) {
      ctx.font = LABEL.smallFont;
      // The context line is deliberately quieter than the name: it qualifies
      // the finding rather than being one.
      ctx.fillStyle = withAlpha(plate.color, 0.8);
      ctx.fillText(plate.sub, plate.x, titleY + LABEL.height);
    }
  }

  ctx.restore();
}

/** A filled triangle at the arrow's tip, aligned to the stem. */
function arrowHead(ctx: CanvasRenderingContext2D, arrow: Arrow): void {
  // Pointing from the box edge outward, which is the direction the reader is
  // being sent: the tail is at `(x1, y1)` and the head sits beyond it.
  const dx = arrow.x1 - arrow.x2;
  const dy = arrow.y1 - arrow.y2;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;

  const ux = dx / length;
  const uy = dy / length;
  const tipX = arrow.x1 + ux * ARROW.headLength;
  const tipY = arrow.y1 + uy * ARROW.headLength;

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(arrow.x1 - uy * ARROW.headWidth, arrow.y1 + ux * ARROW.headWidth);
  ctx.lineTo(arrow.x1 + uy * ARROW.headWidth, arrow.y1 - ux * ARROW.headWidth);
  ctx.closePath();
  ctx.fill();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * The adapter the chart integration holds, and the primitive it drives.
 *
 * Attaching is the caller's job — it owns the series — so this takes an
 * already-created primitive rather than reaching for the chart itself.
 */
export class LightweightChartsCandlePatternOverlay implements CandlePatternOverlayAdapter {
  private readonly primitive = new CandlePatternPrimitive();
  private attachedTo?: ISeriesApi<SeriesType, Time>;

  /** Attaches to a series. Safe to call twice; `destroy` undoes it. */
  attach(series: ISeriesApi<SeriesType, Time>): void {
    if (this.attachedTo) return;
    series.attachPrimitive(this.primitive as ISeriesPrimitive<Time>);
    this.attachedTo = series;
  }

  upsert(hit: RenderedCandlePattern): void {
    this.primitive.set(hit);
  }

  remove(id: string): void {
    this.primitive.delete(id);
  }

  clear(): void {
    this.primitive.reset();
  }

  setVisible(visible: boolean): void {
    this.primitive.setVisible(visible);
  }

  setTheme(theme: 'light' | 'dark'): void {
    // One dark theme ships today, so the argument changes nothing and
    // re-reading the CSS tokens is the whole hook. Kept in the signature
    // because the colours already come from tokens: a light theme would need
    // this call and nothing else.
    void theme;
    this.primitive.rereadTheme();
  }

  destroy(): void {
    this.primitive.reset();
    this.attachedTo?.detachPrimitive(this.primitive as ISeriesPrimitive<Time>);
    this.attachedTo = undefined;
  }

  /** Hits currently held. For tests and for the toolbar count. */
  get size(): number {
    return this.primitive.count;
  }
}
