import { useRef } from "react";

const SLIDE = "transform 0.12s ease-out, left 0.12s ease-out, width 0.12s ease-out, height 0.12s ease-out";
const FADE = "opacity 0.1s ease-out";

/**
 * A `.table-wrap` whose hover highlight is a single translucent strip that
 * slides between rows (the reactbench treatment) instead of a flat per-row
 * tint. The strip follows the mouse only, so touch never leaves it stranded.
 */
export function TableRowSpot({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const rowEl = useRef<HTMLElement | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  function paint(tr: HTMLElement, animate: boolean) {
    const wrap = wrapRef.current;
    const bar = barRef.current;
    if (!wrap || !bar) return;
    const wr = wrap.getBoundingClientRect();
    const r = tr.getBoundingClientRect();
    bar.style.transition = animate ? `${SLIDE}, ${FADE}` : "none";
    bar.style.transform = `translateY(${r.top - wr.top - wrap.clientTop + wrap.scrollTop}px)`;
    bar.style.left = `${r.left - wr.left - wrap.clientLeft + wrap.scrollLeft}px`;
    bar.style.width = `${r.width}px`;
    bar.style.height = `${r.height}px`;
  }

  function over(e: React.MouseEvent<HTMLDivElement>) {
    lastPoint.current = { x: e.clientX, y: e.clientY };
    const bar = barRef.current;
    const tr = (e.target as Element).closest?.("tbody tr") as HTMLElement | null;
    if (!tr || !bar) return;
    const prev = rowEl.current;
    rowEl.current = tr;
    // First sighting snaps the strip into place (no slide-in from the top);
    // every row change after that glides. See reactbench's overRow().
    const shown = bar.style.opacity === "1";
    if (shown && tr === prev) return;
    paint(tr, shown);
    bar.style.opacity = "1";
    if (!shown) {
      void bar.offsetWidth; // commit the snap before transitions turn back on
      bar.style.transition = `${SLIDE}, ${FADE}`;
    }
  }

  function leave() {
    lastPoint.current = null;
    rowEl.current = null;
    const bar = barRef.current;
    if (!bar) return;
    bar.style.transition = `${SLIDE}, ${FADE}`;
    bar.style.opacity = "0";
  }

  /** Scrolling moves the row under a still cursor: track the content exactly. */
  function onScroll() {
    const p = lastPoint.current;
    const wrap = wrapRef.current;
    const bar = barRef.current;
    if (!p || !wrap || !bar || !rowEl.current) return;
    const tr = document
      .elementsFromPoint(p.x, p.y)
      .map((el) => el.closest("tbody tr"))
      .find((t): t is HTMLElement => t instanceof HTMLElement);
    if (tr) rowEl.current = tr;
    paint(rowEl.current, false);
  }

  return (
    <div
      ref={wrapRef}
      className={`table-spot${className ? ` ${className}` : ""}`}
      onMouseOver={over}
      onMouseLeave={leave}
      onScroll={onScroll}
    >
      {children}
      <div ref={barRef} className="table-row-spot" aria-hidden style={{ opacity: 0 }} />
    </div>
  );
}
