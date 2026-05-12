/**
 * Strategy Tracker — Performance Feedback Loop
 * 
 * Tracks every trade's outcome, computes win rate / P&L / drawdown
 * per strategy, and auto-disables strategies that underperform.
 * The Sentinel agent reads this data before approving new trades.
 */

export interface StrategyStats {
  id?: string;
  strategyName: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  currentStreak: number; // positive = win streak, negative = loss streak
  status: 'active' | 'paused' | 'disabled';
  disableReason?: string;
  lastTradeAt: string;
  updatedAt: string;
}

export interface TradeOutcome {
  tradeId: string;
  symbol: string;
  side: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  strategy: string;
  source: string;
  closedAt: string;
}

// Auto-disable thresholds
const THRESHOLDS = {
  MIN_TRADES_BEFORE_EVAL: 5,    // Need at least 5 trades before evaluating
  MIN_WIN_RATE: 35,              // Disable if win rate drops below 35%
  MAX_CONSECUTIVE_LOSSES: 5,     // Disable after 5 losses in a row
  MIN_PROFIT_FACTOR: 0.5,        // Disable if profit factor < 0.5
  MAX_DRAWDOWN_PERCENT: -15,     // Disable if drawdown exceeds -15%
};

export class StrategyTracker {
  private db: any;
  private statsCache: Map<string, StrategyStats> = new Map();

  constructor(db: any) {
    this.db = db;
  }

  /**
   * Record a completed trade outcome
   */
  async recordOutcome(outcome: TradeOutcome): Promise<StrategyStats> {
    const strategyName = outcome.strategy || outcome.source || 'manual';

    // Save outcome to Firestore
    await this.db.collection('tradeOutcomes').add({
      ...outcome,
      recordedAt: new Date().toISOString(),
    });

    // Get or create strategy stats
    let stats = await this.getStats(strategyName);
    if (!stats) {
      stats = this.createEmptyStats(strategyName);
    }

    // Update stats
    stats.totalTrades++;
    stats.totalPnl += outcome.pnl;
    stats.lastTradeAt = outcome.closedAt;
    stats.updatedAt = new Date().toISOString();

    if (outcome.pnl >= 0) {
      stats.wins++;
      stats.avgWin = ((stats.avgWin * (stats.wins - 1)) + outcome.pnl) / stats.wins;
      stats.currentStreak = stats.currentStreak >= 0 ? stats.currentStreak + 1 : 1;
    } else {
      stats.losses++;
      stats.avgLoss = ((stats.avgLoss * (stats.losses - 1)) + Math.abs(outcome.pnl)) / stats.losses;
      stats.currentStreak = stats.currentStreak <= 0 ? stats.currentStreak - 1 : -1;
    }

    stats.winRate = stats.totalTrades > 0 ? (stats.wins / stats.totalTrades) * 100 : 0;
    stats.profitFactor = stats.avgLoss > 0 ? (stats.avgWin * stats.wins) / (stats.avgLoss * stats.losses) : stats.avgWin > 0 ? Infinity : 0;

    // Track max drawdown
    if (stats.totalPnl < stats.maxDrawdown) {
      stats.maxDrawdown = stats.totalPnl;
    }

    // Auto-disable check
    const disableCheck = this.checkAutoDisable(stats);
    if (disableCheck.shouldDisable && stats.status === 'active') {
      stats.status = 'disabled';
      stats.disableReason = disableCheck.reason;
      console.log(`[STRATEGY TRACKER] ⛔ DISABLED "${strategyName}": ${disableCheck.reason}`);

      // Log to brain activity
      await this.db.collection('brainActivity').add({
        agent: 'sentinel',
        message: `⛔ Strategy "${strategyName}" auto-disabled: ${disableCheck.reason}`,
        type: 'veto',
        data: { strategyName, reason: disableCheck.reason, stats },
        timestamp: new Date().toISOString(),
      });

      // Send Telegram alert for strategy disable
      try {
        const { broadcastTelegram, formatStrategyAlert } = await import('./telegram.ts');
        await broadcastTelegram(this.db, formatStrategyAlert(strategyName, disableCheck.reason));
      } catch {}
    }

    // Save updated stats
    await this.saveStats(stats);
    this.statsCache.set(strategyName, stats);

    console.log(`[STRATEGY TRACKER] ${outcome.pnl >= 0 ? '✅' : '❌'} ${strategyName}: ${outcome.symbol} ${outcome.pnl >= 0 ? '+' : ''}$${outcome.pnl.toFixed(2)} | WR: ${stats.winRate.toFixed(1)}% | Streak: ${stats.currentStreak}`);

    return stats;
  }

  /**
   * Check if a strategy should be auto-disabled
   */
  private checkAutoDisable(stats: StrategyStats): { shouldDisable: boolean; reason: string } {
    if (stats.totalTrades < THRESHOLDS.MIN_TRADES_BEFORE_EVAL) {
      return { shouldDisable: false, reason: '' };
    }

    if (stats.winRate < THRESHOLDS.MIN_WIN_RATE) {
      return {
        shouldDisable: true,
        reason: `Win rate too low: ${stats.winRate.toFixed(1)}% (min ${THRESHOLDS.MIN_WIN_RATE}%)`,
      };
    }

    if (stats.currentStreak <= -THRESHOLDS.MAX_CONSECUTIVE_LOSSES) {
      return {
        shouldDisable: true,
        reason: `${Math.abs(stats.currentStreak)} consecutive losses (max ${THRESHOLDS.MAX_CONSECUTIVE_LOSSES})`,
      };
    }

    if (stats.profitFactor < THRESHOLDS.MIN_PROFIT_FACTOR && stats.profitFactor !== Infinity) {
      return {
        shouldDisable: true,
        reason: `Profit factor too low: ${stats.profitFactor.toFixed(2)} (min ${THRESHOLDS.MIN_PROFIT_FACTOR})`,
      };
    }

    return { shouldDisable: false, reason: '' };
  }

  /**
   * Check if a strategy is allowed to trade (used by Sentinel)
   */
  async isStrategyAllowed(strategyName: string): Promise<{ allowed: boolean; reason?: string; stats?: StrategyStats }> {
    const stats = await this.getStats(strategyName);
    if (!stats) {
      return { allowed: true, reason: 'New strategy — no history yet' };
    }

    if (stats.status === 'disabled') {
      return { allowed: false, reason: stats.disableReason || 'Strategy is disabled', stats };
    }

    if (stats.status === 'paused') {
      return { allowed: false, reason: 'Strategy is paused by user', stats };
    }

    return { allowed: true, stats };
  }

  /**
   * Get stats for a specific strategy
   */
  async getStats(strategyName: string): Promise<StrategyStats | null> {
    // Check cache first
    if (this.statsCache.has(strategyName)) {
      return this.statsCache.get(strategyName)!;
    }

    try {
      const snapshot = await this.db.collection('strategyStats')
        .where('strategyName', '==', strategyName)
        .limit(1)
        .get();

      if (snapshot.empty) return null;
      const data = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as StrategyStats;
      this.statsCache.set(strategyName, data);
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Get all strategy stats
   */
  async getAllStats(): Promise<StrategyStats[]> {
    try {
      const snapshot = await this.db.collection('strategyStats')
        .orderBy('totalTrades', 'desc')
        .limit(20)
        .get();

      return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    } catch {
      return [];
    }
  }

  /**
   * Manually toggle a strategy's status
   */
  async toggleStrategy(strategyName: string): Promise<StrategyStats | null> {
    const stats = await this.getStats(strategyName);
    if (!stats) return null;

    if (stats.status === 'active') {
      stats.status = 'paused';
    } else {
      stats.status = 'active';
      stats.disableReason = undefined;
    }
    stats.updatedAt = new Date().toISOString();

    await this.saveStats(stats);
    this.statsCache.set(strategyName, stats);
    return stats;
  }

  /**
   * Get a performance summary for the Brain page
   */
  async getPerformanceSummary(): Promise<{
    totalStrategies: number;
    activeStrategies: number;
    disabledStrategies: number;
    overallWinRate: number;
    totalPnl: number;
    bestStrategy: string;
    worstStrategy: string;
  }> {
    const allStats = await this.getAllStats();
    if (allStats.length === 0) {
      return {
        totalStrategies: 0,
        activeStrategies: 0,
        disabledStrategies: 0,
        overallWinRate: 0,
        totalPnl: 0,
        bestStrategy: 'N/A',
        worstStrategy: 'N/A',
      };
    }

    const totalTrades = allStats.reduce((s, a) => s + a.totalTrades, 0);
    const totalWins = allStats.reduce((s, a) => s + a.wins, 0);

    return {
      totalStrategies: allStats.length,
      activeStrategies: allStats.filter(s => s.status === 'active').length,
      disabledStrategies: allStats.filter(s => s.status === 'disabled').length,
      overallWinRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0,
      totalPnl: allStats.reduce((s, a) => s + a.totalPnl, 0),
      bestStrategy: allStats.sort((a, b) => b.totalPnl - a.totalPnl)[0]?.strategyName || 'N/A',
      worstStrategy: allStats.sort((a, b) => a.totalPnl - b.totalPnl)[0]?.strategyName || 'N/A',
    };
  }

  // ─── Private Helpers ──────────────────────────────────────

  private createEmptyStats(strategyName: string): StrategyStats {
    return {
      strategyName,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnl: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      currentStreak: 0,
      status: 'active',
      lastTradeAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  private async saveStats(stats: StrategyStats): Promise<void> {
    try {
      if (stats.id) {
        await this.db.collection('strategyStats').doc(stats.id).set(stats);
      } else {
        const docRef = await this.db.collection('strategyStats').add(stats);
        stats.id = docRef.id;
      }
    } catch (err) {
      console.error('[STRATEGY TRACKER] Failed to save stats:', err);
    }
  }
}
