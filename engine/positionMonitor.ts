/**
 * Position Monitor — Watches Open Trades for Exit Conditions
 * 
 * Runs every 60 seconds to check all open positions against:
 * 1. Stop-loss hit → close position, record loss
 * 2. Take-profit hit → close position, record win
 * 3. Trailing stop → move SL up as price moves in favor
 * 4. Time-based exit → close stale trades after 4 hours of no movement
 * 
 * Works with the StrategyTracker to record outcomes and
 * feeds the learning loop.
 */

import { TechnicalAnalysisEngine } from './technicalAnalysis.ts';
import { StrategyTracker, TradeOutcome } from './strategyTracker.ts';
import { MemoryManager } from './memory.ts';

export class PositionMonitor {
  private db: any;
  private marketState: Record<string, { price: number; lastChange: number }>;
  private taEngine: TechnicalAnalysisEngine;
  private strategyTracker: StrategyTracker;
  private memoryManager: MemoryManager | null;
  private ownerId: string; // Scopes queries to this user only
  private isRunning = false;

  constructor(db: any, strategyTracker: StrategyTracker, marketState?: Record<string, { price: number; lastChange: number }>, memoryManager?: MemoryManager, ownerId?: string) {
    this.db = db;
    this.marketState = marketState || {};
    this.taEngine = new TechnicalAnalysisEngine();
    this.strategyTracker = strategyTracker;
    this.memoryManager = memoryManager || null;
    this.ownerId = ownerId || '';
  }

  /**
   * Main monitoring loop — called every 60 seconds
   */
  async monitor(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // Fetch open trades — scoped to owner only (prevents cross-user interference)
      let query = this.db.collection('trades').where('status', '==', 'open');
      if (this.ownerId) query = query.where('userId', '==', this.ownerId);
      const snapshot = await query.get();

      if (snapshot.empty) {
        this.isRunning = false;
        return;
      }

      const trades = snapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data(),
      }));

      for (const trade of trades) {
        await this.checkTrade(trade);
      }
    } catch (err: any) {
      console.error('[MONITOR] Error in monitoring loop:', err.message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Check a single trade against exit conditions
   */
  private async checkTrade(trade: any): Promise<void> {
    const symbol = trade.symbol?.replace('/', '') || '';
    if (!symbol) return;

    // Fetch current price — prefer WebSocket-fed marketState, fallback to REST
    let currentPrice: number;
    const cleanSymbol = symbol.replace('/', '');
    
    // Try marketState first (WebSocket-fed, real-time)
    if (this.marketState[trade.symbol]?.price) {
      currentPrice = this.marketState[trade.symbol].price;
    } else if (this.marketState[cleanSymbol]?.price) {
      currentPrice = this.marketState[cleanSymbol].price;
    } else {
      // Fallback to REST only if marketState doesn't have this symbol
      try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cleanSymbol}`);
        const data = await res.json();
        currentPrice = parseFloat(data.price);
        if (!currentPrice || isNaN(currentPrice)) return;
      } catch {
        return; // Can't check without price
      }
    }

    const entryPrice = trade.entryPrice || 0;
    const stopLoss = trade.stopLossPrice || 0;
    const takeProfit = trade.takeProfitPrice || 0;
    const side = trade.side || 'buy';
    const quantity = trade.quantity || 0;

    // Calculate current P&L
    const pnl = side === 'buy'
      ? (currentPrice - entryPrice) * quantity
      : (entryPrice - currentPrice) * quantity;
    const pnlPercent = entryPrice > 0
      ? ((side === 'buy' ? currentPrice - entryPrice : entryPrice - currentPrice) / entryPrice) * 100
      : 0;

    // ── Check Stop-Loss ──
    if (stopLoss > 0) {
      const slHit = side === 'buy' ? currentPrice <= stopLoss : currentPrice >= stopLoss;
      if (slHit) {
        console.log(`[MONITOR] 🛑 SL HIT: ${trade.symbol} @ $${currentPrice} (SL: $${stopLoss})`);
        await this.closeTrade(trade, currentPrice, pnl, pnlPercent, 'stop_loss');
        return;
      }
    }

    // ── Check Take-Profit ──
    if (takeProfit > 0) {
      const tpHit = side === 'buy' ? currentPrice >= takeProfit : currentPrice <= takeProfit;
      if (tpHit) {
        console.log(`[MONITOR] 🎯 TP HIT: ${trade.symbol} @ $${currentPrice} (TP: $${takeProfit})`);
        await this.closeTrade(trade, currentPrice, pnl, pnlPercent, 'take_profit');
        return;
      }
    }

    // ── Trailing Stop ──
    // If price has moved 1.5% in our favor, trail SL to breakeven
    if (stopLoss > 0 && entryPrice > 0) {
      if (side === 'buy' && currentPrice > entryPrice * 1.015 && stopLoss < entryPrice) {
        // Move SL to breakeven
        const newSL = entryPrice * 1.001; // Tiny buffer above entry
        await this.db.collection('trades').doc(trade.id).update({
          stopLossPrice: newSL,
          trailingActivated: true,
        });
        console.log(`[MONITOR] 📈 Trailing SL activated for ${trade.symbol}: SL moved to $${newSL.toFixed(2)} (breakeven)`);

        await this.logActivity(`📈 Trailing stop activated for ${trade.symbol} — SL moved to breakeven $${newSL.toFixed(2)}`);
      }

      // If price has moved 3%+, trail SL to 1.5% below current price
      if (side === 'buy' && currentPrice > entryPrice * 1.03) {
        const trailSL = currentPrice * 0.985;
        if (trailSL > stopLoss) {
          await this.db.collection('trades').doc(trade.id).update({
            stopLossPrice: trailSL,
          });
          console.log(`[MONITOR] 📈 Trailing SL tightened for ${trade.symbol}: SL → $${trailSL.toFixed(2)}`);
        }
      }
    }

    // ── Check Goal & Sentry Profit Targets ──
    try {
      // 1. Check Trading Goals
      const goalsSnapshot = await this.db.collection('tradingGoals')
        .where('userId', '==', trade.userId)
        .where('status', '==', 'active')
        .get();
        
      if (!goalsSnapshot.empty) {
        for (const doc of goalsSnapshot.docs) {
          const goal = doc.data();
          if (pnl >= goal.targetProfit) {
            console.log(`[MONITOR] 🏆 GOAL PROFIT HIT: ${trade.symbol} hit goal of $${goal.targetProfit}`);
            await this.closeTrade(trade, currentPrice, pnl, pnlPercent, 'take_profit');
            
            try {
              const { GoalPlanner } = await import('./goalPlanner.ts');
              const gp = new GoalPlanner(this.db);
              await gp.updateProgress(doc.id, pnl);
            } catch (err) {}
            return;
          }
        }
      }

      // 2. Check Sentry Config if LLM stored a target daily profit or target price condition that maps to PNL
      const sentryDoc = await this.db.collection('sentryConfigs').doc(trade.userId).get();
      if (sentryDoc.exists) {
        const sentryConfig = sentryDoc.data();
        if (sentryConfig.active && sentryConfig.targetDailyProfit && pnl >= sentryConfig.targetDailyProfit) {
          console.log(`[MONITOR] 🎯 SENTRY PROFIT TARGET HIT: ${trade.symbol} PNL $${pnl} >= $${sentryConfig.targetDailyProfit}`);
          await this.closeTrade(trade, currentPrice, pnl, pnlPercent, 'take_profit');
          await sentryDoc.ref.update({ active: false });
          return;
        }
      }
    } catch(e) {}

    // ── Time-Based Exit ──
    // If trade has been open > 4 hours and hasn't moved > 0.5%, close it
    const openedAt = new Date(trade.createdAt).getTime();
    const hoursOpen = (Date.now() - openedAt) / (1000 * 60 * 60);

    if (hoursOpen > 4 && Math.abs(pnlPercent) < 0.5) {
      console.log(`[MONITOR] ⏰ TIME EXIT: ${trade.symbol} open ${hoursOpen.toFixed(1)}h with only ${pnlPercent.toFixed(2)}% move`);
      await this.closeTrade(trade, currentPrice, pnl, pnlPercent, 'time_exit');
      return;
    }
  }

  /**
   * Close a trade and record the outcome
   */
  private async closeTrade(
    trade: any,
    exitPrice: number,
    pnl: number,
    pnlPercent: number,
    reason: 'stop_loss' | 'take_profit' | 'time_exit' | 'manual'
  ): Promise<void> {
    try {
      // Update trade status in Firestore
      await this.db.collection('trades').doc(trade.id).update({
        status: 'closed',
        exitPrice,
        pnl,
        pnlPercent,
        closeReason: reason,
        closedAt: new Date().toISOString(),
      });

      // Update Portfolio Balance
      const portRef = this.db.collection('portfolios').doc(trade.userId);
      const portDoc = await portRef.get();
      if (portDoc.exists) {
        const portData = portDoc.data();
        if (trade.mode === 'live' && !trade.isPractice) {
          await portRef.update({
            liveBalance: (portData.liveBalance || 0) + pnl,
            liveRealizedPnl: (portData.liveRealizedPnl || 0) + pnl,
            updatedAt: new Date().toISOString()
          });
        } else {
          await portRef.update({
            paperBalance: (portData.paperBalance || 100000) + pnl,
            realizedPnl: (portData.realizedPnl || 0) + pnl,
            updatedAt: new Date().toISOString()
          });
        }
      }

      // Record outcome in Strategy Tracker
      const outcome: TradeOutcome = {
        tradeId: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        entryPrice: trade.entryPrice,
        exitPrice,
        quantity: trade.quantity,
        pnl,
        pnlPercent,
        strategy: trade.source || 'agent-swarm',
        source: trade.source || 'agent-swarm',
        closedAt: new Date().toISOString(),
      };

      await this.strategyTracker.recordOutcome(outcome);

      // Send Telegram alert for trade closure
      try {
        const { broadcastTelegram, formatTradeAlert } = await import('./telegram.ts');
        await broadcastTelegram(
          this.db,
          formatTradeAlert('closed', trade.symbol, trade.side, trade.entryPrice, trade.quantity, pnl, reason)
        );
      } catch {}

      // Log to brain activity
      const emoji = reason === 'take_profit' ? '🎯' : reason === 'stop_loss' ? '🛑' : '⏰';
      const label = reason === 'take_profit' ? 'TP HIT' : reason === 'stop_loss' ? 'SL HIT' : 'TIME EXIT';

      await this.logActivity(
        `${emoji} ${label}: ${trade.symbol} closed @ $${exitPrice.toFixed(2)} | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%) | Reason: ${reason}`
      );

      // Run AI Post-Mortem (async, don't block)
      try {
        const { PostMortemEngine } = await import('./postMortem.ts');
        const pm = new PostMortemEngine(this.db, this.memoryManager || undefined);
        pm.analyze({
          tradeId: trade.id,
          symbol: trade.symbol,
          side: trade.side,
          entryPrice: trade.entryPrice,
          exitPrice,
          pnl,
          pnlPercent,
          closeReason: reason,
          strategy: trade.source,
          userId: trade.userId,
        }).catch(err => console.error('[MONITOR] Post-mortem failed:', err.message));
      } catch {}

      console.log(`[MONITOR] ${emoji} Closed ${trade.symbol}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${reason})`);
    } catch (err: any) {
      console.error(`[MONITOR] Failed to close trade ${trade.id}:`, err.message);
    }
  }

  /**
   * Log to brain activity feed
   */
  private async logActivity(message: string): Promise<void> {
    try {
      await this.db.collection('brainActivity').add({
        agent: 'monitor',
        message,
        type: 'execution',
        userId: this.ownerId || undefined,
        timestamp: new Date().toISOString(),
      });
    } catch {}
  }
}
