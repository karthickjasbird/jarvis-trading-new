/**
 * Technical Analysis Engine — Real Candlestick-Based Intelligence
 * 
 * Fetches actual OHLCV candlestick data from Binance and computes
 * real indicators: RSI, MACD, EMA crossovers, Bollinger Bands, ATR.
 * 
 * Supports multi-timeframe confluence detection (1h, 4h, 1D).
 * This replaces the "ask AI to guess" approach with hard data.
 */

import { RSI, MACD, EMA, BollingerBands, ATR, ADX } from 'technicalindicators';

// ─── Types ──────────────────────────────────────────────────

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorSnapshot {
  rsi: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  ema200: number | null;
  bollingerBands: { upper: number; middle: number; lower: number } | null;
  atr: number | null;
  adx: number | null;
  price: number;
  volume: number;
}

export interface TASignal {
  bias: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  confidence: number; // 0-100
  reasons: string[];
}

export interface TimeframeAnalysis {
  timeframe: string;
  indicators: IndicatorSnapshot;
  signal: TASignal;
}

export interface MultiTimeframeReport {
  symbol: string;
  timestamp: string;
  analyses: TimeframeAnalysis[];
  confluence: TASignal;
  summary: string;
}

// ─── Engine ─────────────────────────────────────────────────

export class TechnicalAnalysisEngine {

  /**
   * Fetch OHLCV candlestick data from Binance public API
   */
  async fetchCandles(symbol: string, interval: string, limit: number = 200): Promise<CandleData[]> {
    const cleanSymbol = symbol.replace('/', '');
    const url = `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${interval}&limit=${limit}`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Binance klines error: ${res.status}`);
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
      console.error(`[TA] Failed to fetch candles for ${symbol} ${interval}:`, err.message);
      return [];
    }
  }

  /**
   * Compute all indicators from candlestick data
   */
  computeIndicators(candles: CandleData[]): IndicatorSnapshot {
    if (candles.length < 50) {
      return this.emptySnapshot(candles);
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);
    const currentPrice = closes[closes.length - 1];
    const currentVolume = volumes[volumes.length - 1];

    // RSI (14-period)
    const rsiValues = RSI.calculate({ values: closes, period: 14 });
    const rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;

    // MACD (12, 26, 9)
    const macdValues = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const macdLatest = macdValues.length > 0 ? macdValues[macdValues.length - 1] : null;
    const macd = macdLatest ? {
      macd: macdLatest.MACD ?? 0,
      signal: macdLatest.signal ?? 0,
      histogram: macdLatest.histogram ?? 0,
    } : null;

    // EMAs
    const ema9Values = EMA.calculate({ values: closes, period: 9 });
    const ema21Values = EMA.calculate({ values: closes, period: 21 });
    const ema50Values = EMA.calculate({ values: closes, period: 50 });
    const ema200Values = closes.length >= 200
      ? EMA.calculate({ values: closes, period: 200 })
      : [];

    const ema9 = ema9Values.length > 0 ? ema9Values[ema9Values.length - 1] : null;
    const ema21 = ema21Values.length > 0 ? ema21Values[ema21Values.length - 1] : null;
    const ema50 = ema50Values.length > 0 ? ema50Values[ema50Values.length - 1] : null;
    const ema200 = ema200Values.length > 0 ? ema200Values[ema200Values.length - 1] : null;

    // Bollinger Bands (20, 2)
    const bbValues = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
    const bbLatest = bbValues.length > 0 ? bbValues[bbValues.length - 1] : null;
    const bollingerBands = bbLatest ? {
      upper: bbLatest.upper,
      middle: bbLatest.middle,
      lower: bbLatest.lower,
    } : null;

    // ATR (14-period)
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const atr = atrValues.length > 0 ? atrValues[atrValues.length - 1] : null;

    // ADX (14-period) — trend strength
    const adxValues = ADX.calculate({ close: closes, high: highs, low: lows, period: 14 });
    const adx = adxValues.length > 0 ? adxValues[adxValues.length - 1].adx : null;

    return {
      rsi,
      macd,
      ema9,
      ema21,
      ema50,
      ema200,
      bollingerBands,
      atr,
      adx,
      price: currentPrice,
      volume: currentVolume,
    };
  }

  /**
   * Generate a buy/sell signal from indicators
   */
  generateSignal(ind: IndicatorSnapshot): TASignal {
    const reasons: string[] = [];
    let score = 0; // -100 to +100

    // ── Determine trend context from ADX + EMA alignment + Price Action ──
    // This prevents "buy the dip" signals in confirmed or sudden downtrends
    const isTrending = (ind.adx !== null && ind.adx > 25);
    const isPriceDumping = ind.ema50 !== null && ind.price < (ind.ema50 * 0.985); // Price dropped 1.5% below EMA50
    const isPriceSurging = ind.ema50 !== null && ind.price > (ind.ema50 * 1.015);
    
    const isBearishTrend = (isTrending || isPriceDumping) && ind.ema9 !== null && ind.ema21 !== null && ind.ema9 < ind.ema21;
    const isBullishTrend = (isTrending || isPriceSurging) && ind.ema9 !== null && ind.ema21 !== null && ind.ema9 > ind.ema21;

    // ── RSI ──
    if (ind.rsi !== null) {
      if (ind.rsi < 30) {
        if (isBearishTrend) {
          // In a downtrend, oversold RSI confirms bearishness — NOT a buy signal
          score -= 5;
          reasons.push(`RSI oversold (${ind.rsi.toFixed(1)}) but DOWNTREND active — confirms weakness`);
        } else {
          score += 20;
          reasons.push(`RSI oversold (${ind.rsi.toFixed(1)}) — potential bounce`);
        }
      } else if (ind.rsi < 40) {
        if (isBearishTrend) {
          score -= 3;
          reasons.push(`RSI weak (${ind.rsi.toFixed(1)}) in downtrend — bearish continuation`);
        } else {
          score += 10;
          reasons.push(`RSI approaching oversold (${ind.rsi.toFixed(1)})`);
        }
      } else if (ind.rsi > 70) {
        if (isBullishTrend) {
          // In an uptrend, overbought RSI is expected — less bearish
          score -= 5;
          reasons.push(`RSI overbought (${ind.rsi.toFixed(1)}) but UPTREND active — momentum strong`);
        } else {
          score -= 20;
          reasons.push(`RSI overbought (${ind.rsi.toFixed(1)})`);
        }
      } else if (ind.rsi > 60) {
        score -= 5;
        reasons.push(`RSI elevated (${ind.rsi.toFixed(1)})`);
      } else {
        reasons.push(`RSI neutral (${ind.rsi.toFixed(1)})`);
      }
    }

    // ── MACD ──
    if (ind.macd) {
      if (ind.macd.histogram > 0 && ind.macd.macd > ind.macd.signal) {
        score += 15;
        reasons.push('MACD bullish crossover');
      } else if (ind.macd.histogram < 0 && ind.macd.macd < ind.macd.signal) {
        score -= 15;
        reasons.push('MACD bearish crossover');
      }
      // Histogram momentum
      if (Math.abs(ind.macd.histogram) > 0) {
        const direction = ind.macd.histogram > 0 ? 'increasing' : 'decreasing';
        reasons.push(`MACD histogram ${direction}`);
      }
    }

    // ── EMA Crossovers ──
    if (ind.ema9 !== null && ind.ema21 !== null) {
      if (ind.ema9 > ind.ema21) {
        score += 10;
        reasons.push('EMA 9/21 bullish cross');
      } else {
        score -= 10;
        reasons.push('EMA 9/21 bearish cross');
      }
    }

    if (ind.ema50 !== null && ind.ema200 !== null) {
      if (ind.ema50 > ind.ema200) {
        score += 15;
        reasons.push('Golden cross (EMA 50 > 200)');
      } else {
        score -= 15;
        reasons.push('Death cross (EMA 50 < 200)');
      }
    }

    // ── Price vs EMAs ──
    if (ind.ema50 !== null) {
      if (ind.price > ind.ema50) {
        score += 5;
        reasons.push('Price above EMA 50 (bullish trend)');
      } else {
        score -= 5;
        reasons.push('Price below EMA 50 (bearish trend)');
      }
    }

    // ── ADX Trend Strength ──
    if (ind.adx !== null) {
      if (ind.adx > 40) {
        // Very strong trend — amplify the directional bias
        const trendBonus = isBullishTrend ? 10 : isBearishTrend ? -10 : 0;
        score += trendBonus;
        if (trendBonus !== 0) reasons.push(`Strong trend (ADX: ${ind.adx.toFixed(0)}) — amplified ${isBullishTrend ? 'bullish' : 'bearish'} bias`);
      } else if (ind.adx < 15) {
        reasons.push(`Very weak trend (ADX: ${ind.adx.toFixed(0)}) — choppy market`);
      }
    }

    // ── Bollinger Bands ──
    if (ind.bollingerBands) {
      const bb = ind.bollingerBands;
      const bbWidth = ((bb.upper - bb.lower) / bb.middle) * 100;

      if (ind.price <= bb.lower) {
        if (isBearishTrend) {
          // In downtrend, hitting lower BB is trend continuation, NOT bounce
          score -= 5;
          reasons.push('Price breaking lower Bollinger Band — bearish expansion');
        } else {
          score += 15;
          reasons.push('Price at lower Bollinger Band (potential bounce)');
        }
      } else if (ind.price >= bb.upper) {
        if (isBullishTrend) {
          score += 5;
          reasons.push('Price riding upper Bollinger Band — bullish momentum');
        } else {
          score -= 10;
          reasons.push('Price at upper Bollinger Band (potential reversal)');
        }
      }

      if (bbWidth < 3) {
        reasons.push(`Bollinger squeeze (${bbWidth.toFixed(1)}% width) — breakout imminent`);
        score += 5; // volatility expansion expected
      }
    }

    // ── Determine bias ──
    let bias: TASignal['bias'];
    if (score >= 30) bias = 'strong_buy';
    else if (score >= 10) bias = 'buy';
    else if (score <= -30) bias = 'strong_sell';
    else if (score <= -10) bias = 'sell';
    else bias = 'neutral';

    // Confidence = how far from 0 (neutral), capped at 100
    const confidence = Math.min(100, Math.abs(score) + 30);

    return { bias, confidence, reasons };
  }

  /**
   * Run full multi-timeframe analysis for a single symbol
   */
  async analyzeSymbol(symbol: string): Promise<MultiTimeframeReport> {
    const timeframes = [
      { interval: '1h', label: '1H' },
      { interval: '4h', label: '4H' },
      { interval: '1d', label: '1D' },
    ];

    const analyses: TimeframeAnalysis[] = [];

    for (const tf of timeframes) {
      const candles = await this.fetchCandles(symbol, tf.interval, 200);
      const indicators = this.computeIndicators(candles);
      const signal = this.generateSignal(indicators);

      analyses.push({
        timeframe: tf.label,
        indicators,
        signal,
      });
    }

    // ── Multi-Timeframe Confluence ──
    const confluence = this.computeConfluence(analyses);

    // ── Human-Readable Summary ──
    const summary = this.buildSummary(symbol, analyses, confluence);

    return {
      symbol,
      timestamp: new Date().toISOString(),
      analyses,
      confluence,
      summary,
    };
  }

  /**
   * Compute confluence across multiple timeframes
   */
  private computeConfluence(analyses: TimeframeAnalysis[]): TASignal {
    let totalScore = 0;
    const allReasons: string[] = [];

    // Weight: 1D = 3x, 4H = 2x, 1H = 1x
    const weights: Record<string, number> = { '1H': 1, '4H': 2, '1D': 3 };
    let totalWeight = 0;

    for (const a of analyses) {
      const w = weights[a.timeframe] || 1;
      const biasScore = {
        'strong_buy': 40,
        'buy': 20,
        'neutral': 0,
        'sell': -20,
        'strong_sell': -40,
      }[a.signal.bias];

      totalScore += biasScore * w;
      totalWeight += w;
      allReasons.push(`${a.timeframe}: ${a.signal.bias} (${a.signal.confidence}%)`);
    }

    const avgScore = totalScore / totalWeight;

    let bias: TASignal['bias'];
    if (avgScore >= 25) bias = 'strong_buy';
    else if (avgScore >= 8) bias = 'buy';
    else if (avgScore <= -25) bias = 'strong_sell';
    else if (avgScore <= -8) bias = 'sell';
    else bias = 'neutral';

    // Confluence bonus: all timeframes agree = higher confidence
    const biases = analyses.map(a => a.signal.bias);
    const allBullish = biases.every(b => b === 'buy' || b === 'strong_buy');
    const allBearish = biases.every(b => b === 'sell' || b === 'strong_sell');

    let confidence = Math.min(100, Math.abs(avgScore) + 30);
    if (allBullish || allBearish) {
      confidence = Math.min(100, confidence + 20);
      allReasons.push('⚡ All timeframes aligned — HIGH confluence');
    }

    return { bias, confidence, reasons: allReasons };
  }

  /**
   * Build a human-readable summary string for agents to consume
   */
  private buildSummary(symbol: string, analyses: TimeframeAnalysis[], confluence: TASignal): string {
    const lines: string[] = [`=== ${symbol} Technical Analysis ===`];

    for (const a of analyses) {
      const ind = a.indicators;
      const parts: string[] = [];

      if (ind.rsi !== null) parts.push(`RSI=${ind.rsi.toFixed(1)}`);
      if (ind.macd) parts.push(`MACD hist=${ind.macd.histogram.toFixed(4)}`);
      if (ind.ema9 !== null && ind.ema21 !== null) {
        parts.push(`EMA9=${ind.ema9.toFixed(2)} EMA21=${ind.ema21.toFixed(2)}`);
      }
      if (ind.bollingerBands) {
        parts.push(`BB[${ind.bollingerBands.lower.toFixed(2)}-${ind.bollingerBands.upper.toFixed(2)}]`);
      }
      if (ind.atr !== null) parts.push(`ATR=${ind.atr.toFixed(4)}`);

      lines.push(`[${a.timeframe}] ${a.signal.bias.toUpperCase()} (${a.signal.confidence}%) | ${parts.join(' | ')}`);
      lines.push(`  → ${a.signal.reasons.slice(0, 3).join('; ')}`);
    }

    lines.push(`\n[CONFLUENCE] ${confluence.bias.toUpperCase()} (${confluence.confidence}%)`);
    lines.push(`  → ${confluence.reasons.join('; ')}`);

    return lines.join('\n');
  }

  /**
   * Quick format for injection into agent prompts
   */
  formatForAgent(report: MultiTimeframeReport): string {
    return report.summary;
  }

  // ─── Helpers ──────────────────────────────────────────────

  private emptySnapshot(candles: CandleData[]): IndicatorSnapshot {
    const last = candles.length > 0 ? candles[candles.length - 1] : null;
    return {
      rsi: null,
      macd: null,
      ema9: null,
      ema21: null,
      ema50: null,
      ema200: null,
      bollingerBands: null,
      atr: null,
      adx: null,
      price: last?.close || 0,
      volume: last?.volume || 0,
    };
  }
}
