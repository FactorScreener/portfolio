import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, RefreshIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { Holding, Overview } from "../lib/api.ts";
import { timeAgo } from "../lib/format.ts";
import { OverviewSection } from "../components/OverviewSection.tsx";
import { Treemap, TreemapLegend } from "../components/Treemap.tsx";
import { Help, Spinner } from "../components/ui.tsx";

/** Tickers with a live allocation, largest first. */
function allocatedTickers(holdings: Holding[]): string[] {
  return holdings
    .filter((h) => h.currentValue > 0)
    .sort((a, b) => b.currentValue - a.currentValue || a.tradingSymbol.localeCompare(b.tradingSymbol))
    .map((h) => h.tradingSymbol);
}

export function PortfolioPage({
  overview,
  loading,
  fetchedAt,
  onRefresh,
  notify,
}: {
  overview: Overview | null;
  loading: boolean;
  fetchedAt: number | null;
  onRefresh: () => void;
  notify: (kind: "ok" | "err", text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const tickers = overview ? allocatedTickers(overview.holdings) : [];

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  async function copyTickers() {
    if (tickers.length === 0) return;
    try {
      await navigator.clipboard.writeText(tickers.join("\n"));
      setCopied(true);
      notify("ok", `Copied ${tickers.length} ticker${tickers.length === 1 ? "" : "s"}`);
    } catch {
      notify("err", "Could not copy to the clipboard");
    }
  }

  return (
    <>
      {/* ------------------------------------------ 1. portfolio overview */}
      <section className="section" aria-label="Portfolio overview">
        <div className="section-head">
          <h2 className="section-title">Portfolio</h2>
          <span className="section-spacer" />
          <span className="sub">{fetchedAt ? `Updated ${timeAgo(fetchedAt)}` : ""}</span>
          <button
            className="icon-btn icon-btn-sm"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh portfolio"
            title="Refresh"
          >
            {loading ? (
              <Spinner size={15} />
            ) : (
              <HugeiconsIcon icon={RefreshIcon} size={16} strokeWidth={2} />
            )}
          </button>
        </div>
        <OverviewSection data={overview} />
      </section>

      {/* --------------------------------------------------- 2. treemap */}
      <section className="section" aria-label="Allocation treemap">
        <div className="section-head">
          <h2 className="section-title">Allocation</h2>
          <Help>
            Each rectangle is one stock you are exposed to — settled holdings
            plus today's open positions. Area is its current value; colour is
            its overall return — deeper green for larger gains, deeper red for
            larger losses.
          </Help>
          <span className="section-spacer" />
          <button
            type="button"
            className="btn btn-text btn-sm"
            onClick={() => void copyTickers()}
            disabled={tickers.length === 0}
            aria-label="Copy allocated tickers"
            title="Copy the tickers you currently hold"
          >
            <HugeiconsIcon
              icon={copied ? Tick02Icon : Copy01Icon}
              size={15}
              strokeWidth={2}
            />
            {copied ? "Copied" : "Copy tickers"}
          </button>
          <TreemapLegend />
        </div>
        <div className="card full-bleed" style={{ padding: "12px 0" }}>
          {overview ? (
            <Treemap holdings={overview.holdings} />
          ) : (
            <div className="skeleton" style={{ height: 460 }} />
          )}
        </div>
      </section>
    </>
  );
}
