/**
 * Kelly Position Sizing Calculator
 * 
 * Uses the Kelly Criterion to determine mathematically optimal bet sizes
 * based on historical win rate and risk/reward ratios.
 * 
 * Formula: f* = (bp - q) / b
 *   where:
 *     f* = fraction of capital to risk
 *     b  = average win / average loss (payoff ratio)
 *     p  = probability of winning (win rate)
 *     q  = probability of losing (1 - p)
 * 
 * We use "Half-Kelly" (f-star / 2) for safety -- full Kelly is mathematically
 * optimal but assumes perfect data, which we never have in practice.
 * 
 * The engine also provides per-symbol Kelly fractions, so Jarvis can
 * bet more on coins where it has a proven edge and less on unknowns.
 */

// ─── Types ──────────────────────────────────────────────────

export interface KellyStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;           // 0-1
  avgWin: number;            // Average $ profit on winning trades
  avgLoss: number;           // Average $ loss on losing trades (positive number)
  payoffRatio: number;       // avgWin / avgLoss
  kellyFraction: number;     // Full Kelly (0-1)
  halfKelly: number;         // Half Kelly — what we actually use
  recommendedRiskPercent: number;  // As a percentage of capital
  edge: number;              // Expected value per $1 risked
  streakData: {
    currentStreak: number;   // Positive = win streak, negative = loss streak
    longestWinStreak: number;
    longestLossStreak: number;
  };
}

export interface SymbolKelly {
  symbol: string;
  stats: KellyStats;
}

export interface KellyReport {
  userId: string;
  overall: KellyStats;
  bySymbol: SymbolKelly[];
  generatedAt: string;
  dataWindow: string;       // e.g. "Last 50 trades" or "Last 30 days"
}

// ─── Engine ─────────────────────────────────────────────────

export class KellyCalculator {
  private db: any;
  private cache: Map<string, { report: KellyReport; cachedAt: number }> = new Map();
  private cacheDurationMs = 10 * 60 * 1000; // 10 min cache

  constructor(db: any) {
    this.db = db;
  }

  /**
   * Get the Kelly-optimal position size for a user
   */
  async getKellyReport(userId: string, tradeLimit: number = 100): Promise<KellyReport> {
    // Check cache
    const cached = this.cache.get(userId);
    if (cached && (Date.now() - cached.cachedAt) < this.cacheDurationMs) {
      return cached.report;
    }

    // Fetch closed trades
    const snapshot = await this.db.collection('trades')
      .where('userId', '==', userId)
      .where('status', '==', 'closed')
      .orderBy('closedAt', 'desc')
      .limit(tradeLimit)
      .get();

    const trades = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));

    // Calculate overall Kelly
    const overall = this.calculateKelly(trades);

    // Calculate per-symbol Kelly
    const symbolMap = new Map<string, any[]>();
    for (const trade of trades) {
      const sym = trade.symbol || 'UNKNOWN';
      if (!symbolMap.has(sym)) symbolMap.set(sym, []);
      symbolMap.get(sym)!.push(trade);
    }

    const bySymbol: SymbolKelly[] = [];
    for (const [symbol, symTrades] of symbolMap) {
      if (symTrades.length >= 3) { // Need at least 3 trades for meaningful stats
        bySymbol.push({
          symbol,
          stats: this.calculateKelly(symTrades),
        });
      }
    }

    // Sort by edge (best performers first)
    bySymbol.sort((a, b) => b.stats.edge - a.stats.edge);

    const report: KellyReport = {
      userId,
      overall,
      bySymbol,
      generatedAt: new Date().toISOString(),
      dataWindow: `Last ${trades.length} trades`,
    };

    this.cache.set(userId, { report, cachedAt: Date.now() });
    return report;
  }

  /**
   * Calculate Kelly statistics from a set of trades
   */
  private calculateKelly(trades: any[]): KellyStats {
    if (trades.length === 0) {
      return this.emptyStats();
    }

    const wins = trades.filter(t => (t.pnl || 0) > 0);
    const losses = trades.filter(t => (t.pnl || 0) <= 0);

    const winCount = wins.length;
    const lossCount = losses.length;
    const totalTrades = trades.length;

    const winRate = totalTrades > 0 ? winCount / totalTrades : 0;

    const avgWin = winCount > 0
      ? wins.reduce((sum: number, t: any) => sum + Math.abs(t.pnl || 0), 0) / winCount
      : 0;

    const avgLoss = lossCount > 0
      ? losses.reduce((sum: number, t: any) => sum + Math.abs(t.pnl || 0), 0) / lossCount
      : 1; // Avoid division by zero

    const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0;

    // Kelly Criterion: f* = (bp - q) / b
    const b = payoffRatio;
    const p = winRate;
    const q = 1 - p;

    let kellyFraction = 0;
    if (b > 0 && p > 0) {
      kellyFraction = (b * p - q) / b;
    }

    // Clamp Kelly between 0 and 0.5 (never risk more than 50%)
    kellyFraction = Math.max(0, Math.min(0.5, kellyFraction));

    // Half-Kelly for safety
    const halfKelly = kellyFraction / 2;

    // Recommended risk as percentage
    const recommendedRiskPercent = Math.round(halfKelly * 1000) / 10; // e.g. 0.12 → 12.0%

    // Edge: expected value per $1 risked
    const edge = (winRate * avgWin) - ((1 - winRate) * avgLoss);

    // Streak calculation
    const streakData = this.calculateStreaks(trades);

    return {
      totalTrades,
      wins: winCount,
      losses: lossCount,
      winRate: Math.round(winRate * 1000) / 1000, // 3 decimal places
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      payoffRatio: Math.round(payoffRatio * 100) / 100,
      kellyFraction: Math.round(kellyFraction * 1000) / 1000,
      halfKelly: Math.round(halfKelly * 1000) / 1000,
      recommendedRiskPercent,
      edge: Math.round(edge * 100) / 100,
      streakData,
    };
  }

  /**
   * Calculate win/loss streaks
   */
  private calculateStreaks(trades: any[]): KellyStats['streakData'] {
    let currentStreak = 0;
    let longestWinStreak = 0;
    let longestLossStreak = 0;
    let tempStreak = 0;

    // Trades are sorted desc by closedAt, reverse for chronological order
    const chronological = [...trades].reverse();

    for (const trade of chronological) {
      const isWin = (trade.pnl || 0) > 0;

      if (isWin) {
        if (tempStreak > 0) {
          tempStreak++;
        } else {
          tempStreak = 1;
        }
        longestWinStreak = Math.max(longestWinStreak, tempStreak);
      } else {
        if (tempStreak < 0) {
          tempStreak--;
        } else {
          tempStreak = -1;
        }
        longestLossStreak = Math.max(longestLossStreak, Math.abs(tempStreak));
      }
    }

    currentStreak = tempStreak;

    return { currentStreak, longestWinStreak, longestLossStreak };
  }

  /**
   * Get the optimal position size for a specific trade
   * 
   * @param userId - User ID
   * @param capital - Total available capital
   * @param symbol - Trading symbol (optional, for per-symbol Kelly)
   * @param confidence - TA confidence 0-100 (scales the Kelly fraction)
   * @returns Recommended position size in $
   */
  async getOptimalPositionSize(
    userId: string,
    capital: number,
    symbol?: string,
    confidence: number = 70
  ): Promise<{ size: number; fraction: number; reason: string }> {
    const report = await this.getKellyReport(userId);

    // Use per-symbol Kelly if we have enough data, otherwise fall back to overall
    let kellyFraction = report.overall.halfKelly;
    let source = 'overall';

    if (symbol) {
      const symbolData = report.bySymbol.find(s => s.symbol === symbol);
      if (symbolData && symbolData.stats.totalTrades >= 5) {
        kellyFraction = symbolData.stats.halfKelly;
        source = `${symbol}-specific`;
      }
    }

    // Not enough data — use conservative default
    if (report.overall.totalTrades < 10) {
      kellyFraction = 0.02; // 2% risk — ultra-conservative until we have data
      source = 'default (insufficient data)';
    }

    // Scale by TA confidence (0-100 → 0.5x to 1.0x)
    const confidenceMultiplier = 0.5 + (confidence / 200);
    const adjustedFraction = kellyFraction * confidenceMultiplier;

    // Minimum 1% of capital, maximum 25% per position
    const clampedFraction = Math.max(0.01, Math.min(0.25, adjustedFraction));
    const size = Math.round(capital * clampedFraction * 100) / 100;

    const reason = `Kelly ${source}: ${(kellyFraction * 100).toFixed(1)}% × confidence ${confidence}% = ${(clampedFraction * 100).toFixed(1)}% of capital ($${size.toFixed(0)})`;

    return { size, fraction: clampedFraction, reason };
  }

  /**
   * Format Kelly report for Jarvis to speak
   */
  formatForJarvis(report: KellyReport): string {
    const o = report.overall;
    const lines: string[] = [];

    lines.push(`📊 Kelly Position Sizing Report (${report.dataWindow})`);
    lines.push(`Win Rate: ${(o.winRate * 100).toFixed(1)}% (${o.wins}W / ${o.losses}L)`);
    lines.push(`Avg Win: $${o.avgWin.toFixed(2)} | Avg Loss: $${o.avgLoss.toFixed(2)} | Payoff Ratio: ${o.payoffRatio.toFixed(2)}x`);
    lines.push(`Edge: $${o.edge.toFixed(2)} per trade`);
    lines.push(`Recommended risk per trade: ${o.recommendedRiskPercent}% of capital`);

    if (o.streakData.currentStreak > 0) {
      lines.push(`🔥 Current ${o.streakData.currentStreak}-trade WIN streak!`);
    } else if (o.streakData.currentStreak < 0) {
      lines.push(`⚠️ Current ${Math.abs(o.streakData.currentStreak)}-trade LOSS streak`);
    }

    if (report.bySymbol.length > 0) {
      lines.push('\nBest performing coins:');
      for (const s of report.bySymbol.slice(0, 3)) {
        const emoji = s.stats.edge > 0 ? '✅' : '❌';
        lines.push(`${emoji} ${s.symbol}: ${(s.stats.winRate * 100).toFixed(0)}% win rate, $${s.stats.edge.toFixed(2)} edge (${s.stats.totalTrades} trades)`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Empty stats for users with no trade history
   */
  private emptyStats(): KellyStats {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      payoffRatio: 0,
      kellyFraction: 0,
      halfKelly: 0,
      recommendedRiskPercent: 2, // Default 2% for new users
      edge: 0,
      streakData: { currentStreak: 0, longestWinStreak: 0, longestLossStreak: 0 },
    };
  }

  /**
   * Clear cache for a user (call after a trade closes)
   */
  clearCache(userId: string) {
    this.cache.delete(userId);
  }
}
