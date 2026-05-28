/**
 * Alpaca REST connector — US stocks (and via ETFs, commodities).
 *
 * Lightweight client over Alpaca's HTTP API. No SDK dependency — just fetch.
 *
 * Two host environments:
 *   - paper trading → https://paper-api.alpaca.markets
 *   - live trading  → https://api.alpaca.markets
 * Market data is shared:
 *   - https://data.alpaca.markets
 *
 * Auth: APCA-API-KEY-ID + APCA-API-SECRET-KEY headers.
 *
 * Mirrors the shape ccxt exposes in `tradeExecutor.ts` (createMarketOrder
 * returning { id, average, filled }) so the executor's broker switch stays
 * symmetric across brokers.
 */

export interface AlpacaCredentials {
  apiKeyId: string;
  secretKey: string;
  paper?: boolean;
}

export interface AlpacaClock {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
}

export interface AlpacaQuote {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  timestamp: string;
}

export interface AlpacaBar {
  t: string;   // RFC-3339 timestamp
  o: number;   // open
  h: number;   // high
  l: number;   // low
  c: number;   // close
  v: number;   // volume
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  status: string;
  submitted_at: string;
  filled_at: string | null;
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  side: 'long' | 'short';
  avg_entry_price: string;
  market_value: string;
  current_price: string;
  unrealized_pl: string;
}

export interface AlpacaAccount {
  id: string;
  status: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  pattern_day_trader: boolean;
}

type TimeframeUnit = '1Min' | '5Min' | '15Min' | '1Hour' | '4Hour' | '1Day';

export class AlpacaConnector {
  private apiKeyId: string;
  private secretKey: string;
  private tradingHost: string;
  private dataHost = 'https://data.alpaca.markets';

  constructor(creds: AlpacaCredentials) {
    if (!creds.apiKeyId || !creds.secretKey) {
      throw new Error('AlpacaConnector: apiKeyId and secretKey are required');
    }
    this.apiKeyId = creds.apiKeyId;
    this.secretKey = creds.secretKey;
    this.tradingHost = creds.paper === false
      ? 'https://api.alpaca.markets'
      : 'https://paper-api.alpaca.markets';
  }

  private headers(): Record<string, string> {
    return {
      'APCA-API-KEY-ID': this.apiKeyId,
      'APCA-API-SECRET-KEY': this.secretKey,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(host: string, path: string, init?: RequestInit): Promise<T> {
    const url = `${host}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers || {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[ALPACA] ${res.status} ${res.statusText} on ${path}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  // ──────────────────────────────────────────────────────────
  // Account / market-state
  // ──────────────────────────────────────────────────────────

  async getAccount(): Promise<AlpacaAccount> {
    return this.request<AlpacaAccount>(this.tradingHost, '/v2/account');
  }

  /**
   * Returns the US equity market clock. Use is_open as the gate before
   * placing a stock order; next_open/next_close help with queuing decisions.
   */
  async getClock(): Promise<AlpacaClock> {
    return this.request<AlpacaClock>(this.tradingHost, '/v2/clock');
  }

  // ──────────────────────────────────────────────────────────
  // Market data
  // ──────────────────────────────────────────────────────────

  /**
   * Latest trade for a stock symbol. Returns last traded price + bid/ask.
   * Alpaca's free tier serves IEX-only data (15-min delayed for some calls)
   * — fine for paper, fine for sizing, but real-time SIP requires a paid plan.
   */
  async getQuote(symbol: string): Promise<AlpacaQuote> {
    const enc = encodeURIComponent(symbol);
    const [tradeRes, quoteRes] = await Promise.all([
      this.request<any>(this.dataHost, `/v2/stocks/${enc}/trades/latest`),
      this.request<any>(this.dataHost, `/v2/stocks/${enc}/quotes/latest`).catch(() => null),
    ]);
    const t = tradeRes?.trade;
    const q = quoteRes?.quote;
    if (!t || typeof t.p !== 'number') {
      throw new Error(`[ALPACA] no trade data for ${symbol}`);
    }
    return {
      symbol,
      price: t.p,
      bid: q?.bp ?? t.p,
      ask: q?.ap ?? t.p,
      timestamp: t.t,
    };
  }

  /**
   * OHLCV bars for a stock symbol. Aligns roughly with TechnicalAnalysisEngine
   * intervals (1H / 4H / 1D). Alpaca uses 1Min/5Min/15Min/1Hour/4Hour/1Day.
   *
   * Caller picks the timeframe; we expose the union to keep callers honest.
   */
  async getBars(symbol: string, timeframe: TimeframeUnit, limit: number = 200): Promise<AlpacaBar[]> {
    const enc = encodeURIComponent(symbol);
    const params = new URLSearchParams({
      timeframe,
      limit: String(limit),
      adjustment: 'raw',
    });
    const res = await this.request<any>(this.dataHost, `/v2/stocks/${enc}/bars?${params}`);
    return (res?.bars || []) as AlpacaBar[];
  }

  // ──────────────────────────────────────────────────────────
  // Orders / positions
  // ──────────────────────────────────────────────────────────

  /**
   * Place a simple market order. Day-only TIF — matches MIS semantics on
   * the Kite path. Returns a normalized AlpacaOrder; caller can poll for
   * fill data if needed (Alpaca fills market orders very quickly in paper).
   */
  async placeMarketOrder(
    symbol: string,
    side: 'buy' | 'sell',
    qty: number,
    opts: { clientOrderId?: string; stopLossPrice?: number } = {}
  ): Promise<AlpacaOrder> {
    if (qty <= 0 || !Number.isFinite(qty)) {
      throw new Error(`[ALPACA] invalid qty: ${qty}`);
    }
    // Phase 9 (#11) — optional client_order_id for exchange-layer idempotency.
    // Phase 9 (Tier B #1) — optional stopLossPrice activates OTO bracket
    // (One-Triggers-Other). Order class becomes 'oto' with a stop_loss leg.
    // Per Alpaca docs: 'bracket' requires BOTH legs; 'oto' accepts just one.
    const body = JSON.stringify({
      symbol,
      qty: String(qty),
      side,
      type: 'market',
      time_in_force: 'day',
      ...(opts.clientOrderId ? { client_order_id: opts.clientOrderId } : {}),
      ...(opts.stopLossPrice ? {
        order_class: 'oto',
        stop_loss: { stop_price: String(opts.stopLossPrice) },
      } : {}),
    });
    return this.request<AlpacaOrder>(this.tradingHost, '/v2/orders', {
      method: 'POST',
      body,
    });
  }

  /**
   * Helper that mirrors ccxt's createMarketOrder return shape so the
   * tradeExecutor broker switch can treat Alpaca + ccxt orders uniformly.
   *
   * `average` may be null immediately after submission; the caller should
   * fall back to its last-known price when it is.
   */
  async createMarketOrder(
    symbol: string,
    side: 'buy' | 'sell',
    qty: number,
    opts: { clientOrderId?: string; stopLossPrice?: number } = {}
  ): Promise<{
    id: string;
    average: number | null;
    filled: number;
    raw: AlpacaOrder;
  }> {
    const order = await this.placeMarketOrder(symbol, side, qty, opts);
    // Brief poll — Alpaca fills paper market orders within ~1s.
    let finalOrder = order;
    for (let i = 0; i < 5 && (!finalOrder.filled_avg_price || finalOrder.status === 'new'); i++) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        finalOrder = await this.request<AlpacaOrder>(this.tradingHost, `/v2/orders/${order.id}`);
      } catch {
        break;
      }
    }
    return {
      id: finalOrder.id,
      average: finalOrder.filled_avg_price ? parseFloat(finalOrder.filled_avg_price) : null,
      filled: parseFloat(finalOrder.filled_qty || '0') || qty,
      raw: finalOrder,
    };
  }

  async getPosition(symbol: string): Promise<AlpacaPosition | null> {
    try {
      return await this.request<AlpacaPosition>(this.tradingHost, `/v2/positions/${encodeURIComponent(symbol)}`);
    } catch (err: any) {
      // Alpaca returns 404 when there is no position; treat as null.
      if (/404/.test(err?.message || '')) return null;
      throw err;
    }
  }

  /**
   * Cancel an order by ID. Used by closeWithRetry to cancel a resting
   * SL leg after a manual / sentry close fires — otherwise the orphan
   * SL could trigger later and create a phantom short.
   *
   * Returns void on success. Throws on real errors. Caller should swallow
   * "order not found" / 404 since that means the order is already gone
   * (filled or cancelled by the exchange).
   */
  async cancelOrder(orderId: string): Promise<void> {
    await this.request<void>(this.tradingHost, `/v2/orders/${encodeURIComponent(orderId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Phase 9 (Tier B #2) — Boot-reconciliation list helpers.
   * listPositions returns all open positions; listOpenOrders returns
   * all open orders with nested children (OTO/bracket legs).
   */
  async listPositions(): Promise<AlpacaPosition[]> {
    return this.request<AlpacaPosition[]>(this.tradingHost, '/v2/positions');
  }

  async listOpenOrders(opts: { nested?: boolean; limit?: number } = {}): Promise<AlpacaOrder[]> {
    const nested = opts.nested ? 'true' : 'false';
    const limit = opts.limit ?? 500;
    return this.request<AlpacaOrder[]>(
      this.tradingHost,
      `/v2/orders?status=open&nested=${nested}&limit=${limit}&direction=desc`
    );
  }

  /**
   * Phase 9 (Tier B #2) — Place a standalone stop order to protect an
   * existing position. Used by reconciliation when a naked position
   * is found on the exchange (orphan or known-naked).
   */
  async placeStopOrder(params: {
    symbol: string;
    qty: number;
    side: 'buy' | 'sell';
    stopPrice: number;
    clientOrderId?: string;
  }): Promise<AlpacaOrder> {
    if (params.qty <= 0 || !Number.isFinite(params.qty)) {
      throw new Error(`[ALPACA] placeStopOrder: invalid qty ${params.qty}`);
    }
    const body = JSON.stringify({
      symbol: params.symbol,
      qty: String(params.qty),
      side: params.side,
      type: 'stop',
      time_in_force: 'gtc',
      stop_price: String(params.stopPrice),
      ...(params.clientOrderId ? { client_order_id: params.clientOrderId } : {}),
    });
    return this.request<AlpacaOrder>(this.tradingHost, '/v2/orders', {
      method: 'POST',
      body,
    });
  }

  /**
   * Close an entire position (or a fraction via qty). Alpaca's DELETE
   * /v2/positions/{symbol} endpoint submits a closing market order and
   * returns the resulting order object.
   */
  async closePosition(symbol: string, qty?: number): Promise<AlpacaOrder> {
    const params = qty !== undefined ? `?qty=${qty}` : '';
    return this.request<AlpacaOrder>(this.tradingHost, `/v2/positions/${encodeURIComponent(symbol)}${params}`, {
      method: 'DELETE',
    });
  }
}

/**
 * Heuristic: does this symbol look like a US stock (vs a crypto pair)?
 *
 * Crypto pairs in this codebase consistently carry a slash (`BTC/USDT`) or
 * end in `USDT`. Stocks are 1-5 char bare tickers (AAPL, MSFT, BRK.B).
 * Falls back to "stock" for anything that doesn't look crypto so the
 * executor's stock branch is the default when the caller is ambiguous.
 */
export function detectAssetClass(symbol: string): 'crypto' | 'stock' {
  if (!symbol) return 'stock';
  if (symbol.includes('/')) return 'crypto';
  if (/USDT$|BUSD$|USDC$/i.test(symbol)) return 'crypto';
  return 'stock';
}
