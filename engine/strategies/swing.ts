/**
 * Swing strategy — same Turtle structure on 4H / 1H bars.
 *
 * Days-to-2-weeks hold. Lookback windows scaled to the faster timeframe
 * (proportionally shorter) so the same "break a recent extreme + cut losses
 * at 2N + ride winners" rhythm applies at swing cadence.
 *
 * NOT yet validated by backtest — orchestrator will check the validation
 * outcome and only enable swing if scratch/turtle-backtest.ts --strategy swing
 * has passed the gates (positive expectancy after fees, acceptable DD, not
 * fragility-dependent on top-3).
 */

import type { Candle, StrategyContext, TradeCandidate } from './types.ts';
import { wilderAtr, rollingExtreme, sizeByRisk } from './types.ts';
import { isBearish } from '../tvSignals.ts';

// 4H: ~21 bars = 3.5 days; 8 bars = ~1.5 days for exit
// 1H: ~20 bars = ~1 day; 5 bars = 5h for exit
// Configurable per timeframe at call time:
export interface SwingParams {
  entryLookback: number;
  exitLookback: number;
  atrPeriod: number;
  stopNMult: number;
  riskPct: number;
}

export const SWING_4H_PARAMS: SwingParams = {
  entryLookback: 21,
  exitLookback: 8,
  atrPeriod: 14,
  stopNMult: 2,
  riskPct: 0.01,
};

export const SWING_1H_PARAMS: SwingParams = {
  entryLookback: 20,
  exitLookback: 5,
  atrPeriod: 14,
  stopNMult: 2,
  riskPct: 0.01,
};

export function swingStrategy(ctx: StrategyContext, params: SwingParams = SWING_4H_PARAMS): TradeCandidate | null {
  const { candles, symbol, tvSignal, equityUsd } = ctx;
  if (candles.length < params.entryLookback + 5) return null;

  const i = candles.length - 1;
  const c = candles[i];

  const entryHigh = rollingExtreme(candles, params.entryLookback, 'high');
  const atr = wilderAtr(candles, params.atrPeriod);
  const breakoutLevel = entryHigh[i];
  const n = atr[i];

  if (!Number.isFinite(breakoutLevel) || !Number.isFinite(n) || n <= 0) return null;
  if (c.close <= breakoutLevel) return null;

  // TV cross-check: stronger filter at swing cadence — skip on either MA or
  // OS rating in STRONG_SELL territory (faster timeframe = noisier breakouts).
  if (tvSignal && (tvSignal.maRating === 'STRONG_SELL' || tvSignal.osRating === 'STRONG_SELL')) return null;

  const expectedFill = c.close;
  const stopPrice = expectedFill - params.stopNMult * n;
  const qty = sizeByRisk(equityUsd, n, params.riskPct, expectedFill);
  if (qty <= 0) return null;

  return {
    symbol,
    side: 'buy',
    entryPrice: expectedFill,
    stopPrice,
    initialN: n,
    qty,
    timeframe: 'swing',
    strategy: 'swing-donchian',
    reason: `${params.entryLookback}-bar breakout (swing): close ${c.close.toPrecision(6)} > prior high ${breakoutLevel.toPrecision(6)}; N=${n.toPrecision(4)}; stop=${stopPrice.toPrecision(6)}`,
  };
}

export function swingLevels(candles: Candle[], params: SwingParams = SWING_4H_PARAMS) {
  return {
    entryHigh: rollingExtreme(candles, params.entryLookback, 'high'),
    exitLow: rollingExtreme(candles, params.exitLookback, 'low'),
    atr: wilderAtr(candles, params.atrPeriod),
  };
}
