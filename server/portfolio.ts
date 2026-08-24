import type { DhanHolding, DhanPosition } from "./dhan.ts";

/**
 * Holdings and positions describe the same portfolio at two different points in
 * the settlement cycle: the holdings feed is what has settled into the demat
 * account, positions are today's trades that have not got there yet. Anything
 * bought today shows up only in positions, and shares sold today still show up
 * in holdings with a matching negative position — so real exposure is the sum
 * of the two, and counting only holdings double-buys what you already bought
 * this morning.
 */

/** Cash-segment positions are the only ones this app can act on. */
const EQUITY_SEGMENTS = new Set(["NSE_EQ", "BSE_EQ"]);

/** Product types whose shares a plain CNC sell order can actually deliver. */
const DELIVERABLE_PRODUCTS = new Set(["CNC"]);

export type Exposure = {
  symbol: string;
  securityId: string | null;
  isin: string | null;
  /** Settled shares from the holdings feed. */
  holdingQty: number;
  /** Of those, the ones free to sell today (dpQty; T1 stock is not). */
  settledQty: number;
  /** Net of today's open cash-segment positions; negative if net short. */
  positionQty: number;
  /** The slice of `positionQty` a CNC sell can deliver today. */
  deliverablePositionQty: number;
  /** holdingQty + positionQty — what you are actually exposed to right now. */
  totalQty: number;
  /** settledQty + today's deliverable long positions. */
  sellableQty: number;
  invested: number;
  avgCostPrice: number;
  /** Dhan's LTP from the holdings feed, when there is a holding. */
  lastTradedPrice: number;
  /** Booked P&L on today's closed quantity. */
  realizedPnl: number;
  /** Dhan's standing P&L on the open position, i.e. move since today's fill. */
  positionUnrealizedPnl: number;
  /** Product types backing the open position, e.g. ["CNC", "MTF"]. */
  positionProducts: string[];
  /** True when part of the exposure sits in a product a CNC sell cannot touch. */
  hasUntradeablePosition: boolean;
  /** Holdings qty multiplier applied for an unadjusted split. 1 if none. */
  splitRatio: number;
};

const key = (s: string) => s.trim().toUpperCase();

/** Open cash-segment positions only — closed rows and F&O are dropped. */
export function openEquityPositions(positions: DhanPosition[]): DhanPosition[] {
  return positions.filter(
    (p) =>
      EQUITY_SEGMENTS.has(p.exchangeSegment) &&
      p.positionType !== "CLOSED" &&
      Number(p.netQty) !== 0,
  );
}

/** Open positions this app deliberately ignores (F&O, currency, commodity). */
export function nonEquityPositions(positions: DhanPosition[]): DhanPosition[] {
  return positions.filter(
    (p) =>
      !EQUITY_SEGMENTS.has(p.exchangeSegment) &&
      p.positionType !== "CLOSED" &&
      Number(p.netQty) !== 0,
  );
}

/** Realized P&L booked today, across every position row including closed ones. */
export function realizedToday(positions: DhanPosition[]): number {
  return positions
    .filter((p) => EQUITY_SEGMENTS.has(p.exchangeSegment))
    .reduce((s, p) => s + (Number(p.realizedProfit) || 0), 0);
}

/**
 * Merge the two feeds into one row per symbol. Symbols appear here if they are
 * held, or open in positions, or both.
 */
export function buildExposure(
  holdings: DhanHolding[],
  positions: DhanPosition[],
  splitRatios: Map<string, number> = new Map(),
): Map<string, Exposure> {
  const open = openEquityPositions(positions);
  const out = new Map<string, Exposure>();

  const blank = (symbol: string): Exposure => ({
    symbol,
    securityId: null,
    isin: null,
    holdingQty: 0,
    settledQty: 0,
    positionQty: 0,
    deliverablePositionQty: 0,
    totalQty: 0,
    sellableQty: 0,
    invested: 0,
    avgCostPrice: 0,
    lastTradedPrice: 0,
    realizedPnl: 0,
    positionUnrealizedPnl: 0,
    positionProducts: [],
    hasUntradeablePosition: false,
    splitRatio: 1,
  });

  const row = (symbol: string): Exposure => {
    let e = out.get(symbol);
    if (!e) {
      e = blank(symbol);
      out.set(symbol, e);
    }
    return e;
  };

  for (const h of holdings) {
    const e = row(key(h.tradingSymbol));
    const ratio = splitRatios.get(key(h.tradingSymbol)) ?? 1;
    e.securityId = h.securityId;
    e.isin = h.isin;
    e.splitRatio = Math.max(e.splitRatio, ratio);
    // Qty and average stay on the old share while LTP is already post-split.
    // Invested is qty × avg, so leave it on Dhan's figures; multiplying qty
    // alone halves the implied average and doubles current value (qty × LTP).
    e.holdingQty += h.totalQty * ratio;
    // availableQty is the free-to-sell slice; T1 stock cannot be delivered yet.
    // Extra split shares are not deliverable until the demat credit lands.
    e.settledQty += h.availableQty;
    e.invested += h.totalQty * h.avgCostPrice;
    e.lastTradedPrice = h.lastTradedPrice;
  }

  // Longs and shorts are netted per symbol before costing, so a CNC long and an
  // intraday short in the same name collapse to the exposure that remains.
  const legs = new Map<
    string,
    { longQty: number; longCost: number; shortQty: number; shortValue: number }
  >();

  for (const p of open) {
    const symbol = key(p.tradingSymbol);
    const e = row(symbol);
    const net = Number(p.netQty);
    // Only NSE ids are usable — every order this app places is NSE cash.
    if (e.securityId === null && p.exchangeSegment === "NSE_EQ") e.securityId = p.securityId;
    e.positionQty += net;
    e.positionUnrealizedPnl += Number(p.unrealizedProfit) || 0;
    if (!e.positionProducts.includes(p.productType)) e.positionProducts.push(p.productType);
    if (DELIVERABLE_PRODUCTS.has(p.productType)) e.deliverablePositionQty += net;
    else if (net > 0) e.hasUntradeablePosition = true;

    const l = legs.get(symbol) ?? { longQty: 0, longCost: 0, shortQty: 0, shortValue: 0 };
    if (net > 0) {
      l.longQty += net;
      l.longCost += net * p.buyAvg;
    } else {
      l.shortQty += -net;
      l.shortValue += -net * p.sellAvg;
    }
    legs.set(symbol, l);
  }

  for (const [symbol, p] of legs) {
    const e = out.get(symbol)!;
    const net = e.positionQty;
    if (net > 0) {
      // Cost the surviving longs at their own average buy price.
      const avg = p.longQty > 0 ? p.longCost / p.longQty : 0;
      e.invested += net * avg;
    } else if (net < 0) {
      // Shares sold today are still in the holdings feed, so retire them at the
      // holding's own cost — the gain on them is realized, not unrealized. Only
      // a genuine short beyond the holding is marked at its sale price.
      const holdingAvg = e.holdingQty > 0 ? e.invested / e.holdingQty : 0;
      const fromHolding = Math.min(-net, e.holdingQty);
      const shortOnly = -net - fromHolding;
      const shortAvg = p.shortQty > 0 ? p.shortValue / p.shortQty : 0;
      e.invested -= fromHolding * holdingAvg + shortOnly * shortAvg;
    }
  }

  for (const p of positions) {
    if (!EQUITY_SEGMENTS.has(p.exchangeSegment)) continue;
    const e = out.get(key(p.tradingSymbol));
    if (e) e.realizedPnl += Number(p.realizedProfit) || 0;
  }

  for (const e of out.values()) {
    e.totalQty = e.holdingQty + e.positionQty;
    // Never offer to sell more than the net exposure, even when the demat
    // account holds more than that (an intraday short against stock, say).
    e.sellableQty = Math.max(
      0,
      Math.min(e.settledQty + Math.max(0, e.deliverablePositionQty), e.totalQty),
    );
    e.avgCostPrice = e.totalQty !== 0 ? e.invested / e.totalQty : 0;
    e.positionProducts.sort();
  }

  return out;
}
