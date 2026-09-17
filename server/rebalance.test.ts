import { describe, expect, mock, test } from "bun:test";
import type { DhanHolding, DhanOrder } from "./dhan.ts";

mock.module("./quotes.ts", () => ({
  getQuotes: async () => new Map(),
  getSplitEvents: async () => new Map(),
}));
mock.module("./instruments.ts", () => ({
  resolve: (symbol: string) => ({ symbol, security_id: symbol, name: symbol }),
}));
const { buildPlan } = await import("./rebalance.ts");

const holding: DhanHolding = {
  exchange: "NSE", tradingSymbol: "TEST", securityId: "TEST", isin: "test",
  totalQty: 100, dpQty: 100, t1Qty: 0, availableQty: 100, collateralQty: 0,
  avgCostPrice: 1000, lastTradedPrice: 1000,
};
const filledSell = {
  exchangeSegment: "NSE_EQ", productType: "CNC", transactionType: "SELL",
  filledQty: 100, averageTradedPrice: 1000,
} as DhanOrder;
const request = {
  side: "SELL" as const, targets: [], weightMode: "equal" as const,
  capAt5Pct: false, cashBufferPct: 0, availableCash: 0, minOrderValue: 0,
};

describe("rebalance charge reservation", () => {
  test("sell preview deducts charges including DP from cash after", async () => {
    const plan = await buildPlan(request, [holding]);
    expect(plan.totals.tradeValue).toBe(100_000);
    expect(plan.totals.estimatedCharges).toBe(118.49);
    expect(plan.totals.cashReserved).toBe(118.49);
    expect(plan.totals.cashAfter).toBe(99_881.51);
  });

  test("same-day sell fees reduce buy quantity even with a cash override", async () => {
    const req = { ...request, side: "BUY" as const, availableCash: 100_200, targets: [{ symbol: "TEST" }] };
    const emptyHolding = { ...holding, totalQty: 0, availableQty: 0, dpQty: 0 };
    const withoutSell = await buildPlan(req, [emptyHolding]);
    const afterSell = await buildPlan(req, [emptyHolding], [], [filledSell]);
    expect(withoutSell.rows[0]!.quantity).toBe(100);
    expect(afterSell.rows[0]!.quantity).toBe(99);
    expect(afterSell.totals.priorChargesReserved).toBe(118.49);
    expect(afterSell.totals.cashAfter).toBeGreaterThanOrEqual(0);
    expect(afterSell.totals.cashAfter).toBeCloseTo(100_200 - 99_000 - 118.49 - afterSell.totals.estimatedCharges, 8);
  });

  test("no buys when existing fees exhaust cash", async () => {
    const plan = await buildPlan({ ...request, side: "BUY", availableCash: 10, targets: [{ symbol: "TEST" }] }, [], [], [filledSell]);
    expect(plan.totals.orderCount).toBe(0);
    expect(plan.totals.estimatedCharges).toBe(0);
    expect(plan.totals.cashAfter).toBeCloseTo(-108.49);
  });
});
