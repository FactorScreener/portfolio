import Papa from "papaparse";

export type Sheet = {
  fileName: string;
  columns: string[];
  rows: Record<string, string>[];
  /** Column the ticker was read from. */
  symbolColumn: string;
  /** Columns holding usable numbers, offered as weight sources. */
  numericColumns: string[];
};

const SYMBOL_HINTS = [
  "symbol", "ticker", "tradingsymbol", "trading symbol", "scrip", "scrip name",
  "stock", "stock name", "nse", "nse symbol", "instrument", "security", "name", "isin",
];

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/** Strip ₹, %, commas and brackets so "(1,234.5)" or "12.3%" still parse. */
export function toNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[(),₹$%\s]/g, "");
  if (!s || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function looksLikeTicker(v: string): boolean {
  const s = v.trim().toUpperCase();
  return /^[A-Z0-9&.\-]{1,25}$/.test(s) && /[A-Z]/.test(s);
}

export function parseSheet(file: File): Promise<Sheet> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const columns = (res.meta.fields ?? []).filter(Boolean);
        const rows = res.data.filter((r) =>
          Object.values(r).some((v) => String(v ?? "").trim()),
        );
        if (columns.length === 0 || rows.length === 0) {
          reject(new Error("That file has no readable rows."));
          return;
        }

        // Prefer a column whose header names a ticker; otherwise fall back to
        // the first column where most values actually look like tickers.
        let symbolColumn =
          columns.find((c) => SYMBOL_HINTS.includes(norm(c))) ??
          columns.find((c) => SYMBOL_HINTS.some((h) => norm(c).includes(h))) ??
          "";

        if (!symbolColumn) {
          let best = "";
          let bestScore = 0;
          for (const c of columns) {
            const vals = rows.map((r) => String(r[c] ?? "")).filter(Boolean);
            if (vals.length === 0) continue;
            const score = vals.filter(looksLikeTicker).length / vals.length;
            if (score > bestScore) {
              bestScore = score;
              best = c;
            }
          }
          symbolColumn = bestScore >= 0.6 ? best : (columns[0] ?? "");
        }

        // A weight column needs mostly-numeric values and at least one
        // positive number to normalise against.
        const numericColumns = columns.filter((c) => {
          if (c === symbolColumn) return false;
          const vals = rows.map((r) => r[c]).filter((v) => String(v ?? "").trim());
          if (vals.length < Math.max(1, rows.length * 0.6)) return false;
          const nums = vals.map(toNumber).filter((n): n is number => n !== null);
          return nums.length >= vals.length * 0.9 && nums.some((n) => n > 0);
        });

        resolve({ fileName: file.name, columns, rows, symbolColumn, numericColumns });
      },
      error: (e) => reject(e),
    });
  });
}

/** Split a pasted blob on commas, whitespace or newlines. */
export function parseTickerText(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;\n\r\t]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}
