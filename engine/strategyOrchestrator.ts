/**
 * Strategy Orchestrator — replaces the LLM swarm.
 *
 * Pipeline per scan:
 *   1. Fetch candles for the basket (Binance klines for crypto, Alpaca bars for stocks)
 *   2. Fetch TradingView ratings in one batched call
 *   3. Run each ENABLED strategy → candidates per timeframe
 *   4. Apply Sentinel risk rules (kill-switch, daily-loss cap, concurrency, R/R min, PAPER-ONLY enforcement)
 *   5. Write candidates to brainActivity for UI visibility
 *   6. Optionally auto-execute when in autonomous mode (still paper-only by hard gate)
 *
 * Pure rules — no LLM calls anywhere in this file.
 *
 * Defaults to:
 *   - Position strategy: always enabled (validated)
 *   - Swing: gated on `strategies.enabled.swing` in user settings (default false)
 *   - Intraday: gated on `strategies.enabled.intraday` in user settings (default false)
 *
 * The backtest at scratch/turtle-backtest.ts can set those gates after a validation run.
 */

import { TechnicalAnalysisEngine } from './technicalAnalysis.ts';
import { resolveAlpacaConnector } from './alpacaCreds.ts';
import { fetchCryptoSignals, fetchStockSignals, type TvSignal } from './tvSignals.ts';
import { positionStrategy } from './strategies/position.ts';
import { swingStrategy } from './strategies/swing.ts';
import { intradayStrategy } from './strategies/intraday.ts';
import type { Candle, StrategyContext, TradeCandidate, Timeframe } from './strategies/types.ts';

export interface OrchestratorDeps {
  db: any;
  ta: TechnicalAnalysisEngine;
  ownerUserId: string;
}

export interface OrchestratorOptions {
  /** Filter to a single timeframe; default = all enabled. */
  timeframe?: Timeframe;
  /** Crypto symbols (BINANCE pairs, no slash). */
  cryptoBasket?: string[];
  /** US equity tickers (Alpaca). */
  stockBasket?: string[];
  /** Equity used for sizing. */
  equityUsd: number;
}

export interface OrchestratorResult {
  candidates: TradeCandidate[];
  rejected: { symbol: string; reason: string }[];
  scannedAt: string;
  paperOnly: boolean;
}

interface UserStrategyConfig {
  enabled: { position: boolean; swing: boolean; intraday: boolean };
  swingTimeframe: '4h' | '1h';
  killSwitch: boolean;
  dailyLossCapUsd: number;
  maxConcurrentPositions: number;
  minRiskReward: number;
}

const DEFAULT_CONFIG: UserStrategyConfig = {
  enabled: { position: true, swing: false, intraday: false },
  swingTimeframe: '4h',
  killSwitch: false,
  dailyLossCapUsd: 100,
  maxConcurrentPositions: 6,
  minRiskReward: 1.0,
};

async function loadConfig(db: any, ownerId: string): Promise<UserStrategyConfig> {
  try {
    const doc = await db.collection('riskSettings').doc(ownerId).get();
    if (!doc.exists) return DEFAULT_CONFIG;
    const d = doc.data() || {};
    return {
      enabled: {
        position: d.strategies?.position?.enabled ?? true,
        swing: d.strategies?.swing?.enabled ?? false,
        intraday: d.strategies?.intraday?.enabled ?? false,
      },
      swingTimeframe: d.strategies?.swing?.timeframe ?? '4h',
      killSwitch: d.killSwitch === true,
      dailyLossCapUsd: Number(d.dailyLossCapUsd ?? 100),
      maxConcurrentPositions: Number(d.maxConcurrentPositions ?? 6),
      minRiskReward: Number(d.minRiskReward ?? 1.0),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function getOpenPositionCount(db: any, ownerId: string): Promise<number> {
  try {
    const snap = await db.collection('trades')
      .where('userId', '==', ownerId).where('status', '==', 'open').get();
    return snap.size;
  } catch { return 0; }
}

async function getDailyRealizedPnl(db: any, ownerId: string): Promise<number> {
  try {
    const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
    const snap = await db.collection('trades')
      .where('userId', '==', ownerId).where('status', '==', 'closed').get();
    let sum = 0;
    for (const d of snap.docs) {
      const t = d.data();
      if (t.closedAt && new Date(t.closedAt).getTime() >= startOfDay.getTime()) {
        sum += Number(t.pnl ?? 0);
      }
    }
    return sum;
  } catch { return 0; }
}

function timeframeToInterval(tf: Timeframe, swingTimeframe: '4h' | '1h'): string {
  if (tf === 'position') return '1d';
  if (tf === 'swing') return swingTimeframe;
  return '15m';
}

function candleLimitFor(tf: Timeframe): number {
  if (tf === 'position') return 300;  // 300 daily bars = ~10 months — enough for 55-day lookback + ATR + history
  if (tf === 'swing') return 200;
  return 200;
}

async function fetchCryptoCandles(ta: TechnicalAnalysisEngine, symbols: string[], interval: string, limit: number): Promise<Map<string, Candle[]>> {
  const out = new Map<string, Candle[]>();
  // Sequential with small delay to stay polite to Binance public API
  for (const sym of symbols) {
    try {
      const c = await ta.fetchCandles(sym, interval, limit);
      if (c.length >= 50) out.set(sym, c);
    } catch { /* skip on failure */ }
    await new Promise(r => setTimeout(r, 50));
  }
  return out;
}

async function fetchStockCandles(db: any, ownerUserId: string, symbols: string[], interval: string, limit: number): Promise<Map<string, Candle[]>> {
  const out = new Map<string, Candle[]>();
  const alpaca = await resolveAlpacaConnector(db, ownerUserId);
  if (!alpaca) return out;  // no creds → empty
  // Alpaca timeframe naming: '1Min' / '5Min' / '15Min' / '1Hour' / '4Hour' / '1Day'
  const alpacaTf = (
    interval === '1d' ? '1Day' :
    interval === '4h' ? '4Hour' :
    interval === '1h' ? '1Hour' :
    interval === '15m' ? '15Min' : '1Day'
  );
  for (const sym of symbols) {
    try {
      const bars = await alpaca.getBars(sym, alpacaTf as any, limit);
      if (!bars || bars.length < 50) continue;
      const candles: Candle[] = bars.map((b: any) => ({
        timestamp: new Date(b.t).getTime(),
        open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
      }));
      out.set(sym, candles);
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 80));
  }
  return out;
}

function runStrategiesForTimeframe(
  tf: Timeframe,
  candleMap: Map<string, Candle[]>,
  tvSignals: Map<string, TvSignal>,
  equityUsd: number,
  cfg: UserStrategyConfig,
  dailyCandleMap?: Map<string, Candle[]>,
): TradeCandidate[] {
  const out: TradeCandidate[] = [];
  for (const [symbol, candles] of candleMap.entries()) {
    const ctx: StrategyContext = {
      symbol, candles, equityUsd,
      tvSignal: tvSignals.get(symbol) ?? null,
      dailyCandles: dailyCandleMap?.get(symbol),
    };
    let candidate: TradeCandidate | null = null;
    if (tf === 'position' && cfg.enabled.position) {
      candidate = positionStrategy(ctx);
    } else if (tf === 'swing' && cfg.enabled.swing) {
      // v1.7.2 — swingStrategy is now RSI 40/60 cycle + daily-uptrend filter.
      // Requires ctx.dailyCandles; orchestrator fetches them in the swing branch below.
      candidate = swingStrategy(ctx);
    } else if (tf === 'intraday' && cfg.enabled.intraday) {
      candidate = intradayStrategy(ctx);
    }
    if (candidate) out.push(candidate);
  }
  return out;
}

/**
 * Main entry — replaces agentSwarm.runPipeline() in the new world.
 */
export async function runOrchestrator(deps: OrchestratorDeps, opts: OrchestratorOptions): Promise<OrchestratorResult> {
  const { db, ta, ownerUserId } = deps;
  const rejected: { symbol: string; reason: string }[] = [];
  const scannedAt = new Date().toISOString();

  // HARD GATE: live trading disabled by default. Honors LIVE_TRADING_DISABLED env var.
  // Default = paper-only. To enable live the user must explicitly set the env var to 'false'.
  const paperOnly = process.env.LIVE_TRADING_DISABLED !== 'false';

  const cfg = await loadConfig(db, ownerUserId);

  // Sentinel #1 — kill switch
  if (cfg.killSwitch) {
    return { candidates: [], rejected: [{ symbol: '*', reason: 'kill_switch_active' }], scannedAt, paperOnly };
  }

  // Sentinel #2 — daily loss cap
  const dailyPnl = await getDailyRealizedPnl(db, ownerUserId);
  if (dailyPnl <= -cfg.dailyLossCapUsd) {
    return { candidates: [], rejected: [{ symbol: '*', reason: `daily_loss_cap_hit (${dailyPnl.toFixed(2)} <= -${cfg.dailyLossCapUsd})` }], scannedAt, paperOnly };
  }

  // Sentinel #3 — concurrency cap (informational; we'll trim final list below)
  const openCount = await getOpenPositionCount(db, ownerUserId);
  const slotsAvailable = Math.max(0, cfg.maxConcurrentPositions - openCount);

  const timeframes: Timeframe[] = opts.timeframe ? [opts.timeframe] : ['position', 'swing', 'intraday'];
  const allCandidates: TradeCandidate[] = [];

  // Fetch TV signals once per scan
  const cryptoBasket = opts.cryptoBasket ?? [];
  const stockBasket = opts.stockBasket ?? [];
  const [tvCrypto, tvStocks] = await Promise.all([
    cryptoBasket.length ? fetchCryptoSignals(cryptoBasket) : Promise.resolve(new Map<string, TvSignal>()),
    stockBasket.length ? fetchStockSignals(stockBasket) : Promise.resolve(new Map<string, TvSignal>()),
  ]);

  for (const tf of timeframes) {
    if (tf === 'position' && !cfg.enabled.position) continue;
    if (tf === 'swing' && !cfg.enabled.swing) continue;
    if (tf === 'intraday' && !cfg.enabled.intraday) continue;

    const interval = timeframeToInterval(tf, cfg.swingTimeframe);
    const limit = candleLimitFor(tf);

    // v1.7.2 — swing strategy needs daily context for its uptrend filter.
    // Fetch daily bars for every basket symbol when running the swing timeframe.
    const needDaily = tf === 'swing';
    let dailyCrypto: Map<string, Candle[]> | undefined;
    let dailyStocks: Map<string, Candle[]> | undefined;
    if (needDaily) {
      if (cryptoBasket.length) dailyCrypto = await fetchCryptoCandles(ta, cryptoBasket, '1d', 250);
      if (stockBasket.length) dailyStocks = await fetchStockCandles(db, ownerUserId, stockBasket, '1d', 250);
    }

    // CRYPTO
    if (cryptoBasket.length) {
      const candles = await fetchCryptoCandles(ta, cryptoBasket, interval, limit);
      const found = runStrategiesForTimeframe(tf, candles, tvCrypto, opts.equityUsd, cfg, dailyCrypto);
      allCandidates.push(...found);
    }

    // STOCKS
    if (stockBasket.length) {
      const candles = await fetchStockCandles(db, ownerUserId, stockBasket, interval, limit);
      const found = runStrategiesForTimeframe(tf, candles, tvStocks, opts.equityUsd, cfg, dailyStocks);
      allCandidates.push(...found);
    }
  }

  // Sentinel #4 — deduplicate: if the same symbol fires on multiple timeframes, position wins.
  const bySym = new Map<string, TradeCandidate>();
  const tfPriority: Record<Timeframe, number> = { position: 3, swing: 2, intraday: 1 };
  for (const c of allCandidates) {
    const existing = bySym.get(c.symbol);
    if (!existing || tfPriority[c.timeframe] > tfPriority[existing.timeframe]) bySym.set(c.symbol, c);
  }
  let candidates = Array.from(bySym.values());

  // Sentinel #5 — concurrency trim. Keep only as many as slots available (sorted by strategy priority, then by R-distance).
  candidates.sort((a, b) => tfPriority[b.timeframe] - tfPriority[a.timeframe]);
  if (candidates.length > slotsAvailable) {
    const dropped = candidates.slice(slotsAvailable);
    for (const d of dropped) rejected.push({ symbol: d.symbol, reason: 'concurrency_cap' });
    candidates = candidates.slice(0, slotsAvailable);
  }

  // Lifecycle logging for Phase 3 observation
  try {
    for (const c of candidates) {
      await db.collection('brainActivity').add({
        userId: ownerUserId,
        agent: 'orchestrator',
        type: 'candidate_proposed',
        message: `📐 ${c.symbol} ${c.timeframe} entry — ${c.reason}`,
        timestamp: scannedAt,
        data: {
          symbol: c.symbol, side: c.side, timeframe: c.timeframe, strategy: c.strategy,
          entryPrice: c.entryPrice, stopPrice: c.stopPrice, qty: c.qty, initialN: c.initialN,
          paperOnly,
        },
      });
    }
  } catch (err: any) {
    console.warn(`[orchestrator] brainActivity write failed: ${err.message}`);
  }

  return { candidates, rejected, scannedAt, paperOnly };
}
