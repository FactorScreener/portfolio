import { motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon, ArrowDownRight01Icon } from "@hugeicons/core-free-icons";
import type { Overview } from "../lib/api.ts";
import { money, pct, signed } from "../lib/format.ts";
import { Help } from "./ui.tsx";

function Tile({
  label,
  value,
  delta,
  deltaPct,
  help,
  index,
}: {
  label: string;
  value: string;
  delta?: number;
  deltaPct?: number;
  help?: React.ReactNode;
  index: number;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <motion.div
      className="stat"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay: index * 0.05, ease: [0.2, 0, 0, 1] }}
    >
      <div className="stat-label">
        {label}
        {help && <Help>{help}</Help>}
      </div>
      <div className={`stat-value tnum ${delta === undefined ? "" : up ? "pos" : "neg"}`}>
        {value}
      </div>
      {delta !== undefined && (
        <div className={`stat-sub tnum ${up ? "pos" : "neg"}`}>
          <HugeiconsIcon
            icon={up ? ArrowUpRight01Icon : ArrowDownRight01Icon}
            size={15}
            strokeWidth={2.4}
          />
          {pct(deltaPct)}
        </div>
      )}
    </motion.div>
  );
}

export function OverviewSection({ data }: { data: Overview | null }) {
  if (!data) {
    return (
      <div className="skeleton" style={{ height: 124, borderRadius: 28 }} />
    );
  }

  const s = data.summary;
  const dayLabel = s.dayChange >= 0 ? "Today's Profit" : "Today's Loss";

  return (
    <>
      <div className="stat-grid">
        <Tile index={0} label="Investment" value={money(s.invested)} />
        <Tile
          index={1}
          label="Current Value"
          value={money(s.currentValue)}
          help={
            <>
              Quantity × last traded price across {s.count} scrips — your settled
              holdings plus today's open positions, so anything bought this
              morning is already counted.
              {s.positionsCount > 0 && (
                <>
                  {" "}
                  {money(s.positionsValue)} of it sits in {s.positionsCount} open
                  position{s.positionsCount === 1 ? "" : "s"}.
                </>
              )}
            </>
          }
        />
        <Tile
          index={2}
          label="Overall Profits"
          value={signed(s.pnl)}
          delta={s.pnl}
          deltaPct={s.pnlPct}
        />
        <Tile
          index={3}
          label={dayLabel}
          value={signed(s.dayChange)}
          delta={s.dayChange}
          deltaPct={s.dayChangePct}
          help={
            <>
              Settled holdings are measured against yesterday's close, which comes
              from Yahoo Finance; today's trades are measured from their own fill
              price, booked and open both.
              {data.pricing.dayChangeAvailable === false &&
                " Yahoo did not return a previous close, so this is incomplete."}
            </>
          }
        />
      </div>

      <div
        className="row wrap"
        style={{ marginTop: 12, marginLeft: 6, gap: 18, fontSize: 12.5, color: "var(--ink-muted)" }}
      >
        <span>
          Available cash <b className="tnum" style={{ color: "var(--ink-2)" }}>{money(data.funds.availabelBalance)}</b>
        </span>
        <span>
          Withdrawable <b className="tnum" style={{ color: "var(--ink-2)" }}>{money(data.funds.withdrawableBalance)}</b>
        </span>
        <span>
          Holdings <b style={{ color: "var(--ink-2)" }}>{s.holdingsCount}</b>
        </span>
        {s.positionsCount > 0 && (
          <span>
            Open positions{" "}
            <b style={{ color: "var(--ink-2)" }}>{s.positionsCount}</b>
            <Help>
              Today's trades, before they settle into holdings. They are counted in
              every number above and in the rebalancer, so a stock you bought this
              morning will not be bought again.
            </Help>
          </span>
        )}
        {s.realizedPnl !== 0 && (
          <span>
            Booked today{" "}
            <b className={`tnum ${s.realizedPnl >= 0 ? "pos" : "neg"}`}>
              {signed(s.realizedPnl)}
            </b>
            <Help>
              Profit or loss locked in by today's closed quantity. It is part of
              today's number but not of overall profit, which only marks what you
              still hold.
            </Help>
          </span>
        )}
        {s.ignoredPositions > 0 && (
          <span>
            <b style={{ color: "var(--ink-2)" }}>{s.ignoredPositions}</b> F&amp;O
            position{s.ignoredPositions === 1 ? "" : "s"} ignored
            <Help>
              This app only models the equity cash segment. Derivative, currency and
              commodity positions are left out of every number here.
            </Help>
          </span>
        )}
      </div>
    </>
  );
}
