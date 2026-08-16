import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });

export const db = new Database("data/portfolio.sqlite", { create: true });

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Dhan NSE cash-segment scrip master, refreshed daily.
  CREATE TABLE IF NOT EXISTS instruments (
    symbol       TEXT PRIMARY KEY,
    security_id  TEXT NOT NULL,
    isin         TEXT,
    name         TEXT,
    lot_size     INTEGER NOT NULL DEFAULT 1,
    tick_size    REAL    NOT NULL DEFAULT 0.05
  );
  CREATE INDEX IF NOT EXISTS instruments_isin ON instruments(isin);

  -- One row per placed order, so a rebalance run stays auditable.
  CREATE TABLE IF NOT EXISTS orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id        TEXT NOT NULL,
    placed_at     TEXT NOT NULL,
    side          TEXT NOT NULL,
    symbol        TEXT NOT NULL,
    security_id   TEXT NOT NULL,
    quantity      INTEGER NOT NULL,
    ref_price     REAL,
    dhan_order_id TEXT,
    status        TEXT NOT NULL,
    error         TEXT
  );
  CREATE INDEX IF NOT EXISTS orders_run ON orders(run_id);

  -- Saved target baskets so a mirror can be re-run tomorrow for the buy leg.
  CREATE TABLE IF NOT EXISTS baskets (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload    TEXT NOT NULL
  );
`);

const getStmt = db.query<{ value: string }, [string]>(
  "SELECT value FROM settings WHERE key = ?",
);
const setStmt = db.query(
  "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
);

export function getSetting(key: string): string | null {
  return getStmt.get(key)?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  setStmt.run(key, value);
}
