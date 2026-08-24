import YahooFinance from "yahoo-finance2";
import {
  parseSplitRatio,
  splitRewriteActive,
  type SplitEvent,
} from "./splits.ts";

const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

export type Quote = {
  symbol: string;
  price: number;
  previousClose: number | null;
  /** REGULAR while NSE is trading; PRE / POST / CLOSED otherwise. */
  marketState: string;
  /** Epoch ms of the last print Yahoo has for this symbol. */
  quoteTime: number | null;
  /** Yahoo's own claimed feed delay in minutes (15 for NSE). */
  delayedByMinutes: number | null;
  currency: string | null;
  /** True when the quote is from today's session rather than a stale close. */
  intraday: boolean;
  /** Most recent split Yahoo is advertising on this quote, if any. */
  split: SplitEvent | null;
};

type CacheEntry = { at: number; quote: Quote };
const cache = new Map<string, CacheEntry>();

/**
 * Yahoo's NSE feed is 15 minutes delayed, so caching harder than that would
 * only add staleness on top of staleness. 20s keeps the UI responsive while
 * still collapsing the burst of lookups a rebalance preview kicks off.
 */
const TTL_OPEN_MS = 20_000;
const TTL_CLOSED_MS = 5 * 60_000;

const IST_OFFSET_MIN = 330;

/** NSE cash session: 09:15–15:30 IST, Mon–Fri. */
export function nseSessionOpen(now = new Date()): boolean {
  const ist = new Date(now.getTime() + (IST_OFFSET_MIN + now.getTimezoneOffset()) * 60_000);
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

/** Start of today's IST calendar day, as epoch ms. */
function istDayStart(now = new Date()): number {
  const ist = new Date(now.getTime() + (IST_OFFSET_MIN + now.getTimezoneOffset()) * 60_000);
  ist.setHours(0, 0, 0, 0);
  return ist.getTime() - (IST_OFFSET_MIN + now.getTimezoneOffset()) * 60_000;
}

function toYahoo(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return s.endsWith(".NS") ? s : `${s}.NS`;
}

function splitFromQuotePayload(q: any): SplitEvent | null {
  const actions = q?.corporateActions;
  if (!Array.isArray(actions)) return null;
  let best: SplitEvent | null = null;
  for (const a of actions) {
    const meta = a?.meta;
    if (!meta || String(meta.eventType).toUpperCase() !== "SPLIT") continue;
    const ratio = parseSplitRatio(String(meta.splitRatio ?? ""));
    const atMs = Number(meta.dateEpochMs);
    if (!(ratio > 1) || !Number.isFinite(atMs)) continue;
    if (!best || atMs > best.atMs) best = { ratio, atMs };
  }
  return best;
}

function splitFromChartPayload(events: any): SplitEvent | null {
  const rows = events?.splits;
  const list = Array.isArray(rows) ? rows : rows ? Object.values(rows) : [];
  let best: SplitEvent | null = null;
  for (const s of list as any[]) {
    const neu = Number(s.numerator);
    const den = Number(s.denominator);
    const ratio =
      neu > 0 && den > 0 ? neu / den : parseSplitRatio(String(s.splitRatio ?? ""));
    const atMs = s.date instanceof Date ? s.date.getTime() : Date.parse(s.date);
    if (!(ratio > 1) || !Number.isFinite(atMs)) continue;
    if (!best || atMs > best.atMs) best = { ratio, atMs };
  }
  return best;
}

const SPLIT_CACHE_MS = 30 * 60_000;
const splitCache = new Map<string, { at: number; event: SplitEvent | null }>();

/**
 * Recent splits for holdings. Prefers the corporate-action flag on the quote
 * we already fetched; falls back to the chart event stream for names Yahoo
 * has already dropped from that flag.
 */
export async function getSplitEvents(
  symbols: string[],
  quotes: Map<string, Quote>,
  now = new Date(),
): Promise<Map<string, SplitEvent>> {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, SplitEvent>();
  const needChart: string[] = [];

  for (const s of wanted) {
    const fromQuote = quotes.get(s)?.split;
    if (fromQuote && splitRewriteActive(fromQuote.atMs, now)) {
      out.set(s, fromQuote);
      continue;
    }
    const hit = splitCache.get(s);
    if (hit && Date.now() - hit.at < SPLIT_CACHE_MS) {
      if (hit.event && splitRewriteActive(hit.event.atMs, now)) out.set(s, hit.event);
      continue;
    }
    needChart.push(s);
  }

  const period1 = new Date(now.getTime() - 21 * 86_400_000);
  for (let i = 0; i < needChart.length; i += 5) {
    const batch = needChart.slice(i, i + 5);
    await Promise.all(
      batch.map(async (s) => {
        let event: SplitEvent | null = null;
        try {
          const chart = await yf.chart(toYahoo(s), { period1, events: "split" });
          event = splitFromChartPayload(chart?.events);
        } catch {
          /* leave this symbol without a split */
        }
        splitCache.set(s, { at: Date.now(), event });
        if (event && splitRewriteActive(event.atMs, now)) out.set(s, event);
      }),
    );
  }

  return out;
}

export async function getQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, Quote>();
  const ttl = nseSessionOpen() ? TTL_OPEN_MS : TTL_CLOSED_MS;
  const now = Date.now();

  const stale: string[] = [];
  for (const s of wanted) {
    const hit = cache.get(s);
    if (hit && now - hit.at < ttl) out.set(s, hit.quote);
    else stale.push(s);
  }
  if (stale.length === 0) return out;

  // Yahoo rejects very large symbol batches; 50 per call is comfortably safe.
  const dayStart = istDayStart();
  for (let i = 0; i < stale.length; i += 50) {
    const batch = stale.slice(i, i + 50);
    let results: any[] = [];
    try {
      const r = await yf.quote(batch.map(toYahoo));
      results = Array.isArray(r) ? r : r ? [r] : [];
    } catch {
      // A single unknown ticker can fail the whole batch — retry individually
      // so one bad row in a CSV does not blank out every price.
      for (const s of batch) {
        try {
          const one = await yf.quote(toYahoo(s));
          if (one) results.push(one);
        } catch {
          /* leave this symbol unpriced */
        }
      }
    }

    for (const q of results) {
      const price = q.regularMarketPrice ?? q.postMarketPrice ?? q.preMarketPrice;
      if (typeof price !== "number") continue;
      const plain = String(q.symbol).replace(/\.NS$/i, "").toUpperCase();
      const t = q.regularMarketTime
        ? new Date(q.regularMarketTime as any).getTime()
        : null;
      const quote: Quote = {
        symbol: plain,
        price,
        previousClose: q.regularMarketPreviousClose ?? null,
        marketState: q.marketState ?? "UNKNOWN",
        quoteTime: t,
        delayedByMinutes: q.exchangeDataDelayedBy ?? null,
        currency: q.currency ?? null,
        intraday: t !== null && t >= dayStart,
        split: splitFromQuotePayload(q),
      };
      cache.set(plain, { at: now, quote });
      out.set(plain, quote);
    }
  }

  return out;
}
