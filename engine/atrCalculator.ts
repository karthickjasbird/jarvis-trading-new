/**
 * ATR Calculator — Average True Range
 * 
 * Calculates the ATR(14) for any symbol using Binance kline data.
 * Used for dynamic stop-loss sizing instead of fixed percentages.
 * 
 * ATR measures the average volatility of a coin per candle.
 * A low ATR = calm market = tight stop.  A high ATR = wild market = wide stop.
 */

export interface ATRResult {
  atr: number;           // The ATR value in dollars
  atrPercent: number;    // ATR as a percentage of current price
  currentPrice: number;
  suggestedStopLoss: number;  // Entry - (ATR * 1.5) for longs
  suggestedTakeProfit: number; // Entry + (ATR * 2.5) for longs
  volatilityLevel: 'low' | 'medium' | 'high' | 'extreme';
}

export class ATRCalculator {

  /**
   * Fetch kline (candlestick) data from Binance
   */
  private async fetchCandles(symbol: string, interval: string = '1h', limit: number = 15): Promise<any[]> {
    const cleanSymbol = symbol.replace('/', '');
    const url = `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance klines API error: ${res.status}`);
    return res.json();
  }

  /**
   * Calculate ATR(14) from kline data
   * 
   * True Range = max of:
   *   1. Current High - Current Low
   *   2. abs(Current High - Previous Close)
   *   3. abs(Current Low - Previous Close)
   * 
   * ATR = Simple Moving Average of True Range over 14 periods
   */
  async calculate(symbol: string, interval: string = '1h'): Promise<ATRResult> {
    const candles = await this.fetchCandles(symbol, interval, 15); // 14 periods + 1 for previous close

    if (candles.length < 2) {
      throw new Error(`Not enough candle data for ${symbol}`);
    }

    const trueRanges: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const high = parseFloat(candles[i][2]);
      const low = parseFloat(candles[i][3]);
      const prevClose = parseFloat(candles[i - 1][4]);

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }

    // ATR = average of True Ranges
    const atr = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
    const currentPrice = parseFloat(candles[candles.length - 1][4]); // Last candle close
    const atrPercent = (atr / currentPrice) * 100;

    // Classify volatility
    let volatilityLevel: ATRResult['volatilityLevel'];
    if (atrPercent < 0.5) volatilityLevel = 'low';
    else if (atrPercent < 1.5) volatilityLevel = 'medium';
    else if (atrPercent < 3.0) volatilityLevel = 'high';
    else volatilityLevel = 'extreme';

    return {
      atr,
      atrPercent: parseFloat(atrPercent.toFixed(4)),
      currentPrice,
      suggestedStopLoss: currentPrice - (atr * 1.5),  // 1.5x ATR for stop
      suggestedTakeProfit: currentPrice + (atr * 2.5), // 2.5x ATR for target (risk:reward > 1.5:1)
      volatilityLevel,
    };
  }

  /**
   * Calculate dynamic stop-loss price based on ATR
   * For buy (long): stopLoss = entryPrice - (ATR * multiplier)
   * For sell (short): stopLoss = entryPrice + (ATR * multiplier)
   */
  calculateStopLoss(entryPrice: number, atr: number, side: 'buy' | 'sell', multiplier: number = 1.5): number {
    if (side === 'buy') {
      return parseFloat((entryPrice - (atr * multiplier)).toFixed(8));
    } else {
      return parseFloat((entryPrice + (atr * multiplier)).toFixed(8));
    }
  }

  /**
   * Calculate dynamic take-profit price based on ATR
   * For buy (long): takeProfit = entryPrice + (ATR * multiplier)
   * For sell (short): takeProfit = entryPrice - (ATR * multiplier)
   */
  calculateTakeProfit(entryPrice: number, atr: number, side: 'buy' | 'sell', multiplier: number = 2.5): number {
    if (side === 'buy') {
      return parseFloat((entryPrice + (atr * multiplier)).toFixed(8));
    } else {
      return parseFloat((entryPrice - (atr * multiplier)).toFixed(8));
    }
  }
}
