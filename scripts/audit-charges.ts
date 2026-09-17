import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { auditDateRange, summariseChargeAudit } from "../server/charge-audit.ts";
import { estimateTodaysCharges } from "../server/charges.ts";
import { getCredentials, getFunds, getLedger, getOrders, getTradeHistory } from "../server/dhan.ts";

try {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error("Usage: bun run audit:charges [days, default 30]");
  const startedAt = new Date();
  const range = auditDateRange(args[0] === undefined ? 30 : Number(args[0]), startedAt);
  const creds = getCredentials();
  if (!creds) throw new Error("Connect your Dhan account in Settings first.");

  // These four operations only read account data. They never place orders.
  const [funds, orders, ledger, trades] = await Promise.all([
    getFunds(creds), getOrders(creds), getLedger(creds, range.from, range.to),
    getTradeHistory(creds, range.from, range.to),
  ]);
  if (!Array.isArray(orders)) throw new Error("Dhan returned an invalid order book.");
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    range,
    note: "Read-only observations, not proof of fee settlement. API responses are not an atomic snapshot. DP entries can include pledge/unpledge. Compare snapshots taken before a sell, after its fill, and the next trading morning; account for other trades and fund transfers.",
    funds: {
      availableBalance: funds.availabelBalance,
      startOfDayBalance: funds.sodLimit,
      receivableAmount: funds.receiveableAmount,
      utilizedAmount: funds.utilizedAmount,
      withdrawableBalance: funds.withdrawableBalance,
    },
    today: {
      orderCount: orders.length,
      filledOrderCount: orders.filter((o) => o.filledQty > 0).length,
      delivery: estimateTodaysCharges(orders),
    },
    ...summariseChargeAudit(trades, ledger),
  };
  // No credentials, client IDs, order IDs or symbols are written to the report.
  // Financial totals remain private under the gitignored data directory.
  const dir = "data/charge-audits";
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = `${dir}/${startedAt.toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}.json`;
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(`Saved read-only charge audit to ${path}`);
  console.log(`Found ${report.tradeDays.length} delivery trade days, ${report.ledgerEntries.length} relevant ledger entries, and ${report.today.filledOrderCount} filled orders today.`);
  console.log("This report does not release or change the planner's cash reserve.");
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
