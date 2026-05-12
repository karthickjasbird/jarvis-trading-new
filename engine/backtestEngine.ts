/**
 * Backtest Engine — Historical Strategy Validator
 * 
 * Extracted from the old Backtester UI page. Now used internally
 * by the Sentinel agent to validate whether a proposed trading
 * pattern has historically been profitable before approving trades.
 * 
 * No UI dependency — pure backend engine.
 */

import { RSI, MACD } from 'technicalindicators';
import ccxt from 'ccxt';

const binance = new ccxt.binance({ enableRateLimit: true });

export interface BacktestResult {
  symbol: string;
  strategy: string;
  timeframe: string;
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  pnlPercent: number;
  maxDrawdown: number;
  sharpeApprox: number; // rough risk-adjusted return
  verdict: 'strong' | 'viable' | 'weak' | 'failing';
  summary: string;
}

/**
 * Run a quick backtest for a given symbol + strategy.
 * Used by Sentinel to validate if a pattern has historically worked.
 * 
 * @param symbol  e.g. "INJ/USDT"
 * @param strategy  "rsi" | "macd" — matches the trading signal that triggered the proposal
 * @param timeframe  "1h" | "4h" | "1d" — matches the analysis timeframe
 * @param initialBalance  starting capital (default $10,000)
 */
export async function runBacktest(
  symbol: string,
  strategy: 'rsi' | 'macd',
  timeframe: string = '1h',
  initialBalance: number = 10000
): Promise<BacktestResult> {
  // Fetch historical candles
  const ohlcv = await binance.fetchOHLCV(symbol, timeframe, undefined, 500);

  if (!ohlcv || ohlcv.length < 50) {
    return {
      symbol,
      strategy,
      timeframe,
      totalTrades: 0,
      winRate: 0,
      totalPnl: 0,
      pnlPercent: 0,
      maxDrawdown: 0,
      sharpeApprox: 0,
      verdict: 'weak',
      summary: `Insufficient data for ${symbol} on ${timeframe} — only ${ohlcv?.length || 0} candles available.`,
    };
  }

  const closes = ohlcv.map(c => c[4] as number);

  let balance = initialBalance;
  let position = 0;
  let entryPrice = 0;
  let peakBalance = initialBalance;
  let maxDrawdown = 0;
  const tradeResults: number[] = []; // P&L per trade

  if (strategy === 'rsi') {
    const rsiValues = RSI.calculate({ values: closes, period: 14 });
    const offset = closes.length - rsiValues.length;

    for (let i = offset; i < closes.length; i++) {
      const rsi = rsiValues[i - offset];
      const price = closes[i];

      // Buy: RSI < 30
      if (rsi < 30 && position === 0) {
        position = balance / price;
        entryPrice = price;
        balance = 0;
      }
      // Sell: RSI > 70
      else if (rsi > 70 && position > 0) {
        balance = position * price;
        const pnl = balance - (position * entryPrice);
        tradeResults.push(pnl);
        position = 0;

        // Track drawdown
        if (balance > peakBalance) peakBalance = balance;
        const drawdown = ((peakBalance - balance) / peakBalance) * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      }
    }
  } else if (strategy === 'macd') {
    const macdValues = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const offset = closes.length - macdValues.length;

    for (let i = offset + 1; i < closes.length; i++) {
      const prev = macdValues[i - offset - 1];
      const curr = macdValues[i - offset];
      const price = closes[i];

      if (!prev?.MACD || !prev?.signal || !curr?.MACD || !curr?.signal) continue;

      // Buy: MACD crosses above signal
      if (prev.MACD <= prev.signal && curr.MACD > curr.signal && position === 0) {
        position = balance / price;
        entryPrice = price;
        balance = 0;
      }
      // Sell: MACD crosses below signal
      else if (prev.MACD >= prev.signal && curr.MACD < curr.signal && position > 0) {
        balance = position * price;
        const pnl = balance - (position * entryPrice);
        tradeResults.push(pnl);
        position = 0;

        if (balance > peakBalance) peakBalance = balance;
        const drawdown = ((peakBalance - balance) / peakBalance) * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      }
    }
  }

  // Close any open position at the end
  if (position > 0) {
    const finalPrice = closes[closes.length - 1];
    balance = position * finalPrice;
    const pnl = balance - (position * entryPrice);
    tradeResults.push(pnl);
    position = 0;
  }

  const finalBalance = balance || initialBalance;
  const totalPnl = finalBalance - initialBalance;
  const pnlPercent = (totalPnl / initialBalance) * 100;
  const totalTrades = tradeResults.length;
  const wins = tradeResults.filter(p => p > 0).length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  // Rough Sharpe approximation: mean return / stdev of returns
  let sharpeApprox = 0;
  if (tradeResults.length > 1) {
    const mean = tradeResults.reduce((a, b) => a + b, 0) / tradeResults.length;
    const variance = tradeResults.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / tradeResults.length;
    const stdev = Math.sqrt(variance);
    sharpeApprox = stdev > 0 ? mean / stdev : 0;
  }

  // Generate verdict
  let verdict: BacktestResult['verdict'];
  if (winRate >= 55 && pnlPercent > 5 && sharpeApprox > 0.5) {
    verdict = 'strong';
  } else if (winRate >= 45 && pnlPercent > 0) {
    verdict = 'viable';
  } else if (winRate >= 35 || pnlPercent > -5) {
    verdict = 'weak';
  } else {
    verdict = 'failing';
  }

  const summary = `${strategy.toUpperCase()} on ${symbol} (${timeframe}): ${totalTrades} trades, ${winRate.toFixed(1)}% win rate, ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}% P&L, max drawdown ${maxDrawdown.toFixed(1)}%. Verdict: ${verdict.toUpperCase()}.`;

  return {
    symbol,
    strategy,
    timeframe,
    totalTrades,
    winRate,
    totalPnl,
    pnlPercent,
    maxDrawdown,
    sharpeApprox,
    verdict,
    summary,
  };
}
