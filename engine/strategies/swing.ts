/**
 * Swing strategy — RSI 40/60 cycle inside a daily uptrend.
 *
 * v1.7.2: this REPLACES the prior Turtle-Donchian swing (which failed validation:
 * profit factor 1.03 ≈ break-even with 89% max drawdown). The RSI-cycle approach
 * was validated by scratch/turtle-backtest.ts --mode swing-rsi-cycle:
 *   • $10k → $91k over 7.4y crypto basket (+815%, CAGR 34.8%)
 *   • Max drawdown 38% (vs Turtle-swing's 89%)
 *   • Win rate 49.6%, expectancy +0.11R, profit factor 1.11
 *   • Top 3 winners = 23% of profit (low fragility, vs position's 102%)
 *
 * The KEY rule that made this work — the same rule that took the no-filter
 * version from −99% to +815% — is the daily-uptrend filter.
 *
 * Entry (this module):
 *   • 4h RSI(14) <= 40  (oversold-ish, looking for a bounce)
 *   • Daily 50-EMA rising AND last daily close > daily 50-EMA  (uptrend intact)
 *   • Stop: 2N below entry (2x Wilder ATR-14 on the primary timeframe)
 *   • Size: (equity * 1%) / N coins  → ~2% risk at the 2N stop
 *
 * Exit (production — Sentry handles):
 *   • Hard stop at 2N (catastrophe protection)
 *   • Take-profit at entry + 2N  (~1R quick win to mirror the backtest mean)
 *
 * Caveat: the backtest's ideal exit is "close when RSI>=60", which is a
 * state-based rather than price-based rule. Sentry currently uses price
 * targets. A v2 enhancement would compute live RSI and emit an exit signal
 * when RSI>=60 fires; for now the +2N takeProfitPrice approximates the
 * average winning trade size from the backtest.
 */

import type { StrategyContext, TradeCandidate } from './types.ts';
import {
  wilderAtr, sizeByRisk, dailyUptrendOk,
} from './types.ts';

// Tunables (backtest used these exact values)
export const SWING_RSI_PERIOD = 14;
export const SWING_RSI_ENTRY_MAX = 40;   // enter at-or-below
export const SWING_RSI_EXIT_MIN = 60;    // production hint: Sentry should close when RSI>=60
export const SWING_ATR_PERIOD = 14;
export const SWING_STOP_N_MULT = 2;
export const SWING_TP_N_MULT = 2;        // +2N take-profit (~+1R)
export const SWING_RISK_PCT = 0.01;

// ─── Final-value Wilder RSI on the primary timeframe (4h by default). ──────
function rsiLast(candles: { close: number }[], period = SWING_RSI_PERIOD): number {
  const n = candles.length;
  if (n <= period) return NaN;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < n; i++) {
    const d = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function swingStrategy(ctx: StrategyContext): TradeCandidate | null {
  const { candles, symbol, equityUsd, dailyCandles } = ctx;
  if (candles.length < 60) return null;  // need enough bars for RSI + ATR warmup

  // 1) Primary-timeframe RSI must be oversold
  const rsi = rsiLast(candles, SWING_RSI_PERIOD);
  if (!Number.isFinite(rsi) || rsi > SWING_RSI_ENTRY_MAX) return null;

  // 2) Daily uptrend filter — the rule that made the difference between
  //    +815% and −99% in backtest. Skip if daily context unavailable.
  if (!dailyUptrendOk(dailyCandles, 50)) return null;

  // 3) Sizing + stop from ATR
  const atrSeries = wilderAtr(candles, SWING_ATR_PERIOD);
  const n = atrSeries[atrSeries.length - 1];
  if (!Number.isFinite(n) || n <= 0) return null;

  const i = candles.length - 1;
  const expectedFill = candles[i].close;
  const stopPrice = expectedFill - SWING_STOP_N_MULT * n;
  const takeProfitPrice = expectedFill + SWING_TP_N_MULT * n;
  const qty = sizeByRisk(equityUsd, n, SWING_RISK_PCT, expectedFill);
  if (qty <= 0) return null;

  return {
    symbol,
    side: 'buy',
    entryPrice: expectedFill,
    stopPrice,
    takeProfitPrice,
    initialN: n,
    qty,
    timeframe: 'swing',
    strategy: 'swing-rsi-cycle',
    reason: `RSI(${rsi.toFixed(0)}) ≤ ${SWING_RSI_ENTRY_MAX} in daily uptrend; N=${n.toPrecision(4)}; stop=${stopPrice.toPrecision(6)}; tp=${takeProfitPrice.toPrecision(6)}`,
    rrRatio: SWING_TP_N_MULT / SWING_STOP_N_MULT,
  };
}

// ─── Back-compat exports — kept so the backtest harness still imports cleanly.
// The Turtle-Donchian swing didn't validate (PF 1.03); we keep the param objects
// for the legacy backtest mode but the LIVE strategy is now RSI-cycle.
export interface SwingParams {
  entryLookback: number;
  exitLookback: number;
  atrPeriod: number;
  stopNMult: number;
  riskPct: number;
}
export const SWING_4H_PARAMS: SwingParams = {
  entryLookback: 21, exitLookback: 8, atrPeriod: 14, stopNMult: 2, riskPct: 0.01,
};
export const SWING_1H_PARAMS: SwingParams = {
  entryLookback: 20, exitLookback: 5, atrPeriod: 14, stopNMult: 2, riskPct: 0.01,
};
