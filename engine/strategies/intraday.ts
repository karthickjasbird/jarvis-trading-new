/**
 * Intraday strategy — momentum-confirmed breakout, 15m+ bars only.
 *
 * Hours-to-end-of-day hold. NO scalping below 15m (math doesn't work for retail
 * after fees). Different rulebook from Turtle — Turtle's wide-stop breakout
 * gets chewed by intraday noise + fees, so we use stricter confirmation:
 *
 * Rules (all must hold on the just-closed 15m bar):
 *   1. Price breaks above the high of the prior 20 15m bars (5-hour Donchian)
 *   2. Price > rolling VWAP(40 bars ≈ 10h)
 *   3. RSI(14) > 55  (not exhausted, not just rangebound)
 *   4. Volume > 1.5 × avg of prior 20 bars  (real participation, not a thin breakout)
 *   5. ATR(14) > 0 (must have measurable volatility for sizing)
 *
 * Exit (managed by sentry/orchestrator):
 *   - Price closes back below VWAP, OR
 *   - 2× ATR stop hits intraday, whichever first.
 *
 * NOT yet validated by backtest. Orchestrator only enables this if
 * scratch/turtle-backtest.ts --strategy intraday has passed the gates.
 */

import type { Candle, StrategyContext, TradeCandidate } from './types.ts';
import { wilderAtr, rollingExtreme, rsi, vwap, avgVolume, sizeByRisk } from './types.ts';
import { isBearish } from '../tvSignals.ts';

export const INTRADAY_ENTRY_LOOKBACK = 20;     // ~5h on 15m bars
export const INTRADAY_VWAP_LOOKBACK = 40;      // ~10h
export const INTRADAY_ATR_PERIOD = 14;
export const INTRADAY_RSI_PERIOD = 14;
export const INTRADAY_RSI_MIN = 55;
export const INTRADAY_VOL_MULT = 1.5;
export const INTRADAY_VOL_LOOKBACK = 20;
export const INTRADAY_STOP_N_MULT = 2;
export const INTRADAY_RISK_PCT = 0.005;        // smaller risk per trade — more trades expected

export function intradayStrategy(ctx: StrategyContext): TradeCandidate | null {
  const { candles, symbol, tvSignal, equityUsd } = ctx;
  if (candles.length < INTRADAY_VWAP_LOOKBACK + 5) return null;

  const i = candles.length - 1;
  const c = candles[i];

  // 1. Donchian breakout
  const entryHigh = rollingExtreme(candles, INTRADAY_ENTRY_LOOKBACK, 'high');
  const breakoutLevel = entryHigh[i];
  if (!Number.isFinite(breakoutLevel) || c.close <= breakoutLevel) return null;

  // 2. VWAP filter
  const v = vwap(candles, INTRADAY_VWAP_LOOKBACK);
  if (!Number.isFinite(v) || c.close <= v) return null;

  // 3. RSI filter
  const r = rsi(candles, INTRADAY_RSI_PERIOD);
  if (!Number.isFinite(r) || r < INTRADAY_RSI_MIN) return null;

  // 4. Volume confirmation
  const av = avgVolume(candles, INTRADAY_VOL_LOOKBACK);
  if (!Number.isFinite(av) || c.volume < av * INTRADAY_VOL_MULT) return null;

  // 5. ATR for sizing
  const atr = wilderAtr(candles, INTRADAY_ATR_PERIOD);
  const n = atr[i];
  if (!Number.isFinite(n) || n <= 0) return null;

  // TV cross-check: intraday is fee-sensitive — skip if MA bearish
  if (tvSignal && isBearish(tvSignal.maRating)) return null;

  const expectedFill = c.close;
  const stopPrice = expectedFill - INTRADAY_STOP_N_MULT * n;
  const qty = sizeByRisk(equityUsd, n, INTRADAY_RISK_PCT, expectedFill);
  if (qty <= 0) return null;

  return {
    symbol,
    side: 'buy',
    entryPrice: expectedFill,
    stopPrice,
    initialN: n,
    qty,
    timeframe: 'intraday',
    strategy: 'momentum-vwap',
    reason: `15m breakout + VWAP(${v.toPrecision(6)})↑ + RSI(${r.toFixed(0)}) + vol ${(c.volume / av).toFixed(1)}× avg; stop=${stopPrice.toPrecision(6)}`,
  };
}
