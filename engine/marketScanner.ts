/**
 * Market Scanner — Scans 20+ crypto pairs via Binance public API
 * 
 * Fetches real 24hr ticker data, computes momentum signals,
 * and ranks opportunities for the Agent Swarm pipeline.
 */

import { generateText } from './modelRouter.ts';
import { TechnicalAnalysisEngine } from './technicalAnalysis.ts';

// Top 20 crypto trading pairs to scan
export const SCAN_PAIRS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
  'MATICUSDT', 'ATOMUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT',
  'OPUSDT', 'SUIUSDT', 'INJUSDT', 'TIAUSDT', 'SEIUSDT',
];

export interface ScanResult {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  momentum: 'strong_bull' | 'bull' | 'neutral' | 'bear' | 'strong_bear';
  volatility: number;
  score: number;
  signal?: string;
  rsi?: number;
  confluence?: string;
  taSignal?: string;
  obv?: number;
  obvSlope?: 'up' | 'down' | 'flat';
  vwap?: number;
}

export interface ScanSummary {
  timestamp: string;
  totalPairs: number;
  bullish: number;
  bearish: number;
  neutral: number;
  topOpportunities: ScanResult[];
  marketSentiment: string;
  allResults: ScanResult[];
}

export class MarketScanner {
  private db: any;
  private lastScan: ScanSummary | null = null;
  private taEngine: TechnicalAnalysisEngine;

  constructor(db: any) {
    this.db = db;
    this.taEngine = new TechnicalAnalysisEngine();
  }

  /**
   * Fetch 24h ticker data from Binance public API
   */
  private async fetchTickers(): Promise<any[]> {
    try {
      const url = 'https://api.binance.com/api/v3/ticker/24hr';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
      const allTickers = await res.json();

      // Filter to our scan pairs only
      return allTickers.filter((t: any) => SCAN_PAIRS.includes(t.symbol));
    } catch (err: any) {
      console.error('[SCANNER] Failed to fetch Binance tickers:', err.message);
      return [];
    }
  }

  /**
   * Calculate momentum signal from price change
   */
  private getMomentum(change24h: number): ScanResult['momentum'] {
    if (change24h > 5) return 'strong_bull';
    if (change24h > 1.5) return 'bull';
    if (change24h < -5) return 'strong_bear';
    if (change24h < -1.5) return 'bear';
    return 'neutral';
  }

  /**
   * Calculate opportunity score (0-100) — TA-DRIVEN
   * 
   * The TA signal is the PRIMARY driver of the score.
   * A bearish coin can NEVER score above 50, no matter how much volume it has.
   * Only bullish coins with confirmed TA signals can reach 75+.
   * 
   * Score breakdown:
   *   Base: 50
   *   TA Signal: -40 to +40 (PRIMARY)
   *   Momentum alignment: -10 to +10
   *   Volume bonus: 0 to +10
   *   Volatility: -5 to +5
   */
  private calculateScoreWithTA(ticker: any, taBias: string, taConfidence: number): number {
    const change = parseFloat(ticker.priceChangePercent);
    const volume = parseFloat(ticker.quoteVolume);
    const high = parseFloat(ticker.highPrice);
    const low = parseFloat(ticker.lowPrice);
    const price = parseFloat(ticker.lastPrice);

    let score = 50; // baseline

    // ── TA Signal (PRIMARY — up to ±40 points) ──
    const taScore: Record<string, number> = {
      'strong_buy': 40,
      'buy': 20,
      'neutral': 0,
      'sell': -20,
      'strong_sell': -40,
    };
    score += taScore[taBias] ?? 0;

    // ── Momentum alignment with TA (up to ±10 points) ──
    const isBullishTA = taBias === 'buy' || taBias === 'strong_buy';
    const isBearishTA = taBias === 'sell' || taBias === 'strong_sell';
    
    if (isBullishTA && change > 0) {
      // Momentum confirms bullish TA — bonus
      score += Math.min(10, change * 2);
    } else if (isBullishTA && change < -2) {
      // Momentum contradicts bullish TA — penalty
      score -= 5;
    } else if (isBearishTA && change < 0) {
      // Momentum confirms bearish TA — extra penalty
      score -= Math.min(10, Math.abs(change) * 2);
    } else if (change < -3) {
      // Heavy dump regardless of TA — penalty
      score -= 5;
    }

    // ── Volume bonus (up to +10, but ONLY for bullish/neutral) ──
    if (!isBearishTA) {
      if (volume > 500_000_000) score += 10;
      else if (volume > 100_000_000) score += 7;
      else if (volume > 50_000_000) score += 3;
    }

    // ── Volatility (moderate is good, extreme is bad) ──
    const volatility = ((high - low) / price) * 100;
    if (volatility > 2 && volatility < 6) score += 5;  // Sweet spot
    else if (volatility >= 10) score -= 5;               // Too wild

    // ── Hard caps based on TA direction ──
    if (isBearishTA) score = Math.min(score, 45);   // Bearish NEVER above 45
    if (taBias === 'strong_sell') score = Math.min(score, 25); // Strong sell capped at 25

    // Final clamp
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Run a full market scan — TA-enriched for ALL coins
   */
  async scan(): Promise<ScanSummary> {
    console.log('[SCANNER] 🔍 Scanning 20 crypto pairs with full TA...');

    const tickers = await this.fetchTickers();

    if (tickers.length === 0) {
      console.warn('[SCANNER] No ticker data received. Returning empty scan.');
      const empty: ScanSummary = {
        timestamp: new Date().toISOString(),
        totalPairs: 0,
        bullish: 0,
        bearish: 0,
        neutral: 0,
        topOpportunities: [],
        marketSentiment: 'No data',
        allResults: [],
      };
      this.lastScan = empty;
      return empty;
    }

    // Step 1: Build basic results from ticker data
    const results: ScanResult[] = tickers.map((t: any) => {
      const price = parseFloat(t.lastPrice);
      const change24h = parseFloat(t.priceChangePercent);
      const volume24h = parseFloat(t.quoteVolume);
      const high24h = parseFloat(t.highPrice);
      const low24h = parseFloat(t.lowPrice);
      const volatility = ((high24h - low24h) / price) * 100;

      return {
        symbol: t.symbol.replace('USDT', '/USDT'),
        price,
        change24h,
        volume24h,
        high24h,
        low24h,
        momentum: this.getMomentum(change24h),
        volatility: parseFloat(volatility.toFixed(2)),
        score: 50, // Placeholder — will be recalculated after TA
      };
    });

    // Step 2: Run MULTI-TIMEFRAME TA on ALL coins in parallel (batches of 5)
    // FIX: Previously used 1H-only candles which showed BUY while Scout's multi-TF
    // analysis showed SELL. Now both use the same multi-TF confluence.
    const BATCH_SIZE = 5;
    for (let batch = 0; batch < results.length; batch += BATCH_SIZE) {
      const batchResults = results.slice(batch, batch + BATCH_SIZE);
      
      await Promise.allSettled(batchResults.map(async (result) => {
        try {
          // Use multi-timeframe analysis (1H + 4H + 1D) — same as Scout
          const mtfReport = await this.taEngine.analyzeSymbol(result.symbol);
          
          // Extract 1H indicators for display (RSI, OBV, VWAP)
          const h1Analysis = mtfReport.analyses.find(a => a.timeframe === '1H');
          if (h1Analysis) {
            const indicators = h1Analysis.indicators;
            result.rsi = indicators.rsi !== null ? Math.round(indicators.rsi) : undefined;
            result.obv = indicators.obv !== null ? Math.round(indicators.obv) : undefined;
            result.obvSlope = indicators.obvSlope ?? undefined;
            result.vwap = indicators.vwap !== null ? indicators.vwap : undefined;
          }

          // Use multi-TF CONFLUENCE bias (not just 1H) for score & signal
          result.confluence = mtfReport.confluence.bias;
          result.taSignal = mtfReport.confluence.reasons.slice(0, 3).join('; ');

          console.log(`[SCANNER] 📊 Volume Intelligence for ${result.symbol}: OBV=${result.obv} (${result.obvSlope}), VWAP=${result.vwap?.toFixed(4)}, Price=${result.price}`);

          // Calculate TA-driven score using CONFLUENCE bias
          const cleanSymbol = result.symbol.replace('/USDT', 'USDT');
          const ticker = tickers.find((t: any) => t.symbol === cleanSymbol);
          result.score = this.calculateScoreWithTA(ticker, mtfReport.confluence.bias, mtfReport.confluence.confidence);
        } catch (err: any) {
          console.error(`[SCANNER] TA failed for ${result.symbol}:`, err.message);
          // Fallback: use basic momentum-only score
          result.score = result.change24h > 0 ? Math.min(65, 50 + result.change24h * 3) : Math.max(20, 50 + result.change24h * 3);
          result.confluence = result.change24h > 1 ? 'buy' : result.change24h < -1 ? 'sell' : 'neutral';
        }
      }));
    }
    console.log(`[SCANNER] ✅ TA complete for ${results.length} coins (${Math.ceil(results.length / BATCH_SIZE)} batches)`);

    // Step 2.5: POST-SCAN VALIDATION — Defense-in-depth
    // Enforce hard score caps based on TA signal, catching any edge case or fallback path
    for (const result of results) {
      const isBearish = result.confluence === 'sell' || result.confluence === 'strong_sell';
      const isBullish = result.confluence === 'buy' || result.confluence === 'strong_buy';
      const isNeutral = !isBearish && !isBullish;

      if (result.confluence === 'strong_sell') {
        result.score = Math.min(result.score, 25);
      } else if (result.confluence === 'sell') {
        result.score = Math.min(result.score, 45);
      } else if (isNeutral) {
        result.score = Math.min(result.score, 65);
      }
      // BUY/STRONG_BUY can go up to 100 — no cap needed

      // Also ensure score is never negative
      result.score = Math.max(0, result.score);
    }

    // Step 3: Sort by score descending
    results.sort((a, b) => b.score - a.score);

    const bullish = results.filter(r => r.confluence === 'buy' || r.confluence === 'strong_buy').length;
    const bearish = results.filter(r => r.confluence === 'sell' || r.confluence === 'strong_sell').length;
    const neutral = results.filter(r => !r.confluence || r.confluence === 'neutral').length;

    // Determine market sentiment
    let marketSentiment = 'Mixed';
    if (bullish > bearish * 2) marketSentiment = 'Bullish 🟢';
    else if (bearish > bullish * 2) marketSentiment = 'Bearish 🔴';
    else if (bullish > bearish) marketSentiment = 'Slightly Bullish 🟡';
    else if (bearish > bullish) marketSentiment = 'Slightly Bearish 🟠';

    const topOpportunities = results.slice(0, 5);

    // Step 4: Generate AI signal text for top 3 opportunities only
    for (const opp of topOpportunities.slice(0, 3)) {
      try {
        const prompt = `You are a crypto signal generator. Given this REAL data for ${opp.symbol}:
- Price: $${opp.price}
- 24h Change: ${opp.change24h > 0 ? '+' : ''}${opp.change24h.toFixed(2)}%
- RSI(14): ${opp.rsi || 'N/A'}
- TA Signal: ${opp.confluence} 
- Score: ${opp.score}/100

Write a ONE-LINE trading signal (under 15 words) based on the REAL indicators. Be specific.`;
        opp.signal = await generateText('gemini-2.5-flash', prompt);
      } catch {
        opp.signal = `${opp.confluence === 'buy' || opp.confluence === 'strong_buy' ? '📈' : opp.confluence === 'sell' || opp.confluence === 'strong_sell' ? '📉' : '➡️'} ${opp.change24h > 0 ? '+' : ''}${opp.change24h.toFixed(1)}% — ${opp.confluence || opp.momentum}`;
      }
    }

    const summary: ScanSummary = {
      timestamp: new Date().toISOString(),
      totalPairs: results.length,
      bullish,
      bearish,
      neutral,
      topOpportunities,
      marketSentiment,
      allResults: results,
    };

    this.lastScan = summary;

    // Log to Firestore
    try {
      await this.db.collection('scanHistory').add({
        ...summary,
        allResults: results.map(r => ({ symbol: r.symbol, price: r.price, change24h: r.change24h, score: r.score, momentum: r.momentum, confluence: r.confluence })),
      });
    } catch (err) {
      console.error('[SCANNER] Failed to save scan history:', err);
    }

    console.log(`[SCANNER] ✅ Scan complete: ${bullish} bullish, ${bearish} bearish, ${neutral} neutral | Sentiment: ${marketSentiment}`);
    return summary;
  }

  /**
   * Get the last scan result (cached)
   */
  getLastScan(): ScanSummary | null {
    return this.lastScan;
  }

  /**
   * Get scan history from Firestore
   */
  async getScanHistory(limit = 10): Promise<ScanSummary[]> {
    try {
      const snapshot = await this.db.collection('scanHistory')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();
      return snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    } catch {
      return [];
    }
  }

  /**
   * Get current price for a specific symbol (used by learning loop when coin is locked)
   */
  async getPriceForSymbol(symbol: string): Promise<number | null> {
    try {
      const cleanSymbol = symbol.replace('/', '');
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cleanSymbol}`);
      if (!res.ok) return null;
      const data = await res.json();
      const price = parseFloat(data.price);
      return isNaN(price) ? null : price;
    } catch {
      return null;
    }
  }

  /**
   * Get current trading session quality based on time of day
   * 
   * US Session (13:30 - 20:00 UTC / 9:30 AM - 4 PM EST): Best liquidity, cleanest moves → 100%
   * Asian Session (00:00 - 04:00 UTC / 8 PM - 12 AM EST): Good crypto volume → 75%
   * European Session (07:00 - 11:00 UTC / 3 AM - 7 AM EST): Decent → 75%
   * Dead Zone (04:00 - 07:00 UTC and 20:00 - 00:00 UTC): Low volume, choppy → 50%
   */
  getSessionQuality(): { session: string; multiplier: number; description: string } {
    const utcHour = new Date().getUTCHours();

    if (utcHour >= 13 && utcHour < 20) {
      return { session: 'US', multiplier: 1.0, description: 'US Market Hours — full aggression' };
    } else if (utcHour >= 0 && utcHour < 4) {
      return { session: 'Asia', multiplier: 0.75, description: 'Asian Session — moderate position sizing' };
    } else if (utcHour >= 7 && utcHour < 11) {
      return { session: 'Europe', multiplier: 0.75, description: 'European Session — moderate position sizing' };
    } else {
      return { session: 'Dead Zone', multiplier: 0.5, description: 'Low-volume period — reduced sizing or skip' };
    }
  }

  /**
   * Check the Daily macro trend using EMA 20 vs EMA 50
   * 
   * If EMA20 > EMA50 → Bullish (safe to buy)
   * If EMA20 < EMA50 → Bearish (block buy signals)
   * 
   * This prevents Jarvis from buying into a falling market.
   */
  async checkDailyTrend(symbol: string): Promise<'bullish' | 'bearish' | 'neutral'> {
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=55`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Binance klines error: ${res.status}`);
      const candles = await res.json();

      if (candles.length < 50) return 'neutral'; // Not enough data

      // Extract closing prices
      const closes = candles.map((c: any) => parseFloat(c[4]));

      // Calculate EMA 20
      const ema20 = this.calculateEMA(closes, 20);
      // Calculate EMA 50
      const ema50 = this.calculateEMA(closes, 50);

      if (ema20 === null || ema50 === null) return 'neutral';

      const diff = ((ema20 - ema50) / ema50) * 100;

      // Only classify as bearish/bullish if the EMAs are clearly separated (>0.3%)
      if (diff > 0.3) return 'bullish';
      if (diff < -0.3) return 'bearish';
      return 'neutral';
    } catch (err: any) {
      console.error(`[SCANNER] Failed to check daily trend for ${symbol}:`, err.message);
      return 'neutral'; // Fail-open: don't block trades if check fails
    }
  }

  /**
   * Calculate Exponential Moving Average
   */
  private calculateEMA(closes: number[], period: number): number | null {
    if (closes.length < period) return null;

    const k = 2 / (period + 1);
    // Start with SMA for the first 'period' values
    let ema = closes.slice(0, period).reduce((sum, c) => sum + c, 0) / period;

    // Then apply EMA formula for remaining values
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }

    return ema;
  }
}
