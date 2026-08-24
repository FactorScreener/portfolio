import type { Quote } from "./quotes.ts";

export type PriceSource = "dhan" | "yahoo";

export type Mark = {
  price: number | null;
  source: PriceSource | null;
};

function positive(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** Dhan's holdings LTP when it has one; Yahoo only for names with no holding print. */
export function pickMarkPrice(dhanLtp: number, yahoo: Quote | undefined): Mark {
  if (positive(dhanLtp)) return { price: dhanLtp, source: "dhan" };
  if (yahoo && positive(yahoo.price)) return { price: yahoo.price, source: "yahoo" };
  return { price: null, source: null };
}
