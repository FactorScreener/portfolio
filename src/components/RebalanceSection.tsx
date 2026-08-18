import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  CheckmarkCircle02Icon,
  PlayIcon,
  Recycle03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Link } from "react-router-dom";
import { api, type ExecuteResult, type Overview, type Plan } from "../lib/api.ts";
import { toNumber } from "../lib/csv.ts";
import { money } from "../lib/format.ts";
import { Dialog, Help, SideSwitch, Spinner, Switch } from "./ui.tsx";
import { PlanTable } from "./PlanTable.tsx";
import { TargetInput, type TargetSource } from "./TargetInput.tsx";

type Side = "BUY" | "SELL";

/** The three decisions a run is made of, in the order they have to happen. */
const STEPS = ["Choose a side", "Build the basket", "Review and place"] as const;

export function RebalanceSection({
  overview,
  onDone,
  notify,
}: {
  overview: Overview | null;
  onDone: () => void;
  notify: (kind: "ok" | "err", text: string) => void;
}) {
  const [step, setStep] = useState(0);
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

  /**
   * `over` lets a control that has just changed re-plan with its new value
   * without waiting for the state update to land.
   */
  async function preview(over?: { capAt5Pct?: boolean }) {
    setPlanning(true);
    setResult(null);
    try {
      const p = await api.plan({
        side,
        targets,
        weightMode,
        capAt5Pct: over?.capAt5Pct ?? capAt5Pct,
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

  /** Nothing past the basket means anything until the basket has names in it. */
  const reachable = (i: number) => i <= 1 || canPreview;

  const stateOf = (i: number): StepState =>
    i === step ? "active" : i < step ? "done" : reachable(i) ? "todo" : "locked";

  /** One line of what the collapsed step decided, so the rail stays readable. */
  const summaries: [string, string, string] = [
    side === "SELL" ? "Sell only" : "Buy only",
    !canPreview
      ? "Nothing picked yet"
      : [
          source.kind === "csv"
            ? `${source.sheet.fileName} · ${targets.length} rows`
            : `${targets.length} ticker${targets.length === 1 ? "" : "s"}`,
          weightColumn ? `weights from “${weightColumn}”` : "equal weights",
          capAt5Pct ? "capped at 5%" : null,
          side === "BUY" && cashOverride.trim() ? `₹${cashOverride.trim()} to deploy` : null,
        ]
          .filter(Boolean)
          .join(" · "),
    plan
      ? plan.totals.orderCount === 0
        ? "Already on target"
        : `${plan.totals.orderCount} order${plan.totals.orderCount === 1 ? "" : "s"} · ${money(plan.totals.tradeValue, false)}`
      : "Not previewed yet",
  ];

  function goto(i: number) {
    if (reachable(i)) setStep(i);
  }

  /** Step 2 → 3 always re-prices: the rules above it may have just changed. */
  function toReview() {
    setStep(2);
    void preview();
  }

  return (
    <div className="card card-pad">
      <div className="stepper">
        {/* ------------------------------------------------------ 1. side */}
        <Step
          index={0}
          title={STEPS[0]}
          state={stateOf(0)}
          summary={summaries[0]}
          onOpen={() => goto(0)}
        >
          <div className="row wrap" style={{ gap: 12 }}>
            <SideSwitch
              name="Order side"
              value={side}
              onChange={(s) => {
                setSide(s);
                invalidate();
              }}
              options={[
                { value: "SELL", label: "Sell only", tone: "neg", icon: ArrowDown01Icon },
                { value: "BUY", label: "Buy only", tone: "pos", icon: ArrowUp01Icon },
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

          <div className="step-actions">
            <Next onClick={() => setStep(1)} />
          </div>
        </Step>

        {/* ------------------------------------------ 2. basket + rules */}
        <Step
          index={1}
          title={STEPS[1]}
          state={stateOf(1)}
          summary={summaries[1]}
          onOpen={() => goto(1)}
        >
          <TargetInput
            source={source}
            onChange={(s) => {
              setSource(s);
              invalidate();
            }}
            notify={notify}
            capAt5Pct={capAt5Pct}
          />

          <div className="step-panel">
            <div className="row" style={{ gap: 10 }}>
              <Switch
                checked={capAt5Pct}
                onChange={(v) => {
                  setCapAt5Pct(v);
                  // Re-price straight away so the table's Target column reflects the
                  // cap instead of blanking the plan out.
                  if (plan) void preview({ capAt5Pct: v });
                  else invalidate();
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

          <div className="step-actions">
            <button className="btn btn-filled" onClick={toReview} disabled={!canPreview}>
              <HugeiconsIcon icon={Recycle03Icon} size={17} strokeWidth={2} />
              Preview orders
            </button>
            {!canPreview && <span className="sub">Add tickers or a CSV to continue</span>}
          </div>
        </Step>

        {/* --------------------------------------------------- 3. review */}
        <Step
          index={2}
          title={STEPS[2]}
          state={stateOf(2)}
          summary={summaries[2]}
          onOpen={() => {
            if (!reachable(2)) return;
            setStep(2);
            if (!plan && !planning) void preview();
          }}
        >
          {planning && !plan && (
            <div className="row sub" style={{ gap: 8 }}>
              <Spinner />
              Pricing the basket against your current exposure…
            </div>
          )}

          {!planning && !plan && (
            <div className="step-actions">
              <button className="btn btn-tonal" onClick={() => void preview()} disabled={!canPreview}>
                <HugeiconsIcon icon={Recycle03Icon} size={17} strokeWidth={2} />
                Preview orders
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            {plan && (
              <motion.div
                key="plan"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: planning ? 0.45 : 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                <div className="row wrap" style={{ gap: 10 }}>
                  <button
                    className="btn btn-tonal"
                    onClick={() => void preview()}
                    disabled={!canPreview || planning}
                  >
                    {planning ? (
                      <Spinner />
                    ) : (
                      <HugeiconsIcon icon={Recycle03Icon} size={17} strokeWidth={2} />
                    )}
                    {planning ? "Calculating" : "Recalculate"}
                  </button>

                  {plan.totals.orderCount > 0 && (
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

                  <span className="row" style={{ gap: 16 }}>
                    <Metric
                      label={side === "SELL" ? "Proceeds" : "Deploying"}
                      value={money(plan.totals.tradeValue, false)}
                    />
                    <Metric label="Cash after" value={money(plan.totals.cashAfter, false)} />
                  </span>
                </div>

                {plan.warnings.map((w, i) => (
                  <div key={i} className="banner banner-warn">
                    <HugeiconsIcon
                      icon={Alert02Icon}
                      size={17}
                      strokeWidth={2}
                      style={{ flex: "none", marginTop: 1 }}
                    />
                    <span>{w}</span>
                  </div>
                ))}

                <PlanTable plan={plan} />
              </motion.div>
            )}
          </AnimatePresence>

          {result && <ResultPanel result={result} />}
        </Step>
      </div>

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

/* ------------------------------------------------------------------ step */

type StepState = "active" | "done" | "todo" | "locked";

/**
 * One rung of the rail: dot, title, and a body that only exists while the step
 * is open. Collapsed steps fall back to their summary line and stay clickable
 * so any earlier decision is one click away.
 */
function Step({
  index,
  title,
  state,
  summary,
  onOpen,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  summary: string;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  const open = state === "active";
  const last = index === STEPS.length - 1;

  return (
    <div className="step" data-state={state}>
      <div className="step-rail" aria-hidden>
        <div className="step-dot">
          <AnimatePresence mode="wait" initial={false}>
            {state === "done" ? (
              <motion.span
                key="tick"
                style={{ display: "grid" }}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ type: "spring", stiffness: 620, damping: 30 }}
              >
                <HugeiconsIcon icon={Tick02Icon} size={16} strokeWidth={3} />
              </motion.span>
            ) : (
              <motion.span
                key="num"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {index + 1}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {!last && (
          <div className="step-line" style={{ ["--fill" as string]: state === "done" ? 1 : 0 }} />
        )}
      </div>

      <div className="step-main">
        <button
          type="button"
          className="step-head"
          onClick={onOpen}
          disabled={state === "locked" || open}
          aria-expanded={open}
        >
          <span className="step-title">{title}</span>
          <AnimatePresence initial={false}>
            {!open && (
              <motion.span
                className="step-summary"
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {summary}
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        <Collapse open={open}>
          <div className="step-body">{children}</div>
        </Collapse>
      </div>
    </div>
  );
}

/**
 * Height animation has to clip while it runs, but the steps contain dropdowns
 * and autocomplete menus that overflow their box — so the clip is dropped the
 * moment the step has settled open.
 */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [settled, setSettled] = useState(open);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
          onAnimationStart={() => setSettled(false)}
          onAnimationComplete={() => setSettled(true)}
          style={{ overflow: settled ? "visible" : "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Next({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button className="btn btn-tonal" onClick={onClick} disabled={disabled}>
      Continue
      <HugeiconsIcon icon={ArrowRight01Icon} size={17} strokeWidth={2.2} />
    </button>
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
        <Link to="/history" className="btn btn-text btn-sm">
          View history
        </Link>
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
