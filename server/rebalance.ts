import { applyCap, CAP, normalise } from "../shared/weights.ts";
import { estimateNseCncBuyCharges, maxBuyNotional } from "./charges.ts";
import type { DhanHolding, DhanPosition } from "./dhan.ts";
import { resolve, type Instrument } from "./instruments.ts";
import { buildExposure, nonEquityPositions } from "./portfolio.ts";
import { pickMarkPrice } from "./mark.ts";
import { getQuotes, getSplitEvents, type Quote } from "./quotes.ts";
import { splitHoldingWarning, splitRatiosForHoldings } from "./splits.ts";

export type Side = "BUY" | "SELL";

export type TargetInput = {
  symbol: string;
  /** Raw value from the chosen CSV column. Absent means equal weight. */
  rawWeight?: number | null;
};

export type PlanRequest = {
  side: Side;
  targets: TargetInput[];
  /** Normalise the CSV column into weights, or ignore it and split evenly. */
  weightMode: "equal" | "column";
  capAt5Pct: boolean;
  /** Fraction of investable value held back for slippage on BUY. */
  cashBufferPct: number;
  /** Cash the BUY leg may spend. Defaults to Dhan's available balance. */
  availableCash: number;
  /** Ignore rows whose order value is under this, to avoid dust trades. */
  minOrderValue: number;
};

export type PlanRow = {
  symbol: string;
  name: string | null;
  securityId: string | null;
  price: number | null;
  priceSource: "dhan" | "yahoo" | null;
  /** Settled holding + today's open position — the real exposure. */
  currentQty: number;
  /** The holdings-feed slice of `currentQty`. */
  holdingQty: number;
  /** The open-position slice of `currentQty`; negative if sold today. */
  positionQty: number;
  /** What a CNC sell can actually deliver today. */
  availableQty: number;
  currentValue: number;
  targetWeight: number;
  currentWeight: number;
  targetValue: number;
  driftValue: number;
  side: Side | null;
  quantity: number;
  orderValue: number;
  /** Why this row will not be traded, if it will not be. */
  skipped: string | null;
  action: "buy" | "sell" | "exit" | "hold" | "blocked";
};

export type Plan = {
  side: Side;
  rows: PlanRow[];
  totals: {
    /** Holdings plus open positions, marked to market. */
    portfolioValue: number;
    /** The open-position slice of `portfolioValue`. */
    positionsValue: number;
    availableCash: number;
    investableBase: number;
    /** Value of orders that will actually be sent. */
    tradeValue: number;
    orderCount: number;
    /** Statutory NSE CNC buy charges on `tradeValue`. Zero on a sell run. */
    estimatedCharges: number;
    /** Cash the BUY leg refused to spend so statutory charges still fit. */
    cashReserved: number;
    cashAfter: number;
    targetWeightSum: number;
  };
  unresolved: string[];
  warnings: string[];
  pricing: {
    marketOpen: boolean;
    marketState: string;
    delayedByMinutes: number | null;
    /** Newest Yahoo print used, epoch ms. */
    latestQuoteTime: number | null;
    allIntraday: boolean;
  };
};

/** Why a name with real exposure still cannot be sold today. */
function blockedReason(d: PlanRow): string {
  if (d.holdingQty <= 0 && d.positionQty > 0) {
    return "Bought today in a non-delivery product";
  }
  if (d.holdingQty > 0 && d.positionQty < 0) return "Already sold today";
  return "Shares not yet settled (T1)";
}

export async function buildPlan(
  req: PlanRequest,
  holdings: DhanHolding[],
  positions: DhanPosition[] = [],
): Promise<Plan> {
  const warnings: string[] = [];
  const unresolved: string[] = [];

  // ---- Resolve targets to NSE instruments -------------------------------
  const resolved = new Map<string, { inst: Instrument; raw: number | null }>();
  for (const t of req.targets) {
    const inst = resolve(t.symbol);
    if (!inst) {
      unresolved.push(t.symbol.trim().toUpperCase());
      continue;
    }
    const raw = t.rawWeight ?? null;
    const prev = resolved.get(inst.symbol);
    if (prev) {
      // Same name listed twice — add the column values rather than dropping one.
      prev.raw = (prev.raw ?? 0) + (raw ?? 0);
    } else {
      resolved.set(inst.symbol, { inst, raw });
    }
  }
  if (unresolved.length > 0) {
    warnings.push(
      `${unresolved.length} ticker${unresolved.length > 1 ? "s" : ""} not found on NSE cash segment and excluded from the weights.`,
    );
  }

  // ---- Target weights ----------------------------------------------------
  let weights = new Map<string, number>();
  if (req.weightMode === "column") {
    const usable = [...resolved].filter(([, v]) => (v.raw ?? 0) > 0);
    if (usable.length === 0) {
      warnings.push("Weight column had no positive values — fell back to equal weight.");
      for (const s of resolved.keys()) weights.set(s, 1);
    } else {
      if (usable.length < resolved.size) {
        warnings.push(
          `${resolved.size - usable.length} row(s) had a zero, blank or negative weight and were dropped.`,
        );
      }
      for (const [s, v] of usable) weights.set(s, v.raw as number);
    }
  } else {
    for (const s of resolved.keys()) weights.set(s, 1);
  }
  weights = normalise(weights);

  if (req.capAt5Pct) {
    const n = weights.size;
    weights = applyCap(weights, CAP);
    if (n > 0 && n < 1 / CAP) {
      warnings.push(
        `Only ${n} names with a ${(CAP * 100).toFixed(0)}% cap, so the basket can hold at most ${(n * CAP * 100).toFixed(0)}% — the rest stays in cash.`,
      );
    }
  }

  // ---- Current exposure --------------------------------------------------
  // Holdings alone under-count: shares bought today sit in positions until
  // they settle, and shares sold today are still in holdings.
  const holdingSymbols = [
    ...new Set(holdings.map((h) => h.tradingSymbol.trim().toUpperCase()).filter(Boolean)),
  ];

  let quotes = new Map<string, Quote>();
  try {
    quotes = await getQuotes(holdingSymbols);
  } catch (e) {
    warnings.push(`Price lookup failed: ${(e as Error).message}`);
  }

  let splitEvents = new Map<string, Awaited<ReturnType<typeof getSplitEvents>> extends Map<string, infer V> ? V : never>();
  try {
    splitEvents = await getSplitEvents(holdingSymbols, quotes);
  } catch (e) {
    warnings.push(`Split lookup failed: ${(e as Error).message}`);
  }

  const exposures = buildExposure(
    holdings,
    positions,
    splitRatiosForHoldings(holdings, splitEvents, quotes),
  );

  const untradeable = [...exposures.values()].filter((e) => e.hasUntradeablePosition);
  if (untradeable.length > 0) {
    warnings.push(
      `${untradeable.map((e) => e.symbol).slice(0, 4).join(", ")}${untradeable.length > 4 ? ` +${untradeable.length - 4} more` : ""} hold ${[...new Set(untradeable.flatMap((e) => e.positionProducts))].filter((p) => p !== "CNC").join("/")} positions — they count toward your exposure, but this rebalancer only places CNC orders and cannot square them off.`,
    );
  }
  const derivatives = nonEquityPositions(positions);
  if (derivatives.length > 0) {
    warnings.push(
      `${derivatives.length} open F&O / non-cash position${derivatives.length > 1 ? "s are" : " is"} ignored — this rebalancer only works on the equity cash segment.`,
    );
  }

  const splitAdjusted = [...exposures.values()].filter((e) => e.splitRatio > 1);
  for (const e of splitAdjusted) {
    const rawQty = e.holdingQty / e.splitRatio;
    warnings.push(splitHoldingWarning(e.symbol, e.splitRatio, rawQty, e.holdingQty));
  }

  // ---- Prices ------------------------------------------------------------
  const universe = new Set<string>([...exposures.keys(), ...resolved.keys()]);
  // Dhan's holdings feed already carries a live LTP. Yahoo is only needed for
  // names with no settled holding behind them.

  const needQuote = [...universe].filter(
    (s) => !quotes.has(s) && !((exposures.get(s)?.lastTradedPrice ?? 0) > 0),
  );

  if (needQuote.length > 0) {
    try {
      const extra = await getQuotes(needQuote);
      for (const [k, v] of extra) quotes.set(k, v);
    } catch (e) {
      warnings.push(`Price lookup failed: ${(e as Error).message}`);
    }
  }

  const priceOf = (
    symbol: string,
  ): { price: number | null; source: "dhan" | "yahoo" | null } => {
    const e = exposures.get(symbol);
    return pickMarkPrice(e?.lastTradedPrice ?? 0, quotes.get(symbol));
  };

  const quoteList = [...quotes.values()];
  const marketOpen = quoteList.some((q) => q.marketState === "REGULAR");
  const latestQuoteTime = quoteList.reduce<number | null>(
    (m, q) => (q.quoteTime && (m === null || q.quoteTime > m) ? q.quoteTime : m),
    null,
  );
  const missingPrice = [...universe].filter((s) => priceOf(s).price === null);
  if (missingPrice.length > 0) {
    warnings.push(`No price for ${missingPrice.slice(0, 6).join(", ")}${missingPrice.length > 6 ? ` +${missingPrice.length - 6} more` : ""}; those rows are blocked.`);
  }

  // ---- Base --------------------------------------------------------------
  let portfolioValue = 0;
  let positionsValue = 0;
  for (const [s, e] of exposures) {
    const mark = priceOf(s).price ?? e.lastTradedPrice ?? e.avgCostPrice;
    portfolioValue += e.totalQty * mark;
    positionsValue += e.positionQty * mark;
  }

  const availableCash = Math.max(0, req.availableCash);
  const investableBase = portfolioValue + availableCash;
  const buffer = Math.min(0.2, Math.max(0, req.cashBufferPct));
  const targetWeightSum = [...weights.values()].reduce((s, v) => s + v, 0);

  // ---- Per-name drift ----------------------------------------------------
  const drafts: PlanRow[] = [];

  for (const symbol of [...universe].sort()) {
    const e = exposures.get(symbol);
    const inst = resolved.get(symbol)?.inst ?? resolve(symbol);
    const { price, source } = priceOf(symbol);
    const currentQty = e?.totalQty ?? 0;
    const availableQty = e?.sellableQty ?? 0;
    const currentValue = price !== null ? currentQty * price : 0;
    const targetWeight = weights.get(symbol) ?? 0;
    const targetValue = investableBase * targetWeight * (1 - buffer);

    drafts.push({
      symbol,
      name: inst?.name ?? null,
      securityId: inst?.security_id ?? e?.securityId ?? null,
      price,
      priceSource: source,
      currentQty,
      holdingQty: e?.holdingQty ?? 0,
      positionQty: e?.positionQty ?? 0,
      availableQty,
      currentValue,
      targetWeight,
      currentWeight: investableBase > 0 ? currentValue / investableBase : 0,
      targetValue,
      driftValue: targetValue - currentValue,
      side: null,
      quantity: 0,
      orderValue: 0,
      skipped: null,
      action: "hold",
    });
  }

  // ---- Size the orders ---------------------------------------------------
  if (req.side === "SELL") {
    for (const d of drafts) {
      if (d.currentQty <= 0) continue;
      if (d.price === null || d.securityId === null) {
        d.action = d.currentQty > 0 ? "blocked" : "hold";
        d.skipped = d.price === null ? "No live price" : "Not on NSE cash segment";
        continue;
      }
      if (d.driftValue >= 0) continue; // at or below target — nothing to sell

      // A name that dropped out of the basket is exited whole, so float
      // rounding cannot strand a single share.
      const wanted =
        d.targetWeight === 0
          ? d.currentQty
          : Math.floor(-d.driftValue / d.price);
      if (wanted <= 0) continue;

      const qty = Math.min(wanted, d.availableQty);
      if (qty <= 0) {
        d.action = "blocked";
        d.skipped = blockedReason(d);
        continue;
      }
      if (qty < wanted) {
        warnings.push(
          `${d.symbol}: only ${d.availableQty} of ${wanted} shares can be delivered today (${d.holdingQty} held, ${d.positionQty > 0 ? `${d.positionQty} bought today` : "none bought today"}).`,
        );
      }
      const value = qty * d.price;
      if (value < req.minOrderValue) {
        d.skipped = `Below ₹${req.minOrderValue} minimum`;
        continue;
      }

      d.side = "SELL";
      d.quantity = qty;
      d.orderValue = value;
      d.action = d.targetWeight === 0 || qty >= d.currentQty ? "exit" : "sell";
    }
  } else {
    const spendable = maxBuyNotional(availableCash);
    const heldBack = Math.max(0, availableCash - spendable);

    const candidates = drafts.filter(
      (d) => d.targetWeight > 0 && d.driftValue > 0 && d.price !== null && d.securityId,
    );

    for (const d of drafts) {
      if (d.targetWeight > 0 && d.driftValue > 0 && (d.price === null || !d.securityId)) {
        d.action = "blocked";
        d.skipped = d.price === null ? "No live price" : "Not on NSE cash segment";
      }
    }

    const idealTotal = candidates.reduce((s, d) => s + d.driftValue, 0);
    if (heldBack > 0 && spendable > 0 && idealTotal > 0) {
      warnings.push(
        `Holding back ₹${Math.round(heldBack).toLocaleString("en-IN")} so STT, stamp duty and exchange fees do not push the balance below zero.`,
      );
    }
    if (idealTotal > spendable) {
      warnings.push(
        `Buy leg wants ₹${Math.round(idealTotal).toLocaleString("en-IN")} but only ₹${Math.round(spendable).toLocaleString("en-IN")} is spendable after the fee buffer — orders are scaled down proportionally.`,
      );
    }
    const scale = idealTotal > 0 ? Math.min(1, spendable / idealTotal) : 0;

    let cash = spendable;
    for (const d of candidates) {
      const qty = Math.floor((d.driftValue * scale) / d.price!);
      if (qty <= 0) continue;
      const cost = qty * d.price!;
      if (cost > cash) continue;
      d.quantity = qty;
      cash -= cost;
    }

    // Flooring leaves change on the table. Hand it out one share at a time to
    // whichever name is furthest below its target.
    for (let i = 0; i < 2000; i++) {
      const best = candidates
        .filter((d) => d.price! <= cash && d.driftValue - d.quantity * d.price! > 0)
        .sort(
          (a, b) =>
            b.driftValue - b.quantity * b.price! - (a.driftValue - a.quantity * a.price!),
        )[0];
      if (!best) break;
      best.quantity += 1;
      cash -= best.price!;
    }

    for (const d of candidates) {
      if (d.quantity <= 0) continue;
      const value = d.quantity * d.price!;
      if (value < req.minOrderValue) {
        d.quantity = 0;
        d.skipped = `Below ₹${req.minOrderValue} minimum`;
        continue;
      }
      d.side = "BUY";
      d.orderValue = value;
      d.action = "buy";
    }
  }

  const rows = drafts;
  const traded = rows.filter((r) => r.side && r.quantity > 0);
  const tradeValue = traded.reduce((s, r) => s + r.orderValue, 0);
  const estimatedCharges =
    req.side === "BUY" ? estimateNseCncBuyCharges(tradeValue) : 0;
  const cashReserved =
    req.side === "BUY" ? Math.max(0, availableCash - maxBuyNotional(availableCash)) : 0;

  return {
    side: req.side,
    rows,
    totals: {
      portfolioValue,
      positionsValue,
      availableCash,
      investableBase,
      tradeValue,
      orderCount: traded.length,
      estimatedCharges,
      cashReserved,
      cashAfter:
        req.side === "BUY"
          ? availableCash - tradeValue - estimatedCharges
          : availableCash + tradeValue,
      targetWeightSum,
    },
    unresolved,
    warnings,
    pricing: {
      marketOpen,
      marketState: quoteList[0]?.marketState ?? (marketOpen ? "REGULAR" : "CLOSED"),
      delayedByMinutes: quoteList.find((q) => q.delayedByMinutes != null)?.delayedByMinutes ?? null,
      latestQuoteTime,
      allIntraday: quoteList.length === 0 || quoteList.every((q) => q.intraday),
    },
  };
}
