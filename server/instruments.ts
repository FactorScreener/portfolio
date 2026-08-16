import Papa from "papaparse";
import { db, getSetting, setSetting } from "./db.ts";

const SCRIP_URL = "https://images.dhan.co/api-data/api-scrip-master-detailed.csv";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type Instrument = {
  symbol: string;
  security_id: string;
  isin: string | null;
  name: string | null;
  lot_size: number;
  tick_size: number;
};

type ScripRow = {
  EXCH_ID: string;
  SEGMENT: string;
  SECURITY_ID: string;
  ISIN: string;
  INSTRUMENT: string;
  UNDERLYING_SYMBOL: string;
  DISPLAY_NAME: string;
  SERIES: string;
  LOT_SIZE: string;
  TICK_SIZE: string;
};

/**
 * Pull the Dhan scrip master and keep only NSE cash-segment equity (series EQ
 * and BE). Anything else is not tradable as CNC delivery from this app.
 */
export async function syncInstruments(force = false): Promise<number> {
  const last = Number(getSetting("instruments_synced_at") ?? 0);
  const count = countInstruments();
  if (!force && count > 0 && Date.now() - last < MAX_AGE_MS) return count;

  const res = await fetch(SCRIP_URL);
  if (!res.ok) throw new Error(`Scrip master download failed (${res.status})`);
  const csv = await res.text();

  const parsed = Papa.parse<ScripRow>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  const rows = parsed.data.filter(
    (r) =>
      r.EXCH_ID === "NSE" &&
      r.SEGMENT === "E" &&
      r.INSTRUMENT === "EQUITY" &&
      (r.SERIES === "EQ" || r.SERIES === "BE"),
  );
  if (rows.length === 0) throw new Error("Scrip master contained no NSE equities");

  const insert = db.query(
    `INSERT INTO instruments (symbol, security_id, isin, name, lot_size, tick_size)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       security_id = excluded.security_id,
       isin        = excluded.isin,
       name        = excluded.name,
       lot_size    = excluded.lot_size,
       tick_size   = excluded.tick_size`,
  );

  db.transaction(() => {
    db.exec("DELETE FROM instruments");
    for (const r of rows) {
      insert.run(
        r.UNDERLYING_SYMBOL.trim().toUpperCase(),
        r.SECURITY_ID.trim(),
        r.ISIN?.trim() || null,
        r.DISPLAY_NAME?.trim() || null,
        Math.max(1, Number(r.LOT_SIZE) || 1),
        Number(r.TICK_SIZE) > 0 ? Number(r.TICK_SIZE) / 100 : 0.05,
      );
    }
  })();

  setSetting("instruments_synced_at", String(Date.now()));
  return rows.length;
}

export function countInstruments(): number {
  return (
    db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM instruments").get()?.n ?? 0
  );
}

export function syncedAt(): number {
  return Number(getSetting("instruments_synced_at") ?? 0);
}

const bySymbol = db.query<Instrument, [string]>(
  "SELECT * FROM instruments WHERE symbol = ?",
);
const byIsin = db.query<Instrument, [string]>(
  "SELECT * FROM instruments WHERE isin = ? LIMIT 1",
);

/**
 * Resolve whatever the user typed or uploaded. Accepts a plain NSE ticker, a
 * Yahoo-style `TICKER.NS`, or an ISIN.
 */
export function resolve(raw: string): Instrument | null {
  const t = raw.trim().toUpperCase();
  if (!t) return null;

  const stripped = t.replace(/\.(NS|NSE)$/, "");
  const direct = bySymbol.get(stripped);
  if (direct) return direct;

  if (/^IN[A-Z0-9]{10}$/.test(t)) {
    const viaIsin = byIsin.get(t);
    if (viaIsin) return viaIsin;
  }
  return null;
}

const searchStmt = db.query<Instrument, [string, string, string]>(
  `SELECT * FROM instruments
    WHERE symbol LIKE ?2 OR name LIKE ?2
    ORDER BY CASE WHEN symbol = ?1 THEN 0
                  WHEN symbol LIKE ?3 THEN 1
                  ELSE 2 END,
             length(symbol)
    LIMIT 20`,
);

export function search(q: string): Instrument[] {
  const t = q.trim().toUpperCase();
  if (!t) return [];
  return searchStmt.all(t, `%${t}%`, `${t}%`);
}
