import { createChart, LineSeries, type UTCTimestamp } from 'lightweight-charts';
import {
  previousDayRangeLines,
  PDR_COLOR,
  PDR_LINES,
  PDR_LINE_TYPE,
  PDR_STYLE,
} from './previous-day-range';
import type { PreviousDayRange } from '../chart-stream/chart-stream.models';

/** 09:15 IST on `date`, in epoch seconds — the first bar of a session. */
function openOf(date: string): number {
  return Math.floor(new Date(`${date}T09:15:00+05:30`).getTime() / 1000);
}

const bars = (date: string, count: number, stepSeconds = 300) =>
  Array.from({ length: count }, (_, i) => ({ time: openOf(date) + i * stepSeconds }));

const range = (
  date: string,
  previousTradingDate: string,
  pdh: number,
  pdl: number,
): PreviousDayRange => ({
  date,
  previousTradingDate,
  pdh,
  pdl,
  mid: (pdh + pdl) / 2,
});

describe('previousDayRangeLines', () => {
  it('draws a flat level across every bar of the day', () => {
    const lines = previousDayRangeLines(bars('2026-09-10', 3), [
      range('2026-09-10', '2026-09-09', 24700, 24400),
    ]);

    expect(lines.pdh.map((p) => p.value)).toEqual([24700, 24700, 24700]);
    expect(lines.pdl.map((p) => p.value)).toEqual([24400, 24400, 24400]);
    expect(lines.mid.map((p) => p.value)).toEqual([24550, 24550, 24550]);
  });

  it('gives each day its own level', () => {
    const lines = previousDayRangeLines(
      [...bars('2026-09-10', 2), ...bars('2026-09-11', 2)],
      [
        range('2026-09-10', '2026-09-09', 24700, 24400),
        range('2026-09-11', '2026-09-10', 24650, 24350),
      ],
    );

    // Flat across each day. The change between them is drawn as a vertical
    // step by `PDR_LINE_TYPE`, not encoded as a break here — a break would
    // need a second point at the boundary bar's own time, and `setData`
    // rejects two points sharing a timestamp.
    expect(lines.pdh.map((p) => p.value)).toEqual([24700, 24700, 24650, 24650]);
  });

  it('emits whitespace for a day with no range rather than bridging it', () => {
    const lines = previousDayRangeLines(
      [...bars('2026-09-10', 1), ...bars('2026-09-11', 1), ...bars('2026-09-14', 1)],
      [
        range('2026-09-10', '2026-09-09', 24700, 24400),
        range('2026-09-14', '2026-09-11', 24800, 24500),
      ],
    );

    // The middle day has no range: it contributes a gap, never a line drawn
    // straight from 10 Sep's level to 14 Sep's.
    expect(lines.pdh.map((p) => p.value)).toEqual([24700, undefined, 24800]);
  });

  it('never emits two points at the same time, which setData would reject', () => {
    const series = [...bars('2026-09-10', 3), ...bars('2026-09-11', 3), ...bars('2026-09-14', 3)];
    const lines = previousDayRangeLines(series, [
      range('2026-09-10', '2026-09-09', 24700, 24400),
      range('2026-09-14', '2026-09-11', 24800, 24500),
    ]);

    for (const line of PDR_LINES) {
      const times = lines[line].map((p) => p.time);
      expect(times.every((t, i) => i === 0 || t > (times[i - 1] as number))).toBe(true);
    }
  });

  it('keeps one point per bar per line, in bar order', () => {
    const series = bars('2026-09-10', 5);
    const lines = previousDayRangeLines(series, [range('2026-09-10', '2026-09-09', 24700, 24400)]);

    for (const line of PDR_LINES) {
      expect(lines[line].map((p) => p.time)).toEqual(series.map((b) => b.time));
    }
  });

  it('returns empty lines for an empty series', () => {
    const lines = previousDayRangeLines([], [range('2026-09-10', '2026-09-09', 1, 0)]);
    expect(lines).toEqual({ pdh: [], pdl: [], mid: [] });
  });

  it('draws nothing when there are no ranges at all', () => {
    const lines = previousDayRangeLines(bars('2026-09-10', 2), []);
    expect(lines.pdh.every((p) => p.value === undefined)).toBe(true);
  });
});

/**
 * The contract the pure tests above cannot check: that Lightweight Charts
 * actually accepts what this module produces.
 *
 * `setData` asserts strictly increasing timestamps and throws on a duplicate.
 * A unit test over plain arrays will happily pass while the real chart throws
 * on the first multi-day session — so this drives the real library.
 */
describe('previousDayRangeLines, fed to a real chart', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.width = '600px';
    host.style.height = '300px';
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  function drawOn(lineData: ReturnType<typeof previousDayRangeLines>): void {
    const chart = createChart(host, { width: 600, height: 300 });
    try {
      for (const line of PDR_LINES) {
        const series = chart.addSeries(LineSeries, {
          color: PDR_COLOR,
          lineWidth: PDR_STYLE[line].width,
          lineType: PDR_LINE_TYPE,
          title: PDR_STYLE[line].title,
          lastValueVisible: true,
        });
        series.setData(
          lineData[line].map((point) => ({
            time: point.time as UTCTimestamp,
            ...(point.value === undefined ? {} : { value: point.value }),
          })),
        );
      }
    } finally {
      chart.remove();
    }
  }

  it('accepts a multi-day series without throwing', () => {
    const series = [...bars('2026-09-10', 5), ...bars('2026-09-11', 5)];
    const lines = previousDayRangeLines(series, [
      range('2026-09-10', '2026-09-09', 24700, 24400),
      range('2026-09-11', '2026-09-10', 24650, 24350),
    ]);

    expect(() => drawOn(lines)).not.toThrow();
  });

  it('accepts a series with a day that has no range', () => {
    const series = [...bars('2026-09-10', 3), ...bars('2026-09-11', 3), ...bars('2026-09-14', 3)];
    const lines = previousDayRangeLines(series, [
      range('2026-09-10', '2026-09-09', 24700, 24400),
      range('2026-09-14', '2026-09-11', 24800, 24500),
    ]);

    expect(() => drawOn(lines)).not.toThrow();
  });

  it('accepts a single-day series and an empty one', () => {
    expect(() =>
      drawOn(
        previousDayRangeLines(bars('2026-09-10', 4), [
          range('2026-09-10', '2026-09-09', 24700, 24400),
        ]),
      ),
    ).not.toThrow();
    expect(() => drawOn(previousDayRangeLines([], []))).not.toThrow();
  });
});
