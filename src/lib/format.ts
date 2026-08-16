const inr = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ₹ 14,76,506.97 — Indian digit grouping, always two decimals. */
export function money(n: number | null | undefined, decimals = true): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  return `${sign}₹${decimals ? inr.format(v) : inr0.format(v)}`;
}

/** Compact form for dense cells: ₹16.78L, ₹1.24Cr. */
export function moneyShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${sign}₹${(v / 1e3).toFixed(1)}K`;
  return `${sign}₹${v.toFixed(0)}`;
}

export function pct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(digits)}%`;
}

export function signed(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : "-"}₹${inr.format(Math.abs(n))}`;
}

export function num(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return inr.format(Number(n.toFixed(digits)));
}

export function timeAgo(ms: number | null): string {
  if (!ms) return "—";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function istTime(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}
