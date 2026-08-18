import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  RefreshIcon,
  Recycle03Icon,
} from "@hugeicons/core-free-icons";
import { api, type HistoryOrder, type HistoryRun } from "../lib/api.ts";
import { istDateTime, money } from "../lib/format.ts";
import { Help, Spinner, Switch } from "../components/ui.tsx";
import { TableRowSpot } from "../components/TableRowSpot.tsx";

export function HistoryPage() {
  const [runs, setRuns] = useState<HistoryRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDhanId, setShowDhanId] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const { runs: next, liveError: dhanErr } = await api.history();
      setRuns(next);
      setLiveError(dhanErr);
      setOpenId((id) => {
        if (id && next.some((r) => r.runId === id)) return id;
        // A phone cannot scan a 30-row table that opens itself; leave
        // the list collapsed until they pick a batch.
        if (window.matchMedia("(max-width: 700px)").matches) return null;
        return next[0]?.runId ?? null;
      });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="section section-history" aria-label="Rebalance history">
      <div className="section-head">
        <h2 className="section-title">History</h2>
        <Help>
          Every batch this machine sent to Dhan. A rebalance is two of these
          — sell the names you want out, then buy the names you want in —
          recorded separately so a mid-run failure stays obvious.
        </Help>
        <span className="section-spacer" />
        {runs && runs.length > 0 && (
          <div className="row dhan-id-toggle" style={{ gap: 8 }}>
            <span className="sub dhan-id-label">
              <span className="dhan-id-wide">Dhan Order ID</span>
              <span className="dhan-id-narrow">IDs</span>
            </span>
            <Switch
              checked={showDhanId}
              onChange={setShowDhanId}
              label="Show Dhan Order ID"
            />
          </div>
        )}
        <button
          className="icon-btn icon-btn-sm"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh history"
          title="Refresh"
        >
          {loading && runs ? (
            <Spinner size={15} />
          ) : (
            <HugeiconsIcon icon={RefreshIcon} size={16} strokeWidth={2} />
          )}
        </button>
      </div>

      {error && <div className="banner banner-neg">{error}</div>}
      {liveError && (
        <div className="banner banner-warn" style={{ marginBottom: 12 }}>
          Couldn’t refresh Dhan status — showing the last known state. {liveError}
        </div>
      )}

      {loading && !runs && (
        <div className="run-list">
          <div className="skeleton" style={{ height: 88, borderRadius: 28 }} />
          <div className="skeleton" style={{ height: 88, borderRadius: 28 }} />
        </div>
      )}

      {runs && runs.length === 0 && (
        <div className="card card-pad" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 6 }}>
            No runs yet
          </div>
          <p style={{ color: "var(--ink-2)", margin: "0 auto 18px", maxWidth: 420 }}>
            Place a plan from Rebalance and the orders will land here, one
            batch per side.
          </p>
          <Link to="/rebalance" className="btn btn-filled">
            <HugeiconsIcon icon={Recycle03Icon} size={17} strokeWidth={2} />
            Open Rebalance
          </Link>
        </div>
      )}

      {runs && runs.length > 0 && (
        <div className="run-list">
          {runs.map((run) => (
            <RunCard
              key={run.runId}
              run={run}
              open={openId === run.runId}
              showDhanId={showDhanId}
              onToggle={() =>
                setOpenId((id) => (id === run.runId ? null : run.runId))
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RunCard({
  run,
  open,
  showDhanId,
  onToggle,
}: {
  run: HistoryRun;
  open: boolean;
  showDhanId: boolean;
  onToggle: () => void;
}) {
  const preview = run.orders.slice(0, 4).map((o) => o.symbol).join(", ");
  const extra = run.orderCount - 4;

  return (
    <div className="card run-card" data-open={open}>
      <button
        type="button"
        className="run-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className={`tag ${run.side === "BUY" ? "tag-buy" : "tag-sell"}`}>
          {run.side === "BUY" ? "Buy" : "Sell"}
        </span>
        <span className="run-when-title">{istDateTime(run.placedAt)}</span>
        <span className="run-preview-slot" aria-hidden={open}>
          <span className="run-preview sub">
            {preview}
            {extra > 0 ? ` +${extra}` : ""}
          </span>
        </span>
        <span className="run-metrics">
          <span className="run-metric run-metric-orders">
            <span className="sub">Orders</span>
            <b className="tnum">{run.orderCount}</b>
          </span>
          <span className="run-metric run-metric-value">
            <span className="sub">Value</span>
            <b className="tnum">{money(run.notional, false)}</b>
          </span>
          <span className="run-metric run-metric-status">
            <span className="sub">Status</span>
            <span className={`pill ${runPill(run).cls}`}>{runPill(run).text}</span>
          </span>
        </span>
        <span className="run-chev" aria-hidden>
          <HugeiconsIcon icon={ArrowDown01Icon} size={18} strokeWidth={2} />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="run-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.36, ease: [0.2, 0, 0, 1] }}
            style={{ overflow: "hidden" }}
          >
            <TableRowSpot
              className={`table-wrap table-wrap-full run-table${run.orders.length > 1 ? " table-split" : ""}`}
            >
              {splitOrders(run.orders).map((orders, i) => (
                <OrderTable key={i} orders={orders} showDhanId={showDhanId} />
              ))}
            </TableRowSpot>
            <OrderCards orders={run.orders} showDhanId={showDhanId} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function splitOrders(orders: HistoryOrder[]): HistoryOrder[][] {
  const half = Math.ceil(orders.length / 2);
  return [orders.slice(0, half), orders.slice(half)].filter((rows) => rows.length > 0);
}

function OrderTable({
  orders,
  showDhanId,
}: {
  orders: HistoryOrder[];
  showDhanId: boolean;
}) {
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Stock</th>
          <th>Qty</th>
          <th>Price</th>
          <th>Value</th>
          <th>Status</th>
          {showDhanId && <th>Dhan Order ID</th>}
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id}>
            <td>
              <div className="sym">{o.symbol}</div>
              {o.error && <div className="sub neg">{o.error}</div>}
            </td>
            <td>
              {(o.filledQty ?? o.quantity).toLocaleString("en-IN")}
              {o.filledQty != null && o.filledQty !== o.quantity && (
                <div className="sub">of {o.quantity.toLocaleString("en-IN")}</div>
              )}
            </td>
            <td>
              {money(o.avgPrice)}
              <div className="sub">
                {o.refPrice != null ? `ref ${money(o.refPrice)}` : "\u00a0"}
              </div>
            </td>
            <td>{o.orderValue ? money(o.orderValue, false) : "—"}</td>
            <td>
              <span className={`pill ${statusTone(o.status)}`}>
                {prettyStatus(o.status)}
              </span>
            </td>
            {showDhanId && <td>{o.dhanOrderId ?? "—"}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OrderCards({
  orders,
  showDhanId,
}: {
  orders: HistoryOrder[];
  showDhanId: boolean;
}) {
  return (
    <ul className="order-cards">
      {orders.map((o) => {
        const filled = o.filledQty ?? o.quantity;
        const partial = o.filledQty != null && o.filledQty !== o.quantity;
        return (
          <li key={o.id} className="order-card">
            <div className="order-card-top">
              <div className="order-card-name">
                <div className="sym">{o.symbol}</div>
                {o.error && <div className="sub neg">{o.error}</div>}
              </div>
              <span className={`pill ${statusTone(o.status)}`}>
                {prettyStatus(o.status)}
              </span>
            </div>
            <div className="order-card-meta">
              <span className="tnum">
                {filled.toLocaleString("en-IN")}
                {partial && (
                  <span className="sub"> of {o.quantity.toLocaleString("en-IN")}</span>
                )}
                {" × "}
                {money(o.avgPrice)}
              </span>
              <b className="tnum">{o.orderValue ? money(o.orderValue, false) : "—"}</b>
            </div>
            {o.refPrice != null && (
              <div className="sub">ref {money(o.refPrice)}</div>
            )}
            {showDhanId && (
              <div className="sub">{o.dhanOrderId ?? "—"}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function prettyStatus(status: string): string {
  if (!status) return "—";
  if (status === "NO_FILL") return "Not filled";
  if (status === "PART_TRADED") return "Part traded";
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function statusTone(status: string): string {
  if (status === "TRADED") return "pill-live";
  if (["FAILED", "REJECTED"].includes(status)) return "pill-neg";
  if (
    ["NO_FILL", "CANCELLED", "EXPIRED", "PENDING", "TRANSIT", "PART_TRADED", "SENT"].includes(
      status,
    )
  ) {
    return "pill-warn";
  }
  return "";
}

function runPill(run: HistoryRun): { text: string; cls: string } {
  const traded = run.orders.filter((o) => o.status === "TRADED").length;
  const failed = run.orders.filter((o) =>
    ["FAILED", "REJECTED"].includes(o.status),
  ).length;
  const noFill = run.orders.filter((o) =>
    ["NO_FILL", "CANCELLED", "EXPIRED"].includes(o.status),
  ).length;
  const pending = run.orderCount - traded - failed - noFill;

  const parts: string[] = [];
  if (traded === run.orderCount) parts.push("All traded");
  else if (traded) parts.push(`${traded} traded`);
  if (noFill) parts.push(`${noFill} not filled`);
  if (failed) parts.push(`${failed} failed`);
  if (pending === run.orderCount) parts.push("Pending");
  else if (pending) parts.push(`${pending} pending`);

  const cls = failed ? "pill-neg" : noFill || pending ? "pill-warn" : traded ? "pill-live" : "";
  return { text: parts.join(" · ") || "All sent", cls };
}
