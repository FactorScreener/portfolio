import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import type { Plan, PlanRow } from "../lib/api.ts";
import { money, moneyShort, pct } from "../lib/format.ts";
import { SideSwitch } from "./ui.tsx";

const TAGS: Record<PlanRow["action"], { label: string; cls: string }> = {
  buy: { label: "Buy", cls: "tag-buy" },
  sell: { label: "Trim", cls: "tag-sell" },
  exit: { label: "Exit", cls: "tag-exit" },
  hold: { label: "Hold", cls: "tag-hold" },
  blocked: { label: "Blocked", cls: "tag-blocked" },
};

export function PlanTable({ plan }: { plan: Plan }) {
  // Only rows with orders show by default — the plan is easier to scan when
  // holds and blocks stay one click away.
  const [filter, setFilter] = useState<"orders" | "all">("orders");

  const rows = useMemo(() => {
    const withOrders = plan.rows.filter((r) => r.side && r.quantity > 0);
    const rest = plan.rows.filter((r) => !(r.side && r.quantity > 0));
    const sortByValue = (a: PlanRow, b: PlanRow) => b.orderValue - a.orderValue;
    const sortByWeight = (a: PlanRow, b: PlanRow) =>
      b.targetWeight - a.targetWeight || b.currentValue - a.currentValue;
    return filter === "orders"
      ? [...withOrders].sort(sortByValue)
      : [...withOrders.sort(sortByValue), ...rest.sort(sortByWeight)];
  }, [plan, filter]);

  const orderCount = plan.rows.filter((r) => r.side && r.quantity > 0).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="row wrap">
        <SideSwitch
          name="Rows shown"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "orders", label: `Orders (${orderCount})` },
            { value: "all", label: `All (${plan.rows.length})` },
          ]}
        />
        <span className="grow" />
        <span className="sub">
          Target weights sum to {(plan.totals.targetWeightSum * 100).toFixed(1)}%
        </span>
      </div>

      <div className="table-wrap table-wrap-full">
        <table className="data">
          <thead>
            <tr>
              <th>Stock</th>
              <th>Action</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Order value</th>
              <th>Now</th>
              <th>Target</th>
              <th>Exposure</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tag = TAGS[r.action];
              return (
                <tr key={r.symbol}>
                  <td>
                    <div className="sym">{r.symbol}</div>
                    {r.name && (
                      <div
                        className="sub"
                        style={{ maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {r.name}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`tag ${tag.cls}`}>{tag.label}</span>
                    {r.skipped && (
                      <div className="sub" style={{ marginTop: 2 }}>
                        {r.skipped}
                      </div>
                    )}
                  </td>
                  <td className={r.quantity ? "" : "muted"}>
                    {r.quantity ? r.quantity.toLocaleString("en-IN") : "—"}
                  </td>
                  <td>
                    {money(r.price)}
                    {r.priceSource === "yahoo" && (
                      <span className="sub" title="Yahoo Finance, 15 min delayed">
                        {" "}
                        ⁺
                      </span>
                    )}
                  </td>
                  <td className={r.orderValue ? "" : "muted"}>
                    {r.orderValue ? money(r.orderValue, false) : "—"}
                  </td>
                  <td className="muted">{pct(r.currentWeight * 100, 2)}</td>
                  <td>
                    <span className="wbar" style={{ ["--w" as string]: `${Math.min(100, r.targetWeight * 100 * 4)}%` }}>
                      {r.targetWeight > 0 ? pct(r.targetWeight * 100, 2) : "—"}
                    </span>
                  </td>
                  <td className="muted">
                    {r.currentQty ? `${r.currentQty} · ${moneyShort(r.currentValue)}` : "—"}
                    {r.positionQty !== 0 && (
                      <div className="sub">
                        {r.holdingQty} held
                        {r.positionQty > 0
                          ? ` + ${r.positionQty} bought today`
                          : ` − ${-r.positionQty} sold today`}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 32 }}>
                  <HugeiconsIcon icon={Alert02Icon} size={18} strokeWidth={2} />
                  <div style={{ marginTop: 6 }}>
                    Nothing to {plan.side === "BUY" ? "buy" : "sell"} — the portfolio already
                    matches these targets.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="sub">
        ⁺ priced from Yahoo Finance (15 min delayed). Everything you already hold is
        priced from Dhan in real time. Exposure counts settled holdings plus today's
        open positions.
      </div>
    </div>
  );
}
