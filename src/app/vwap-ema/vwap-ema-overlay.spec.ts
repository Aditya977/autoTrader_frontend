import { vwapEmaMarkers } from './vwap-ema-overlay';
import type { Setup } from './vwap-ema.models';

/** 2026-09-16 09:15 IST as epoch ms. */
const OPEN = Date.UTC(2026, 8, 16, 3, 45);
const MIN = 60_000;

const SETUP = {
  id: 's1',
  date: '2026-09-16',
  direction: 'LONG',
  confirmation: { barTs: OPEN + 14 * MIN, o: 100, h: 103, l: 99, c: 102 },
  trade: {
    direction: 'LONG',
    entry: 103.2,
    stop: 99,
    scaleOut: { price: 107.4, ts: OPEN + 22 * MIN, fraction: 0.5 },
    entryTs: OPEN + 15 * MIN,
    exitTs: OPEN + 28 * MIN,
    exitReason: 'EMA_TRAIL',
    result: 'WIN',
    rMultiple: 1.3,
  },
} as unknown as Setup;

describe('vwap-ema overlay', () => {
  it('marks the confirmation, entry, partial and exit on the bars they fall in', () => {
    const markers = vwapEmaMarkers([SETUP], 300, OPEN + 120 * MIN);
    expect(markers.map((m) => m.text)).toEqual([
      'rejection ↑',
      'LONG 103.2',
      '+1R (50%)',
      'EMA_TRAIL +1.30R',
    ]);
  });

  it('never marks what the drawn bars have not reached yet', () => {
    // A replay at 09:30: the confirmation and entry have printed, not the exit.
    const markers = vwapEmaMarkers([SETUP], 60, OPEN + 16 * MIN);
    expect(markers.map((m) => m.text)).toEqual(['rejection ↑', 'LONG 103.2']);
    expect(vwapEmaMarkers([SETUP], 60, OPEN + 10 * MIN)).toEqual([]);
  });
});
