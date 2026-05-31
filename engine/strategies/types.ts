/**
 * Shared types for the rules-engine strategy layer.
 *
 * Strategy modules are pure functions: take (candles + optional TV signals),
 * return a TradeCandidate or null. No DB access, no fetching. This lets the
 * SAME code run in production (via strategyOrchestrator) and in the backtest
 * (scratch/turtle-backtest.ts) without divergence.
 */

import type { TvSignal } from '../tvSignals.ts';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = 'position' | 'swing' | 'intraday';

export interface StrategyContext {
  symbol: string;
  candles: Candle[];          // ordered ascending; last entry = most recent CLOSED bar
  tvSignal?: TvSignal | null; // optional TV ratings (orchestrator fetches once per scan)
  equityUsd: number;          // current account equity (for sizing)
}

export interface TradeCandidate {
  symbol: string;
  side: 'buy';                // long-only v1
  entryPrice: number;         // expected next-bar-open fill
  stopPrice: number;
  takeProfitPrice?: number;
  initialN: number;           // ATR for sizing (Turtle "N")
  qty: number;                // sized via Kelly-like (equity * RISK_PCT) / N
  timeframe: Timeframe;
  strategy: string;           // 'turtle-system2' | 'swing-donchian' | 'momentum-vwap'
  reason: string;             // human-readable rule fire (for voice + UI)
  rrRatio?: number;           // (target - entry) / (entry - stop) when target is set
}

export type StrategyFn = (ctx: StrategyContext) => TradeCandidate | null;

// ─── Shared math helpers (used by all strategy modules + backtest) ──────────

/** Wilder ATR — the Turtles' "N". Returns array aligned to candle index (NaN until warm). */
export function wilderAtr(candles: Candle[], period: number): number[] {
  const n = candles.length;
  const atr = new Array<number>(n).fill(NaN);
  if (n <= period) return atr;
  const tr = new Array<number>(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  atr[period] = sum / period;
  for (let i = period + 1; i < n; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

/** Donchian channel — extreme of the PRIOR `lookback` bars (excludes current). */
export function rollingExtreme(candles: Candle[], lookback: number, kind: 'high' | 'low'): number[] {
  const n = candles.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = lookback; i < n; i++) {
    let ext = kind === 'high' ? -Infinity : Infinity;
    for (let j = i - lookback; j < i; j++) {
      const v = kind === 'high' ? candles[j].high : candles[j].low;
      if (kind === 'high') { if (v > ext) ext = v; }
      else { if (v < ext) ext = v; }
    }
    out[i] = ext;
  }
  return out;
}

/** Wilder RSI(14) — final value only. Returns NaN if not enough data. */
export function rsi(candles: Candle[], period = 14): number {
  if (candles.length <= period) return NaN;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d > 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Session VWAP — rolling N-bar volume-weighted average price. */
export function vwap(candles: Candle[], lookback: number): number {
  const n = candles.length;
  if (n < 1) return NaN;
  const start = Math.max(0, n - lookback);
  let pv = 0, v = 0;
  for (let i = start; i < n; i++) {
    const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
    pv += typical * candles[i].volume;
    v += candles[i].volume;
  }
  return v > 0 ? pv / v : NaN;
}

/** Average volume over the last N closed bars (excludes the current). */
export function avgVolume(candles: Candle[], lookback: number): number {
  const n = candles.length;
  if (n < lookback + 1) return NaN;
  let s = 0;
  for (let i = n - lookback - 1; i < n - 1; i++) s += candles[i].volume;
  return s / lookback;
}

/** Sizing: units(coins) = (equity * riskPct) / N. Capped by cash availability. */
export function sizeByRisk(equityUsd: number, n: number, riskPct: number, fillPrice: number): number {
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(fillPrice) || fillPrice <= 0) return 0;
  const qty = (equityUsd * riskPct) / n;
  return qty > 0 ? qty : 0;
}
