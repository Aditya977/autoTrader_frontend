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
import type { DetectedPattern, PatternLine } from '../types';
import type { PatternOverlayAdapter } from './pattern-overlay-adapter';
import {
  DASH,
  LABEL,
  LINE_WIDTH,
  OPACITY,
  PIVOT_DOT_RADIUS,
  colorFor,
  readPalette,
  withAlpha,
  type PatternPalette,
} from './styles';

/** A line already converted to canvas coordinates. */
interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  dash: readonly number[] | null;
  alpha: number;
}

interface Plate {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
}

interface Dot {
  x: number;
  y: number;
  color: string;
  alpha: number;
}

interface Frame {
  segments: Segment[];
  plates: Plate[];
  dots: Dot[];
}

/**
 * Draws every detected pattern onto the chart, as one series primitive.
 *
 * One primitive for all patterns rather than one each: the library redraws
 * primitives on every pan, zoom and data change, and twenty primitives each
 * recomputing their own coordinates would do twenty times the work for one
 * picture. This recalculates the whole frame in `updateAllViews` and the
 * renderer just paints it.
 *
 * ## Why the library draws this and not a DOM layer
 *
 * Every point is anchored by time and price and converted through the chart's
 * own `timeToCoordinate` and `priceToCoordinate`. That is what makes overlays
 * follow pan and zoom exactly, with no listener to keep in sync and no chance
 * of the lines lagging the candles by a frame.
 *
 * It also depends on a property the engine guarantees: **every time in a
 * pattern is a real bar's time.** `timeToCoordinate` answers `null` for an
 * instant that is not in the data, so a neckline projected to an invented
 * future timestamp would silently vanish. The detectors clamp to the series
 * for exactly this reason.
 */
class PatternPrimitive implements ISeriesPrimitive<Time> {
  private readonly patterns = new Map<string, DetectedPattern>();
  private palette: PatternPalette = readPalette();
  private visible = true;
  private frame: Frame = { segments: [], plates: [], dots: [] };

  private chart?: IChartApi;
  private series?: ISeriesApi<SeriesType, Time>;
  private requestUpdate?: () => void;

  private readonly view: IPrimitivePaneView = {
    // Above the candles: an outline hidden behind a wick describes nothing.
    zOrder: () => 'top',
    renderer: (): IPrimitivePaneRenderer | null => {
      if (!this.visible) return null;
      const frame = this.frame;
      if (!frame.segments.length && !frame.plates.length && !frame.dots.length) {
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
    this.palette = readPalette();
  }

  detached(): void {
    this.chart = undefined;
    this.series = undefined;
    this.requestUpdate = undefined;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  /** Called by the library whenever the viewport or the data changed. */
  updateAllViews(): void {
    this.frame = this.visible ? this.build() : { segments: [], plates: [], dots: [] };
  }

  /* --- the adapter surface ------------------------------------------- */

  set(pattern: DetectedPattern): void {
    this.patterns.set(pattern.id, pattern);
    this.refresh();
  }

  delete(id: string): void {
    if (this.patterns.delete(id)) this.refresh();
  }

  reset(): void {
    if (this.patterns.size === 0) return;
    this.patterns.clear();
    this.refresh();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.refresh();
  }

  rereadTheme(): void {
    this.palette = readPalette();
    this.refresh();
  }

  get count(): number {
    return this.patterns.size;
  }

  private refresh(): void {
    this.updateAllViews();
    this.requestUpdate?.();
  }

  /* --- time and price into pixels ------------------------------------ */

  private build(): Frame {
    const frame: Frame = { segments: [], plates: [], dots: [] };
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series) return frame;

    const timeScale = chart.timeScale();
    const x = (time: number): number | null => timeScale.timeToCoordinate(time as UTCTimestamp);
    const y = (price: number): number | null => series.priceToCoordinate(price);

    // Newest first, so when plates are pushed apart the most recent pattern
    // keeps the position it asked for.
    const ordered = [...this.patterns.values()].sort((a, b) => b.endTime - a.endTime);

    for (const pattern of ordered) {
      const color = colorFor(this.palette, pattern.direction);
      const alpha = OPACITY[pattern.status];
      const forming = pattern.status === 'forming';

      for (const line of pattern.lines) {
        const segment = toSegment(line, x, y, color, alpha, forming);
        if (segment) frame.segments.push(segment);
      }

      for (const pivot of pattern.pivots) {
        const px = x(pivot.time);
        const py = y(pivot.price);
        if (px === null || py === null) continue;
        frame.dots.push({ x: px, y: py, color, alpha });
      }

      const lx = x(pattern.label.anchor.time);
      const ly = y(pattern.label.anchor.price);
      if (lx === null || ly === null) continue;
      frame.plates.push({
        x: lx,
        y: ly + (pattern.label.placement === 'above' ? -LABEL.offset : LABEL.offset),
        // Confidence belongs on the label, not in a tooltip nobody opens: a
        // 0.51 and a 0.94 are different claims and should not read alike.
        text: `${pattern.label.text} · ${Math.round(pattern.confidence * 100)}%`,
        color,
        alpha,
      });
    }

    spreadPlates(frame.plates);
    return frame;
  }
}

function toSegment(
  line: PatternLine,
  x: (time: number) => number | null,
  y: (price: number) => number | null,
  color: string,
  alpha: number,
  forming: boolean,
): Segment | null {
  const x1 = x(line.from.time);
  const y1 = y(line.from.price);
  const x2 = x(line.to.time);
  const y2 = y(line.to.price);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

  const isLevel = line.role === 'neckline' || line.role === 'support' || line.role === 'resistance';
  const isTarget = line.role === 'target';

  return {
    x1,
    y1,
    x2,
    y2,
    // A neckline is a level, not a direction, so it stays neutral whichever
    // way the pattern points. The outline carries the colour.
    color: isLevel || isTarget ? withAlpha(color, 0.85) : color,
    width: isTarget ? LINE_WIDTH.target : isLevel ? LINE_WIDTH.level : LINE_WIDTH.outline,
    dash: isTarget
      ? [...DASH.target]
      : isLevel
        ? [...DASH.level]
        : forming
          ? [...DASH.forming]
          : null,
    alpha,
  };
}

/**
 * Pushes overlapping labels apart, top to bottom.
 *
 * Only vertically, and only downward from where each asked to sit. Nudging
 * horizontally would move a label away from the pattern it names, which is
 * worse than two plates being a little lower than ideal.
 */
function spreadPlates(plates: Plate[]): void {
  const byColumn = new Map<number, Plate[]>();
  for (const plate of plates) {
    // Bucketed by rough x, so only labels that actually sit near each other
    // compete for vertical room.
    const column = Math.round(plate.x / 120);
    const list = byColumn.get(column);
    if (list) list.push(plate);
    else byColumn.set(column, [plate]);
  }

  for (const list of byColumn.values()) {
    list.sort((a, b) => a.y - b.y);
    for (let i = 1; i < list.length; i++) {
      const previous = list[i - 1] as Plate;
      const current = list[i] as Plate;
      if (current.y - previous.y < LABEL.minGap) {
        current.y = previous.y + LABEL.minGap;
      }
    }
  }
}

function paint(ctx: CanvasRenderingContext2D, frame: Frame): void {
  ctx.save();

  for (const segment of frame.segments) {
    ctx.globalAlpha = segment.alpha;
    ctx.strokeStyle = segment.color;
    ctx.lineWidth = segment.width;
    ctx.setLineDash(segment.dash ? [...segment.dash] : []);
    ctx.beginPath();
    ctx.moveTo(segment.x1, segment.y1);
    ctx.lineTo(segment.x2, segment.y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const dot of frame.dots) {
    ctx.globalAlpha = dot.alpha;
    ctx.fillStyle = dot.color;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, PIVOT_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = LABEL.font;
  ctx.textBaseline = 'middle';
  for (const plate of frame.plates) {
    ctx.globalAlpha = plate.alpha;
    const width = ctx.measureText(plate.text).width + LABEL.paddingX * 2;
    const height = 16;
    const left = plate.x - width / 2;
    const top = plate.y - height / 2;

    ctx.fillStyle = withAlpha(plate.color, 0.18);
    roundRect(ctx, left, top, width, height, LABEL.radius);
    ctx.fill();
    ctx.strokeStyle = withAlpha(plate.color, 0.55);
    ctx.lineWidth = 1;
    roundRect(ctx, left, top, width, height, LABEL.radius);
    ctx.stroke();

    ctx.fillStyle = plate.color;
    ctx.textAlign = 'center';
    ctx.fillText(plate.text, plate.x, plate.y);
  }

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
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
 * already-attached primitive rather than reaching for the chart itself.
 */
export class LightweightChartsPatternOverlay implements PatternOverlayAdapter {
  private readonly primitive = new PatternPrimitive();
  private attachedTo?: ISeriesApi<SeriesType, Time>;

  /** Attaches to a series. Safe to call once; `destroy` undoes it. */
  attach(series: ISeriesApi<SeriesType, Time>): void {
    if (this.attachedTo) return;
    series.attachPrimitive(this.primitive as ISeriesPrimitive<Time>);
    this.attachedTo = series;
  }

  upsert(pattern: DetectedPattern): void {
    this.primitive.set(pattern);
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
    // A single dark theme ships today, so the argument changes nothing and
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

  /** Patterns currently held. For tests and for the toolbar count. */
  get size(): number {
    return this.primitive.count;
  }
}
