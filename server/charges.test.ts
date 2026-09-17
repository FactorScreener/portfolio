import { describe, expect, test } from "bun:test";
import { estimateNseCncBuyCharges, maxBuyNotional } from "./charges.ts";

describe("NSE CNC buy charges", () => {
  test("₹1 lakh of delivery buys matches Dhan's statutory stack", () => {
    // STT ₹100, stamp ₹15, NSE txn ₹3.07, SEBI ₹0.10, GST ₹0.57
    expect(estimateNseCncBuyCharges(100_000)).toBe(118.74);
  });

  test("max notional plus fees on that notional still fits in cash", () => {
    const cash = 84_320.5;
    const t = maxBuyNotional(cash);
    expect(t + estimateNseCncBuyCharges(t)).toBeLessThanOrEqual(cash);
    expect(t).toBe(cash - estimateNseCncBuyCharges(cash));
  });

  test("empty cash spends nothing", () => {
    expect(maxBuyNotional(0)).toBe(0);
  });
});

import { estimateNseCncSellCharges, estimateTodaysCharges } from "./charges.ts";
import type { DhanOrder } from "./dhan.ts";

function order(overrides: Partial<DhanOrder> = {}): DhanOrder {
  return {
    dhanClientId: "test", orderId: "1", orderStatus: "TRADED",
    transactionType: "SELL", exchangeSegment: "NSE_EQ", productType: "CNC",
    orderType: "MARKET", tradingSymbol: "TEST", securityId: "1",
    quantity: 100, price: 0, averageTradedPrice: 1000, filledQty: 100,
    createTime: "", updateTime: "", ...overrides,
  };
}

describe("delivery sell and same-day reserves", () => {
  test("₹1 lakh sale includes STT and DP with GST, but no stamp duty", () => {
    expect(estimateNseCncSellCharges(100_000, 1)).toBe(118.49);
    expect(estimateNseCncSellCharges(100_000, 2)).toBe(133.24);
    expect(estimateNseCncSellCharges(0, 1)).toBe(0);
  });

  test("partial fills on cancelled orders count; unfilled and other products do not", () => {
    const prior = estimateTodaysCharges([
      order({ orderStatus: "CANCELLED", filledQty: 50 }),
      order({ orderStatus: "REJECTED", filledQty: 0 }),
      order({ orderStatus: "PENDING", filledQty: 0 }),
      order({ productType: "INTRADAY" }),
      order({ exchangeSegment: "NSE_FNO" }),
    ]);
    expect(prior.sellTurnover).toBe(50_000);
    expect(prior.sellInstructions).toBe(1);
    expect(prior.charges).toBe(66.61);
  });

  test("sell then repeated buys leave enough cash for all same-day charges", () => {
    const prior = estimateTodaysCharges([order(), order({ transactionType: "BUY", filledQty: 20 })]);
    const cash = 80_000;
    const spend = maxBuyNotional(cash - prior.charges, prior.buyTurnover);
    const incrementalBuyFees = estimateNseCncBuyCharges(prior.buyTurnover + spend)
      - estimateNseCncBuyCharges(prior.buyTurnover);
    expect(spend + prior.charges + incrementalBuyFees).toBeLessThanOrEqual(cash);
    expect(spend).toBeLessThan(maxBuyNotional(cash));
    expect(maxBuyNotional(10 - prior.charges)).toBe(0);
    expect(estimateTodaysCharges([]).charges).toBe(0);
  });

  test("a missing fill price cannot silently remove the reserve", () => {
    expect(() => estimateTodaysCharges([order({ averageTradedPrice: 0 })])).toThrow();
  });
});
