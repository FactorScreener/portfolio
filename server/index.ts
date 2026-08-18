import { Hono } from "hono";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { db } from "./db.ts";
import {
  DhanError,
  cancelOrder,
  clearCredentials,
  getCredentials,
  getFunds,
  getHoldings,
  getOrders,
  getPositions,
  getTradeHistory,
  placeOrder,
  saveCredentials,
  type DhanHolding,
  type DhanOrder,
  type DhanPosition,
  type DhanTrade,
} from "./dhan.ts";
import {
  buildExposure,
  nonEquityPositions,
  openEquityPositions,
  realizedToday,
} from "./portfolio.ts";
import {
  countInstruments,
  resolve,
  search,
  syncInstruments,
  syncedAt,
} from "./instruments.ts";
import { getQuotes, nseSessionOpen } from "./quotes.ts";
import { buildPlan, type PlanRequest } from "./rebalance.ts";

const app = new Hono();
const api = new Hono();

if (process.env.NODE_ENV !== "production") app.use("*", logger());

/** Every route below needs credentials; fail loudly and early if unset. */
function requireCreds() {
  const creds = getCredentials();
  if (!creds) throw new HttpError(401, "Add your Dhan Client ID and access token first.");
  return creds;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

api.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  if (err instanceof DhanError) {
    const expired = /token|unauthor|invalid/i.test(err.message) || err.code === "DH-901";
    return c.json(
      { error: err.message, code: err.code, expired },
      (expired ? 401 : 502) as 401,
    );
  }
  console.error(err);
  return c.json({ error: err.message || "Unexpected server error" }, 500);
});

// ---------------------------------------------------------------- settings

api.get("/settings", (c) => {
  const creds = getCredentials();
  return c.json({
    connected: Boolean(creds),
    clientId: creds?.clientId ?? "",
    // Never echo the token back; the UI only needs to know one is stored.
    tokenSet: Boolean(creds?.accessToken),
    instrumentCount: countInstruments(),
    instrumentsSyncedAt: syncedAt() || null,
    marketOpen: nseSessionOpen(),
  });
});

const credsSchema = z.object({
  clientId: z.string().min(1),
  accessToken: z.string().min(20),
});

api.post("/settings", async (c) => {
  const body = credsSchema.parse(await c.req.json());
  saveCredentials(body);
  // Prove the token works before telling the user they are connected.
  await getFunds(body);
  syncInstruments().catch((e) => console.error("scrip sync:", e.message));
  return c.json({ ok: true });
});

api.delete("/settings", (c) => {
  clearCredentials();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- overview

type Enriched = {
  tradingSymbol: string;
  securityId: string | null;
  isin: string | null;
  name: string | null;
  /** Settled holding + today's open position. */
  totalQty: number;
  holdingQty: number;
  positionQty: number;
  availableQty: number;
  positionProducts: string[];
  avgCostPrice: number;
  price: number;
  prevClose: number | null;
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  dayChange: number;
  dayChangePct: number;
  realizedPnl: number;
};

/**
 * One row per symbol across both feeds. Holdings alone miss anything bought
 * today, and still count anything sold today — see server/portfolio.ts.
 */
async function enrichPortfolio(holdings: DhanHolding[], positions: DhanPosition[]) {
  const exposures = buildExposure(holdings, positions);
  const symbols = [...exposures.keys()];
  // Dhan gives a live LTP but no previous close, so Yahoo fills in the day
  // move. If Yahoo is unreachable the P&L numbers still work.
  let quotes = new Map<string, Awaited<ReturnType<typeof getQuotes>> extends Map<string, infer V> ? V : never>();
  try {
    quotes = await getQuotes(symbols);
  } catch (e) {
    console.error("quotes:", (e as Error).message);
  }

  const rows: Enriched[] = [...exposures.values()]
    .filter((e) => e.totalQty !== 0)
    .map((e) => {
      const q = quotes.get(e.symbol);
      const price = e.lastTradedPrice > 0 ? e.lastTradedPrice : (q?.price ?? e.avgCostPrice);
      const currentValue = e.totalQty * price;
      const prevClose = q?.previousClose ?? null;
      // Settled stock moves with the day; today's trades are marked from their
      // own fill, which is what Dhan's position P&L already measures.
      const dayChange =
        (prevClose !== null ? (price - prevClose) * e.holdingQty : 0) +
        e.positionUnrealizedPnl +
        e.realizedPnl;
      return {
        tradingSymbol: e.symbol,
        securityId: e.securityId,
        isin: e.isin,
        name: resolve(e.symbol)?.name ?? null,
        totalQty: e.totalQty,
        holdingQty: e.holdingQty,
        positionQty: e.positionQty,
        availableQty: e.sellableQty,
        positionProducts: e.positionProducts,
        avgCostPrice: e.avgCostPrice,
        price,
        prevClose,
        invested: e.invested,
        currentValue,
        pnl: currentValue - e.invested,
        pnlPct: e.invested > 0 ? ((currentValue - e.invested) / e.invested) * 100 : 0,
        dayChange,
        // Against where the row started the day, not the per-share move — the
        // two disagree once part of the exposure was bought intraday.
        dayChangePct:
          currentValue - dayChange > 0 ? (dayChange / (currentValue - dayChange)) * 100 : 0,
        realizedPnl: e.realizedPnl,
      };
    })
    .sort((a, b) => b.currentValue - a.currentValue);

  const invested = rows.reduce((s, r) => s + r.invested, 0);
  const currentValue = rows.reduce((s, r) => s + r.currentValue, 0);
  const dayChange = rows.reduce((s, r) => s + r.dayChange, 0);
  const prevValue = currentValue - dayChange;
  const openPositions = openEquityPositions(positions);
  const positionsValue = rows.reduce((s, r) => s + r.positionQty * r.price, 0);

  const sample = [...quotes.values()];
  return {
    holdings: rows,
    summary: {
      invested,
      currentValue,
      pnl: currentValue - invested,
      pnlPct: invested > 0 ? ((currentValue - invested) / invested) * 100 : 0,
      dayChange,
      dayChangePct: prevValue > 0 ? (dayChange / prevValue) * 100 : 0,
      count: rows.length,
      /** Names with a settled holding behind them. */
      holdingsCount: rows.filter((r) => r.holdingQty > 0).length,
      positionsCount: new Set(openPositions.map((p) => p.tradingSymbol.trim().toUpperCase())).size,
      positionsValue,
      /** Booked on today's closed quantity — not part of `pnl`. */
      realizedPnl: realizedToday(positions),
      /** F&O and other non-cash positions this app does not model. */
      ignoredPositions: nonEquityPositions(positions).length,
    },
    pricing: {
      marketOpen: nseSessionOpen(),
      marketState: sample.find((q) => q.marketState)?.marketState ?? "UNKNOWN",
      delayedByMinutes: sample.find((q) => q.delayedByMinutes != null)?.delayedByMinutes ?? null,
      latestQuoteTime: sample.reduce<number | null>(
        (m, q) => (q.quoteTime && (m === null || q.quoteTime > m) ? q.quoteTime : m),
        null,
      ),
      /** Day-change needs a previous close from Yahoo; flag when it is missing. */
      dayChangeAvailable: rows.some((r) => r.prevClose !== null),
      ltpSource: "dhan" as const,
    },
  };
}

api.get("/overview", async (c) => {
  const creds = requireCreds();
  await syncInstruments().catch(() => {});
  const [holdings, positions, funds] = await Promise.all([
    getHoldings(creds),
    getPositions(creds),
    getFunds(creds),
  ]);
  const enriched = await enrichPortfolio(holdings ?? [], positions ?? []);
  return c.json({ ...enriched, positions: openEquityPositions(positions ?? []), funds });
});

// ---------------------------------------------------------------- instruments

api.get("/instruments/search", (c) => {
  const q = c.req.query("q") ?? "";
  return c.json({ results: search(q) });
});

api.post("/instruments/sync", async (c) => {
  const n = await syncInstruments(true);
  return c.json({ count: n, syncedAt: syncedAt() });
});

/** Validate a pasted / uploaded ticker list without building a full plan. */
api.post("/instruments/resolve", async (c) => {
  await syncInstruments().catch(() => {});
  const { symbols } = z.object({ symbols: z.array(z.string()) }).parse(await c.req.json());
  const found: { input: string; symbol: string; name: string | null }[] = [];
  const missing: string[] = [];
  for (const s of symbols) {
    const inst = resolve(s);
    if (inst) found.push({ input: s, symbol: inst.symbol, name: inst.name });
    else if (s.trim()) missing.push(s.trim().toUpperCase());
  }
  return c.json({ found, missing });
});

// ---------------------------------------------------------------- rebalance

const planSchema = z.object({
  side: z.enum(["BUY", "SELL"]),
  targets: z.array(
    z.object({ symbol: z.string(), rawWeight: z.number().nullable().optional() }),
  ),
  weightMode: z.enum(["equal", "column"]).default("equal"),
  capAt5Pct: z.boolean().default(false),
  cashBufferPct: z.number().min(0).max(0.2).default(0),
  availableCash: z.number().min(0).optional(),
  minOrderValue: z.number().min(0).default(0),
});

api.post("/rebalance/plan", async (c) => {
  const creds = requireCreds();
  await syncInstruments().catch(() => {});
  const input = planSchema.parse(await c.req.json());

  const [holdings, positions, funds] = await Promise.all([
    getHoldings(creds),
    getPositions(creds),
    getFunds(creds),
  ]);
  const req: PlanRequest = {
    ...input,
    availableCash: input.availableCash ?? funds.availabelBalance,
  };
  const plan = await buildPlan(req, holdings ?? [], positions ?? []);
  return c.json(plan);
});

const executeSchema = z.object({
  side: z.enum(["BUY", "SELL"]),
  orders: z.array(
    z.object({
      symbol: z.string(),
      securityId: z.string(),
      quantity: z.number().int().positive(),
      refPrice: z.number().nullable().optional(),
    }),
  ).min(1),
});

/**
 * Place the plan. Orders go out one at a time — Dhan rate-limits order entry,
 * and a serial loop means a mid-run failure leaves a clear boundary between
 * what was sent and what was not.
 */
api.post("/rebalance/execute", async (c) => {
  const creds = requireCreds();
  const { side, orders } = executeSchema.parse(await c.req.json());
  const runId = randomUUID();
  const placedAt = new Date().toISOString();

  const insert = db.query(
    `INSERT INTO orders (run_id, placed_at, side, symbol, security_id, quantity,
                         ref_price, dhan_order_id, status, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const results: {
    symbol: string;
    quantity: number;
    ok: boolean;
    orderId?: string;
    status?: string;
    error?: string;
  }[] = [];

  for (const o of orders) {
    try {
      const r = await placeOrder(creds, {
        securityId: o.securityId,
        transactionType: side,
        quantity: o.quantity,
        orderType: "MARKET",
        correlationId: runId.slice(0, 25),
      });
      insert.run(
        runId, placedAt, side, o.symbol, o.securityId, o.quantity,
        o.refPrice ?? null, r.orderId, r.orderStatus ?? "SENT", null,
      );
      results.push({ symbol: o.symbol, quantity: o.quantity, ok: true, orderId: r.orderId, status: r.orderStatus });
    } catch (e) {
      const msg = (e as Error).message;
      insert.run(
        runId, placedAt, side, o.symbol, o.securityId, o.quantity,
        o.refPrice ?? null, null, "FAILED", msg,
      );
      results.push({ symbol: o.symbol, quantity: o.quantity, ok: false, error: msg });
    }
    await Bun.sleep(120); // stay under Dhan's ~10 orders/sec entry limit
  }

  return c.json({
    runId,
    placed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
});

// ---------------------------------------------------------------- history

type OrderRow = {
  id: number;
  run_id: string;
  placed_at: string;
  side: "BUY" | "SELL";
  symbol: string;
  security_id: string;
  quantity: number;
  ref_price: number | null;
  dhan_order_id: string | null;
  status: string;
  error: string | null;
};

type Fill = { qty: number; notional: number; securityId: string; side: string };

const TERMINAL_BAD = new Set(["FAILED", "REJECTED", "CANCELLED", "EXPIRED", "NO_FILL"]);

function ymdIst(input?: string | number | Date): string {
  const d = input === undefined ? new Date() : new Date(input);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function aggregateTrades(trades: DhanTrade[]): Map<string, Fill> {
  const m = new Map<string, Fill>();
  for (const t of trades) {
    const id = String(t.orderId);
    const qty = Number(t.tradedQuantity) || 0;
    const px = Number(t.tradedPrice) || 0;
    const prev = m.get(id);
    if (prev) {
      prev.qty += qty;
      prev.notional += qty * px;
    } else {
      m.set(id, {
        qty,
        notional: qty * px,
        securityId: String(t.securityId),
        side: String(t.transactionType),
      });
    }
  }
  return m;
}

function applyFill(
  row: OrderRow,
  fill: Fill,
): { status: string; filledQty: number; avgPrice: number; live: boolean } {
  return {
    status: fill.qty >= row.quantity ? "TRADED" : "PART_TRADED",
    filledQty: fill.qty,
    avgPrice: fill.qty ? fill.notional / fill.qty : 0,
    live: true,
  };
}

/**
 * Local audit of every rebalance this machine sent. SQLite is the source of
 * which orders went out; Dhan's day book plus trade history paint the actual
 * fill. A dead token still returns the local rows.
 */
api.get("/history", async (c) => {
  const rows = db
    .query<OrderRow, []>("SELECT * FROM orders ORDER BY id")
    .all();

  let live = false;
  let liveError: string | null = null;
  const liveById = new Map<string, DhanOrder>();
  let fillsById = new Map<string, Fill>();

  const creds = getCredentials();
  if (creds && rows.length) {
    const from = ymdIst(rows[0]!.placed_at);
    const to = ymdIst();
    try {
      const [book, trades] = await Promise.all([
        getOrders(creds),
        getTradeHistory(creds, from, to),
      ]);
      live = true;
      for (const o of Array.isArray(book) ? book : []) {
        if (o.orderId) liveById.set(String(o.orderId), o);
      }
      fillsById = aggregateTrades(trades);
    } catch (e) {
      liveError = (e as Error).message;
    }
  }

  const overlay = new Map<
    number,
    { status: string; filledQty: number | null; avgPrice: number | null; live: boolean; dhanOrderId: string | null }
  >();

  const unmatched: OrderRow[] = [];
  for (const row of rows) {
    const oid = row.dhan_order_id;
    const book = oid ? liveById.get(oid) : undefined;
    if (book) {
      const filled = Number(book.filledQty) || 0;
      const avg = Number(book.averageTradedPrice) || 0;
      overlay.set(row.id, {
        status: book.orderStatus || row.status,
        filledQty: filled || null,
        avgPrice: avg || null,
        live: true,
        dhanOrderId: oid,
      });
      continue;
    }
    const fill = oid ? fillsById.get(oid) : undefined;
    if (fill) {
      overlay.set(row.id, { ...applyFill(row, fill), dhanOrderId: oid });
      continue;
    }
    if (row.status === "FAILED" || !oid) {
      overlay.set(row.id, {
        status: row.status,
        filledQty: null,
        avgPrice: null,
        live: false,
        dhanOrderId: oid,
      });
      continue;
    }
    unmatched.push(row);
  }

  // Only the Dhan order id we stored at place-time counts. Matching leftovers
  // by scrip + qty would steal a later manual fill (WELCORP was cancelled in
  // the Dhan app; a separate 58-share buy then looked identical).
  for (const row of unmatched) {
    const pastDay = ymdIst(row.placed_at) < ymdIst();
    overlay.set(row.id, {
      status: live && pastDay ? "NO_FILL" : row.status,
      filledQty: null,
      avgPrice: null,
      live,
      dhanOrderId: row.dhan_order_id,
    });
  }

  const persist = db.query("UPDATE orders SET status = ? WHERE id = ?");
  for (const [id, o] of overlay) {
    if (o.live) persist.run(o.status, id);
  }

  const groups = new Map<string, OrderRow[]>();
  for (const row of rows) {
    const list = groups.get(row.run_id);
    if (list) list.push(row);
    else groups.set(row.run_id, [row]);
  }

  const runs = [...groups.values()].reverse().map((orders) => {
    const first = orders[0]!;
    const mapped = orders.map((o) => {
      const over = overlay.get(o.id);
      const filledQty = over?.filledQty ?? null;
      const avgPrice = over?.avgPrice ?? null;
      const status = over?.status ?? o.status;
      const orderValue =
        filledQty != null && avgPrice != null
          ? filledQty * avgPrice
          : TERMINAL_BAD.has(status)
            ? 0
            : o.quantity * (o.ref_price ?? 0);
      return {
        id: o.id,
        symbol: o.symbol,
        securityId: o.security_id,
        quantity: o.quantity,
        filledQty,
        refPrice: o.ref_price,
        avgPrice,
        orderValue,
        dhanOrderId: over?.dhanOrderId ?? o.dhan_order_id,
        status,
        live: over?.live ?? false,
        error: o.error,
      };
    });
    const failed = mapped.filter((o) => TERMINAL_BAD.has(o.status)).length;
    const traded = mapped.filter((o) => o.status === "TRADED").length;
    const notional = mapped.reduce((sum, o) => sum + o.orderValue, 0);
    return {
      runId: first.run_id,
      placedAt: first.placed_at,
      side: first.side,
      orderCount: orders.length,
      placed: orders.length - failed,
      traded,
      failed,
      notional,
      orders: mapped,
    };
  });

  return c.json({ runs, live, liveError });
});

// ---------------------------------------------------------------- orders

api.get("/orders", async (c) => {
  const creds = requireCreds();
  const live = await getOrders(creds);
  const runs = db
    .query<
      { run_id: string; placed_at: string; side: string; n: number },
      []
    >(
      `SELECT run_id, placed_at, side, COUNT(*) AS n
         FROM orders GROUP BY run_id ORDER BY placed_at DESC LIMIT 20`,
    )
    .all();
  return c.json({ live, runs });
});

api.get("/orders/:runId", (c) => {
  const rows = db
    .query("SELECT * FROM orders WHERE run_id = ? ORDER BY id")
    .all(c.req.param("runId"));
  return c.json({ rows });
});

api.delete("/orders/:orderId", async (c) => {
  const creds = requireCreds();
  return c.json(await cancelOrder(creds, c.req.param("orderId")));
});

// ---------------------------------------------------------------- baskets

api.get("/baskets", (c) =>
  c.json({
    baskets: db
      .query("SELECT id, name, created_at FROM baskets ORDER BY created_at DESC")
      .all(),
  }),
);

api.post("/baskets", async (c) => {
  const { name, payload } = z
    .object({ name: z.string().min(1), payload: z.unknown() })
    .parse(await c.req.json());
  const id = randomUUID();
  db.query("INSERT INTO baskets (id, name, created_at, payload) VALUES (?, ?, ?, ?)").run(
    id, name, new Date().toISOString(), JSON.stringify(payload),
  );
  return c.json({ id });
});

api.get("/baskets/:id", (c) => {
  const row = db
    .query<{ payload: string; name: string }, [string]>(
      "SELECT name, payload FROM baskets WHERE id = ?",
    )
    .get(c.req.param("id"));
  if (!row) throw new HttpError(404, "Basket not found");
  return c.json({ name: row.name, payload: JSON.parse(row.payload) });
});

api.delete("/baskets/:id", (c) => {
  db.query("DELETE FROM baskets WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

app.route("/api", api);

if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

const port = Number(process.env.PORT ?? 8787);
console.log(`API listening on http://localhost:${port}`);

// Warm the scrip cache so the first search is instant.
syncInstruments().catch((e) => console.error("scrip sync:", e.message));

export default { port, fetch: app.fetch, idleTimeout: 120 };
