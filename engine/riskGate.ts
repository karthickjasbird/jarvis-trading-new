/**
 * Risk Gate — single audit point for every position-OPENING write.
 *
 * Every check that could refuse a new entry lives here. Existing inline
 * checks in tradeExecutor.checkRiskManagement have been folded in; the
 * gate is now the canonical "does this trade pass risk?" answer.
 *
 * Returns a structured result with `code` so callers can log, route, or
 * surface the rejection cleanly:
 *
 *   const r = await riskGate.checkOpen({ userId, symbol, ..., price });
 *   if (!r.allowed) {
 *     // r.code: KILL_SWITCH | DAILY_LOSS | NOTIONAL_CAP | CONCURRENT_CAP |
 *     //         LIVE_CAPITAL_CAP | LEVERAGE_CAP
 *     // r.reason: human-readable explanation
 *   }
 *
 * Closes / partial-closes do NOT call the gate — they reduce exposure and
 * should never be blocked by an opening-side risk check.
 */

import { isHalted } from './killSwitch.ts';

export type RiskCode =
  | 'KILL_SWITCH'
  | 'DAILY_LOSS'
  | 'NOTIONAL_CAP'
  | 'CONCURRENT_CAP'
  | 'LIVE_CAPITAL_CAP'
  | 'LEVERAGE_CAP';

export interface OpenAction {
  userId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  assetClass: 'crypto' | 'stock';
  isPractice: boolean;
  leverage?: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  code?: RiskCode;
  reason?: string;
  /** Debug info — what NAV/cap/positions we saw at decision time. */
  context?: Record<string, any>;
}

interface RiskSettings {
  maxDailyLoss?: number;
  maxPositionSizePct?: number;
  maxOpenPositions?: number;
  maxLiveCapital?: number;
  maxLeverage?: { crypto?: number; stock?: number };
}

const DEFAULTS = {
  maxDailyLoss: 1000,
  maxPositionSizePct: 20,
  maxOpenPositions: 5,
  maxLiveCapital: 50,
  maxLeverage: { crypto: 10, stock: 1 },
} as const;

export class RiskGate {
  constructor(
    private db: FirebaseFirestore.Firestore,
    private marketState: Record<string, { price: number }>,
  ) {}

  async checkOpen(action: OpenAction): Promise<RiskCheckResult> {
    // 1. Kill switch (delegated to engine/killSwitch.ts)
    const halt = isHalted();
    if (halt.halted) {
      return {
        allowed: false,
        code: 'KILL_SWITCH',
        reason: halt.reason || 'manual halt',
        context: { source: halt.source, since: halt.since },
      };
    }

    const settings = await this.loadSettings(action.userId);
    const notional = action.quantity * action.price;

    // 2. Daily loss cap
    const cap = settings.maxDailyLoss ?? DEFAULTS.maxDailyLoss;
    if (cap > 0) {
      const dailyPnl = await this.getDailyPnl(action.userId);
      if (dailyPnl <= -cap) {
        return {
          allowed: false,
          code: 'DAILY_LOSS',
          reason: `Daily loss $${Math.abs(dailyPnl).toFixed(2)} reached cap $${cap}`,
          context: { dailyPnl, cap },
        };
      }
    }

    // 3. Notional cap (single-order % of NAV)
    const navBalance = await this.getNavBalance(action.userId);
    const pctCap = settings.maxPositionSizePct ?? DEFAULTS.maxPositionSizePct;
    if (pctCap > 0 && navBalance > 0) {
      const maxValue = navBalance * (pctCap / 100);
      if (notional > maxValue) {
        return {
          allowed: false,
          code: 'NOTIONAL_CAP',
          reason: `Order $${notional.toFixed(2)} > ${pctCap}% of NAV $${navBalance.toFixed(2)} (max $${maxValue.toFixed(2)})`,
          context: { notional, navBalance, pctCap, maxValue },
        };
      }
    }

    // 4. Concurrent positions cap
    const concurrentCap = settings.maxOpenPositions ?? DEFAULTS.maxOpenPositions;
    if (concurrentCap > 0) {
      const openCount = await this.getOpenPositionCount(action.userId);
      if (openCount >= concurrentCap) {
        return {
          allowed: false,
          code: 'CONCURRENT_CAP',
          reason: `Already ${openCount} open positions (cap: ${concurrentCap})`,
          context: { openCount, cap: concurrentCap },
        };
      }
    }

    // 5. Live capital cap (aggregate LIVE-money exposure)
    if (!action.isPractice) {
      const liveCap = settings.maxLiveCapital ?? DEFAULTS.maxLiveCapital;
      if (liveCap > 0) {
        let openLiveExposure = 0;
        try {
          const liveSnap = await this.db.collection('trades')
            .where('userId', '==', action.userId)
            .where('status', '==', 'open')
            .where('isPractice', '==', false)
            .get();
          for (const doc of liveSnap.docs) {
            const t: any = doc.data();
            const px = this.marketState?.[t.symbol]?.price || t.entryPrice || 0;
            openLiveExposure += (Number(t.quantity) || 0) * Number(px || 0);
          }
        } catch (err: any) {
          // Fail-closed on live money — if we can't verify exposure, refuse.
          return {
            allowed: false,
            code: 'LIVE_CAPITAL_CAP',
            reason: `Could not verify live exposure (${err.message}). Refusing live trade for safety.`,
            context: { error: err.message },
          };
        }
        const projected = openLiveExposure + notional;
        if (projected > liveCap) {
          return {
            allowed: false,
            code: 'LIVE_CAPITAL_CAP',
            reason: `Live $${openLiveExposure.toFixed(2)} + this $${notional.toFixed(2)} = $${projected.toFixed(2)} > $${liveCap} cap`,
            context: { openLiveExposure, notional, projected, liveCap },
          };
        }
      }
    }

    // 6. Leverage cap per asset class (only enforced when leverage > 1)
    if (action.leverage && action.leverage > 1) {
      const levCaps = { ...DEFAULTS.maxLeverage, ...(settings.maxLeverage || {}) };
      const cap = action.assetClass === 'crypto' ? levCaps.crypto : levCaps.stock;
      if (cap && action.leverage > cap) {
        return {
          allowed: false,
          code: 'LEVERAGE_CAP',
          reason: `${action.leverage}x leverage > ${cap}x cap for ${action.assetClass}`,
          context: { leverage: action.leverage, cap, assetClass: action.assetClass },
        };
      }
    }

    return { allowed: true };
  }

  private async loadSettings(userId: string): Promise<RiskSettings> {
    try {
      const doc = await this.db.collection('riskSettings').doc(userId).get();
      if (doc.exists) return (doc.data() as RiskSettings) || {};
    } catch {}
    return {};
  }

  private async getDailyPnl(userId: string): Promise<number> {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const snap = await this.db.collection('trades')
        .where('userId', '==', userId)
        .where('status', '==', 'closed')
        .get();
      let pnl = 0;
      for (const doc of snap.docs) {
        const t: any = doc.data();
        if (!t.closedAt) continue;
        if (new Date(t.closedAt) >= startOfDay) {
          pnl += Number(t.pnl) || 0;
        }
      }
      return pnl;
    } catch {
      return 0;
    }
  }

  private async getNavBalance(userId: string): Promise<number> {
    try {
      const doc = await this.db.collection('portfolios').doc(userId).get();
      if (doc.exists) {
        const data = doc.data() as any;
        // Existing behavior: position-size % is measured against paperBalance
        // (or 100k default). Live NAV would be more correct but is a separate
        // refactor — preserving today's check for now.
        return Number(data?.paperBalance) || 100000;
      }
    } catch {}
    return 100000;
  }

  private async getOpenPositionCount(userId: string): Promise<number> {
    try {
      const snap = await this.db.collection('trades')
        .where('userId', '==', userId)
        .where('status', '==', 'open')
        .get();
      return snap.size;
    } catch {
      return 0;
    }
  }
}
