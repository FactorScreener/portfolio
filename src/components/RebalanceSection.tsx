import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  CheckmarkCircle02Icon,
  PlayIcon,
  Recycle03Icon,
} from "@hugeicons/core-free-icons";
import { api, type ExecuteResult, type Overview, type Plan } from "../lib/api.ts";
import { toNumber } from "../lib/csv.ts";
import { money } from "../lib/format.ts";
import { Dialog, Help, Segmented, Spinner, Switch } from "./ui.tsx";
import { PlanTable } from "./PlanTable.tsx";
import { TargetInput, type TargetSource } from "./TargetInput.tsx";

type Side = "BUY" | "SELL";

export function RebalanceSection({
  overview,
  onDone,
  notify,
}: {
  overview: Overview | null;
  onDone: () => void;
  notify: (kind: "ok" | "err", text: string) => void;
}) {
  const [side, setSide] = useState<Side>("SELL");
  const [source, setSource] = useState<TargetSource>({ kind: "tickers", symbols: [] });
  const [capAt5Pct, setCapAt5Pct] = useState(false);
  const [cashOverride, setCashOverride] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  // A CSV column drives the weights; typed tickers are always equal weight.
  const weightColumn = source.kind === "csv" ? source.weightColumn : null;
  const weightMode: "equal" | "column" = weightColumn ? "column" : "equal";

  const targets = useMemo(() => {
    if (source.kind === "tickers") {
      return source.symbols.map((symbol) => ({ symbol, rawWeight: null }));
    }
    const { sheet } = source;
    return sheet.rows
      .map((r) => ({
        symbol: String(r[sheet.symbolColumn] ?? "").trim(),
        rawWeight: weightColumn ? toNumber(r[weightColumn]) : null,
      }))
      .filter((t) => t.symbol);
  }, [source, weightColumn]);

  const cash = cashOverride.trim() ? Number(cashOverride.replace(/[^\d.]/g, "")) : null;

  function invalidate() {
    setPlan(null);
    setResult(null);
  }

  async function preview() {
    setPlanning(true);
    setResult(null);
    try {
      const p = await api.plan({
        side,
        targets,
        weightMode,
        capAt5Pct,
        cashBufferPct: 0,
        minOrderValue: 0,
        ...(side === "BUY" && cash !== null && Number.isFinite(cash) ? { availableCash: cash } : {}),
      });
      setPlan(p);
      if (p.totals.orderCount === 0) notify("ok", "No orders needed — already on target.");
    } catch (e) {
      notify("err", (e as Error).message);
    } finally {
      setPlanning(false);
    }
  }

  async function execute() {
    if (!plan) return;
    setExecuting(true);
    try {
      const orders = plan.rows
        .filter((r) => r.side && r.quantity > 0 && r.securityId)
        .map((r) => ({
          symbol: r.symbol,
          securityId: r.securityId as string,
          quantity: r.quantity,
          refPrice: r.price,
        }));
      const res = await api.execute({ side: plan.side, orders });
      setResult(res);
      setConfirming(false);
      notify(
        res.failed === 0 ? "ok" : "err",
        res.failed === 0
          ? `${res.placed} ${plan.side.toLowerCase()} orders placed`
          : `${res.placed} placed, ${res.failed} failed`,
      );
      onDone();
    } catch (e) {
      notify("err", (e as Error).message);
    } finally {
      setExecuting(false);
    }
  }

  const canPreview = targets.length > 0;
  const orderRows = plan?.rows.filter((r) => r.side && r.quantity > 0) ?? [];

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ---------------------------------------------------------- side */}
      <div className="row wrap" style={{ gap: 12 }}>
        <Segmented
          name="Order side"
          value={side}
          onChange={(s) => {
            setSide(s);
            invalidate();
          }}
          options={[
            { value: "SELL", label: "Sell only", icon: ArrowDown01Icon },
            { value: "BUY", label: "Buy only", icon: ArrowUp01Icon },
          ]}
        />
        <Help>
          Cash from a sale settles the next trading day, so a mirror runs over two
          days: sell today, buy tomorrow once the proceeds land. Each run only ever
          sends one side.
        </Help>
        <span className="grow" />
        <span className="pill">NSE · CNC · Market</span>
      </div>

      {/* -------------------------------------------------------- targets */}
      <TargetInput
        source={source}
        onChange={(s) => {
          setSource(s);
          invalidate();
        }}
        notify={notify}
      />

      {/* -------------------------------------------------------- weights */}
      <div
        className="row wrap"
        style={{
          gap: 18,
          padding: "14px 16px",
          background: "var(--surface-2)",
          borderRadius: 16,
        }}
      >
        <div className="row" style={{ gap: 10 }}>
          <Switch
            checked={capAt5Pct}
            onChange={(v) => {
              setCapAt5Pct(v);
              invalidate();
            }}
            label="Cap every weight at 5%"
          />
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>Cap at 5%</div>
            <div className="sub">No single stock above 5% of the portfolio</div>
          </div>
          <Help>
            Anything over 5% is trimmed back and the excess is spread across the
            names still under the cap, repeating until every weight fits. With
            fewer than 20 stocks the basket cannot reach 100% — the remainder
            stays in cash.
          </Help>
        </div>

        <span className="grow" />

        <div className="row" style={{ gap: 8 }}>
          <span className="sub">Weights</span>
          <span className="pill">
            {weightColumn ? `From “${weightColumn}”` : "Equal"}
            <Help align="right">
              {weightColumn
                ? "Read from your CSV and locked — edit the file and re-upload to change them."
                : "Every stock in the basket gets an identical share."}
            </Help>
          </span>
        </div>

        {side === "BUY" && (
          <div className="row" style={{ gap: 8 }}>
            <label className="sub" htmlFor="cash">
              Cash to deploy
            </label>
            <input
              id="cash"
              className="input tnum"
              style={{ width: 150 }}
              inputMode="decimal"
              value={cashOverride}
              onChange={(e) => {
                setCashOverride(e.target.value);
                invalidate();
              }}
              placeholder={money(overview?.funds.availabelBalance ?? 0, false)}
            />
            <Help align="right">
              Defaults to your Dhan available balance. Override it if yesterday's
              sale proceeds have not shown up in the funds API yet.
            </Help>
          </div>
        )}
      </div>

      {/* -------------------------------------------------------- preview */}
      <div className="row wrap" style={{ gap: 10 }}>
        <button className="btn btn-tonal" onClick={preview} disabled={!canPreview || planning}>
          {planning ? <Spinner /> : <HugeiconsIcon icon={Recycle03Icon} size={17} strokeWidth={2} />}
          {planning ? "Calculating" : plan ? "Recalculate" : "Preview orders"}
        </button>

        {plan && plan.totals.orderCount > 0 && (
          <button
            className={`btn ${side === "SELL" ? "btn-danger" : "btn-filled"}`}
            onClick={() => setConfirming(true)}
          >
            <HugeiconsIcon icon={PlayIcon} size={17} strokeWidth={2} />
            Place {plan.totals.orderCount} {side === "SELL" ? "sell" : "buy"} order
            {plan.totals.orderCount === 1 ? "" : "s"}
          </button>
        )}

        <span className="grow" />

        {!canPreview && <span className="sub">Add tickers or a CSV to begin</span>}

        {plan && (
          <span className="row" style={{ gap: 16 }}>
            <Metric label={side === "SELL" ? "Proceeds" : "Deploying"} value={money(plan.totals.tradeValue, false)} />
            <Metric label="Cash after" value={money(plan.totals.cashAfter, false)} />
          </span>
        )}
      </div>

      {/* --------------------------------------------------------- output */}
      <AnimatePresence mode="wait">
        {plan && (
          <motion.div
            key="plan"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {plan.warnings.map((w, i) => (
              <div key={i} className="banner banner-warn">
                <HugeiconsIcon icon={Alert02Icon} size={17} strokeWidth={2} style={{ flex: "none", marginTop: 1 }} />
                <span>{w}</span>
              </div>
            ))}
            <PlanTable plan={plan} />
          </motion.div>
        )}
      </AnimatePresence>

      {result && <ResultPanel result={result} />}

      {/* ------------------------------------------------------- confirm */}
      <Dialog
        open={confirming}
        onClose={() => !executing && setConfirming(false)}
        wide
        title={`Place ${orderRows.length} ${side === "SELL" ? "sell" : "buy"} order${orderRows.length === 1 ? "" : "s"}?`}
        description={`Market orders on NSE, CNC delivery. ${
          side === "SELL"
            ? `Estimated proceeds ${money(plan?.totals.tradeValue ?? 0, false)}.`
            : `Estimated spend ${money(plan?.totals.tradeValue ?? 0, false)}.`
        } Market orders fill at whatever the book offers, so the final amount will differ.`}
        actions={
          <>
            <button className="btn btn-tonal" onClick={() => setConfirming(false)} disabled={executing}>
              Cancel
            </button>
            <button
              className={`btn ${side === "SELL" ? "btn-danger" : "btn-filled"}`}
              onClick={execute}
              disabled={executing}
            >
              {executing && <Spinner />}
              {executing ? "Placing…" : `Yes, place ${orderRows.length}`}
            </button>
          </>
        }
      >
        <div className="table-wrap" style={{ maxHeight: 320 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Stock</th>
                <th>Qty</th>
                <th>Ref price</th>
                <th>Approx value</th>
              </tr>
            </thead>
            <tbody>
              {orderRows.map((r) => (
                <tr key={r.symbol}>
                  <td className="sym">{r.symbol}</td>
                  <td>{r.quantity.toLocaleString("en-IN")}</td>
                  <td>{money(r.price)}</td>
                  <td>{money(r.orderValue, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Dialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
      <span className="sub">{label}</span>
      <b className="tnum" style={{ fontSize: 15, fontWeight: 500 }}>
        {value}
      </b>
    </span>
  );
}

function ResultPanel({ result }: { result: ExecuteResult }) {
  const failed = result.results.filter((r) => !r.ok);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`banner ${failed.length ? "banner-warn" : "banner-info"}`}
      style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}
    >
      <div className="row" style={{ gap: 8 }}>
        <HugeiconsIcon
          icon={failed.length ? Alert02Icon : CheckmarkCircle02Icon}
          size={18}
          strokeWidth={2}
          style={{ color: failed.length ? "var(--warn)" : "var(--pos)" }}
        />
        <b>
          {result.placed} placed{failed.length ? `, ${failed.length} failed` : ""}
        </b>
        <span className="grow" />
        <span className="sub mono">run {result.runId.slice(0, 8)}</span>
      </div>
      {failed.map((f) => (
        <div key={f.symbol} className="sub">
          <b>{f.symbol}</b> ×{f.quantity} — {f.error}
        </div>
      ))}
    </motion.div>
  );
}
