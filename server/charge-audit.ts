import type { DhanLedgerEntry, DhanTrade } from "./dhan.ts";

const FEE_FIELDS = [
  "sebiTax", "stt", "brokerageCharges", "serviceTax",
  "exchangeTransactionCharges", "stampDuty",
] as const;

const paise = (value: number) => Math.round(value * 100) / 100;

/** Calendar dates in India, independent of the computer's local timezone. */
export function auditDateRange(days: number, now = new Date()) {
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error("Days must be an integer between 1 and 90.");
  }
  const ist = now.getTime() + 330 * 60_000;
  return {
    from: new Date(ist - (days - 1) * 86_400_000).toISOString().slice(0, 10),
    to: new Date(ist).toISOString().slice(0, 10),
  };
}

function amount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Summarise evidence without guessing which ledger debit settles which fee.
 * DP entries also cover pledge/unpledge; trade charges may be netted into a
 * single trading debit. Neither proves what the intraday funds API included.
 */
export function summariseChargeAudit(trades: DhanTrade[], ledger: DhanLedgerEntry[]) {
  const days = new Map<string, {
    buyValue: number;
    sellValue: number;
    reportedTradingCharges: number;
    chargesComplete: boolean;
    unpricedBuyCount: number;
    unpricedSellCount: number;
    sellOrders: Set<string>;
  }>();
  let excludedTrades = 0;
  for (const trade of trades) {
    if (trade.exchangeSegment !== "NSE_EQ" || trade.productType !== "CNC") {
      excludedTrades++;
      continue;
    }
    const date = trade.exchangeTime?.slice(0, 10);
    const quantity = amount(trade.tradedQuantity);
    const price = amount(trade.tradedPrice);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || quantity === null || quantity <= 0 || price === null
      || !["BUY", "SELL"].includes(trade.transactionType)) {
      throw new Error("Cannot audit a delivery fill with missing date, side, quantity or price.");
    }
    let day = days.get(date);
    if (!day) {
      day = {
        buyValue: 0, sellValue: 0, reportedTradingCharges: 0, chargesComplete: true,
        unpricedBuyCount: 0, unpricedSellCount: 0, sellOrders: new Set(),
      };
      days.set(date, day);
    }
    const value = quantity * price;
    if (trade.transactionType === "BUY") {
      day.buyValue += value;
      if (price === 0) day.unpricedBuyCount++;
    }
    else {
      day.sellValue += value;
      if (price === 0) day.unpricedSellCount++;
      day.sellOrders.add(trade.orderId);
    }
    for (const field of FEE_FIELDS) {
      const fee = amount(trade[field]);
      if (fee === null) day.chargesComplete = false;
      else day.reportedTradingCharges += fee;
    }
  }
  return {
    excludedTrades,
    tradeDays: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => ({
      date,
      buyValue: day.unpricedBuyCount === 0 ? paise(day.buyValue) : null,
      sellValue: day.unpricedSellCount === 0 ? paise(day.sellValue) : null,
      unpricedFillCount: day.unpricedBuyCount + day.unpricedSellCount,
      sellOrderCount: day.sellOrders.size,
      // The history endpoint reports these fees, but does not report DP fees.
      reportedTradingCharges: day.chargesComplete ? paise(day.reportedTradingCharges) : null,
      netTradeDebitExcludingDp: day.chargesComplete && day.unpricedBuyCount + day.unpricedSellCount === 0
        ? paise(day.buyValue - day.sellValue + day.reportedTradingCharges) : null,
    })),
    ledgerEntries: ledger.filter((entry) =>
      /^(DP Transaction Charges|Trades Executed)$/i.test(entry.narration.trim()),
    ).map((entry) => ({
      date: entry.voucherdate,
      kind: /^DP /i.test(entry.narration.trim()) ? "DP / pledge / unpledge" : "Trades executed",
      exchange: entry.exchange,
      debit: amount(entry.debit),
      credit: amount(entry.credit),
    })),
  };
}
