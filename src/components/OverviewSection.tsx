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
              Quantity × last traded price, straight from Dhan's holdings feed —
              real time while the market is open. {s.count} scrips.
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
              Measured against yesterday's close, which comes from Yahoo Finance.
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
          Holdings <b style={{ color: "var(--ink-2)" }}>{s.count}</b>
        </span>
      </div>
    </>
  );
}
