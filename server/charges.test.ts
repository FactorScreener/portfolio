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
