import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Holding } from "../lib/api.ts";
import { money, moneyShort, pct } from "../lib/format.ts";
import { HEAT_VARS, heatColors, squarify } from "../lib/treemap.ts";

type Hover = { h: Holding; x: number; y: number } | null;

const GAP = 3;

export function Treemap({ holdings }: { holdings: Holding[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<Hover>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e?.contentRect.width ?? 0));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const height = width > 900 ? 460 : width > 620 ? 400 : 520;

  const tiles = useMemo(() => {
    const data = holdings
      .filter((h) => h.currentValue > 0)
      .map((h) => ({ key: h.tradingSymbol, value: h.currentValue, h }));
    return squarify(data, Math.max(0, width), height);
  }, [holdings, width, height]);

  if (holdings.length === 0) {
    return (
      <div className="banner banner-info" style={{ justifyContent: "center" }}>
        No holdings to plot.
      </div>
    );
  }

  return (
    <>
      <div ref={wrapRef} className="treemap" style={{ height }}>
        {tiles.map((t, i) => {
          const h = t.datum.h;
          const w = Math.max(0, t.w - GAP);
          const ht = Math.max(0, t.h - GAP);
          const { fill, ink } = heatColors(h.pnlPct);

          // Only draw text that actually fits; a cramped tile gets the ticker
          // alone, and a tiny one gets nothing but its tooltip.
          const showSym = w >= 46 && ht >= 24;
          const showPct = w >= 58 && ht >= 42;
          const symSize = Math.max(10, Math.min(19, Math.round(Math.min(w / 5.4, ht / 3.4))));

          return (
            <motion.div
              key={h.tradingSymbol}
              className="tm-cell"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1, left: t.x, top: t.y, width: w, height: ht }}
              transition={{
                duration: 0.4,
                delay: Math.min(i * 0.012, 0.25),
                ease: [0.2, 0, 0, 1],
              }}
              style={{ background: fill, color: ink }}
              onMouseEnter={(e) => setHover({ h, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHover({ h, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHover(null)}
              tabIndex={0}
              onFocus={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setHover({ h, x: r.left + r.width / 2, y: r.top });
              }}
              onBlur={() => setHover(null)}
              aria-label={`${h.tradingSymbol}, ${money(h.currentValue)}, ${pct(h.pnlPct)}`}
            >
              {showSym && (
                <span className="tm-sym" style={{ fontSize: symSize }}>
                  {h.tradingSymbol}
                </span>
              )}
              {showPct && (
                <span className="tm-pct" style={{ fontSize: Math.max(10, symSize - 5) }}>
                  {pct(h.pnlPct, 1)}
                </span>
              )}
            </motion.div>
          );
        })}
      </div>

      {hover && <TreemapTooltip hover={hover} />}
    </>
  );
}

function TreemapTooltip({ hover }: { hover: NonNullable<Hover> }) {
  const { h, x, y } = hover;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 14, top: y + 14 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.min(x + 14, window.innerWidth - r.width - 12),
      top: Math.min(y + 14, window.innerHeight - r.height - 12),
    });
  }, [x, y]);

  return (
    <div ref={ref} className="tooltip" style={pos} role="tooltip">
      <div className="tooltip-title">{h.tradingSymbol}</div>
      {h.name && (
        <div className="sub" style={{ marginBottom: 6 }}>
          {h.name}
        </div>
      )}
      <div className="tooltip-row">
        <span>Value</span>
        <b>{money(h.currentValue)}</b>
      </div>
      <div className="tooltip-row">
        <span>Qty × LTP</span>
        <b>
          {h.totalQty} × {money(h.price)}
        </b>
      </div>
      <div className="tooltip-row">
        <span>Avg cost</span>
        <b>{money(h.avgCostPrice)}</b>
      </div>
      <div className="tooltip-row">
        <span>Return</span>
        <b className={h.pnl >= 0 ? "pos" : "neg"}>
          {money(h.pnl)} · {pct(h.pnlPct)}
        </b>
      </div>
      <div className="tooltip-row">
        <span>Today</span>
        <b className={h.dayChange >= 0 ? "pos" : "neg"}>
          {moneyShort(h.dayChange)} · {pct(h.dayChangePct)}
        </b>
      </div>
    </div>
  );
}

export function TreemapLegend() {
  return (
    <div className="tm-legend">
      <span>Loss</span>
      <div className="tm-legend-bar" aria-hidden>
        {HEAT_VARS.map((v) => (
          <span key={v} style={{ background: v }} />
        ))}
      </div>
      <span>Gain</span>
      <span style={{ marginLeft: 4 }}>· area = current value</span>
    </div>
  );
}
