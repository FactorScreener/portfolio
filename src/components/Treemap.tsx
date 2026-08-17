import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Holding } from "../lib/api.ts";
import { money, moneyShort, pct } from "../lib/format.ts";
import { HEAT_VARS, heatColors, squarify } from "../lib/treemap.ts";

type Hover = { h: Holding; x: number; y: number } | null;

const GAP = 3;

/** Half a gap between two tiles, nothing against the treemap's outer edge. */
const inset = (edge: number, bound: number) => (Math.abs(edge - bound) < 0.5 ? 0 : GAP / 2);

/** Shared offscreen canvas for measuring ticker widths, so labels can shrink to
 *  fit a tile instead of trailing off into an ellipsis. */
const measureText = (() => {
  let ctx: CanvasRenderingContext2D | null | undefined;
  return (text: string, size: number) => {
    if (ctx === undefined) {
      ctx =
        typeof document === "undefined"
          ? null
          : document.createElement("canvas").getContext("2d");
    }
    if (!ctx) return text.length * size * 0.62;
    ctx.font = `600 ${size}px "Google Sans", "Google Sans Text", system-ui, sans-serif`;
    return ctx.measureText(text).width;
  };
})();

const MIN_LABEL = 8;

/** Largest size (≤ maxSize) at which `text` still fits inside `maxWidth`. */
function fitTicker(text: string, maxWidth: number, maxSize: number) {
  if (maxWidth <= 0) return MIN_LABEL;
  const wid = measureText(text, maxSize);
  if (wid <= maxWidth) return maxSize;
  return Math.max(MIN_LABEL, Math.floor((maxSize * maxWidth) / wid));
}

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
        Nothing to plot — no holdings or open positions.
      </div>
    );
  }

  return (
    <>
      <div ref={wrapRef} className="treemap" style={{ height }}>
        {tiles.map((t) => {
          const h = t.datum.h;
          // Split the gap between neighbours and keep the outer edges flush, so
          // the wrapper's rounded corners stay filled and only the seams show.
          const l = inset(t.x, 0);
          const r = inset(width, t.x + t.w);
          const tp = inset(t.y, 0);
          const b = inset(height, t.y + t.h);
          const x = t.x + l;
          const y = t.y + tp;
          const w = Math.max(0, t.w - l - r);
          const ht = Math.max(0, t.h - tp - b);
          const { fill, ink } = heatColors(h.pnlPct);

          // Only draw text that actually fits; a cramped tile gets the ticker
          // alone, and a tiny one gets nothing but its tooltip.
          const showSym = w >= 46 && ht >= 24;
          const showPct = w >= 58 && ht >= 42;
          const availW = Math.max(0, w - 10);
          const symSize = showSym ? fitTicker(h.tradingSymbol, availW, Math.min(19, Math.floor(ht / 3.4))) : 0;

          return (
            <div
              key={h.tradingSymbol}
              className="tm-cell"
              style={{ left: x, top: y, width: w, height: ht, background: fill, color: ink }}
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
                <span className="tm-pct" style={{ fontSize: Math.max(8, symSize - 4) }}>
                  {pct(h.pnlPct, 1)}
                </span>
              )}
            </div>
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
      {h.positionQty !== 0 && (
        <div className="tooltip-row">
          <span>{h.positionQty > 0 ? "Bought today" : "Sold today"}</span>
          <b>{Math.abs(h.positionQty)} shares</b>
        </div>
      )}
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
