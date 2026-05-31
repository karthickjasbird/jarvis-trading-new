/**
 * TradingView signals fetcher — public scanner endpoint.
 *
 * Replaces the LLM swarm's "indicator analysis" layer. Instead of running 9
 * Gemini calls to re-derive what TradingView already labels, we fetch the
 * pre-computed Tech/MA/OS ratings + key indicators directly.
 *
 * Endpoints (no auth required, public):
 *   - https://scanner.tradingview.com/crypto/scan
 *   - https://scanner.tradingview.com/america/scan
 *
 * Defensive: returns an empty map on any failure. Callers fall back to local
 * TA from technicalAnalysis.ts (also free).
 */

export type TvRating = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';

export interface TvSignal {
  symbol: string;             // bare ticker e.g. 'BTCUSDT' or 'AAPL'
  techRating: TvRating;       // overall Recommend.All
  maRating: TvRating;         // Recommend.MA
  osRating: TvRating;         // Recommend.Other (oscillators)
  rsi: number | null;         // RSI(14)
  momentum: number | null;    // Mom(10)
  socialDom: number | null;   // % social dominance (crypto only)
  fetchedAt: number;          // unix ms
}

// Numeric Recommend.All threshold → label
//   ≥  0.5    Strong buy
//   ≥  0.1    Buy
//   > -0.1    Neutral
//   ≥ -0.5    Sell
//   <  -0.5    Strong sell
function numericToRating(n: number | null | undefined): TvRating {
  if (n == null || !Number.isFinite(n)) return 'NEUTRAL';
  if (n >= 0.5) return 'STRONG_BUY';
  if (n >= 0.1) return 'BUY';
  if (n > -0.1) return 'NEUTRAL';
  if (n >= -0.5) return 'SELL';
  return 'STRONG_SELL';
}

const CRYPTO_COLUMNS = ['Recommend.All', 'Recommend.MA', 'Recommend.Other', 'RSI', 'Mom', 'social_dominance'];
const STOCK_COLUMNS = ['Recommend.All', 'Recommend.MA', 'Recommend.Other', 'RSI', 'Mom'];

async function postScanner(url: string, body: any): Promise<any | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 429) await new Promise(r => setTimeout(r, 1000 * attempt));
        else throw new Error(`HTTP ${res.status}`);
      } else {
        return await res.json();
      }
    } catch (err: any) {
      if (attempt === 3) {
        console.warn(`[tvSignals] ${url} failed after 3 attempts: ${err.message}`);
        return null;
      }
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  return null;
}

/**
 * Fetch TradingView ratings for a list of CRYPTO USDT pairs.
 * Input: bare Binance symbols ('BTCUSDT', 'ETHUSDT', ...).
 * Returns a Map keyed by the same bare symbol.
 */
export async function fetchCryptoSignals(symbols: string[]): Promise<Map<string, TvSignal>> {
  const out = new Map<string, TvSignal>();
  if (!symbols.length) return out;
  // TradingView wants "BINANCE:BTCUSDT" form
  const tickers = symbols.map(s => `BINANCE:${s}`);
  const body = {
    symbols: { tickers, query: { types: [] } },
    columns: CRYPTO_COLUMNS,
  };
  const json = await postScanner('https://scanner.tradingview.com/crypto/scan', body);
  if (!json?.data) return out;
  const now = Date.now();
  for (const row of json.data as any[]) {
    const sym = (row.s as string)?.replace(/^BINANCE:/, '');
    if (!sym) continue;
    const d = row.d as (number | null)[];
    out.set(sym, {
      symbol: sym,
      techRating: numericToRating(d[0]),
      maRating: numericToRating(d[1]),
      osRating: numericToRating(d[2]),
      rsi: typeof d[3] === 'number' ? d[3] : null,
      momentum: typeof d[4] === 'number' ? d[4] : null,
      socialDom: typeof d[5] === 'number' ? d[5] : null,
      fetchedAt: now,
    });
  }
  return out;
}

/**
 * Fetch TradingView ratings for US equity tickers (and commodity ETFs).
 * Input: bare Alpaca tickers ('AAPL', 'GLD', ...).
 */
export async function fetchStockSignals(symbols: string[]): Promise<Map<string, TvSignal>> {
  const out = new Map<string, TvSignal>();
  if (!symbols.length) return out;
  // For US equities, the prefix is NASDAQ:/NYSE:/AMEX:. The scanner accepts
  // either explicit prefixes or no prefix — bare tickers work for most.
  const tickers = symbols.map(s => s);
  const body = {
    symbols: { tickers, query: { types: [] } },
    columns: STOCK_COLUMNS,
  };
  const json = await postScanner('https://scanner.tradingview.com/america/scan', body);
  if (!json?.data) return out;
  const now = Date.now();
  for (const row of json.data as any[]) {
    const sym = (row.s as string)?.replace(/^(NASDAQ|NYSE|AMEX):/, '');
    if (!sym) continue;
    const d = row.d as (number | null)[];
    out.set(sym, {
      symbol: sym,
      techRating: numericToRating(d[0]),
      maRating: numericToRating(d[1]),
      osRating: numericToRating(d[2]),
      rsi: typeof d[3] === 'number' ? d[3] : null,
      momentum: typeof d[4] === 'number' ? d[4] : null,
      socialDom: null,  // not applicable for stocks
      fetchedAt: now,
    });
  }
  return out;
}

export function isBullish(rating: TvRating): boolean {
  return rating === 'BUY' || rating === 'STRONG_BUY';
}

export function isBearish(rating: TvRating): boolean {
  return rating === 'SELL' || rating === 'STRONG_SELL';
}
