import { applyCap, CAP, normalise } from "../shared/weights.ts";
import type { DhanHolding } from "./dhan.ts";
import { resolve, type Instrument } from "./instruments.ts";
import { getQuotes, type Quote } from "./quotes.ts";

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
  currentQty: number;
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
    holdingsValue: number;
    availableCash: number;
    investableBase: number;
    /** Value of orders that will actually be sent. */
    tradeValue: number;
    orderCount: number;
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

export async function buildPlan(
  req: PlanRequest,
  holdings: DhanHolding[],
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

  // ---- Prices ------------------------------------------------------------
  const holdingBySymbol = new Map<string, DhanHolding>();
  for (const h of holdings) {
    holdingBySymbol.set(h.tradingSymbol.trim().toUpperCase(), h);
  }

  const universe = new Set<string>([...holdingBySymbol.keys(), ...resolved.keys()]);
  // Dhan's holdings feed already carries a real-time LTP, so Yahoo is only
  // needed for names not currently held.
  const needQuote = [...universe].filter((s) => !holdingBySymbol.has(s));

  let quotes = new Map<string, Quote>();
  try {
    quotes = await getQuotes(needQuote);
  } catch (e) {
    warnings.push(`Price lookup failed: ${(e as Error).message}`);
  }

  const priceOf = (
    symbol: string,
  ): { price: number | null; source: "dhan" | "yahoo" | null } => {
    const h = holdingBySymbol.get(symbol);
    if (h && h.lastTradedPrice > 0) return { price: h.lastTradedPrice, source: "dhan" };
    const q = quotes.get(symbol);
    if (q && q.price > 0) return { price: q.price, source: "yahoo" };
    return { price: null, source: null };
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
  let holdingsValue = 0;
  for (const [s, h] of holdingBySymbol) {
    const { price } = priceOf(s);
    holdingsValue += h.totalQty * (price ?? h.lastTradedPrice ?? h.avgCostPrice);
  }

  const availableCash = Math.max(0, req.availableCash);
  const investableBase = holdingsValue + availableCash;
  const buffer = Math.min(0.2, Math.max(0, req.cashBufferPct));
  const targetWeightSum = [...weights.values()].reduce((s, v) => s + v, 0);

  // ---- Per-name drift ----------------------------------------------------
  const drafts: PlanRow[] = [];

  for (const symbol of [...universe].sort()) {
    const h = holdingBySymbol.get(symbol);
    const inst = resolved.get(symbol)?.inst ?? resolve(symbol);
    const { price, source } = priceOf(symbol);
    const currentQty = h?.totalQty ?? 0;
    const availableQty = h?.availableQty ?? 0;
    const currentValue = price !== null ? currentQty * price : 0;
    const targetWeight = weights.get(symbol) ?? 0;
    const targetValue = investableBase * targetWeight * (1 - buffer);

    drafts.push({
      symbol,
      name: inst?.name ?? null,
      securityId: inst?.security_id ?? h?.securityId ?? null,
      price,
      priceSource: source,
      currentQty,
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
        d.skipped = "Shares not yet settled (T1)";
        continue;
      }
      if (qty < wanted) {
        warnings.push(
          `${d.symbol}: only ${d.availableQty} of ${wanted} shares are settled and sellable today.`,
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
    const spendable = availableCash;
    if (idealTotal > spendable) {
      warnings.push(
        `Buy leg wants ₹${Math.round(idealTotal).toLocaleString("en-IN")} but only ₹${Math.round(spendable).toLocaleString("en-IN")} is available — orders are scaled down proportionally.`,
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

  return {
    side: req.side,
    rows,
    totals: {
      holdingsValue,
      availableCash,
      investableBase,
      tradeValue,
      orderCount: traded.length,
      cashAfter:
        req.side === "BUY" ? availableCash - tradeValue : availableCash + tradeValue,
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
