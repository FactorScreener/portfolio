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
    totalQty: 100,
    dpQty: 100,
    t1Qty: 0,
    availableQty: 100,
    collateralQty: 0,
    avgCostPrice: 400,
    lastTradedPrice: 320,
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
  test("rewrites when average is still on the old share", () => {
    expect(
      dhanNeedsSplitRewrite({ avgCost: 400, ltp: 320, ratio: 2 }),
    ).toBe(true);
  });

  test("skips when Dhan has already halved the average", () => {
    expect(
      dhanNeedsSplitRewrite({ avgCost: 200, ltp: 320, ratio: 2 }),
    ).toBe(false);
  });

  test("rewrites when Yahoo is still on the old print and Dhan LTP is not", () => {
    expect(
      dhanNeedsSplitRewrite({ avgCost: 200, ltp: 320, ratio: 2, yahooPrice: 640 }),
    ).toBe(true);
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
    expect(e.holdingQty).toBe(200);
    expect(e.totalQty).toBe(200);
    expect(e.invested).toBe(40_000);
    expect(e.avgCostPrice).toBe(200);
    expect(e.lastTradedPrice).toBe(320);
    expect(e.totalQty * e.lastTradedPrice).toBe(64_000);
    expect(e.splitRatio).toBe(2);
    expect(e.settledQty).toBe(100);
    expect(e.sellableQty).toBe(100);
  });

  test("leaves the holding alone when no split ratio is supplied", () => {
    const e = buildExposure([holding()], []).get("TDPOWERSYS")!;
    expect(e.holdingQty).toBe(100);
    expect(e.avgCostPrice).toBe(400);
    expect(e.splitRatio).toBe(1);
  });

  test("splitRatiosForHoldings only flags names whose book still looks pre-split", () => {
    const ev: SplitEvent = { ratio: 2, atMs: Date.parse("2026-08-24T00:00:00+05:30") };
    const events = new Map([["TDPOWERSYS", ev]]);
    const quotes = new Map([["TDPOWERSYS", { price: 320 }]]);
    const unadjusted = splitRatiosForHoldings([holding()], events, quotes);
    expect(unadjusted.get("TDPOWERSYS")).toBe(2);
    const adjusted = splitRatiosForHoldings(
      [holding({ avgCostPrice: 200 })],
      events,
      quotes,
    );
    expect(adjusted.has("TDPOWERSYS")).toBe(false);
  });
});
