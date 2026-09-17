import { getSetting, setSetting } from "./db.ts";

const BASE = "https://api.dhan.co/v2";

export type Credentials = { clientId: string; accessToken: string };

export function getCredentials(): Credentials | null {
  const clientId = getSetting("dhan_client_id");
  const accessToken = getSetting("dhan_access_token");
  if (!clientId || !accessToken) return null;
  return { clientId, accessToken };
}

export function saveCredentials(c: Credentials): void {
  setSetting("dhan_client_id", c.clientId.trim());
  setSetting("dhan_access_token", c.accessToken.trim());
}

export function clearCredentials(): void {
  setSetting("dhan_client_id", "");
  setSetting("dhan_access_token", "");
}

/** Dhan returns HTTP 200 with an `errorCode` body for most business errors. */
export class DhanError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly status: number,
  ) {
    super(message);
    this.name = "DhanError";
  }
}

async function call<T>(
  creds: Credentials,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "access-token": creds.accessToken,
      "client-id": creds.clientId,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init.headers,
    },
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new DhanError(text.slice(0, 300) || res.statusText, undefined, res.status);
  }

  if (!res.ok) {
    const b = body as Record<string, unknown> | null;
    const msg =
      (b?.errorMessage as string) ??
      (b?.message as string) ??
      (typeof b?.data === "string" ? b.data : null) ??
      `Dhan request failed (${res.status})`;
    throw new DhanError(msg, b?.errorCode as string | undefined, res.status);
  }

  const b = body as Record<string, unknown> | null;
  if (b && !Array.isArray(b) && (b.errorCode || b.status === "failed")) {
    throw new DhanError(
      (b.errorMessage as string) ??
        (b.internalErrorMessage as string) ??
        JSON.stringify(b.data ?? b).slice(0, 300),
      b.errorCode as string | undefined,
      res.status,
    );
  }

  return body as T;
}

export type DhanHolding = {
  exchange: string;
  tradingSymbol: string;
  securityId: string;
  isin: string;
  totalQty: number;
  dpQty: number;
  t1Qty: number;
  availableQty: number;
  collateralQty: number;
  avgCostPrice: number;
  lastTradedPrice: number;
};

export function getHoldings(creds: Credentials) {
  return call<DhanHolding[]>(creds, "/holdings");
}

export type DhanPosition = {
  dhanClientId: string;
  tradingSymbol: string;
  securityId: string;
  positionType: "LONG" | "SHORT" | "CLOSED";
  exchangeSegment: string;
  productType: string;
  buyAvg: number;
  buyQty: number;
  costPrice: number;
  sellAvg: number;
  sellQty: number;
  /** buyQty − sellQty. Negative means net short. */
  netQty: number;
  realizedProfit: number;
  unrealizedProfit: number;
  dayBuyQty: number;
  daySellQty: number;
};

/** Today's open positions, including anything bought today that has not yet
 *  settled into the holdings feed. */
export function getPositions(creds: Credentials) {
  return call<DhanPosition[]>(creds, "/positions");
}

export type DhanFunds = {
  dhanClientId: string;
  availabelBalance: number;
  sodLimit: number;
  collateralAmount: number;
  receiveableAmount: number;
  utilizedAmount: number;
  withdrawableBalance: number;
};

export function getFunds(creds: Credentials) {
  return call<DhanFunds>(creds, "/fundlimit");
}

export type DhanOrder = {
  dhanClientId: string;
  orderId: string;
  orderStatus: string;
  transactionType: string;
  exchangeSegment: string;
  productType: string;
  orderType: string;
  tradingSymbol: string;
  securityId: string;
  quantity: number;
  price: number;
  averageTradedPrice: number;
  filledQty: number;
  createTime: string;
  updateTime: string;
  omsErrorDescription?: string;
};

export function getOrders(creds: Credentials) {
  return call<DhanOrder[]>(creds, "/orders");
}

export type DhanTrade = {
  orderId: string;
  securityId: string;
  transactionType: string;
  tradedQuantity: number;
  tradedPrice: number;
  customSymbol?: string | null;
  tradingSymbol?: string | null;
  exchangeSegment?: string;
  productType?: string;
  exchangeTime?: string;
  sebiTax?: number | string;
  stt?: number | string;
  brokerageCharges?: number | string;
  serviceTax?: number | string;
  exchangeTransactionCharges?: number | string;
  stampDuty?: number | string;
};

export type DhanLedgerEntry = {
  narration: string;
  voucherdate: string;
  exchange: string;
  voucherdesc: string;
  debit: string;
  credit: string;
};

/** Read-only report. Narration does not identify which sell a DP debit pays. */
export async function getLedger(creds: Credentials, fromDate: string, toDate: string) {
  const rows = await call<DhanLedgerEntry[]>(
    creds,
    `/ledger?from-date=${fromDate}&to-date=${toDate}`,
  );
  if (!Array.isArray(rows)) throw new Error("Dhan returned an invalid ledger report.");
  return rows;
}

/** Paginated fills across a date range. Dhan's day order book does not keep
 *  yesterday; this is how a past rebalance is confirmed. */
export async function getTradeHistory(
  creds: Credentials,
  fromDate: string,
  toDate: string,
): Promise<DhanTrade[]> {
  const out: DhanTrade[] = [];
  for (let page = 0; page < 50; page++) {
    const rows = await call<DhanTrade[]>(
      creds,
      `/trades/${fromDate}/${toDate}/${page}`,
    );
    if (!Array.isArray(rows)) throw new Error("Dhan returned an invalid trade history report.");
    if (rows.length === 0) return out;
    out.push(...rows);
  }
  throw new Error("Trade history exceeded 50 pages. Request a shorter date range.");
}

export function cancelOrder(creds: Credentials, orderId: string) {
  return call<{ orderId: string; orderStatus: string }>(
    creds,
    `/orders/${orderId}`,
    { method: "DELETE" },
  );
}

export type PlaceOrderInput = {
  securityId: string;
  transactionType: "BUY" | "SELL";
  quantity: number;
  /** MARKET leaves price at 0; LIMIT requires a tick-aligned price. */
  orderType: "MARKET" | "LIMIT";
  price?: number;
  correlationId?: string;
};

/** Every order this app places is NSE cash + CNC delivery, by design. */
export function placeOrder(creds: Credentials, o: PlaceOrderInput) {
  return call<{ orderId: string; orderStatus: string }>(creds, "/orders", {
    method: "POST",
    body: JSON.stringify({
      dhanClientId: creds.clientId,
      correlationId: o.correlationId,
      transactionType: o.transactionType,
      exchangeSegment: "NSE_EQ",
      productType: "CNC",
      orderType: o.orderType,
      validity: "DAY",
      securityId: o.securityId,
      quantity: o.quantity,
      disclosedQuantity: 0,
      price: o.orderType === "LIMIT" ? (o.price ?? 0) : 0,
      triggerPrice: 0,
      afterMarketOrder: false,
    }),
  });
}
