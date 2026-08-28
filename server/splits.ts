import type { DhanHolding } from "./dhan.ts";

export type SplitEvent = {
  /** New shares per old share. 2-for-1 => 2. */
  ratio: number;
  /** Ex-date, epoch ms. */
  atMs: number;
};

/** Keep rewriting Dhan's book this many IST days after the ex-date. */
export const SPLIT_REWRITE_DAYS = 14;

const IST_OFFSET_MIN = 330;

export function istYmd(now = new Date()): string {
  const ist = new Date(now.getTime() + (IST_OFFSET_MIN + now.getTimezoneOffset()) * 60_000);
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const d = String(ist.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "2:1" means two new shares for each old one. */
export function parseSplitRatio(text: string): number {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!m) return NaN;
  const neu = Number(m[1]);
  const old = Number(m[2]);
  if (!(neu > 0 && old > 0)) return NaN;
  return neu / old;
}

export function splitRewriteActive(atMs: number, now = new Date(), windowDays = SPLIT_REWRITE_DAYS): boolean {
  if (!Number.isFinite(atMs) || atMs <= 0) return false;
  const today = istYmd(now);
  const ex = istYmd(new Date(atMs));
  const until = istYmd(new Date(atMs + windowDays * 86_400_000));
  return today >= ex && today <= until;
}

/**
 * Dhan sometimes updates LTP on ex-date while quantity and average stay on the
 * old share. The tell is the average: unadjusted it sits near ratio × LTP,
 * adjusted it sits near LTP (a winner or loser, not twice the print).
 *
 * Yahoo printing the old price is not enough. That only means Yahoo is stale;
 * it does not mean Dhan's quantity is still pre-split.
 */
export function dhanNeedsSplitRewrite(input: {
  avgCost: number;
  ltp: number;
  ratio: number;
  yahooPrice?: number | null;
}): boolean {
  const { avgCost, ltp, ratio } = input;
  if (!(ratio > 1.001 && avgCost > 0 && ltp > 0)) return false;

  const rel = avgCost / ltp;
  const nearerOldShare = Math.abs(rel - ratio) < Math.abs(rel - 1);
  // For a 2-for-1, avg must be at least ~1.4× LTP before we touch quantity.
  const clearlyOld = rel >= 1 + (ratio - 1) * 0.4;
  return nearerOldShare && clearlyOld;
}

export function splitRatiosForHoldings(
  holdings: DhanHolding[],
  events: Map<string, SplitEvent>,
  yahooPriceBySymbol: Map<string, { price: number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of holdings) {
    const symbol = h.tradingSymbol.trim().toUpperCase();
    const ev = events.get(symbol);
    if (!ev) continue;
    const yahoo = yahooPriceBySymbol.get(symbol)?.price ?? null;
    if (
      dhanNeedsSplitRewrite({
        avgCost: h.avgCostPrice,
        ltp: h.lastTradedPrice,
        ratio: ev.ratio,
        yahooPrice: yahoo,
      })
    ) {
      out.set(symbol, ev.ratio);
    }
  }
  return out;
}

export function splitHoldingWarning(symbol: string, ratio: number, rawQty: number, adjustedQty: number): string {
  return `${symbol}: Dhan still reports ${rawQty} shares at the pre-split average. Applied ${ratio}-for-1 (${rawQty} → ${adjustedQty}) so current value is LTP × post-split shares. Sellable quantity is unchanged — Dhan will not deliver the extra shares until the demat credit lands.`;
}
