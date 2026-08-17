/**
 * Target-weight maths, shared by the planner on the server and the CSV preview
 * in the browser. It lives here so the weights a user reads off the preview
 * table are the same numbers the orders are sized from.
 */

/** No single stock may exceed this share of the portfolio. */
export const CAP = 0.05;

export function normalise(weights: Map<string, number>): Map<string, number> {
  const sum = [...weights.values()].reduce((s, v) => s + v, 0);
  if (sum <= 0) return weights;
  return new Map([...weights].map(([k, v]) => [k, v / sum]));
}

/**
 * Cap every weight at `cap` and push the overflow onto the names still below
 * it, repeating because a redistribution can lift a name over the cap itself.
 * When every name sits at the cap the weights sum to under 1 and the shortfall
 * intentionally stays in cash.
 */
export function applyCap(weights: Map<string, number>, cap = CAP): Map<string, number> {
  const w = new Map(weights);
  for (let i = 0; i < 200; i++) {
    const over = [...w].filter(([, v]) => v > cap + 1e-12);
    if (over.length === 0) break;

    let excess = 0;
    for (const [k, v] of over) {
      excess += v - cap;
      w.set(k, cap);
    }

    const under = [...w].filter(([, v]) => v < cap - 1e-12);
    const underSum = under.reduce((s, [, v]) => s + v, 0);
    if (underSum <= 1e-12) break; // everything is capped; residual is cash

    for (const [k, v] of under) w.set(k, v + (excess * v) / underSum);
  }
  return w;
}
