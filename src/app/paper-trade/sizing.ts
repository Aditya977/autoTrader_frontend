/**
 * Turning "I want to put ₹20,000 into this" into a quantity the exchange would
 * actually accept.
 *
 * Pure functions over numbers, with no dependency on the engine, so the setup
 * form can show the plan *before* anything is committed and the engine can
 * re-derive the same numbers when the order arrives. Two implementations of
 * this arithmetic — one for the preview, one for the order — is exactly how a
 * form ends up promising three lots and filling two.
 *
 * ## Why lots and not shares
 *
 * An option trades in lots. NIFTY's is 75 at the time of writing, and it has
 * been 25, 50 and 65 within living memory. A partial lot is not a smaller
 * trade, it is a rejected order — so the only question worth answering is how
 * many *whole* lots the money buys, and whether that number is at least one.
 * Everything below follows from that.
 */

import type { PaperContract } from './paper-trade.models';

/** Why an order cannot be sized, when it cannot. */
export type SizingProblem =
  | 'NO_CONTRACT'
  | 'NO_PRICE'
  | 'NO_LOT_SIZE'
  | 'AMOUNT_MISSING'
  | 'AMOUNT_BELOW_ONE_LOT'
  | 'LOTS_MISSING';

/**
 * What an amount buys, and whether it buys anything at all.
 *
 * `valid` is the single question the button asks. The rest is what the form
 * shows beside it, and `problem`/`message` are why the button is off — a
 * disabled control with no stated reason is the most common way a form wastes
 * somebody's afternoon.
 */
export interface SizingPlan {
  valid: boolean;
  problem: SizingProblem | null;
  /** Ready to render. Empty when {@link valid}. */
  message: string;

  lotSize: number;
  /** Whole lots the amount affords. `0` when it affords none. */
  lots: number;
  /** `lots × lotSize`. */
  quantity: number;
  /** Premium per unit the plan was made against. */
  price: number;

  /** `price × lotSize` — what a single lot costs, and the floor on any trade. */
  costPerLot: number;
  /** `price × quantity` — the capital the order actually consumes. */
  requiredCapital: number;
  /** Same number, named as the order value the form is asked to display. */
  orderValue: number;
  /** `investment - requiredCapital`. Never negative when {@link valid}. */
  leftover: number;
  /** The amount the plan was made from, as the engine read it. */
  investment: number;
  /** Shortfall to afford one lot. `0` unless the problem is the amount. */
  shortfall: number;
}

/**
 * The checks both sizing paths share — a contract, a real price, a lot size.
 *
 * Extracted so the two entry points cannot drift apart. They ask different
 * questions of the user but the instrument has to be tradable either way, and
 * two copies of "is this an untraded strike" is exactly the sort of thing that
 * ends up fixed in one of them.
 *
 * Returns the invalid plan to hand straight back, or the shared base to build
 * a valid one on.
 */
function checkInstrument(
  contract: Pick<PaperContract, 'lotSize'> | null,
  price: number | null,
  investment: number,
):
  | { fail: SizingPlan }
  | { base: Omit<SizingPlan, 'valid' | 'problem' | 'message'>; costPerLot: number } {
  const lotSize = Math.trunc(contract?.lotSize ?? 0);
  const premium = Number(price);

  const base = {
    lotSize,
    lots: 0,
    quantity: 0,
    price: Number.isFinite(premium) ? premium : 0,
    costPerLot: 0,
    requiredCapital: 0,
    orderValue: 0,
    leftover: 0,
    investment: Number.isFinite(investment) ? investment : 0,
    shortfall: 0,
  };

  if (!contract) {
    return {
      fail: { ...base, valid: false, problem: 'NO_CONTRACT', message: 'Select a contract.' },
    };
  }
  // A price of exactly 0 is not a cheap option, it is an untraded strike the
  // chain reported no premium for. Sizing against it would divide by zero and
  // offer an infinite quantity.
  if (!Number.isFinite(premium) || premium <= 0) {
    return {
      fail: {
        ...base,
        valid: false,
        problem: 'NO_PRICE',
        message: 'No live price for this contract yet.',
      },
    };
  }
  if (lotSize <= 0) {
    return {
      fail: {
        ...base,
        valid: false,
        problem: 'NO_LOT_SIZE',
        message: 'Enter the lot size for this contract.',
      },
    };
  }

  const costPerLot = premium * lotSize;
  return { base: { ...base, costPerLot }, costPerLot };
}

/**
 * How many whole lots `lots` is, and what it costs — the user naming the size.
 *
 * The counterpart to {@link planSize}, for a trader who thinks in lots rather
 * than in rupees, which is how most option positions are actually described
 * ("two lots of the 24500 call", not "fourteen thousand rupees of it").
 *
 * There is no budget to fail against here: the user has stated the size they
 * want, so `investment` is an *output* — the capital that size requires —
 * rather than a cap the size is squeezed into. That asymmetry is the whole
 * difference between the two functions, and it is why `leftover` is always
 * zero on this path: nothing was left over, because nothing was being divided
 * up.
 */
export function planLots(
  contract: Pick<PaperContract, 'lotSize'> | null,
  price: number | null,
  lots: number | null,
): SizingPlan {
  const wanted = Math.trunc(Number(lots));
  const checked = checkInstrument(contract, price, 0);
  if ('fail' in checked) return checked.fail;

  const { base, costPerLot } = checked;

  if (!Number.isFinite(wanted) || wanted < 1) {
    return { ...base, valid: false, problem: 'LOTS_MISSING', message: 'Enter at least one lot.' };
  }

  const quantity = wanted * base.lotSize;
  const requiredCapital = base.price * quantity;

  return {
    ...base,
    valid: true,
    problem: null,
    message: '',
    lots: wanted,
    quantity,
    requiredCapital,
    orderValue: requiredCapital,
    // The capital the chosen size demands. Reported as the investment so the
    // engine, which sizes from this figure, commits exactly what was asked for.
    investment: requiredCapital,
    leftover: 0,
  };
}

/**
 * How many whole lots `investment` buys of `contract` at `price`.
 *
 * Deliberately total: every bad input produces a plan that is simply invalid
 * with a reason, rather than a throw. The form calls this on every keystroke,
 * including the keystroke that leaves the field empty.
 */
export function planSize(
  contract: Pick<PaperContract, 'lotSize'> | null,
  price: number | null,
  investment: number | null,
): SizingPlan {
  const amount = Number(investment);
  const checked = checkInstrument(contract, price, amount);
  if ('fail' in checked) return checked.fail;

  const { base, costPerLot } = checked;
  const lotSize = base.lotSize;
  const premium = base.price;

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ...base,
      valid: false,
      problem: 'AMOUNT_MISSING',
      message: 'Enter the amount to invest.',
    };
  }

  const lots = Math.floor(amount / costPerLot);
  if (lots < 1) {
    return {
      ...base,
      shortfall: costPerLot - amount,
      valid: false,
      problem: 'AMOUNT_BELOW_ONE_LOT',
      message:
        `₹${round(amount)} is short of one lot. ` +
        `One lot of ${lotSize} at ₹${premium} costs ₹${round(costPerLot)}.`,
    };
  }

  const quantity = lots * lotSize;
  const requiredCapital = premium * quantity;

  return {
    ...base,
    valid: true,
    problem: null,
    message: '',
    lots,
    quantity,
    requiredCapital,
    orderValue: requiredCapital,
    leftover: amount - requiredCapital,
  };
}

/**
 * Mark-to-market on a long position, before charges.
 *
 * Trivial, and extracted anyway: it is the one line every P&L on screen passes
 * through, and a short leg — which the engine's `side` already admits — inverts
 * it. Having one place to invert is the difference between adding shorts later
 * and hunting for sign errors later.
 */
export function grossPnlFor(
  side: 'BUY' | 'SELL',
  entryPrice: number,
  currentPrice: number,
  quantity: number,
): number {
  const move = currentPrice - entryPrice;
  return (side === 'BUY' ? move : -move) * quantity;
}

/** Percentage of the capital the position tied up. `0` when it tied up none. */
export function pnlPct(netPnl: number, capitalUsed: number): number {
  if (!capitalUsed) return 0;
  return (netPnl / capitalUsed) * 100;
}

/**
 * A long's stop immediately below a candle's low, on a valid tick.
 *
 * The same rule as the backend's `stopBelowLow`: the low is floored onto the
 * tick grid first (an off-grid low rounds *away* from price, never into the
 * candle), then `bufferTicks` ticks are taken off. Counted in whole ticks so
 * float noise cannot knock a price that was already on the grid down a tick —
 * `101.05 / 0.05` is `2020.9999999999998`.
 */
export function stopBelowLow(low: number, tickSize: number, bufferTicks = 1): number {
  if (!Number.isFinite(low)) return low;
  const tick = tickSize > 0 && Number.isFinite(tickSize) ? tickSize : 0;
  if (tick === 0) return low;
  const decimals = (tick.toString().split('.')[1] ?? '').length;
  const raw = low / tick;
  const ticks = Math.abs(raw - Math.round(raw)) < 1e-6 ? Math.round(raw) : Math.floor(raw);
  const stopTicks = ticks - Math.max(0, Math.trunc(bufferTicks));
  return Number((stopTicks * tick).toFixed(decimals));
}

function round(value: number): string {
  return Math.round(value).toLocaleString('en-IN');
}
