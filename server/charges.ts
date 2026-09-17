import type { DhanOrder } from "./dhan.ts";

/**
 * NSE cash CNC (delivery) charges Dhan posts after fills.
 *
 * Dhan's /margincalculator returns brokerage and SPAN-style margin, not these
 * statutory line items. Reserve an estimate because the funds API does not
 * specify which fees it already reflects. This can hold back extra cash.
 *
 * Rates match Dhan's equity-delivery table (https://dhan.co/pricing/, checked
 * Sep 2026) and NSE circular NSE/FA/73061 effective 1 Mar 2026. Brokerage on
 * delivery is ₹0. Update if Dhan or NSE revises the schedule.
 */

/** STT on delivery, buy and sell. Finance Act 2026 left this unchanged. */
const STT_DELIVERY = 0.001;
/** Central stamp duty, buy side only. */
const STAMP_DUTY_BUY = 0.00015;
/** NSE cash txn, ₹306.99 per crore (Dhan: 0.0030699%). */
const NSE_TXN = 0.000030699;
/** SEBI turnover fee, ₹10 per crore. */
const SEBI = 0.000001;
/** NSE IPFT after 1 Mar 2026, ₹0.01 per crore (Dhan: 0.0000001%). */
const IPFT = 0.000000001;
const GST = 0.18;

function roundRupee(n: number): number {
  return Math.round(n);
}

function roundPaise(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Whole rupees as paise, so the estimate is an exact number of paise. */
function toPaise(n: number): number {
  return Math.round(n * 100);
}

function estimateCharges(turnover: number, buy: boolean): number {
  if (turnover <= 0) return 0;
  // Dhan: STT and stamp to nearest rupee, everything else to 2 decimals.
  const stt = roundRupee(turnover * STT_DELIVERY);
  const stamp = buy ? roundRupee(turnover * STAMP_DUTY_BUY) : 0;
  const exch = roundPaise(turnover * NSE_TXN);
  const sebi = roundPaise(turnover * SEBI);
  const ipft = roundPaise(turnover * IPFT);
  const gst = roundPaise(GST * (exch + sebi + ipft));
  return (toPaise(stt) + toPaise(stamp) + toPaise(exch) + toPaise(sebi) + toPaise(ipft) + toPaise(gst)) / 100;
}

export function estimateNseCncBuyCharges(turnover: number): number {
  return estimateCharges(turnover, true);
}

/** Reserve one DP instruction per sell order, including 18% GST. */
export function estimateNseCncSellCharges(turnover: number, instructions: number): number {
  if (turnover <= 0) return 0;
  return roundPaise(estimateCharges(turnover, false) + instructions * 14.75);
}

/** The day order book includes partial fills even on cancelled orders.
 * Unfilled orders incur no charges and their proceeds are not added to cash.
 * Reserving DP per executed sell order is conservative if Dhan groups debits.
 */
export function estimateTodaysCharges(orders: DhanOrder[]) {
  let buyTurnover = 0;
  let sellTurnover = 0;
  let sellInstructions = 0;
  for (const order of orders) {
    if (order.exchangeSegment !== "NSE_EQ" || order.productType !== "CNC") continue;
    if (!(order.filledQty > 0)) continue;
    if (!(order.averageTradedPrice > 0) || !Number.isFinite(order.averageTradedPrice)) {
      throw new Error("A filled delivery order has no valid fill price. Refresh before planning.");
    }
    const turnover = order.filledQty * order.averageTradedPrice;
    if (order.transactionType === "BUY") buyTurnover += turnover;
    if (order.transactionType === "SELL") {
      sellTurnover += turnover;
      sellInstructions += 1;
    }
  }
  return {
    buyTurnover,
    sellTurnover,
    sellInstructions,
    charges: roundPaise(estimateNseCncBuyCharges(buyTurnover)
      + estimateNseCncSellCharges(sellTurnover, sellInstructions)),
  };
}

/** Largest buy notional that still leaves room for the statutory debit on it. */
export function maxBuyNotional(availableCash: number, priorBuyTurnover = 0): number {
  const cash = Math.max(0, availableCash);
  return Math.max(0, cash - (estimateNseCncBuyCharges(priorBuyTurnover + cash)
    - estimateNseCncBuyCharges(priorBuyTurnover)));
}
