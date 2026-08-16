import YahooFinance from "yahoo-finance2";

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
      };
      cache.set(plain, { at: now, quote });
      out.set(plain, quote);
    }
  }

  return out;
}
