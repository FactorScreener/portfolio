import { describe, expect, test } from "bun:test";
import { buildExposure } from "./portfolio.ts";
import type { DhanHolding } from "./dhan.ts";
import {
  dhanNeedsSplitRewrite,
  parseSplitRatio,
  splitRatiosForHoldings,
  splitRewriteActive,
  type SplitEvent,
} from "./splits.ts";

function holding(over: Partial<DhanHolding> = {}): DhanHolding {
  return {
    exchange: "NSE",
    tradingSymbol: "TDPOWERSYS",
    securityId: "123",
    isin: "INE",
    totalQty: 95,
    dpQty: 95,
    t1Qty: 0,
    availableQty: 95,
    collateralQty: 0,
    avgCostPrice: 1216.18,
    lastTradedPrice: 752.7,
    ...over,
  };
}

describe("parseSplitRatio", () => {
  test("reads 2:1 as two new shares per old share", () => {
    expect(parseSplitRatio("2:1")).toBe(2);
  });

  test("reads 5:2", () => {
    expect(parseSplitRatio("5:2")).toBe(2.5);
  });
});

describe("splitRewriteActive", () => {
  const ex = Date.parse("2026-08-24T00:00:00+05:30");

  test("is active on the ex-date and two weeks later, not the day before", () => {
    expect(splitRewriteActive(ex, new Date("2026-08-23T15:00:00+05:30"))).toBe(false);
    expect(splitRewriteActive(ex, new Date("2026-08-24T09:30:00+05:30"))).toBe(true);
    expect(splitRewriteActive(ex, new Date("2026-09-07T09:30:00+05:30"))).toBe(true);
    expect(splitRewriteActive(ex, new Date("2026-09-08T09:30:00+05:30"))).toBe(false);
  });
});

describe("dhanNeedsSplitRewrite", () => {
  test("rewrites when average is still the pre-split price", () => {
    expect(
      dhanNeedsSplitRewrite({ avgCost: 1216.18, ltp: 752.7, ratio: 2 }),
    ).toBe(true);
  });

  test("skips when average already sits next to LTP, even if the stock is up", () => {
    expect(
      dhanNeedsSplitRewrite({
        avgCost: 627.7222,
        ltp: 752.7,
        ratio: 2,
        yahooPrice: 752.7,
      }),
    ).toBe(false);
  });

  test("does not treat a stale Yahoo print as proof that quantity is unadjusted", () => {
    expect(
      dhanNeedsSplitRewrite({ avgCost: 627.72, ltp: 752.7, ratio: 2, yahooPrice: 1505.4 }),
    ).toBe(false);
  });
});

describe("buildExposure with injected split ratios", () => {
  test("doubles quantity and halves average; LTP and invested stay put", () => {
    const map = buildExposure(
      [holding()],
      [],
      new Map([["TDPOWERSYS", 2]]),
    );
    const e = map.get("TDPOWERSYS")!;
    expect(e.holdingQty).toBe(190);
    expect(e.totalQty).toBe(190);
    expect(e.invested).toBeCloseTo(95 * 1216.18);
    expect(e.avgCostPrice).toBeCloseTo(608.09);
    expect(e.lastTradedPrice).toBe(752.7);
    expect(e.splitRatio).toBe(2);
    expect(e.settledQty).toBe(95);
    expect(e.sellableQty).toBe(95);
  });

  test("leaves the holding alone when no split ratio is supplied", () => {
    const e = buildExposure([holding()], []).get("TDPOWERSYS")!;
    expect(e.holdingQty).toBe(95);
    expect(e.avgCostPrice).toBe(1216.18);
    expect(e.splitRatio).toBe(1);
  });

  test("splitRatiosForHoldings leaves Dhan's post-split TDPOWERSYS book alone", () => {
    const ev: SplitEvent = { ratio: 2, atMs: Date.parse("2026-08-24T00:00:00+05:30") };
    const events = new Map([["TDPOWERSYS", ev]]);
    const quotes = new Map([["TDPOWERSYS", { price: 752.7 }]]);
    const unadjusted = splitRatiosForHoldings([holding()], events, quotes);
    expect(unadjusted.get("TDPOWERSYS")).toBe(2);
    const adjusted = splitRatiosForHoldings(
      [holding({ totalQty: 216, availableQty: 216, avgCostPrice: 627.7222 })],
      events,
      quotes,
    );
    expect(adjusted.has("TDPOWERSYS")).toBe(false);
  });
});
