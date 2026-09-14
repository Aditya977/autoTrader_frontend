import { VWAP_COLOR, vwapLine } from './vwap';

describe('vwapLine', () => {
  it('lifts the value each bar already carries onto a line', () => {
    const line = vwapLine([
      { time: 60, vwap: 100 },
      { time: 120, vwap: 101.5 },
      { time: 180, vwap: 101.25 },
    ]);

    expect(line).toEqual([
      { time: 60, value: 100 },
      { time: 120, value: 101.5 },
      { time: 180, value: 101.25 },
    ]);
  });

  /**
   * The case this function exists for. An index reports no volume, so its VWAP
   * is null all session; carrying the last value forward would draw a confident
   * horizontal line across a chart that has no VWAP at all.
   */
  it('draws nothing for a bar with no VWAP rather than holding the last one', () => {
    const line = vwapLine([
      { time: 60, vwap: 100 },
      { time: 120, vwap: null },
      { time: 180, vwap: 102 },
    ]);

    expect(line).toEqual([
      { time: 60, value: 100 },
      { time: 180, value: 102 },
    ]);
  });

  it('returns nothing at all for a series that never had one', () => {
    expect(
      vwapLine([
        { time: 60, vwap: null },
        { time: 120, vwap: null },
      ]),
    ).toEqual([]);
  });

  it('skips a value that is not a finite number', () => {
    expect(vwapLine([{ time: 60, vwap: Number.NaN }])).toEqual([]);
  });

  it('is drawn in a colour nothing else on the chart uses', () => {
    expect(VWAP_COLOR).toBe('#f472b6');
  });
});
