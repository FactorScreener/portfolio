export type TileInput = { key: string; value: number; [k: string]: unknown };
export type Tile<T> = { datum: T; x: number; y: number; w: number; h: number };

type Rect = { x: number; y: number; w: number; h: number };

const worst = (row: number[], side: number, sum: number): number => {
  if (row.length === 0 || sum <= 0 || side <= 0) return Infinity;
  const max = row[0] as number; // rows are fed largest-first
  const min = row[row.length - 1] as number;
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
};

/**
 * Squarified treemap (Bruls, Huizing & van Wijk). Keeps tiles close to square
 * so small holdings stay readable instead of collapsing into slivers.
 */
export function squarify<T extends TileInput>(
  data: T[],
  width: number,
  height: number,
): Tile<T>[] {
  const items = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  if (items.length === 0 || width <= 0 || height <= 0) return [];

  const total = items.reduce((s, d) => s + d.value, 0);
  const scale = (width * height) / total;
  const areas = items.map((d) => d.value * scale);

  const out: Tile<T>[] = [];
  let rect: Rect = { x: 0, y: 0, w: width, h: height };
  let i = 0;

  while (i < areas.length) {
    const side = Math.min(rect.w, rect.h);
    const row: number[] = [];
    let rowSum = 0;

    // Grow the current row while it improves the worst aspect ratio.
    while (i < areas.length) {
      const next = areas[i] as number;
      const current = worst(row, side, rowSum);
      const candidate = worst([...row, next], side, rowSum + next);
      if (row.length > 0 && candidate > current) break;
      row.push(next);
      rowSum += next;
      i++;
    }

    // Lay the row out along the shorter side, then shrink the rectangle.
    const horizontal = rect.w >= rect.h;
    const thickness = rowSum / side;
    let offset = 0;
    const start = i - row.length;

    for (let j = 0; j < row.length; j++) {
      const area = row[j] as number;
      const length = area / thickness;
      const datum = items[start + j] as T;
      out.push(
        horizontal
          ? { datum, x: rect.x, y: rect.y + offset, w: thickness, h: length }
          : { datum, x: rect.x + offset, y: rect.y, w: length, h: thickness },
      );
      offset += length;
    }

    rect = horizontal
      ? { x: rect.x + thickness, y: rect.y, w: rect.w - thickness, h: rect.h }
      : { x: rect.x, y: rect.y + thickness, w: rect.w, h: rect.h - thickness };

    if (rect.w < 0.5 || rect.h < 0.5) break;
  }

  return out;
}

/* ---------------------------------------------------------------- colour */

/**
 * Diverging red→neutral→green ramp keyed on return %. Steps are read from CSS
 * custom properties so the toggle repaints the map with the dark ramp rather
 * than dimming the light one.
 */
const STEPS = ["r4", "r3", "r2", "r1", "0", "g1", "g2", "g3", "g4"] as const;

/** Breakpoints in percent; index i covers returns up to BREAKS[i]. */
const BREAKS = [-25, -12, -5, -1, 1, 5, 12, 25];

export function heatIndex(pnlPct: number): number {
  for (let i = 0; i < BREAKS.length; i++) {
    if (pnlPct < (BREAKS[i] as number)) return i;
  }
  return BREAKS.length;
}

/**
 * Fill and label ink for a return %. Both are CSS custom properties, so a
 * theme switch repaints the tile and its label together — the ink can never
 * lag a step behind the fill.
 */
export function heatColors(pnlPct: number): { fill: string; ink: string } {
  const step = STEPS[heatIndex(pnlPct)];
  return { fill: `var(--heat-${step})`, ink: `var(--heat-${step}-ink)` };
}

export const HEAT_VARS = STEPS.map((s) => `var(--heat-${s})`);
