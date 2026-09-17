import { levelLinesAt, levelRejectionMarkers } from './level-rejection-overlay';
import type { DayLevels, Setup } from './level-rejection.models';

/** 2026-09-16 09:15 IST as epoch ms. */
const OPEN = Date.UTC(2026, 8, 16, 3, 45);
const MIN = 60_000;

const day = (date: string, pdh: number): DayLevels =>
  ({
    date,
    levels: [
      { type: 'PDH', price: pdh },
      { type: 'PD50', price: 150 },
      { type: 'S1H_LOW', price: 150 },
    ],
  }) as DayLevels;

const SETUP = {
  id: 's1',
  date: '2026-09-16',
  direction: 'LONG',
  zoneId: 'PDL',
  primaryLevel: 'PDL',
  primaryLevelPrice: 25000,
  rejection: { type: 'SWEEP_PIN', barTs: OPEN + 5 * MIN },
  structure: { breakTs: OPEN + 16 * MIN, description: 'close through swing high' },
  trade: {
    direction: 'LONG',
    entry: 25066,
    stop: 24990,
    target: 25142,
    entryTs: OPEN + 17 * MIN,
    exitTs: OPEN + 28 * MIN,
    exitReason: 'TARGET',
    result: 'WIN',
    rMultiple: 1,
  },
} as unknown as Setup;

describe('level rejection overlay', () => {
  it('draws the levels of the newest day on screen, merging coinciding ones', () => {
    const days = [day('2026-09-15', 210), day('2026-09-16', 200), day('2026-09-17', 190)];
    const lines = levelLinesAt(days, (OPEN + 60 * MIN) / 1000);
    expect(lines.map((l) => [l.price, l.title])).toEqual([
      [200, 'PDH'],
      [150, 'PD 50% · 13:15 1H L'],
    ]);
    expect(levelLinesAt([], null)).toEqual([]);
  });

  it('marks rejection, break, entry and exit on the 5m bars they fall in', () => {
    const markers = levelRejectionMarkers([SETUP], 300, OPEN + 120 * MIN);
    expect(markers.map((m) => m.text)).toEqual([
      'PDL rejection ↑',
      '1M break',
      'LONG 25066',
      'TARGET +1.00R',
    ]);
    expect(markers.map((m) => m.time)).toEqual([
      (OPEN + 5 * MIN) / 1000,
      (OPEN + 15 * MIN) / 1000,
      (OPEN + 15 * MIN) / 1000,
      (OPEN + 25 * MIN) / 1000,
    ] as never[]);
  });

  it('never marks what the drawn bars have not reached yet', () => {
    // A replay standing at 09:40: the rejection and break have printed, the exit has not.
    const markers = levelRejectionMarkers([SETUP], 60, OPEN + 25 * MIN);
    expect(markers.map((m) => m.text)).toEqual(['PDL rejection ↑', '1M break', 'LONG 25066']);
    expect(levelRejectionMarkers([SETUP], 60, OPEN + 9 * MIN)).toEqual([]);
  });
});
