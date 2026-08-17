import type { Overview } from "../lib/api.ts";
import { RebalanceSection } from "../components/RebalanceSection.tsx";
import { Help } from "../components/ui.tsx";

export function RebalancePage({
  overview,
  onDone,
  notify,
}: {
  overview: Overview | null;
  onDone: () => void;
  notify: (kind: "ok" | "err", text: string) => void;
}) {
  return (
    <section className="section" aria-label="Rebalance">
      <div className="section-head">
        <h2 className="section-title">Rebalance</h2>
        <Help>
          Give it the basket you want to hold. It compares that against your
          current exposure — settled holdings plus today's open positions —
          and works out the whole-share orders that move you there, using
          that exposure plus available cash as the denominator.
        </Help>
      </div>
      <RebalanceSection
        overview={overview}
        onDone={onDone}
        notify={notify}
      />
    </section>
  );
}
