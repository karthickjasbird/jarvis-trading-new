/**
 * Position strategy — Turtle System-2 (the validated edge).
 *
 * Daily bars, weeks-to-months hold. Published params from Curtis Faith's
 * "Way of the Turtle" (2007); NOT tuned to our data — that's the whole point.
 *
 * Rules:
 *   Entry  : today's close > highest high of the prior 55 daily bars
 *   N      : 20-period Wilder ATR
 *   Size   : (equity * 1%) / N coins (≈ 2% equity risk at 2N stop)
 *   Stop   : 2N below entry
 *   Exit (managed elsewhere by sentry/orchestrator): close < lowest low of prior 20 bars,
 *           OR stop hit, whichever first.
 *
 * Validated by scratch/turtle-backtest.ts: $10k → $438k over 7.4y on a 56-pair
 * crypto basket (including dead coins like LUNA/FTT), 60% max DD, beat
 * buy-and-hold BTC on both return and drawdown.
 */

import type { Candle, StrategyContext, TradeCandidate } from './types.ts';
import { wilderAtr, rollingExtreme, sizeByRisk } from './types.ts';
import { isBearish } from '../tvSignals.ts';

export const POSITION_ENTRY_LOOKBACK = 55;
export const POSITION_EXIT_LOOKBACK = 20;
export const POSITION_ATR_PERIOD = 20;
export const POSITION_STOP_N_MULT = 2;
export const POSITION_RISK_PCT = 0.01;

export function positionStrategy(ctx: StrategyContext): TradeCandidate | null {
  const { candles, symbol, tvSignal, equityUsd } = ctx;
  if (candles.length < POSITION_ENTRY_LOOKBACK + 5) return null;

  const i = candles.length - 1;  // last closed bar
  const c = candles[i];

  // Compute the breakout level and N at the current bar
  const entryHigh = rollingExtreme(candles, POSITION_ENTRY_LOOKBACK, 'high');
  const atr = wilderAtr(candles, POSITION_ATR_PERIOD);
  const breakoutLevel = entryHigh[i];
  const n = atr[i];

  if (!Number.isFinite(breakoutLevel) || !Number.isFinite(n) || n <= 0) return null;

  // Primary rule: today's close breaks the 55-day high
  if (c.close <= breakoutLevel) return null;

  // Optional TV cross-check: if TV's MA rating is STRONG_SELL, skip the breakout
  // (rare but real — usually fires on a fake-out rally inside a deeper downtrend)
  if (tvSignal && isBearish(tvSignal.maRating) && tvSignal.maRating === 'STRONG_SELL') return null;

  // Fill model: next-bar open (orchestrator/executor handles real fill)
  const expectedFill = c.close;  // close-of-signal as the planning price; executor uses next open
  const stopPrice = expectedFill - POSITION_STOP_N_MULT * n;
  const qty = sizeByRisk(equityUsd, n, POSITION_RISK_PCT, expectedFill);
  if (qty <= 0) return null;

  return {
    symbol,
    side: 'buy',
    entryPrice: expectedFill,
    stopPrice,
    initialN: n,
    qty,
    timeframe: 'position',
    strategy: 'turtle-system2',
    reason: `${POSITION_ENTRY_LOOKBACK}d breakout: close ${c.close.toPrecision(6)} > prior-${POSITION_ENTRY_LOOKBACK}d high ${breakoutLevel.toPrecision(6)}; N=${n.toPrecision(4)}; stop=${stopPrice.toPrecision(6)}`,
  };
}

/** For the backtest: also expose pure breakout-level/ATR computation. */
export function positionLevels(candles: Candle[]): { entryHigh: number[]; exitLow: number[]; atr: number[] } {
  return {
    entryHigh: rollingExtreme(candles, POSITION_ENTRY_LOOKBACK, 'high'),
    exitLow: rollingExtreme(candles, POSITION_EXIT_LOOKBACK, 'low'),
    atr: wilderAtr(candles, POSITION_ATR_PERIOD),
  };
}
