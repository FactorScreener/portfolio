/**
 * NSE cash CNC (delivery) charges Dhan posts after fills.
 *
 * Dhan's /margincalculator returns brokerage and SPAN-style margin, not these
 * statutory line items — so a plan that spends every rupee of available
 * balance goes negative when STT, stamp and exchange fees hit.
 *
 * Rates match Dhan's equity-delivery table (https://dhan.co/pricing/, checked
 * Aug 2026) and NSE circular NSE/FA/73061 effective 1 Mar 2026. Brokerage on
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

export function estimateNseCncBuyCharges(turnover: number): number {
  if (turnover <= 0) return 0;
  // Dhan: STT and stamp to nearest rupee, everything else to 2 decimals.
  const stt = roundRupee(turnover * STT_DELIVERY);
  const stamp = roundRupee(turnover * STAMP_DUTY_BUY);
  const exch = roundPaise(turnover * NSE_TXN);
  const sebi = roundPaise(turnover * SEBI);
  const ipft = roundPaise(turnover * IPFT);
  const gst = roundPaise(GST * (exch + sebi + ipft));
  return (toPaise(stt) + toPaise(stamp) + toPaise(exch) + toPaise(sebi) + toPaise(ipft) + toPaise(gst)) / 100;
}

/** Largest buy notional that still leaves room for the statutory debit on it. */
export function maxBuyNotional(availableCash: number): number {
  const cash = Math.max(0, availableCash);
  return Math.max(0, cash - estimateNseCncBuyCharges(cash));
}
