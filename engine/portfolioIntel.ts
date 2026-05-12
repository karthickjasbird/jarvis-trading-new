/**
 * Portfolio Intelligence — Portfolio-Level Risk Management
 * 
 * Prevents the system from making correlated bets, overexposing
 * to a single sector, or exceeding total risk limits.
 * 
 * Features:
 * 1. Correlation check — max 2 highly-correlated positions open
 * 2. Portfolio heat — total risk across open positions ≤ 6%
 * 3. Drawdown circuit breaker — daily P&L < -5% → halt all trading
 * 4. Sector diversification tracking
 */

// Correlation groups — assets that move together 80%+ of the time
const CORRELATION_GROUPS: Record<string, string[]> = {
  'layer1':    ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'AVAX/USDT', 'NEAR/USDT', 'APT/USDT', 'SUI/USDT'],
  'layer2':    ['ARB/USDT', 'OP/USDT', 'MATIC/USDT'],
  'defi':      ['LINK/USDT', 'ATOM/USDT', 'INJ/USDT', 'DOT/USDT'],
  'meme':      ['DOGE/USDT', 'SHIB/USDT', 'PEPE/USDT', 'WIF/USDT'],
  'payments':  ['XRP/USDT', 'ADA/USDT', 'XLM/USDT'],
  'data':      ['TIA/USDT', 'SEI/USDT'],
};

// Risk thresholds
const PORTFOLIO_LIMITS = {
  MAX_CORRELATED_POSITIONS: 2,   // Max 2 positions in the same correlation group
  MAX_PORTFOLIO_HEAT: 6,         // Max 6% total capital at risk
  MAX_DAILY_DRAWDOWN: -5,        // Halt trading if daily P&L < -5%
  MAX_OPEN_POSITIONS: 5,         // Max 5 open positions total
};

export interface PortfolioRiskCheck {
  allowed: boolean;
  reason: string;
  details: {
    openPositions: number;
    portfolioHeat: number;
    dailyPnl: number;
    correlatedCount: number;
    correlationGroup?: string;
    circuitBreakerActive: boolean;
  };
}

export interface PortfolioSnapshot {
  openPositions: Array<{
    symbol: string;
    side: string;
    entryPrice: number;
    quantity: number;
    riskPercent: number;
    sector: string;
  }>;
  totalHeat: number;
  dailyPnl: number;
  sectorExposure: Record<string, number>;
  circuitBreakerActive: boolean;
  timestamp: string;
}

export class PortfolioIntelligence {
  private db: any;
  private circuitBreakerActive = false;
  private circuitBreakerResetDate = '';

  constructor(db: any) {
    this.db = db;
  }

  /**
   * Get the correlation group for a symbol
   */
  private getCorrelationGroup(symbol: string): { group: string; name: string } | null {
    for (const [name, symbols] of Object.entries(CORRELATION_GROUPS)) {
      if (symbols.includes(symbol)) {
        return { group: name, name };
      }
    }
    return null;
  }

  /**
   * Check if a new trade is allowed given current portfolio state
   */
  async checkTradeAllowed(symbol: string, riskPercent: number): Promise<PortfolioRiskCheck> {
    // Reset circuit breaker at midnight
    const today = new Date().toISOString().split('T')[0];
    if (this.circuitBreakerResetDate !== today) {
      this.circuitBreakerActive = false;
      this.circuitBreakerResetDate = today;
    }

    // 1. Circuit breaker check
    if (this.circuitBreakerActive) {
      return {
        allowed: false,
        reason: `⛔ CIRCUIT BREAKER ACTIVE — Daily drawdown exceeded ${PORTFOLIO_LIMITS.MAX_DAILY_DRAWDOWN}%. Trading halted until tomorrow.`,
        details: {
          openPositions: 0,
          portfolioHeat: 0,
          dailyPnl: 0,
          correlatedCount: 0,
          circuitBreakerActive: true,
        },
      };
    }

    // 2. Fetch open positions
    const openTrades = await this.getOpenPositions();

    // 3. Max open positions check
    if (openTrades.length >= PORTFOLIO_LIMITS.MAX_OPEN_POSITIONS) {
      return {
        allowed: false,
        reason: `Max ${PORTFOLIO_LIMITS.MAX_OPEN_POSITIONS} open positions reached (${openTrades.length} open).`,
        details: {
          openPositions: openTrades.length,
          portfolioHeat: this.calculateHeat(openTrades),
          dailyPnl: await this.getDailyPnl(),
          correlatedCount: 0,
          circuitBreakerActive: false,
        },
      };
    }

    // 4. Correlation check
    const newGroup = this.getCorrelationGroup(symbol);
    if (newGroup) {
      const correlatedCount = openTrades.filter(t => {
        const tGroup = this.getCorrelationGroup(t.symbol);
        return tGroup?.group === newGroup.group;
      }).length;

      if (correlatedCount >= PORTFOLIO_LIMITS.MAX_CORRELATED_POSITIONS) {
        return {
          allowed: false,
          reason: `Already ${correlatedCount} open positions in "${newGroup.name}" sector. Max ${PORTFOLIO_LIMITS.MAX_CORRELATED_POSITIONS} correlated positions allowed.`,
          details: {
            openPositions: openTrades.length,
            portfolioHeat: this.calculateHeat(openTrades),
            dailyPnl: await this.getDailyPnl(),
            correlatedCount,
            correlationGroup: newGroup.name,
            circuitBreakerActive: false,
          },
        };
      }
    }

    // 5. Portfolio heat check
    const currentHeat = this.calculateHeat(openTrades);
    const newHeat = currentHeat + riskPercent;
    if (newHeat > PORTFOLIO_LIMITS.MAX_PORTFOLIO_HEAT) {
      return {
        allowed: false,
        reason: `Portfolio heat would be ${newHeat.toFixed(1)}% (max ${PORTFOLIO_LIMITS.MAX_PORTFOLIO_HEAT}%). Current: ${currentHeat.toFixed(1)}%.`,
        details: {
          openPositions: openTrades.length,
          portfolioHeat: currentHeat,
          dailyPnl: await this.getDailyPnl(),
          correlatedCount: 0,
          circuitBreakerActive: false,
        },
      };
    }

    // 6. Daily drawdown check
    const dailyPnl = await this.getDailyPnl();
    if (dailyPnl < PORTFOLIO_LIMITS.MAX_DAILY_DRAWDOWN) {
      this.circuitBreakerActive = true;
      console.log(`[PORTFOLIO] ⛔ CIRCUIT BREAKER ACTIVATED — Daily P&L: ${dailyPnl.toFixed(2)}%`);

      // Log to brain activity
      try {
        await this.db.collection('brainActivity').add({
          agent: 'sentinel',
          message: `⛔ CIRCUIT BREAKER: Daily drawdown ${dailyPnl.toFixed(2)}% exceeded ${PORTFOLIO_LIMITS.MAX_DAILY_DRAWDOWN}%. ALL trading halted until tomorrow.`,
          type: 'veto',
          timestamp: new Date().toISOString(),
        });
      } catch {}

      return {
        allowed: false,
        reason: `⛔ CIRCUIT BREAKER — Daily P&L ${dailyPnl.toFixed(2)}% exceeded limit.`,
        details: {
          openPositions: openTrades.length,
          portfolioHeat: currentHeat,
          dailyPnl,
          correlatedCount: 0,
          circuitBreakerActive: true,
        },
      };
    }

    // All checks passed
    return {
      allowed: true,
      reason: `✅ Trade allowed. Heat: ${newHeat.toFixed(1)}%/${PORTFOLIO_LIMITS.MAX_PORTFOLIO_HEAT}%. Positions: ${openTrades.length + 1}/${PORTFOLIO_LIMITS.MAX_OPEN_POSITIONS}.`,
      details: {
        openPositions: openTrades.length,
        portfolioHeat: currentHeat,
        dailyPnl,
        correlatedCount: 0,
        circuitBreakerActive: false,
      },
    };
  }

  /**
   * Get full portfolio snapshot for the Brain page
   */
  async getSnapshot(): Promise<PortfolioSnapshot> {
    const openTrades = await this.getOpenPositions();
    const sectorExposure: Record<string, number> = {};

    for (const trade of openTrades) {
      const group = this.getCorrelationGroup(trade.symbol);
      const sector = group?.name || 'other';
      sectorExposure[sector] = (sectorExposure[sector] || 0) + 1;
    }

    return {
      openPositions: openTrades.map(t => ({
        symbol: t.symbol,
        side: t.side,
        entryPrice: t.entryPrice,
        quantity: t.quantity,
        riskPercent: t.riskPercent || 2,
        sector: this.getCorrelationGroup(t.symbol)?.name || 'other',
      })),
      totalHeat: this.calculateHeat(openTrades),
      dailyPnl: await this.getDailyPnl(),
      sectorExposure,
      circuitBreakerActive: this.circuitBreakerActive,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Private Helpers ──────────────────────────────────────

  private async getOpenPositions(): Promise<any[]> {
    try {
      const snapshot = await this.db.collection('trades')
        .where('status', '==', 'open')
        .get();
      return snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    } catch {
      return [];
    }
  }

  private calculateHeat(positions: any[]): number {
    return positions.reduce((sum: number, p: any) => sum + (p.riskPercent || 2), 0);
  }

  private async getDailyPnl(): Promise<number> {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const snapshot = await this.db.collection('trades')
        .where('status', '==', 'closed')
        .where('closedAt', '>=', todayStart.toISOString())
        .get();

      if (snapshot.empty) return 0;

      const totalPnl = snapshot.docs.reduce((sum: number, d: any) => {
        return sum + (d.data().pnlPercent || 0);
      }, 0);

      return totalPnl;
    } catch {
      return 0;
    }
  }
}
