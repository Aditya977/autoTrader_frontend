import { grossPnlFor, planSize, pnlPct } from './sizing';
import type { PaperContract } from './paper-trade.models';

const NIFTY: PaperContract = {
  instrumentKey: 'NSE_FO|12345',
  tradingsymbol: 'NIFTY 24500 CE',
  underlying: 'NIFTY',
  expiry: '2026-08-27',
  strike: 24500,
  leg: 'CE',
  lotSize: 75,
  tickSize: 0.05,
};

describe('planSize', () => {
  it('buys whole lots only, and reports what is left over', () => {
    // One lot of 75 at ₹94 is ₹7,050. ₹20,000 buys two, not 2.83.
    const plan = planSize(NIFTY, 94, 20_000);

    expect(plan.valid).toBe(true);
    expect(plan.lots).toBe(2);
    expect(plan.quantity).toBe(150);
    expect(plan.costPerLot).toBeCloseTo(7_050, 6);
    expect(plan.requiredCapital).toBeCloseTo(14_100, 6);
    expect(plan.orderValue).toBe(plan.requiredCapital);
    expect(plan.leftover).toBeCloseTo(5_900, 6);
  });

  it('refuses an amount that cannot cover a single lot, and says by how much', () => {
    const plan = planSize(NIFTY, 94, 5_000);

    expect(plan.valid).toBe(false);
    expect(plan.problem).toBe('AMOUNT_BELOW_ONE_LOT');
    expect(plan.lots).toBe(0);
    expect(plan.quantity).toBe(0);
    expect(plan.shortfall).toBeCloseTo(2_050, 6);
    expect(plan.message).toContain('7,050');
  });

  it('accepts an amount that covers exactly one lot', () => {
    // The boundary, because floating point makes `floor(7050 / 7050)` the one
    // place this could return zero lots for an amount that plainly affords one.
    const plan = planSize(NIFTY, 94, 7_050);

    expect(plan.valid).toBe(true);
    expect(plan.lots).toBe(1);
    expect(plan.leftover).toBeCloseTo(0, 6);
  });

  it('refuses an untraded strike rather than dividing by its zero price', () => {
    // `null` LTP is an untraded strike, not a free option. Sizing against it
    // would offer an unbounded quantity.
    expect(planSize(NIFTY, null, 20_000).problem).toBe('NO_PRICE');
    expect(planSize(NIFTY, 0, 20_000).problem).toBe('NO_PRICE');
    expect(planSize(NIFTY, -5, 20_000).problem).toBe('NO_PRICE');
    // A real price, however small, is sized normally — the refusal above is
    // about the absence of a quote, not about cheapness.
    expect(planSize(NIFTY, 0.05, 20_000).valid).toBe(true);
  });

  it('is total over missing inputs rather than throwing on a half-typed form', () => {
    expect(planSize(null, 94, 20_000).problem).toBe('NO_CONTRACT');
    expect(planSize(NIFTY, 94, null).problem).toBe('AMOUNT_MISSING');
    expect(planSize(NIFTY, 94, NaN).problem).toBe('AMOUNT_MISSING');
    expect(planSize({ lotSize: 0 }, 94, 20_000).problem).toBe('NO_LOT_SIZE');
  });
});

describe('grossPnlFor', () => {
  it('follows the premium up for a long and down for a short', () => {
    expect(grossPnlFor('BUY', 100, 120, 150)).toBe(3_000);
    expect(grossPnlFor('BUY', 100, 80, 150)).toBe(-3_000);
    expect(grossPnlFor('SELL', 100, 80, 150)).toBe(3_000);
    expect(grossPnlFor('SELL', 100, 120, 150)).toBe(-3_000);
  });
});

describe('pnlPct', () => {
  it('measures against the capital the position used, not the amount typed', () => {
    expect(pnlPct(1_410, 14_100)).toBeCloseTo(10, 6);
  });

  it('is zero rather than infinite when no capital was used', () => {
    expect(pnlPct(500, 0)).toBe(0);
  });
});
