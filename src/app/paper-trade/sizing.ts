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

/** Why an amount cannot be traded, when it cannot. */
export type SizingProblem =
  'NO_CONTRACT' | 'NO_PRICE' | 'NO_LOT_SIZE' | 'AMOUNT_MISSING' | 'AMOUNT_BELOW_ONE_LOT';

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
  const lotSize = Math.trunc(contract?.lotSize ?? 0);
  const amount = Number(investment);
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
    investment: Number.isFinite(amount) ? amount : 0,
    shortfall: 0,
  };

  if (!contract) {
    return { ...base, valid: false, problem: 'NO_CONTRACT', message: 'Select a contract.' };
  }
  // A price of exactly 0 is not a cheap option, it is an untraded strike the
  // chain reported no premium for. Sizing against it would divide by zero and
  // offer an infinite quantity.
  if (!Number.isFinite(premium) || premium <= 0) {
    return {
      ...base,
      valid: false,
      problem: 'NO_PRICE',
      message: 'No live price for this contract yet.',
    };
  }
  if (lotSize <= 0) {
    return {
      ...base,
      valid: false,
      problem: 'NO_LOT_SIZE',
      message: 'Enter the lot size for this contract.',
    };
  }

  const costPerLot = premium * lotSize;

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ...base,
      costPerLot,
      valid: false,
      problem: 'AMOUNT_MISSING',
      message: 'Enter the amount to invest.',
    };
  }

  const lots = Math.floor(amount / costPerLot);
  if (lots < 1) {
    return {
      ...base,
      costPerLot,
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
    costPerLot,
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

function round(value: number): string {
  return Math.round(value).toLocaleString('en-IN');
}
