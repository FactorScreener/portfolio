import { describe, expect, test } from "bun:test";
import { pickMarkPrice } from "./mark.ts";
import type { Quote } from "./quotes.ts";

function yahoo(price: number): Quote {
  return {
    symbol: "TDPOWERSYS",
    price,
    previousClose: price,
    marketState: "REGULAR",
    quoteTime: Date.now(),
    delayedByMinutes: 15,
    currency: "INR",
    intraday: true,
    split: null,
  };
}

describe("pickMarkPrice", () => {
  test("uses Dhan LTP even when Yahoo disagrees", () => {
    expect(pickMarkPrice(320, yahoo(640))).toEqual({
      price: 320,
      source: "dhan",
    });
  });

  test("falls back to Yahoo when Dhan LTP is missing", () => {
    expect(pickMarkPrice(0, yahoo(320))).toEqual({
      price: 320,
      source: "yahoo",
    });
  });
});
