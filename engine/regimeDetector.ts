/**
 * Market Regime Detector — Classifies the Current Market Environment
 * 
 * Uses ADX, ATR, Bollinger Band Width, and EMA alignment to determine:
 *   - trending_up:   Strong directional move upward (ADX > 25, EMA aligned bullish)
 *   - trending_down:  Strong directional move downward (ADX > 25, EMA aligned bearish)
 *   - ranging:        Low directional movement, price oscillating (ADX < 20, tight BB)
 *   - volatile:       High ATR, wide BB, unpredictable swings
 * 
 * Each regime produces trading recommendations:
 *   - trending:  Use momentum entries, wider stops, trail profits
 *   - ranging:   Use mean-reversion, tight stops, quick TP at band edges
 *   - volatile:  Reduce position size or skip, wait for clarity
 * 
 * The regime is cached per symbol and refreshed every 5 minutes.
 */

import { RSI, EMA, BollingerBands, ATR, ADX } from 'technicalindicators';

// ─── Types ──────────────────────────────────────────────────

export type RegimeType = 'trending_up' | 'trending_down' | 'ranging' | 'volatile';

export interface RegimeResult {
  symbol: string;
  regime: RegimeType;
  confidence: number;       // 0-100
  adx: number;              // Trend strength
  atr: number;              // Volatility (absolute)
  atrPercent: number;       // ATR as % of price
  bbWidth: number;          // Bollinger Band width as % of price
  emaAlignment: 'bullish' | 'bearish' | 'mixed';
  recommendations: RegimeRecommendations;
  analyzedAt: string;
  timeframe: string;
}

export interface RegimeRecommendations {
  shouldTrade: boolean;
  strategyType: 'momentum' | 'mean_reversion' | 'breakout' | 'avoid';
  positionSizeMultiplier: number;  // 0.0 to 1.5 — scale positions
  stopLossMultiplier: number;      // Scale SL wider/tighter
  takeProfitMultiplier: number;    // Scale TP wider/tighter
  reason: string;
}

export interface MarketRegimeSummary {
  timestamp: string;
  overallRegime: RegimeType;
  regimes: RegimeResult[];
  trendingCount: number;
  rangingCount: number;
  volatileCount: number;
  marketHealth: 'excellent' | 'good' | 'caution' | 'danger';
}

// ─── Candle interface ───────────────────────────────────────

interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Engine ─────────────────────────────────────────────────

export class RegimeDetector {
  private cache: Map<string, RegimeResult> = new Map();
  private cacheDurationMs = 5 * 60 * 1000; // 5 min cache

  /**
   * Detect the market regime for a single symbol
   */
  async detectRegime(symbol: string, timeframe: string = '4h'): Promise<RegimeResult> {
    // Check cache
    const cacheKey = `${symbol}_${timeframe}`;
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - new Date(cached.analyzedAt).getTime()) < this.cacheDurationMs) {
      return cached;
    }

    const candles = await this.fetchCandles(symbol, timeframe, 100);
    if (candles.length < 50) {
      return this.defaultResult(symbol, timeframe);
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const currentPrice = closes[closes.length - 1];

    // ── ADX (Average Directional Index) — Trend Strength ──
    const adxValues = ADX.calculate({ close: closes, high: highs, low: lows, period: 14 });
    const adx = adxValues.length > 0 ? adxValues[adxValues.length - 1].adx : 20;

    // ── ATR (Average True Range) — Volatility ──
    const atrValues = ATR.calculate({ close: closes, high: highs, low: lows, period: 14 });
    const atr = atrValues.length > 0 ? atrValues[atrValues.length - 1] : 0;
    const atrPercent = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

    // ── Bollinger Band Width ──
    const bbValues = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
    const bbLatest = bbValues.length > 0 ? bbValues[bbValues.length - 1] : null;
    const bbWidth = bbLatest && bbLatest.middle > 0
      ? ((bbLatest.upper - bbLatest.lower) / bbLatest.middle) * 100
      : 5;

    // ── EMA Alignment ──
    const ema9 = EMA.calculate({ values: closes, period: 9 });
    const ema21 = EMA.calculate({ values: closes, period: 21 });
    const ema50 = EMA.calculate({ values: closes, period: 50 });

    const e9 = ema9.length > 0 ? ema9[ema9.length - 1] : currentPrice;
    const e21 = ema21.length > 0 ? ema21[ema21.length - 1] : currentPrice;
    const e50 = ema50.length > 0 ? ema50[ema50.length - 1] : currentPrice;

    let emaAlignment: 'bullish' | 'bearish' | 'mixed' = 'mixed';
    if (e9 > e21 && e21 > e50) emaAlignment = 'bullish';
    else if (e9 < e21 && e21 < e50) emaAlignment = 'bearish';

    // ── Regime Classification ──
    const { regime, confidence } = this.classifyRegime(adx, atrPercent, bbWidth, emaAlignment);

    // ── Trading Recommendations ──
    const recommendations = this.getRecommendations(regime, adx, atrPercent);

    const result: RegimeResult = {
      symbol,
      regime,
      confidence,
      adx: Math.round(adx * 100) / 100,
      atr: Math.round(atr * 10000) / 10000,
      atrPercent: Math.round(atrPercent * 100) / 100,
      bbWidth: Math.round(bbWidth * 100) / 100,
      emaAlignment,
      recommendations,
      analyzedAt: new Date().toISOString(),
      timeframe,
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Classify the market regime from indicator values
   */
  private classifyRegime(
    adx: number,
    atrPercent: number,
    bbWidth: number,
    emaAlignment: 'bullish' | 'bearish' | 'mixed'
  ): { regime: RegimeType; confidence: number } {
    // ── Volatile regime: Very high ATR or very wide BB ──
    // ATR% > 5% on 4H or BB width > 10% = volatile
    if (atrPercent > 5 || bbWidth > 10) {
      const confidence = Math.min(95, 50 + atrPercent * 5 + (bbWidth > 10 ? 20 : 0));
      return { regime: 'volatile', confidence };
    }

    // ── Trending regime: ADX > 25 with clear EMA alignment ──
    if (adx > 25) {
      if (emaAlignment === 'bullish') {
        const confidence = Math.min(95, 40 + adx + (bbWidth > 4 ? 10 : 0));
        return { regime: 'trending_up', confidence };
      }
      if (emaAlignment === 'bearish') {
        const confidence = Math.min(95, 40 + adx + (bbWidth > 4 ? 10 : 0));
        return { regime: 'trending_down', confidence };
      }
      // ADX high but EMAs mixed → still trending, just direction unclear
      // Use price vs EMA50 as tiebreaker
      const confidence = Math.min(80, 30 + adx);
      return { regime: atrPercent > 3 ? 'volatile' : 'ranging', confidence };
    }

    // ── Ranging regime: ADX < 20 with tight BB ──
    if (adx < 20 && bbWidth < 5) {
      const confidence = Math.min(90, 50 + (20 - adx) * 2 + (5 - bbWidth) * 5);
      return { regime: 'ranging', confidence };
    }

    // ── Borderline: ADX 20-25 ──
    // Could be transitioning. Use BB width as tiebreaker
    if (bbWidth > 6) {
      return { regime: 'volatile', confidence: 55 };
    }
    if (emaAlignment !== 'mixed') {
      const regime = emaAlignment === 'bullish' ? 'trending_up' : 'trending_down';
      return { regime, confidence: 50 };
    }
    return { regime: 'ranging', confidence: 45 };
  }

  /**
   * Generate regime-specific trading recommendations
   */
  private getRecommendations(regime: RegimeType, adx: number, atrPercent: number): RegimeRecommendations {
    switch (regime) {
      case 'trending_up':
        return {
          shouldTrade: true,
          strategyType: 'momentum',
          positionSizeMultiplier: 1.2,
          stopLossMultiplier: 1.5,    // Wider stops in trends — let it breathe
          takeProfitMultiplier: 2.0,   // Bigger targets — ride the trend
          reason: `Strong uptrend (ADX: ${adx.toFixed(0)}). Use momentum entries on pullbacks. Trail stops to lock profits.`,
        };

      case 'trending_down':
        return {
          shouldTrade: true,
          strategyType: 'momentum',
          positionSizeMultiplier: 0.8,  // Slightly smaller — shorting is riskier
          stopLossMultiplier: 1.5,
          takeProfitMultiplier: 1.5,
          reason: `Strong downtrend (ADX: ${adx.toFixed(0)}). Look for short opportunities or avoid longs. Tighter risk management.`,
        };

      case 'ranging':
        return {
          shouldTrade: true,
          strategyType: 'mean_reversion',
          positionSizeMultiplier: 0.7,  // Smaller positions in ranges
          stopLossMultiplier: 0.8,      // Tighter stops — less room for error
          takeProfitMultiplier: 0.6,    // Quick profits at band edges
          reason: `Ranging market (ADX: ${adx.toFixed(0)}). Buy near support/lower BB, sell near resistance/upper BB. Quick TP.`,
        };

      case 'volatile':
        return {
          shouldTrade: atrPercent < 8, // Skip if ATR > 8%
          strategyType: atrPercent > 8 ? 'avoid' : 'breakout',
          positionSizeMultiplier: 0.4,  // Much smaller positions
          stopLossMultiplier: 2.0,      // Much wider stops
          takeProfitMultiplier: 2.5,    // Wider targets if entering
          reason: atrPercent > 8
            ? `Extreme volatility (ATR: ${atrPercent.toFixed(1)}%). AVOID trading. Wait for conditions to stabilize.`
            : `High volatility (ATR: ${atrPercent.toFixed(1)}%). Reduce position sizes significantly. Use breakout strategies only.`,
        };
    }
  }

  /**
   * Scan multiple symbols and classify the overall market
   */
  async scanMarketRegime(symbols: string[]): Promise<MarketRegimeSummary> {
    const regimes: RegimeResult[] = [];

    for (const symbol of symbols) {
      try {
        const result = await this.detectRegime(symbol, '4h');
        regimes.push(result);
      } catch (err: any) {
        console.error(`[REGIME] Failed to detect regime for ${symbol}:`, err.message);
      }
    }

    const trendingCount = regimes.filter(r => r.regime === 'trending_up' || r.regime === 'trending_down').length;
    const rangingCount = regimes.filter(r => r.regime === 'ranging').length;
    const volatileCount = regimes.filter(r => r.regime === 'volatile').length;

    // Overall market regime = whatever the majority is
    let overallRegime: RegimeType = 'ranging';
    if (trendingCount > rangingCount && trendingCount > volatileCount) {
      const bullish = regimes.filter(r => r.regime === 'trending_up').length;
      const bearish = regimes.filter(r => r.regime === 'trending_down').length;
      overallRegime = bullish >= bearish ? 'trending_up' : 'trending_down';
    } else if (volatileCount > rangingCount) {
      overallRegime = 'volatile';
    }

    // Market health assessment
    let marketHealth: MarketRegimeSummary['marketHealth'] = 'good';
    if (overallRegime === 'trending_up' && trendingCount > symbols.length * 0.5) {
      marketHealth = 'excellent';
    } else if (overallRegime === 'volatile' || volatileCount > symbols.length * 0.4) {
      marketHealth = 'danger';
    } else if (overallRegime === 'ranging') {
      marketHealth = 'caution';
    } else if (overallRegime === 'trending_down') {
      marketHealth = 'caution';
    }

    return {
      timestamp: new Date().toISOString(),
      overallRegime,
      regimes,
      trendingCount,
      rangingCount,
      volatileCount,
      marketHealth,
    };
  }

  /**
   * Get a human-readable regime summary for Jarvis to speak
   */
  formatForJarvis(summary: MarketRegimeSummary): string {
    const lines: string[] = [];
    lines.push(`📊 Market Regime: ${this.regimeEmoji(summary.overallRegime)} ${this.regimeLabel(summary.overallRegime)}`);
    lines.push(`Health: ${summary.marketHealth.toUpperCase()} | Trending: ${summary.trendingCount} | Ranging: ${summary.rangingCount} | Volatile: ${summary.volatileCount}`);
    lines.push('');

    for (const r of summary.regimes.slice(0, 5)) {
      const emoji = this.regimeEmoji(r.regime);
      lines.push(`${emoji} ${r.symbol}: ${this.regimeLabel(r.regime)} (ADX: ${r.adx}, ATR: ${r.atrPercent}%, BB: ${r.bbWidth}%)`);
      lines.push(`   → ${r.recommendations.reason}`);
    }

    return lines.join('\n');
  }

  /**
   * Format a brief regime badge for the dashboard
   */
  getRegimeBadge(regime: RegimeType): { emoji: string; label: string; color: string } {
    switch (regime) {
      case 'trending_up': return { emoji: '🟢', label: 'Trending Up', color: '#10b981' };
      case 'trending_down': return { emoji: '🔴', label: 'Trending Down', color: '#ef4444' };
      case 'ranging': return { emoji: '🟡', label: 'Ranging', color: '#eab308' };
      case 'volatile': return { emoji: '🟠', label: 'Volatile', color: '#f97316' };
    }
  }

  private regimeEmoji(regime: RegimeType): string {
    return this.getRegimeBadge(regime).emoji;
  }

  private regimeLabel(regime: RegimeType): string {
    return this.getRegimeBadge(regime).label;
  }

  /**
   * Fetch candles from Binance
   */
  private async fetchCandles(symbol: string, interval: string, limit: number): Promise<CandleData[]> {
    const cleanSymbol = symbol.replace('/', '');
    const url = `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${interval}&limit=${limit}`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Binance error: ${res.status}`);
      const data = await res.json();

      return data.map((k: any) => ({
        timestamp: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
    } catch (err: any) {
      console.error(`[REGIME] Failed to fetch candles for ${symbol}:`, err.message);
      return [];
    }
  }

  /**
   * Default result when data is insufficient
   */
  private defaultResult(symbol: string, timeframe: string): RegimeResult {
    return {
      symbol,
      regime: 'ranging',
      confidence: 0,
      adx: 0,
      atr: 0,
      atrPercent: 0,
      bbWidth: 0,
      emaAlignment: 'mixed',
      recommendations: {
        shouldTrade: false,
        strategyType: 'avoid',
        positionSizeMultiplier: 0,
        stopLossMultiplier: 1,
        takeProfitMultiplier: 1,
        reason: 'Insufficient data for regime detection.',
      },
      analyzedAt: new Date().toISOString(),
      timeframe,
    };
  }

  /**
   * Clear the cache (useful when market conditions change rapidly)
   */
  clearCache() {
    this.cache.clear();
  }
}
