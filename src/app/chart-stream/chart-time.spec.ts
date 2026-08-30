import {
  bucketStartMs,
  formatIstAxisStamp,
  formatIstDay,
  formatIstStamp,
  formatIstTime,
  formatPrice,
  formatVolume,
  toChartTime,
} from './chart-time';

/** 09:15 IST on 2026-08-14, the NSE open — every fixture below hangs off this. */
const OPEN_MS = Date.parse('2026-08-14T03:45:00.000Z');
const MINUTE = 60_000;

describe('toChartTime', () => {
  it('converts epoch milliseconds to epoch seconds', () => {
    expect(toChartTime(1_755_000_000_000)).toBe(1_755_000_000 as never);
  });

  it('floors sub-second precision rather than rounding up', () => {
    expect(toChartTime(1_755_000_000_999)).toBe(1_755_000_000 as never);
  });
});

describe('IST formatting', () => {
  it('labels the open as 09:15, not the UTC 03:45 the timestamp actually is', () => {
    // The whole point of formatting rather than shifting the data: the bar is
    // a real UTC instant and the label is the exchange's clock.
    expect(formatIstTime(OPEN_MS / 1000)).toBe('09:15');
  });

  it('labels the close as 15:30', () => {
    const close = Date.parse('2026-08-14T10:00:00.000Z');
    expect(formatIstTime(close / 1000)).toBe('15:30');
  });

  it('files an afternoon bar under its IST date, not its UTC date', () => {
    // 2026-08-14T19:00Z is already 15 Aug in IST; a UTC-dated chart would put
    // it on the wrong day. (Outside session hours, but the rule is the rule.)
    const evening = Date.parse('2026-08-14T19:00:00.000Z');
    expect(formatIstDay(evening / 1000)).toBe('15 Aug');
  });

  it('spells the full stamp with the timezone named', () => {
    const stamp = formatIstStamp(OPEN_MS / 1000);
    expect(stamp).toContain('14 Aug 2026');
    expect(stamp).toContain('09:15');
    expect(stamp).toContain('IST');
  });
});

describe('bucketStartMs', () => {
  it('leaves one-minute bars where they are', () => {
    expect(bucketStartMs(OPEN_MS, 60)).toBe(OPEN_MS);
    expect(bucketStartMs(OPEN_MS + MINUTE, 60)).toBe(OPEN_MS + MINUTE);
  });

  it('anchors 5-minute buckets to the 09:15 open, so they run 09:15 / 09:20', () => {
    // Epoch-aligned flooring would put these on 09:15 and 09:20 only by
    // accident; the anchor is what guarantees it for every interval.
    for (let minute = 0; minute < 5; minute++) {
      expect(bucketStartMs(OPEN_MS + minute * MINUTE, 300)).toBe(OPEN_MS);
    }
    expect(bucketStartMs(OPEN_MS + 5 * MINUTE, 300)).toBe(OPEN_MS + 5 * MINUTE);
    expect(formatIstTime(bucketStartMs(OPEN_MS + 7 * MINUTE, 300) / 1000)).toBe('09:20');
  });

  it('anchors 15- and 30-minute buckets to the open too', () => {
    expect(formatIstTime(bucketStartMs(OPEN_MS + 14 * MINUTE, 900) / 1000)).toBe('09:15');
    expect(formatIstTime(bucketStartMs(OPEN_MS + 15 * MINUTE, 900) / 1000)).toBe('09:30');
    expect(formatIstTime(bucketStartMs(OPEN_MS + 29 * MINUTE, 1800) / 1000)).toBe('09:15');
    expect(formatIstTime(bucketStartMs(OPEN_MS + 31 * MINUTE, 1800) / 1000)).toBe('09:45');
  });

  it('runs hourly buckets 09:15 to 10:15, the way an Indian chart does', () => {
    expect(formatIstTime(bucketStartMs(OPEN_MS + 59 * MINUTE, 3600) / 1000)).toBe('09:15');
    expect(formatIstTime(bucketStartMs(OPEN_MS + 60 * MINUTE, 3600) / 1000)).toBe('10:15');
  });

  it('keeps the anchor on the next trading day, not only the first one', () => {
    const nextDay = OPEN_MS + 86_400_000;
    expect(formatIstTime(bucketStartMs(nextDay + 7 * MINUTE, 300) / 1000)).toBe('09:20');
  });

  it('buckets daily bars to the IST calendar day', () => {
    const openBucket = bucketStartMs(OPEN_MS, 86_400);
    const closeBucket = bucketStartMs(Date.parse('2026-08-14T10:00:00.000Z'), 86_400);
    expect(closeBucket).toBe(openBucket);
    expect(formatIstDay(openBucket / 1000)).toBe('14 Aug');
  });
});

describe('number formatting', () => {
  it('keeps two decimals so a small premium never renders as a whole number', () => {
    expect(formatPrice(0.05)).toBe('0.05');
    expect(formatPrice(24000)).toBe('24,000.00');
  });

  it('reads volume as a magnitude', () => {
    expect(formatVolume(942)).toBe('942');
    expect(formatVolume(12_400)).toBe('12.4k');
    expect(formatVolume(3_200_000)).toBe('3.2M');
  });
});

describe('formatIstAxisStamp', () => {
  it('drops the year and timezone the full stamp carries, so it fits the axis', () => {
    // The crosshair label is drawn between two tick labels; the full stamp is
    // wide enough to cover them.
    expect(formatIstAxisStamp(OPEN_MS / 1000)).toBe('14 Aug · 09:15');
    expect(formatIstAxisStamp(OPEN_MS / 1000).length).toBeLessThan(
      formatIstStamp(OPEN_MS / 1000).length,
    );
  });
});
