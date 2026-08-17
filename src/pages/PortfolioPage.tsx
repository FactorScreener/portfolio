import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import type { Overview } from "../lib/api.ts";
import { timeAgo } from "../lib/format.ts";
import { OverviewSection } from "../components/OverviewSection.tsx";
import { Treemap, TreemapLegend } from "../components/Treemap.tsx";
import { Help, Spinner } from "../components/ui.tsx";

export function PortfolioPage({
  overview,
  loading,
  fetchedAt,
  onRefresh,
}: {
  overview: Overview | null;
  loading: boolean;
  fetchedAt: number | null;
  onRefresh: () => void;
}) {
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
