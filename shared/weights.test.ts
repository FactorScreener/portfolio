import { describe, expect, test } from "bun:test";
import { applyCap, normalise } from "./weights.ts";

describe("inverse weights", () => {
  const volatility = new Map([["LOW", 10], ["HIGH", 20]]);

  test("lower volatility receives proportionally more weight", () => {
    const weights = normalise(volatility, true);
    expect(weights.get("LOW")).toBeCloseTo(2 / 3);
    expect(weights.get("HIGH")).toBeCloseTo(1 / 3);
    expect(volatility.get("LOW")).toBe(10);
  });

  test("turning inversion off restores direct weights", () => {
    const weights = normalise(volatility, false);
    expect(weights.get("LOW")).toBeCloseTo(1 / 3);
    expect(weights.get("HIGH")).toBeCloseTo(2 / 3);
  });

  test("invalid values never produce infinite or negative allocations", () => {
    const weights = normalise(new Map([
      ["ZERO", 0], ["NEGATIVE", -1], ["NAN", NaN], ["INFINITY", Infinity],
      ["LOW", 1e-310], ["HIGH", 2e-310],
    ]), true);
    expect(weights.size).toBe(2);
    expect(weights.get("LOW")).toBeCloseTo(2 / 3);
    expect(weights.get("HIGH")).toBeCloseTo(1 / 3);
    expect(normalise(new Map(), true).size).toBe(0);
  });

  test("cap redistributes inverse weights and leaves cash for small baskets", () => {
    const raw = new Map(Array.from({ length: 25 }, (_, i) => [String(i), i === 0 ? 1 : 10]));
    const capped = applyCap(normalise(raw, true));
    expect(capped.get("0")).toBeCloseTo(0.05);
    expect(capped.get("1")).toBeCloseTo(0.95 / 24);
    expect([...capped.values()].reduce((sum, w) => sum + w, 0)).toBeCloseTo(1);
    expect([...applyCap(normalise(volatility, true)).values()]).toEqual([0.05, 0.05]);
  });
});
