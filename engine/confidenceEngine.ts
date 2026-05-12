/**
 * Jarvis Confidence Engine
 * 
 * Tracks Jarvis's paper trading performance and calculates a
 * confidence score (0–100). When Jarvis hits 100% confidence
 * across all metrics, it proactively notifies the user via
 * Telegram and voice that it's ready for live trading.
 */

import { sendTelegramNotification } from './telegram.ts';

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;                   // 0-100%
  avgPnlPerTrade: number;            // $ per trade
  totalPnl: number;                  // Total realized P&L
  maxDrawdown: number;               // Worst % drawdown
  profitTargetHitRate: number;       // % of trades that hit TP (not SL)
  consecutiveProfitableDays: number; // Days in a row with net positive P&L
  totalTradingDays: number;
  sharpeScore: number;               // Simplified risk-adjusted return (0-100)
}

export interface ConfidenceReport {
  score: number;                     // 0-100
  isReadyForLive: boolean;
  metrics: PerformanceMetrics;
  breakdown: ConfidenceBreakdown[];
  message: string;                   // Human-readable summary
  lastUpdated: string;
}

export interface ConfidenceBreakdown {
  name: string;
  score: number;        // 0-100 for this component
  weight: number;       // Weight in final score
  status: 'pass' | 'fail' | 'partial';
  detail: string;
}

// ─── Thresholds to be considered "live-ready" ───────────────
const THRESHOLDS = {
  minTotalTrades:             50,   // Minimum trades before evaluation
  minWinRate:                 60,   // %
  minAvgPnlPerTrade:          0,    // Must be positive on average
  maxDrawdown:                10,   // % max allowed drawdown
  minProfitTargetHitRate:     70,   // % of trades that hit TP
  minConsecutiveProfitDays:   5,    // Days in a row profitable
  minTradingDays:             10,   // Minimum days of activity
};

export class ConfidenceEngine {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  /**
   * Compute full performance metrics from closed paper trades
   */
  async computeMetrics(userId: string): Promise<PerformanceMetrics> {
    // Fetch all closed practice trades for this user
    const snapshot = await this.db.collection('trades')
      .where('userId', '==', userId)
      .where('isPractice', '==', true)
      .where('status', '==', 'closed')
      .get();

    const trades = snapshot.docs.map((d: any) => d.data());

    if (trades.length === 0) {
      return this.emptyMetrics();
    }

    const totalTrades = trades.length;
    const winningTrades = trades.filter((t: any) => (t.pnl || 0) > 0).length;
    const losingTrades = trades.filter((t: any) => (t.pnl || 0) <= 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const totalPnl = trades.reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);
    const avgPnlPerTrade = totalTrades > 0 ? totalPnl / totalTrades : 0;

    // Profit target hit rate (profitTarget set AND pnl >= profitTarget)
    const targetTrades = trades.filter((t: any) => t.profitTarget != null && t.profitTarget > 0);
    const targetHits = targetTrades.filter((t: any) => (t.pnl || 0) >= (t.profitTarget || 0));
    const profitTargetHitRate = targetTrades.length > 0 ? (targetHits.length / targetTrades.length) * 100 : winRate;

    // Max drawdown — group trades by day, compute running P&L peak/trough
    const maxDrawdown = this.computeMaxDrawdown(trades);

    // Consecutive profitable days
    const { consecutiveProfitableDays, totalTradingDays } = this.computeStreaks(trades);

    // Simplified Sharpe: (avg win) / (std dev of P&L), normalized to 0-100
    const pnls = trades.map((t: any) => t.pnl || 0);
    const mean = avgPnlPerTrade;
    const variance = pnls.reduce((acc: number, p: number) => acc + Math.pow(p - mean, 2), 0) / pnls.length;
    const stdDev = Math.sqrt(variance) || 1;
    const rawSharpe = mean / stdDev;
    const sharpeScore = Math.min(100, Math.max(0, (rawSharpe + 1) * 50)); // Map -1..+1 to 0..100

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate: parseFloat(winRate.toFixed(1)),
      avgPnlPerTrade: parseFloat(avgPnlPerTrade.toFixed(2)),
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      maxDrawdown: parseFloat(maxDrawdown.toFixed(1)),
      profitTargetHitRate: parseFloat(profitTargetHitRate.toFixed(1)),
      consecutiveProfitableDays,
      totalTradingDays,
      sharpeScore: parseFloat(sharpeScore.toFixed(1)),
    };
  }

  /**
   * Calculate confidence score and breakdown
   */
  async getConfidenceReport(userId: string): Promise<ConfidenceReport> {
    const metrics = await this.computeMetrics(userId);
    const breakdown = this.computeBreakdown(metrics);
    
    // Weighted average of all components
    const totalWeight = breakdown.reduce((s, b) => s + b.weight, 0);
    const score = Math.min(100, Math.round(
      breakdown.reduce((s, b) => s + (b.score * b.weight), 0) / totalWeight
    ));

    const isReadyForLive = score >= 100 && metrics.totalTrades >= THRESHOLDS.minTotalTrades;

    const message = this.buildMessage(score, metrics, breakdown);

    const report: ConfidenceReport = {
      score,
      isReadyForLive,
      metrics,
      breakdown,
      message,
      lastUpdated: new Date().toISOString(),
    };

    // Cache the report in Firestore
    try {
      await this.db.collection('confidenceReports').doc(userId).set({
        ...report,
        userId,
      });
    } catch {}

    return report;
  }

  /**
   * Called after every paper trade close — re-evaluates and notifies if ready
   */
  async evaluateAndNotify(userId: string): Promise<ConfidenceReport> {
    const report = await this.getConfidenceReport(userId);

    if (report.isReadyForLive) {
      // Check if we already sent the notification
      try {
        const flagDoc = await this.db.collection('confidenceFlags').doc(userId).get();
        if (!flagDoc.exists || !flagDoc.data()?.notifiedAt) {
          const msg = `🎓 <b>JARVIS IS LIVE-READY!</b>\n\n` +
            `After ${report.metrics.totalTrades} paper trades, I've achieved a <b>${report.score}% confidence score</b>.\n\n` +
            `📊 <b>My Performance:</b>\n` +
            `• Win Rate: ${report.metrics.winRate}% ✅\n` +
            `• Avg Profit/Trade: $${report.metrics.avgPnlPerTrade} ✅\n` +
            `• Max Drawdown: ${report.metrics.maxDrawdown}% ✅\n` +
            `• TP Hit Rate: ${report.metrics.profitTargetHitRate}% ✅\n` +
            `• Consecutive Profitable Days: ${report.metrics.consecutiveProfitableDays} ✅\n\n` +
            `I'm confident I'm ready to trade with real money. Switch to LIVE mode when you're ready!`;

          await sendTelegramNotification(this.db, userId, msg);
          await this.db.collection('confidenceFlags').doc(userId).set({
            notifiedAt: new Date().toISOString(),
            score: report.score,
          });
          console.log(`[CONFIDENCE ENGINE] 🏆 Jarvis is LIVE-READY for user ${userId}!`);
        }
      } catch (err) {
        console.error('[CONFIDENCE ENGINE] Failed to send live-ready notification:', err);
      }
    }

    console.log(`[CONFIDENCE ENGINE] User ${userId} confidence: ${report.score}% | Ready: ${report.isReadyForLive}`);
    return report;
  }

  // ─── Private Helpers ─────────────────────────────────────

  private computeBreakdown(m: PerformanceMetrics): ConfidenceBreakdown[] {
    return [
      {
        name: 'Trade Volume',
        score: Math.min(100, (m.totalTrades / THRESHOLDS.minTotalTrades) * 100),
        weight: 10,
        status: m.totalTrades >= THRESHOLDS.minTotalTrades ? 'pass' : 'fail',
        detail: `${m.totalTrades} / ${THRESHOLDS.minTotalTrades} trades`,
      },
      {
        name: 'Win Rate',
        score: Math.min(100, (m.winRate / THRESHOLDS.minWinRate) * 100),
        weight: 25,
        status: m.winRate >= THRESHOLDS.minWinRate ? 'pass' : m.winRate >= THRESHOLDS.minWinRate * 0.8 ? 'partial' : 'fail',
        detail: `${m.winRate}% (target: ${THRESHOLDS.minWinRate}%)`,
      },
      {
        name: 'Average P&L',
        score: m.avgPnlPerTrade > 0 ? Math.min(100, 50 + (m.avgPnlPerTrade * 10)) : 0,
        weight: 20,
        status: m.avgPnlPerTrade >= THRESHOLDS.minAvgPnlPerTrade ? 'pass' : 'fail',
        detail: `$${m.avgPnlPerTrade}/trade`,
      },
      {
        name: 'Drawdown Control',
        score: m.maxDrawdown <= THRESHOLDS.maxDrawdown ? 100 : Math.max(0, 100 - ((m.maxDrawdown - THRESHOLDS.maxDrawdown) * 10)),
        weight: 20,
        status: m.maxDrawdown <= THRESHOLDS.maxDrawdown ? 'pass' : m.maxDrawdown <= THRESHOLDS.maxDrawdown * 1.5 ? 'partial' : 'fail',
        detail: `${m.maxDrawdown}% drawdown (max allowed: ${THRESHOLDS.maxDrawdown}%)`,
      },
      {
        name: 'Profit Target Hit Rate',
        score: Math.min(100, (m.profitTargetHitRate / THRESHOLDS.minProfitTargetHitRate) * 100),
        weight: 15,
        status: m.profitTargetHitRate >= THRESHOLDS.minProfitTargetHitRate ? 'pass' : m.profitTargetHitRate >= THRESHOLDS.minProfitTargetHitRate * 0.8 ? 'partial' : 'fail',
        detail: `${m.profitTargetHitRate}% (target: ${THRESHOLDS.minProfitTargetHitRate}%)`,
      },
      {
        name: 'Consistency (Days)',
        score: Math.min(100, (m.consecutiveProfitableDays / THRESHOLDS.minConsecutiveProfitDays) * 100),
        weight: 10,
        status: m.consecutiveProfitableDays >= THRESHOLDS.minConsecutiveProfitDays ? 'pass' : 'fail',
        detail: `${m.consecutiveProfitableDays} profitable days in a row`,
      },
    ];
  }

  private computeMaxDrawdown(trades: any[]): number {
    if (trades.length === 0) return 0;
    let peak = 0;
    let runningPnl = 0;
    let maxDD = 0;
    const sorted = [...trades].sort((a, b) => new Date(a.closedAt || a.createdAt).getTime() - new Date(b.closedAt || b.createdAt).getTime());
    for (const t of sorted) {
      runningPnl += t.pnl || 0;
      if (runningPnl > peak) peak = runningPnl;
      if (peak > 0) {
        const dd = ((peak - runningPnl) / peak) * 100;
        if (dd > maxDD) maxDD = dd;
      }
    }
    return maxDD;
  }

  private computeStreaks(trades: any[]): { consecutiveProfitableDays: number; totalTradingDays: number } {
    // Group trades by date
    const byDay: Record<string, number> = {};
    for (const t of trades) {
      const day = (t.closedAt || t.createdAt || '').slice(0, 10);
      if (!day) continue;
      byDay[day] = (byDay[day] || 0) + (t.pnl || 0);
    }
    const days = Object.keys(byDay).sort();
    const totalTradingDays = days.length;
    let streak = 0;
    let maxStreak = 0;
    for (const day of days) {
      if (byDay[day] > 0) {
        streak++;
        maxStreak = Math.max(maxStreak, streak);
      } else {
        streak = 0;
      }
    }
    return { consecutiveProfitableDays: maxStreak, totalTradingDays };
  }

  private buildMessage(score: number, metrics: PerformanceMetrics, breakdown: ConfidenceBreakdown[]): string {
    if (metrics.totalTrades < 5) {
      return `I've only completed ${metrics.totalTrades} paper trades. I need more data to evaluate my confidence. Keep going!`;
    }
    if (score >= 100) {
      return `I'm 100% confident and ready to trade with real money. All performance thresholds have been met consistently.`;
    }
    const failing = breakdown.filter(b => b.status === 'fail').map(b => b.name);
    if (score >= 80) {
      return `I'm ${score}% confident. Almost there! Still working on: ${failing.join(', ')}.`;
    }
    if (score >= 50) {
      return `I'm ${score}% confident. Making progress. Need to improve: ${failing.join(', ')}.`;
    }
    return `I'm ${score}% confident. Still learning. Key areas to improve: ${failing.join(', ')}.`;
  }

  private emptyMetrics(): PerformanceMetrics {
    return {
      totalTrades: 0, winningTrades: 0, losingTrades: 0,
      winRate: 0, avgPnlPerTrade: 0, totalPnl: 0,
      maxDrawdown: 0, profitTargetHitRate: 0,
      consecutiveProfitableDays: 0, totalTradingDays: 0, sharpeScore: 0,
    };
  }
}
