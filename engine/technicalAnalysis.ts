/**
 * Technical Analysis Engine — Real Candlestick-Based Intelligence
 * 
 * Fetches actual OHLCV candlestick data from Binance and computes
 * real indicators: RSI, MACD, EMA crossovers, Bollinger Bands, ATR.
 * 
 * Supports multi-timeframe confluence detection (1h, 4h, 1D).
 * This replaces the "ask AI to guess" approach with hard data.
 * 
 * FIX #4: Regime-Aware Indicator Weighting
 *   Indicator scores are now dynamically scaled by market regime:
 *   - Trending: momentum indicators (EMA, MACD, ADX) amplified, oscillators dampened
 *   - Ranging: oscillators (RSI, BB) amplified, momentum indicators dampened
 *   - Volatile: all weights dampened to prevent chasing noise
 */

import { RSI, MACD, EMA, BollingerBands, ATR, ADX, OBV, VWAP } from 'technicalindicators';
import { TradingViewBridge } from './tradingViewBridge.ts';
import { readTVIndicators, IchimokuReading, SupertrendReading, TVIndicatorReading } from './tvIndicators.ts';

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
  obv: number | null;
  obvSlope: 'up' | 'down' | 'flat' | null;
  vwap: number | null;
  // NEXUS Phase 5b — TradingView-native indicators (populated only when
  // enrichWithTV() is called against a connected bridge with a matching symbol)
  ichimoku?: IchimokuReading | null;
  supertrend?: SupertrendReading | null;
  /** Per-indicator source. Defaults to 'local' for everything computed in computeIndicators().
   *  Overridden to 'tradingview' for any value enriched from the TV chart legend. */
  _sources?: Record<string, 'local' | 'tradingview'>;
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
   * FIX #5: 3-attempt exponential backoff to prevent NaN indicators from single network failures
   */
  async fetchCandles(symbol: string, interval: string, limit: number = 200): Promise<CandleData[]> {
    const cleanSymbol = symbol.replace('/', '');
    const url = `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${interval}&limit=${limit}`;

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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
        if (attempt < MAX_RETRIES) {
          const delayMs = Math.pow(2, attempt) * 500; // 1s, 2s
          console.warn(`[TA] Retry ${attempt}/${MAX_RETRIES} for ${symbol} ${interval} in ${delayMs}ms: ${err.message}`);
          await new Promise(r => setTimeout(r, delayMs));
        } else {
          console.error(`[TA] Failed to fetch candles for ${symbol} ${interval} after ${MAX_RETRIES} attempts:`, err.message);
          return [];
        }
      }
    }
    return [];
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

    // OBV (On-Balance Volume)
    const obvValues = OBV.calculate({ close: closes, volume: volumes });
    const obv = obvValues.length > 0 ? obvValues[obvValues.length - 1] : null;

    // OBV Slope: compare to 5-period average of OBV values if available, or previous
    let obvSlope: 'up' | 'down' | 'flat' | null = null;
    if (obvValues.length >= 6) {
      const latestObv = obvValues[obvValues.length - 1];
      const last5 = obvValues.slice(-5);
      const avg = last5.reduce((sum, v) => sum + v, 0) / last5.length;
      obvSlope = latestObv > avg ? 'up' : latestObv < avg ? 'down' : 'flat';
    } else if (obvValues.length >= 2) {
      const latestObv = obvValues[obvValues.length - 1];
      const prevObv = obvValues[obvValues.length - 2];
      obvSlope = latestObv > prevObv ? 'up' : latestObv < prevObv ? 'down' : 'flat';
    }

    // VWAP (Volume-Weighted Average Price)
    const vwapValues = VWAP.calculate({ high: highs, low: lows, close: closes, volume: volumes });
    const vwap = vwapValues.length > 0 ? vwapValues[vwapValues.length - 1] : null;

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
      obv,
      obvSlope,
      vwap,
    };
  }

  /**
   * FIX #4: Regime-aware indicator weight multipliers
   * In trending markets, momentum indicators matter more.
   * In ranging markets, oscillators and mean-reversion indicators matter more.
   * In volatile markets, all weights are dampened to avoid chasing noise.
   */
  private getRegimeWeights(regime?: string): { rsi: number; macd: number; ema: number; bb: number; adx: number } {
    switch (regime) {
      case 'trending_up':
      case 'trending_down':
        // Momentum matters — EMA crossovers, MACD, ADX amplified; RSI/BB reduced
        return { rsi: 0.6, macd: 1.5, ema: 1.5, bb: 0.5, adx: 1.5 };
      case 'ranging':
        // Mean-reversion matters — RSI and BB amplified; MACD/EMA/ADX reduced
        return { rsi: 1.5, macd: 0.5, ema: 0.5, bb: 1.5, adx: 0.5 };
      case 'volatile':
        // Defensive — all weights dampened to prevent chasing erratic swings
        return { rsi: 0.5, macd: 0.5, ema: 0.5, bb: 0.7, adx: 0.7 };
      default:
        // No regime data — use standard weights (1.0 = no adjustment)
        return { rsi: 1.0, macd: 1.0, ema: 1.0, bb: 1.0, adx: 1.0 };
    }
  }

  /**
   * Generate a buy/sell signal from indicators
   * FIX #4: Now accepts optional regime parameter to apply dynamic weight multipliers
   */
  generateSignal(ind: IndicatorSnapshot, regime?: string): TASignal {
    const reasons: string[] = [];
    let score = 0; // -100 to +100

    // FIX #4: Apply regime-aware weight multipliers to indicator scores
    const w = this.getRegimeWeights(regime);

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
          score -= Math.round(5 * w.rsi);
          reasons.push(`RSI oversold (${ind.rsi.toFixed(1)}) but DOWNTREND active — confirms weakness`);
        } else {
          score += Math.round(20 * w.rsi);
          reasons.push(`RSI oversold (${ind.rsi.toFixed(1)}) — potential bounce`);
        }
      } else if (ind.rsi < 40) {
        if (isBearishTrend) {
          score -= Math.round(3 * w.rsi);
          reasons.push(`RSI weak (${ind.rsi.toFixed(1)}) in downtrend — bearish continuation`);
        } else {
          score += Math.round(10 * w.rsi);
          reasons.push(`RSI approaching oversold (${ind.rsi.toFixed(1)})`);
        }
      } else if (ind.rsi > 70) {
        if (isBullishTrend) {
          // In an uptrend, overbought RSI is expected — less bearish
          score -= Math.round(5 * w.rsi);
          reasons.push(`RSI overbought (${ind.rsi.toFixed(1)}) but UPTREND active — momentum strong`);
        } else {
          score -= Math.round(20 * w.rsi);
          reasons.push(`RSI overbought (${ind.rsi.toFixed(1)})`);
        }
      } else if (ind.rsi > 60) {
        score -= Math.round(5 * w.rsi);
        reasons.push(`RSI elevated (${ind.rsi.toFixed(1)})`);
      } else {
        reasons.push(`RSI neutral (${ind.rsi.toFixed(1)})`);
      }
    }

    // ── MACD ──
    if (ind.macd) {
      if (ind.macd.histogram > 0 && ind.macd.macd > ind.macd.signal) {
        score += Math.round(15 * w.macd);
        reasons.push('MACD bullish crossover');
      } else if (ind.macd.histogram < 0 && ind.macd.macd < ind.macd.signal) {
        score -= Math.round(15 * w.macd);
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
        score += Math.round(10 * w.ema);
        reasons.push('EMA 9/21 bullish cross');
      } else {
        score -= Math.round(10 * w.ema);
        reasons.push('EMA 9/21 bearish cross');
      }
    }

    if (ind.ema50 !== null && ind.ema200 !== null) {
      if (ind.ema50 > ind.ema200) {
        score += Math.round(15 * w.ema);
        reasons.push('Golden cross (EMA 50 > 200)');
      } else {
        score -= Math.round(15 * w.ema);
        reasons.push('Death cross (EMA 50 < 200)');
      }
    }

    // ── Price vs EMAs ──
    if (ind.ema50 !== null) {
      if (ind.price > ind.ema50) {
        score += Math.round(5 * w.ema);
        reasons.push('Price above EMA 50 (bullish trend)');
      } else {
        score -= Math.round(5 * w.ema);
        reasons.push('Price below EMA 50 (bearish trend)');
      }
    }

    // ── ADX Trend Strength ──
    if (ind.adx !== null) {
      if (ind.adx > 40) {
        // Very strong trend — amplify the directional bias
        const trendBonus = isBullishTrend ? Math.round(10 * w.adx) : isBearishTrend ? Math.round(-10 * w.adx) : 0;
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
          score -= Math.round(5 * w.bb);
          reasons.push('Price breaking lower Bollinger Band — bearish expansion');
        } else {
          score += Math.round(15 * w.bb);
          reasons.push('Price at lower Bollinger Band (potential bounce)');
        }
      } else if (ind.price >= bb.upper) {
        if (isBullishTrend) {
          score += Math.round(5 * w.bb);
          reasons.push('Price riding upper Bollinger Band — bullish momentum');
        } else {
          score -= Math.round(10 * w.bb);
          reasons.push('Price at upper Bollinger Band (potential reversal)');
        }
      }

      if (bbWidth < 3) {
        reasons.push(`Bollinger squeeze (${bbWidth.toFixed(1)}% width) — breakout imminent`);
        score += Math.round(5 * w.bb); // volatility expansion expected
      }
    }

    // ── VWAP Alignment ──
    if (ind.vwap !== null) {
      if (ind.price > ind.vwap) {
        score += Math.round(10 * w.ema);
        reasons.push(`Price above VWAP ($${ind.vwap.toFixed(2)}) — bullish institutional support`);
      } else if (ind.price < ind.vwap) {
        score -= Math.round(10 * w.ema);
        reasons.push(`Price below VWAP ($${ind.vwap.toFixed(2)}) — bearish institutional resistance`);
      }
    }

    // ── OBV Momentum ──
    if (ind.obvSlope !== null) {
      if (ind.obvSlope === 'up') {
        score += Math.round(10 * w.macd);
        reasons.push(`OBV momentum rising (${ind.obvSlope}) — volume confirmation`);
      } else if (ind.obvSlope === 'down') {
        score -= Math.round(10 * w.macd);
        reasons.push(`OBV momentum falling (${ind.obvSlope}) — volume distribution`);
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

    // FIX #4: Log regime weight adjustment for transparency
    if (regime) {
      reasons.push(`Regime-weighted: ${regime} (RSI×${w.rsi} MACD×${w.macd} EMA×${w.ema} BB×${w.bb} ADX×${w.adx})`);
    }

    return { bias, confidence, reasons };
  }

  /**
   * Run full multi-timeframe analysis for a single symbol
   */
  async analyzeSymbol(symbol: string, regime?: string): Promise<MultiTimeframeReport> {
    const timeframes = [
      { interval: '1h', label: '1H' },
      { interval: '4h', label: '4H' },
      { interval: '1d', label: '1D' },
    ];

    const analyses: TimeframeAnalysis[] = [];

    for (const tf of timeframes) {
      const candles = await this.fetchCandles(symbol, tf.interval, 200);
      const indicators = this.computeIndicators(candles);
      const signal = this.generateSignal(indicators, regime);

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

    // Weight: 1H and 4H are the actionable timeframes (2x each),
    // 1D provides context/bias only (1x) — prevents daily trend from
    // completely overriding valid short-term setups
    const weights: Record<string, number> = { '1H': 2, '4H': 2, '1D': 1 };
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
      obv: null,
      obvSlope: null,
      vwap: null,
    };
  }

  /**
   * NEXUS Phase 5b — Overlay TradingView-native indicator values onto a
   * locally-computed snapshot. Falls back gracefully:
   *   - If the bridge isn't connected, returns the snapshot unchanged.
   *   - If the TV chart is on a different symbol, refuses to apply (safety).
   *   - If a TV indicator can't be parsed, falls back to the local value.
   *
   * Sets `_sources[indicatorName]` so consumers can tell where each value came from.
   *
   * @param snapshot - Locally-computed IndicatorSnapshot from computeIndicators()
   * @param bridge - The TradingViewBridge (singleton from getTradingViewBridge())
   * @param expectedSymbol - The ccxt symbol Jarvis is analyzing (e.g. "ETH/USDT").
   *                        If TV is showing a different symbol, the overlay is skipped.
   */
  async enrichWithTV(
    snapshot: IndicatorSnapshot,
    bridge: TradingViewBridge,
    expectedSymbol?: string
  ): Promise<IndicatorSnapshot> {
    if (!bridge.isConnected()) return snapshot;

    let reading: TVIndicatorReading;
    try {
      reading = await readTVIndicators(bridge);
    } catch (err: any) {
      console.warn(`[TA→TV] readTVIndicators failed: ${err.message}`);
      return snapshot;
    }

    // Safety: only apply TV values if the chart's showing the same symbol
    if (expectedSymbol && reading.symbol) {
      const want = expectedSymbol.replace('/', '').toUpperCase();
      if (reading.symbol !== want) {
        console.warn(`[TA→TV] Symbol mismatch — chart=${reading.symbol} requested=${want}; using local indicators only`);
        return snapshot;
      }
    }

    const enriched: IndicatorSnapshot = { ...snapshot };
    const sources: Record<string, 'local' | 'tradingview'> = {};

    // Mark locally-derived values up front (so the final map is exhaustive)
    if (snapshot.rsi !== null) sources.rsi = 'local';
    if (snapshot.macd !== null) sources.macd = 'local';
    if (snapshot.ema9 !== null || snapshot.ema21 !== null || snapshot.ema50 !== null || snapshot.ema200 !== null) sources.ema = 'local';
    if (snapshot.bollingerBands !== null) sources.bollingerBands = 'local';
    if (snapshot.atr !== null) sources.atr = 'local';
    if (snapshot.adx !== null) sources.adx = 'local';
    if (snapshot.obv !== null) sources.obv = 'local';
    if (snapshot.vwap !== null) sources.vwap = 'local';

    // Overlay TV values where parsed successfully
    if (reading.rsi) {
      enriched.rsi = reading.rsi.value;
      sources.rsi = 'tradingview';
    }
    if (reading.ichimoku) {
      enriched.ichimoku = reading.ichimoku;
      sources.ichimoku = 'tradingview';
    }
    if (reading.supertrend) {
      enriched.supertrend = reading.supertrend;
      sources.supertrend = 'tradingview';
    }

    enriched._sources = sources;
    return enriched;
  }
}
