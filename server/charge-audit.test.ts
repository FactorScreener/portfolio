import { describe, expect, test } from "bun:test";
import { auditDateRange, summariseChargeAudit } from "./charge-audit.ts";
import type { DhanLedgerEntry, DhanTrade } from "./dhan.ts";

function trade(overrides: Partial<DhanTrade> = {}): DhanTrade {
  return {
    orderId: "private-order", securityId: "private-security", transactionType: "SELL",
    exchangeSegment: "NSE_EQ", productType: "CNC", exchangeTime: "2026-09-17 10:00:00",
    tradedQuantity: 10, tradedPrice: 100,
    sebiTax: "0.001", stt: 1, brokerageCharges: 0, serviceTax: "0.01",
    exchangeTransactionCharges: 0.03, stampDuty: 0, ...overrides,
  };
}

const dp: DhanLedgerEntry = {
  narration: "DP Transaction Charges", voucherdate: "Sep 18, 2026", exchange: "NSE_CASH",
  voucherdesc: "Charges for Sell / Pledge / Unpledge in your Demat Account",
  debit: "14.75", credit: "0",
};

describe("read-only charge audit", () => {
  test("uses India's date around UTC midnight, including weekends", () => {
    expect(auditDateRange(3, new Date("2026-09-20T19:00:00Z"))).toEqual({
      from: "2026-09-19", to: "2026-09-21",
    });
    expect(() => auditDateRange(0)).toThrow();
    expect(() => auditDateRange(NaN)).toThrow();
    expect(() => auditDateRange(91)).toThrow();
  });

  test("sums partial fills without counting the sell order twice", () => {
    const result = summariseChargeAudit([trade(), trade()], [dp]);
    expect(result.tradeDays).toEqual([{
      date: "2026-09-17", buyValue: 0, sellValue: 2000, sellOrderCount: 1, unpricedFillCount: 0,
      reportedTradingCharges: 2.08, netTradeDebitExcludingDp: -1997.92,
    }]);
    expect(result.ledgerEntries).toEqual([{
      date: "Sep 18, 2026", kind: "DP / pledge / unpledge", exchange: "NSE_CASH",
      debit: 14.75, credit: 0,
    }]);
    expect(JSON.stringify(result)).not.toContain("private-");
  });

  test("does not invent zero charges when the history omits a fee", () => {
    const result = summariseChargeAudit([trade({ stt: undefined })], []);
    expect(result.tradeDays[0]!.reportedTradingCharges).toBeNull();
    expect(result.tradeDays[0]!.netTradeDebitExcludingDp).toBeNull();
  });

  test("keeps trading ledger observations separate from fee settlement", () => {
    const result = summariseChargeAudit([
      trade({ transactionType: "BUY" }), trade({ productType: "INTRADAY" }),
    ], [
      { ...dp, narration: "Trades Executed", debit: "1001.04", voucherdate: "Sep 17, 2026" },
      { ...dp, narration: "Funds Deposited" },
    ]);
    expect(result.excludedTrades).toBe(1);
    expect(result.tradeDays[0]!.netTradeDebitExcludingDp).toBe(1001.04);
    expect(result.ledgerEntries).toHaveLength(1);
    expect(result.ledgerEntries[0]!.kind).toBe("Trades executed");
  });

  test("refuses incomplete fill data instead of producing a misleading report", () => {
    expect(() => summariseChargeAudit([trade({ exchangeTime: "NA" })], [])).toThrow();
    expect(() => summariseChargeAudit([trade({ tradedPrice: NaN })], [])).toThrow();
  });

  test("flags zero-price history records without assuming they are free trades", () => {
    const result = summariseChargeAudit([trade(), trade({ tradedPrice: 0 })], []);
    expect(result.tradeDays[0]!.sellValue).toBeNull();
    expect(result.tradeDays[0]!.unpricedFillCount).toBe(1);
    expect(result.tradeDays[0]!.netTradeDebitExcludingDp).toBeNull();
  });
});
