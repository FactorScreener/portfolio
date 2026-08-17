import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  CsvIcon,
  Delete02Icon,
  Search01Icon,
  Tick02Icon,
  Upload04Icon,
} from "@hugeicons/core-free-icons";
import { applyCap, normalise } from "../../shared/weights.ts";
import { api } from "../lib/api.ts";
import { parseSheet, parseTickerText, toNumber, type Sheet } from "../lib/csv.ts";
import { Dropdown } from "./Dropdown.tsx";
import { Help, SideSwitch, Spinner } from "./ui.tsx";

export type TargetSource =
  | { kind: "tickers"; symbols: string[] }
  | { kind: "csv"; sheet: Sheet; weightColumn: string | null };

export function TargetInput({
  source,
  onChange,
  notify,
  capAt5Pct,
}: {
  source: TargetSource;
  onChange: (s: TargetSource) => void;
  notify: (kind: "ok" | "err", text: string) => void;
  /** Mirrored in the preview's weight column so the toggle has a visible effect. */
  capAt5Pct: boolean;
}) {
  // CSV leads by default; an already-picked ticker list keeps its tab so
  // reopening the step doesn't hide it.
  const [tab, setTab] = useState<"tickers" | "csv">(
    source.kind === "tickers" && source.symbols.length > 0 ? "tickers" : "csv",
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="row">
        <SideSwitch
          name="Target source"
          value={tab}
          onChange={(t) => {
            setTab(t);
            if (t === "tickers" && source.kind !== "tickers") {
              onChange({ kind: "tickers", symbols: [] });
            }
          }}
          options={[
            { value: "csv", label: "CSV", icon: CsvIcon },
            { value: "tickers", label: "Tickers", icon: Search01Icon },
          ]}
        />
        <span className="grow" />
      </div>

      {tab === "tickers" ? (
        <TickerEntry
          symbols={source.kind === "tickers" ? source.symbols : []}
          onChange={(symbols) => onChange({ kind: "tickers", symbols })}
        />
      ) : (
        <CsvEntry
          sheet={source.kind === "csv" ? source.sheet : null}
          weightColumn={source.kind === "csv" ? source.weightColumn : null}
          onSheet={(sheet) => onChange({ kind: "csv", sheet, weightColumn: null })}
          onWeightColumn={(weightColumn) =>
            source.kind === "csv" && onChange({ ...source, weightColumn })
          }
          onClear={() => onChange({ kind: "tickers", symbols: [] })}
          notify={notify}
          capAt5Pct={capAt5Pct}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- tickers */

function TickerEntry({
  symbols,
  onChange,
}: {
  symbols: string[];
  onChange: (s: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<{ symbol: string; name: string | null }[]>([]);
  const [bad, setBad] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Autocomplete against the cached NSE scrip list.
  useEffect(() => {
    const q = text.trim();
    if (q.length < 1 || /[\s,;\n]/.test(text)) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await api.searchInstruments(q);
        if (!cancelled) {
          setResults(r.results.filter((x) => !symbols.includes(x.symbol)).slice(0, 7));
          setActive(0);
        }
      } catch {
        /* autocomplete is best-effort */
      }
    }, 130);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, symbols]);

  function add(list: string[]) {
    const next = [...new Set([...symbols, ...list])];
    onChange(next);
    setText("");
    setResults([]);
  }

  /** Accept a pasted blob: validate everything at once, chip the good ones. */
  async function commitText(raw: string) {
    const parsed = parseTickerText(raw);
    if (parsed.length === 0) return;
    try {
      const r = await api.resolveSymbols(parsed);
      add(r.found.map((f) => f.symbol));
      setBad(r.missing);
    } catch {
      add(parsed);
    }
  }

  return (
    <div ref={boxRef} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ position: "relative" }}>
        <input
          className="input input-tall"
          value={text}
          placeholder="Type a ticker, or paste a whole list separated by commas or newlines"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            const v = e.target.value;
            // A paste containing separators is a list, not a search.
            if (/[,;\n\t]/.test(v)) void commitText(v);
            else setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && results.length) {
              e.preventDefault();
              setActive((a) => (a + 1) % results.length);
            } else if (e.key === "ArrowUp" && results.length) {
              e.preventDefault();
              setActive((a) => (a - 1 + results.length) % results.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const pick = results[active];
              if (pick) add([pick.symbol]);
              else void commitText(text);
            } else if (e.key === "Backspace" && !text && symbols.length) {
              onChange(symbols.slice(0, -1));
            } else if (e.key === "Escape") {
              setResults([]);
            }
          }}
          onBlur={() => setTimeout(() => setResults([]), 140)}
        />

        <AnimatePresence>
          {results.length > 0 && (
            <motion.ul
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                zIndex: 40,
                listStyle: "none",
                margin: 0,
                padding: 6,
                background: "var(--surface)",
                border: "1px solid var(--hairline)",
                borderRadius: 12,
                boxShadow: "var(--shadow-3)",
                maxHeight: 288,
                overflow: "auto",
              }}
            >
              {results.map((r, i) => (
                <li key={r.symbol}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      add([r.symbol]);
                    }}
                    onMouseEnter={() => setActive(i)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      background: i === active ? "var(--surface-2)" : "transparent",
                      borderRadius: 8,
                      padding: "9px 12px",
                      cursor: "pointer",
                      font: "inherit",
                      color: "var(--ink)",
                      display: "flex",
                      gap: 10,
                      alignItems: "baseline",
                    }}
                  >
                    <span className="sym">{r.symbol}</span>
                    <span className="sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.name}
                    </span>
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>

      {(symbols.length > 0 || bad.length > 0) && (
        <div className="row wrap" style={{ gap: 6 }}>
          <AnimatePresence initial={false}>
            {symbols.map((s) => (
              <motion.span
                key={s}
                className="chip"
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.15 }}
              >
                {s}
                <button
                  className="chip-x"
                  aria-label={`Remove ${s}`}
                  onClick={() => onChange(symbols.filter((x) => x !== s))}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2.6} />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>

          {bad.map((s) => (
            <span key={s} className="chip chip-bad" title="Not found on NSE">
              {s}
              <button className="chip-x" aria-label={`Dismiss ${s}`} onClick={() => setBad(bad.filter((x) => x !== s))}>
                <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2.6} />
              </button>
            </span>
          ))}

          {symbols.length > 0 && (
            <button className="btn btn-text btn-sm" onClick={() => onChange([])}>
              <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={2} />
              Clear {symbols.length}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- csv */

function CsvEntry({
  sheet,
  weightColumn,
  onSheet,
  onWeightColumn,
  onClear,
  notify,
  capAt5Pct,
}: {
  sheet: Sheet | null;
  weightColumn: string | null;
  onSheet: (s: Sheet) => void;
  onWeightColumn: (c: string | null) => void;
  onClear: () => void;
  notify: (kind: "ok" | "err", text: string) => void;
  capAt5Pct: boolean;
}) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function take(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const s = await parseSheet(file);
      onSheet(s);
      notify("ok", `${s.rows.length} rows read from ${s.fileName}`);
    } catch (e) {
      notify("err", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!sheet) {
    return (
      <>
        <div
          className="dropzone"
          data-over={over}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void take(e.dataTransfer.files[0]);
          }}
        >
          {busy ? (
            <Spinner size={22} />
          ) : (
            <>
              <HugeiconsIcon icon={Upload04Icon} size={26} strokeWidth={1.8} />
              <div style={{ marginTop: 8, fontWeight: 500, color: "var(--ink)" }}>
                Drop a CSV, or click to choose
              </div>
              <div style={{ fontSize: 12.5, marginTop: 2 }}>
                Any file with a ticker column works
              </div>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          hidden
          onChange={(e) => void take(e.target.files?.[0])}
        />
      </>
    );
  }

  const usableRows = weightColumn
    ? sheet.rows.filter((r) => (toNumber(r[weightColumn]) ?? 0) > 0).length
    : sheet.rows.length;

  // The share each ticker ends up with, run through the same normalise/cap the
  // planner uses. Duplicate tickers are summed, exactly as the server does, so
  // both rows of a repeated name show the combined weight.
  const weightBySymbol = (() => {
    const raw = new Map<string, number>();
    for (const r of sheet.rows) {
      const symbol = String(r[sheet.symbolColumn] ?? "").trim().toUpperCase();
      if (!symbol) continue;
      const v = weightColumn ? Math.max(0, toNumber(r[weightColumn]) ?? 0) : 1;
      if (weightColumn && v <= 0) continue; // dropped by the planner
      raw.set(symbol, (raw.get(symbol) ?? 0) + v);
    }
    const normalised = normalise(raw);
    return capAt5Pct ? applyCap(normalised) : normalised;
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="pill pill-live">
          <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2.6} />
          {sheet.fileName}
        </span>
        <span className="sub">{sheet.rows.length} rows · {sheet.columns.length} columns</span>
        <span className="grow" />
        <button className="btn btn-text btn-sm" onClick={onClear}>
          Remove
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="symcol">
            Ticker column
          </label>
          <Dropdown
            id="symcol"
            label="Ticker column"
            value={sheet.symbolColumn}
            onChange={(c) => onSheet({ ...sheet, symbolColumn: c })}
            options={sheet.columns.map((c) => ({ value: c, label: c }))}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="wcol">
            Weight column
            <Help>
              Pick a numeric column and each row's weight becomes its share of
              that column's total. Leave it on Equal weight to split the basket
              evenly instead.
            </Help>
          </label>
          <Dropdown
            id="wcol"
            label="Weight column"
            value={weightColumn ?? ""}
            onChange={(c) => onWeightColumn(c || null)}
            options={[
              { value: "", label: "Equal weight", hint: "Split the basket evenly" },
              ...sheet.numericColumns.map((c) => ({ value: c, label: c })),
            ]}
          />
          {sheet.numericColumns.length === 0 && (
            <span className="sub">No numeric columns found in this file.</span>
          )}
        </div>
      </div>

      {weightColumn && usableRows < sheet.rows.length && (
        <div className="banner banner-warn">
          {sheet.rows.length - usableRows} row(s) have a blank, zero or negative
          value in “{weightColumn}” and will be dropped.
        </div>
      )}

      <div className="table-wrap table-wrap-full">
        <table className="data">
          <thead>
            <tr>
              <th>{sheet.symbolColumn}</th>
              {weightColumn && <th>{weightColumn}</th>}
              <th>{capAt5Pct ? "Weight · capped 5%" : "Weight"}</th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((r, i) => {
              const symbol = String(r[sheet.symbolColumn] ?? "").trim().toUpperCase();
              const w = weightBySymbol.get(symbol);
              return (
                <tr key={i}>
                  <td className="sym">{symbol}</td>
                  {weightColumn && <td>{r[weightColumn]}</td>}
                  <td className={w ? "tnum" : "tnum muted"}>
                    {w ? `${(w * 100).toFixed(2)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
