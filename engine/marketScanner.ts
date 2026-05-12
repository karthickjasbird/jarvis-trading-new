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
   * Calculate opportunity score (0-100)
   */
  private calculateScore(ticker: any): number {
    const change = parseFloat(ticker.priceChangePercent);
    const volume = parseFloat(ticker.quoteVolume);
    const high = parseFloat(ticker.highPrice);
    const low = parseFloat(ticker.lowPrice);
    const price = parseFloat(ticker.lastPrice);

    let score = 50; // baseline

    // Momentum strength (up to ±20 points)
    score += Math.min(20, Math.abs(change) * 3);

    // Volume factor (high volume = more opportunity)
    if (volume > 500_000_000) score += 15;
    else if (volume > 100_000_000) score += 10;
    else if (volume > 50_000_000) score += 5;

    // Volatility factor (moderate volatility is good)
    const volatility = ((high - low) / price) * 100;
    if (volatility > 2 && volatility < 8) score += 10;
    else if (volatility >= 8) score += 5; // too volatile, slight bonus

    // Cap at 100
    return Math.min(100, Math.round(score));
  }

  /**
   * Run a full market scan
   */
  async scan(): Promise<ScanSummary> {
    console.log('[SCANNER] 🔍 Scanning 20 crypto pairs...');

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
        score: this.calculateScore(t),
      };
    });

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    const bullish = results.filter(r => r.momentum === 'bull' || r.momentum === 'strong_bull').length;
    const bearish = results.filter(r => r.momentum === 'bear' || r.momentum === 'strong_bear').length;
    const neutral = results.filter(r => r.momentum === 'neutral').length;

    // Determine market sentiment
    let marketSentiment = 'Mixed';
    if (bullish > bearish * 2) marketSentiment = 'Bullish 🟢';
    else if (bearish > bullish * 2) marketSentiment = 'Bearish 🔴';
    else if (bullish > bearish) marketSentiment = 'Slightly Bullish 🟡';
    else if (bearish > bullish) marketSentiment = 'Slightly Bearish 🟠';

    const topOpportunities = results.slice(0, 5);

    // Generate signal text for top 3 using AI + enrich with real TA data
    for (const opp of topOpportunities.slice(0, 3)) {
      try {
        // Fetch real 1H candle TA for this pair
        const cleanSymbol = opp.symbol.replace('/USDT', 'USDT');
        const candles = await this.taEngine.fetchCandles(cleanSymbol, '1h', 100);
        const indicators = this.taEngine.computeIndicators(candles);
        const taSignal = this.taEngine.generateSignal(indicators);

        // Inject real TA data into the scan result
        opp.rsi = indicators.rsi !== null ? Math.round(indicators.rsi) : undefined;
        opp.confluence = taSignal.bias;
        opp.taSignal = taSignal.reasons.slice(0, 2).join('; ');

        // Boost score based on TA confluence
        if (taSignal.bias === 'strong_buy') opp.score = Math.min(100, opp.score + 10);
        else if (taSignal.bias === 'strong_sell') opp.score = Math.max(0, opp.score - 10);

        const prompt = `You are a crypto signal generator. Given this REAL data for ${opp.symbol}:
- Price: $${opp.price}
- 24h Change: ${opp.change24h > 0 ? '+' : ''}${opp.change24h.toFixed(2)}%
- RSI(14): ${indicators.rsi?.toFixed(1) || 'N/A'}
- MACD Histogram: ${indicators.macd?.histogram.toFixed(4) || 'N/A'}
- EMA 9/21: ${indicators.ema9?.toFixed(2) || 'N/A'} / ${indicators.ema21?.toFixed(2) || 'N/A'}
- TA Signal: ${taSignal.bias} (${taSignal.confidence}%)

Write a ONE-LINE trading signal (under 15 words) based on the REAL indicators. Be specific.`;
        opp.signal = await generateText('gemini-2.5-flash', prompt);
      } catch {
        opp.signal = `${opp.momentum.includes('bull') ? '📈' : '📉'} ${opp.change24h > 0 ? '+' : ''}${opp.change24h.toFixed(1)}% — ${opp.momentum} momentum`;
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
        allResults: results.map(r => ({ symbol: r.symbol, price: r.price, change24h: r.change24h, score: r.score, momentum: r.momentum })),
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
