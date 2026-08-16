export type Holding = {
  tradingSymbol: string;
  securityId: string;
  isin: string;
  name: string | null;
  totalQty: number;
  availableQty: number;
  avgCostPrice: number;
  price: number;
  prevClose: number | null;
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  dayChange: number;
  dayChangePct: number;
};

export type Summary = {
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  dayChange: number;
  dayChangePct: number;
  count: number;
};

export type Pricing = {
  marketOpen: boolean;
  marketState: string;
  delayedByMinutes: number | null;
  latestQuoteTime: number | null;
  dayChangeAvailable?: boolean;
  allIntraday?: boolean;
  ltpSource?: string;
};

export type Funds = {
  availabelBalance: number;
  withdrawableBalance: number;
  utilizedAmount: number;
  collateralAmount: number;
};

export type Overview = {
  holdings: Holding[];
  summary: Summary;
  pricing: Pricing;
  funds: Funds;
};

export type Settings = {
  connected: boolean;
  clientId: string;
  tokenSet: boolean;
  instrumentCount: number;
  instrumentsSyncedAt: number | null;
  marketOpen: boolean;
};

export type PlanRow = {
  symbol: string;
  name: string | null;
  securityId: string | null;
  price: number | null;
  priceSource: "dhan" | "yahoo" | null;
  currentQty: number;
  availableQty: number;
  currentValue: number;
  targetWeight: number;
  currentWeight: number;
  targetValue: number;
  driftValue: number;
  side: "BUY" | "SELL" | null;
  quantity: number;
  orderValue: number;
  skipped: string | null;
  action: "buy" | "sell" | "exit" | "hold" | "blocked";
};

export type Plan = {
  side: "BUY" | "SELL";
  rows: PlanRow[];
  totals: {
    holdingsValue: number;
    availableCash: number;
    investableBase: number;
    tradeValue: number;
    orderCount: number;
    cashAfter: number;
    targetWeightSum: number;
  };
  unresolved: string[];
  warnings: string[];
  pricing: Pricing;
};

export type ExecuteResult = {
  runId: string;
  placed: number;
  failed: number;
  results: {
    symbol: string;
    quantity: number;
    ok: boolean;
    orderId?: string;
    status?: string;
    error?: string;
  }[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly expired = false,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(
      body?.error ?? `Request failed (${res.status})`,
      res.status,
      Boolean(body?.expired),
    );
  }
  return body as T;
}

export const api = {
  settings: () => req<Settings>("/settings"),
  saveSettings: (clientId: string, accessToken: string) =>
    req<{ ok: true }>("/settings", {
      method: "POST",
      body: JSON.stringify({ clientId, accessToken }),
    }),
  disconnect: () => req<{ ok: true }>("/settings", { method: "DELETE" }),

  overview: () => req<Overview>("/overview"),

  resolveSymbols: (symbols: string[]) =>
    req<{ found: { input: string; symbol: string; name: string | null }[]; missing: string[] }>(
      "/instruments/resolve",
      { method: "POST", body: JSON.stringify({ symbols }) },
    ),
  searchInstruments: (q: string) =>
    req<{ results: { symbol: string; name: string | null }[] }>(
      `/instruments/search?q=${encodeURIComponent(q)}`,
    ),
  syncInstruments: () =>
    req<{ count: number; syncedAt: number }>("/instruments/sync", { method: "POST" }),

  plan: (body: unknown) =>
    req<Plan>("/rebalance/plan", { method: "POST", body: JSON.stringify(body) }),
  execute: (body: unknown) =>
    req<ExecuteResult>("/rebalance/execute", { method: "POST", body: JSON.stringify(body) }),

  orders: () =>
    req<{
      live: {
        orderId: string;
        orderStatus: string;
        transactionType: string;
        tradingSymbol: string;
        quantity: number;
        filledQty: number;
        averageTradedPrice: number;
        createTime: string;
        omsErrorDescription?: string;
      }[];
      runs: { run_id: string; placed_at: string; side: string; n: number }[];
    }>("/orders"),
  cancelOrder: (id: string) => req<unknown>(`/orders/${id}`, { method: "DELETE" }),
};
