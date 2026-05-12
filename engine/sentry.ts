import { TradeExecutor } from './tradeExecutor.ts';
import { MemoryManager } from './memory.ts';
import { GoogleGenAI, Type } from '@google/genai';
import { sendTelegramNotification } from './telegram.ts';
import { formatCopilotApproval } from './telegram.ts';
import { PostMortemEngine } from './postMortem.ts';
import { StrategyTracker } from './strategyTracker.ts';
import { GoalPlanner } from './goalPlanner.ts';
import { ConfidenceEngine } from './confidenceEngine.ts';
import { ATRCalculator } from './atrCalculator.ts';

export class SentryEngine {
  private db: FirebaseFirestore.Firestore;
  private tradeExecutor: TradeExecutor;
  private marketState: any;
  private memoryManager: MemoryManager;

  // Per-user Circuit Breaker state
  private circuitBreakers: Map<string, {
    consecutiveLosses: number;
    active: boolean;
    resumeAt: number;
    dailyShutdown: boolean;
  }> = new Map();

  // Event-driven: Cache of open trades to avoid hitting Firestore on every tick
  private openTradesCache: any[] = [];
  private lastCacheRefresh: number = 0;
  private cacheRefreshInterval: number = 10000; // Refresh from Firestore every 10 seconds
  private processingTrades: Set<string> = new Set(); // Prevent double-processing
  private cachedAutoLiquidateThreshold: number = 0; // From risk settings — 0 means disabled

  constructor(db: any, tradeExecutor: TradeExecutor, marketState: any, memoryManager: MemoryManager) {
    this.db = db;
    this.tradeExecutor = tradeExecutor;
    this.marketState = marketState;
    this.memoryManager = memoryManager;
  }

  private getCircuitBreaker(userId: string) {
    if (!this.circuitBreakers.has(userId)) {
      this.circuitBreakers.set(userId, {
        consecutiveLosses: 0,
        active: false,
        resumeAt: 0,
        dailyShutdown: false,
      });
    }
    return this.circuitBreakers.get(userId)!;
  }

  /**
   * Check if the circuit breaker allows trading for a specific user
   */
  isCircuitBreakerActive(userId?: string): boolean {
    if (!userId) {
      // Legacy global check: return true if ANY user is circuit-broken
      for (const [, cb] of this.circuitBreakers) {
        if (cb.dailyShutdown) return true;
        if (cb.active && Date.now() < cb.resumeAt) return true;
      }
      return false;
    }
    const cb = this.getCircuitBreaker(userId);
    if (cb.dailyShutdown) return true;
    if (cb.active && Date.now() < cb.resumeAt) return true;
    if (cb.active && Date.now() >= cb.resumeAt) {
      cb.active = false;
      console.log(`[CIRCUIT BREAKER] [${userId.slice(0, 8)}] ✅ Cooldown expired. Trading resumed.`);
    }
    return false;
  }

  /**
   * Track trade outcome for circuit breaker logic
   */
  private async trackTradeOutcome(pnl: number, userId: string) {
    const cb = this.getCircuitBreaker(userId);
    if (pnl < 0) {
      cb.consecutiveLosses++;
      console.log(`[CIRCUIT BREAKER] [${userId.slice(0, 8)}] Loss #${cb.consecutiveLosses} recorded.`);

      if (cb.consecutiveLosses >= 4) {
        cb.dailyShutdown = true;
        console.log(`[CIRCUIT BREAKER] [${userId.slice(0, 8)}] 🛑 4 consecutive losses. DAILY SHUTDOWN activated.`);
        await sendTelegramNotification(this.db, userId,
          '🛑 <b>DAILY SHUTDOWN</b>\n\n4 consecutive losses detected. All autonomous trading paused until tomorrow. Your open positions will still be monitored for SL/TP.'
        );
      } else if (cb.consecutiveLosses >= 3) {
        cb.active = true;
        cb.resumeAt = Date.now() + (2 * 60 * 60 * 1000); // 2 hours
        const resumeTime = new Date(cb.resumeAt).toLocaleTimeString();
        console.log(`[CIRCUIT BREAKER] [${userId.slice(0, 8)}] ⚠️ 3 consecutive losses. Pausing until ${resumeTime}.`);
        await sendTelegramNotification(this.db, userId,
          `⚠️ <b>CIRCUIT BREAKER ACTIVATED</b>\n\n3 consecutive losses detected. Autonomous trading paused for 2 hours to let the market settle.\n\nResumes at: ${resumeTime}\n\nYour open positions are still being monitored for SL/TP.`
        );
      }
    } else if (pnl > 0) {
      if (cb.consecutiveLosses > 0) {
        console.log(`[CIRCUIT BREAKER] [${userId.slice(0, 8)}] ✅ Win detected. Resetting loss streak (was ${cb.consecutiveLosses}).`);
      }
      cb.consecutiveLosses = 0;
    }
  }

  /**
   * Reset daily shutdown for a specific user (call at midnight or start of new trading day)
   */
  resetDailyShutdown(userId?: string) {
    if (userId) {
      const cb = this.getCircuitBreaker(userId);
      cb.dailyShutdown = false;
      cb.consecutiveLosses = 0;
      cb.active = false;
      console.log(`[CIRCUIT BREAKER] [${userId.slice(0, 8)}] 🔄 Daily reset — trading enabled.`);
    } else {
      // Reset all users
      this.circuitBreakers.clear();
      console.log('[CIRCUIT BREAKER] 🔄 Global daily reset — all users trading enabled.');
    }
  }

  // Legacy fast-loop for limit tracking
  /**
   * EVENT-DRIVEN: Called on every WebSocket price tick
   * Uses a local cache of open trades to avoid Firestore queries on every tick.
   * Cache is refreshed every 10 seconds.
   */
  async onPriceUpdate(symbol: string, rawSymbol: string, currentPrice: number): Promise<void> {
    // Refresh trade cache periodically (not on every tick)
    const now = Date.now();
    if (now - this.lastCacheRefresh > this.cacheRefreshInterval) {
      try {
        const snapshot = await this.db.collection('trades').where('status', '==', 'open').get();
        this.openTradesCache = snapshot.docs.map((doc: any) => ({
          id: doc.id,
          ref: doc.ref,
          ...doc.data(),
        }));
        this.lastCacheRefresh = now;

        // Also refresh auto-liquidate threshold from risk settings
        try {
          // Try to find a userId from the cached trades
          const sampleUserId = this.openTradesCache[0]?.userId;
          if (sampleUserId) {
            const riskDoc = await this.db.collection('riskSettings').doc(sampleUserId).get();
            this.cachedAutoLiquidateThreshold = riskDoc.exists
              ? (riskDoc.data()?.autoLiquidateThreshold || 0)
              : 300; // default $300
          }
        } catch {}
      } catch {
        // If cache refresh fails, keep using stale cache
      }
    }

    // Find trades matching this symbol
    const matchingTrades = this.openTradesCache.filter(trade => {
      const tradeSymbol = (trade.symbol || '').replace('/', '').toUpperCase();
      return tradeSymbol === rawSymbol.toUpperCase() || tradeSymbol === symbol.replace('/', '').toUpperCase();
    });

    if (matchingTrades.length === 0) return;

    for (const trade of matchingTrades) {
      // Skip if already being processed (prevent double-close)
      if (this.processingTrades.has(trade.id)) continue;

      const entryPrice = trade.entryPrice || 0;
      const isLong = trade.side === 'buy';
      const priceDiff = currentPrice - entryPrice;
      const pnl = isLong ? (priceDiff * trade.quantity) : (-priceDiff * trade.quantity);

      let shouldClose = false;
      let reason = '';

      // Check Take Profit
      if (trade.takeProfitPrice) {
        if ((isLong && currentPrice >= trade.takeProfitPrice) ||
            (!isLong && currentPrice <= trade.takeProfitPrice)) {
          shouldClose = true;
          reason = `⚡ INSTANT TP HIT at $${currentPrice.toFixed(4)} (target: $${trade.takeProfitPrice})`;
        }
      }

      // Check Stop Loss
      if (!shouldClose && trade.stopLossPrice) {
        if ((isLong && currentPrice <= trade.stopLossPrice) ||
            (!isLong && currentPrice >= trade.stopLossPrice)) {
          shouldClose = true;
          reason = `⚡ INSTANT SL HIT at $${currentPrice.toFixed(4)} (stop: $${trade.stopLossPrice})`;
        }
      }

      // Check Dollar Profit Target
      if (!shouldClose && trade.profitTarget) {
        if (pnl >= trade.profitTarget) {
          shouldClose = true;
          reason = `⚡ INSTANT PROFIT TARGET $${trade.profitTarget} reached (PnL: $${pnl.toFixed(2)})`;
        }
      }

      // Check Trailing Stop
      if (!shouldClose && trade.trailingStopDistance) {
        if (isLong) {
          const highest = trade.highestPrice || entryPrice;
          const trailingStop = highest - trade.trailingStopDistance;
          if (currentPrice <= trailingStop) {
            shouldClose = true;
            reason = `⚡ INSTANT TRAILING STOP at $${currentPrice.toFixed(4)} (highest: $${highest})`;
          }
        } else {
          const lowest = trade.lowestPrice || entryPrice;
          const trailingStop = lowest + trade.trailingStopDistance;
          if (currentPrice >= trailingStop) {
            shouldClose = true;
            reason = `⚡ INSTANT TRAILING STOP at $${currentPrice.toFixed(4)} (lowest: $${lowest})`;
          }
        }
      }

      // Check Auto-Liquidate Threshold (from Risk Settings)
      if (!shouldClose && this.cachedAutoLiquidateThreshold > 0) {
        if (pnl <= -this.cachedAutoLiquidateThreshold) {
          shouldClose = true;
          reason = `🚨 AUTO-LIQUIDATE: Position loss $${Math.abs(pnl).toFixed(2)} exceeded threshold $${this.cachedAutoLiquidateThreshold}`;
        }
      }

      if (shouldClose) {
        // Mark as processing to prevent double-close
        this.processingTrades.add(trade.id);

        console.log(`[SENTRY-WS] ${reason} — ${trade.symbol} (Trade ID: ${trade.id})`);

        try {
          // Handle partial close on first TP hit
          if (reason.includes('TP HIT') && (!trade.partialExits || trade.partialExits.length === 0)) {
            console.log(`[SENTRY-WS] 🎯 TP1 hit — executing 50% partial close for ${trade.symbol}`);
            await this.tradeExecutor.partialClosePosition(trade.userId, trade.id, 50);
          } else {
            // Full close
            const result = await this.tradeExecutor.closePosition(trade.userId, trade.id);
            await this.trackTradeOutcome(result.realizedPnl || 0, trade.userId);

            // Fire post-trade automations
            try {
              const postMortemEngine = new PostMortemEngine(this.db);
              const strategyTracker = new StrategyTracker(this.db);
              const goalPlanner = new GoalPlanner(this.db);
              const confidenceEngine = new ConfidenceEngine(this.db);

              await postMortemEngine.analyze({
                tradeId: trade.id,
                symbol: trade.symbol,
                side: trade.side,
                entryPrice: trade.entryPrice,
                exitPrice: result.exitPrice || trade.entryPrice,
                pnl: result.realizedPnl || 0,
                pnlPercent: trade.entryPrice > 0 ? ((result.realizedPnl || 0) / (trade.entryPrice * trade.quantity)) * 100 : 0,
                closeReason: reason,
              });

              await strategyTracker.recordOutcome({
                tradeId: trade.id,
                symbol: trade.symbol,
                side: trade.side as 'buy' | 'sell',
                entryPrice: trade.entryPrice,
                exitPrice: result.exitPrice || trade.entryPrice,
                quantity: trade.quantity,
                pnl: result.realizedPnl || 0,
                pnlPercent: trade.entryPrice > 0 ? ((result.realizedPnl || 0) / (trade.entryPrice * trade.quantity)) * 100 : 0,
                strategy: trade.mode || 'sentry',
                source: 'jarvis-ws-instant',
                closedAt: new Date().toISOString(),
              });

              const activeGoals = await goalPlanner.getGoals(trade.userId);
              const activeGoal = activeGoals.find((g: any) => g.status === 'active');
              if (activeGoal) {
                const newProgress = (activeGoal.currentProgress || 0) + (result.realizedPnl || 0);
                await goalPlanner.updateProgress(activeGoal.id, newProgress);
              }

              if (trade.isPractice) {
                await confidenceEngine.evaluateAndNotify(trade.userId);
              }
            } catch (autoErr: any) {
              console.error('[SENTRY-WS] Failed post-trade automations:', autoErr.message);
            }
          }

          // Remove from cache (it's closed now)
          this.openTradesCache = this.openTradesCache.filter(t => t.id !== trade.id);
        } catch (err: any) {
          console.error(`[SENTRY-WS] Failed to close trade ${trade.id}:`, err.message);
        } finally {
          this.processingTrades.delete(trade.id);
        }
      } else {
        // Update highest/lowest for trailing stops (in-memory only, synced to Firestore by the 5s poll)
        if (isLong && currentPrice > (trade.highestPrice || entryPrice)) {
          trade.highestPrice = currentPrice;
        } else if (!isLong && currentPrice < (trade.lowestPrice || entryPrice)) {
          trade.lowestPrice = currentPrice;
        }
      }
    }
  }

  async monitor() {
    try {
      // 1. Monitor Daily Drawdown / Target Profit (Account Level)
      const sentryDocs = await this.db.collection('sentryConfigs').where('active', '==', true).where('isAutonomous', '!=', true).get();
      
      for (const doc of sentryDocs.docs) {
        const config = doc.data();
        const userId = doc.id;
        const currentPrice = this.marketState[config.symbol]?.price;

        if (!currentPrice || !config.targetPrice || !config.condition) continue;

        let conditionMet = false;
        if (config.condition === 'above' && currentPrice >= config.targetPrice) conditionMet = true;
        if (config.condition === 'below' && currentPrice <= config.targetPrice) conditionMet = true;

        if (conditionMet) {
          console.log(`[SENTRY] Target hit for ${userId}: ${config.symbol} ${config.condition} ${config.targetPrice} (Current: ${currentPrice})`);
          
          try {
            const executionResult = await this.tradeExecutor.execute({
              userId,
              symbol: config.symbol,
              side: config.side,
              quantity: config.quantity,
              market: config.market || 'crypto',
              mode: 'sentry',
              isPractice: config.isPractice !== undefined ? config.isPractice : true,
            });

            // Send Telegram Alert
            const msg = `🎯 <b>Sentry Target Hit!</b>\n\nAsset: <b>${config.symbol}</b>\nCondition: ${config.condition.toUpperCase()} ${config.targetPrice}\nTrigger Price: $${currentPrice}\n\nAction: Executing ${config.side.toUpperCase()} ${config.quantity} ${config.symbol}.\nStatus: ${executionResult.status}`;
            await sendTelegramNotification(this.db, userId, msg);

            // Deactivate this sentry config so it doesn't fire again immediately
            await doc.ref.update({ active: false, lastTriggered: new Date().toISOString() });
          } catch (err: any) {
            console.error(`[SENTRY] Execution failed for ${userId}:`, err.message);
            await sendTelegramNotification(this.db, userId, `❌ <b>Sentry Execution Failed</b>\n\nAsset: ${config.symbol}\nError: ${err.message}`);
          }
        }
      }

      // 2. DAILY P&L KILL SWITCH — Nuclear safety net
      // Aggregate total daily P&L (realized + unrealized) across ALL users
      // If exceeded, panic close everything and shut down
      if (!this.dailyShutdown) {
        try {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          // Get all trades closed today
          const closedToday = await this.db.collection('trades')
            .where('status', '==', 'closed')
            .where('closedAt', '>=', today.toISOString())
            .get();

          let totalRealizedPnl = 0;
          const userIds = new Set<string>();
          closedToday.docs.forEach((d: any) => {
            totalRealizedPnl += d.data().pnl || 0;
            userIds.add(d.data().userId);
          });

          // Get unrealized P&L from open positions
          const openPositions = await this.db.collection('trades')
            .where('status', '==', 'open')
            .get();

          let totalUnrealizedPnl = 0;
          for (const d of openPositions.docs) {
            const trade = d.data();
            const currentPrice = this.marketState[trade.symbol]?.price;
            if (currentPrice && trade.entryPrice) {
              const isLong = trade.side === 'buy';
              const priceDiff = currentPrice - trade.entryPrice;
              totalUnrealizedPnl += isLong ? (priceDiff * trade.quantity) : (-priceDiff * trade.quantity);
              userIds.add(trade.userId);
            }
          }

          const totalDailyPnl = totalRealizedPnl + totalUnrealizedPnl;
          const MAX_DAILY_LOSS = -500; // $500 max daily loss (configurable)

          if (totalDailyPnl <= MAX_DAILY_LOSS) {
            console.log(`[KILL SWITCH] 🛑 DAILY LOSS LIMIT BREACHED: $${totalDailyPnl.toFixed(2)} (limit: $${MAX_DAILY_LOSS})`);
            
            // Panic close ALL open positions for ALL users
            for (const userId of userIds) {
              try {
                await this.tradeExecutor.panicCloseAll(userId);
              } catch (e: any) {
                console.error(`[KILL SWITCH] Failed to panic close for ${userId}:`, e.message);
              }
              await sendTelegramNotification(this.db, userId,
                `🛑 <b>DAILY LOSS LIMIT REACHED</b>\n\nTotal daily P&L: $${totalDailyPnl.toFixed(2)} (limit: $${MAX_DAILY_LOSS})\n\nAll positions have been PANIC CLOSED.\nAll autonomous trading is PAUSED until tomorrow.\n\nThis is a safety mechanism to protect your capital.`
              );
            }

            // Activate daily shutdown
            this.dailyShutdown = true;
            console.log('[KILL SWITCH] 🛑 Daily shutdown activated. No more trading today.');
          }
        } catch (killErr: any) {
          // Kill switch errors should never crash the monitor
          console.error('[KILL SWITCH] Error in daily P&L check:', killErr.message);
        }
      }

      // 3. Monitor Individual Positions (SL, TP, Trailing Stop) - same as before
      const openPositionsSnapshot = await this.db.collection('trades').where('status', '==', 'open').get();
      
      for (const doc of openPositionsSnapshot.docs) {
        const trade = doc.data();
        
        // Fetch REAL price from Binance (don't rely on marketState which may not update all symbols)
        let currentPrice = this.marketState[trade.symbol]?.price;
        try {
          const cleanSymbol = (trade.symbol || '').replace('/', '');
          if (cleanSymbol) {
            const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cleanSymbol}`);
            const data = await res.json();
            const binancePrice = parseFloat(data.price);
            if (binancePrice && !isNaN(binancePrice)) {
              currentPrice = binancePrice;
              // Also update marketState so it stays current
              if (this.marketState[trade.symbol]) {
                this.marketState[trade.symbol].price = binancePrice;
              }
            }
          }
        } catch {}
        if (!currentPrice) continue;

        let shouldClose = false;
        let reason = '';
        let updateData: any = {};
        let isStopLoss = false;

        // Check for copilot approvals that have been pending > 10 minutes
        if (trade.awaitingApproval && trade.approvalRequestedAt) {
          const elapsed = Date.now() - new Date(trade.approvalRequestedAt).getTime();
          if (elapsed > 10 * 60 * 1000) {
            shouldClose = true;
            reason = '⏰ No response after 10 min — auto-closed.';
          } else if (trade.forceClose) {
            shouldClose = true;
            reason = 'Manual Copilot Close';
          } else {
             continue; // Skip normal checks if waiting for approval
          }
        }

        // Update highest/lowest price for trailing stops
        if (trade.side === 'buy' && currentPrice > (trade.highestPrice || trade.entryPrice)) {
          updateData.highestPrice = currentPrice;
        } else if (trade.side === 'sell' && currentPrice < (trade.lowestPrice || trade.entryPrice)) {
          updateData.lowestPrice = currentPrice;
        }

        // Check Take Profit — use partial close (50/50) on first hit
        if (trade.takeProfitPrice) {
          if ((trade.side === 'buy' && currentPrice >= trade.takeProfitPrice) ||
              (trade.side === 'sell' && currentPrice <= trade.takeProfitPrice)) {
            // Check if we already did a partial close (partialExits array exists)
            if (!trade.partialExits || trade.partialExits.length === 0) {
              // FIRST TP HIT → Partial close 50%, let rest ride
              console.log(`[SENTRY] 🎯 TP1 hit for ${trade.symbol} — executing 50% partial close`);
              try {
                await this.tradeExecutor.partialClosePosition(trade.userId, doc.id, 50);
                // Don't set shouldClose — the remaining 50% stays open with trailing stop
                // The partialClosePosition method already:
                //   - Closed 50% of the position
                //   - Moved stop to breakeven
                //   - Enabled trailing stop
                //   - Cleared takeProfitPrice (so this won't trigger again)
              } catch (err: any) {
                console.error(`[SENTRY] Partial close failed, doing full close:`, err.message);
                shouldClose = true;
                reason = `Take Profit hit at $${currentPrice} (partial close failed, full exit)`;
              }
              continue; // Skip to next trade — this one is handled
            } else {
              // SECOND TP or subsequent — full close (this path shouldn't normally hit
              // because takeProfitPrice is cleared after partial, but just in case)
              shouldClose = true;
              reason = `Take Profit hit at $${currentPrice}`;
            }
          }
        }

        // Check Stop Loss
        if (!shouldClose && trade.stopLossPrice) {
          if ((trade.side === 'buy' && currentPrice <= trade.stopLossPrice) ||
              (trade.side === 'sell' && currentPrice >= trade.stopLossPrice)) {
            shouldClose = true;
            isStopLoss = true;
            reason = `Stop Loss hit at $${currentPrice}`;
          }
        }

        // Check Trailing Stop
        if (!shouldClose && trade.trailingStopDistance) {
          if (trade.side === 'buy') {
            const highest = updateData.highestPrice || trade.highestPrice || trade.entryPrice;
            const trailingStop = highest - trade.trailingStopDistance;
            if (currentPrice <= trailingStop) {
              shouldClose = true;
              isStopLoss = true;
              reason = `Trailing Stop hit at $${currentPrice} (Highest: $${highest})`;
            }
          } else if (trade.side === 'sell') {
            const lowest = updateData.lowestPrice || trade.lowestPrice || trade.entryPrice;
            const trailingStop = lowest + trade.trailingStopDistance;
            if (currentPrice >= trailingStop) {
              shouldClose = true;
              isStopLoss = true;
              reason = `Trailing Stop hit at $${currentPrice} (Lowest: $${lowest})`;
            }
          }
        }

        // Check Dollar Profit Target
        if (!shouldClose && trade.profitTarget) {
          const isLong = trade.side === 'buy';
          const priceDiff = currentPrice - trade.entryPrice;
          const pnl = isLong ? (priceDiff * trade.quantity) : (-priceDiff * trade.quantity);
          if (pnl >= trade.profitTarget) {
            shouldClose = true;
            reason = `Profit Target $${trade.profitTarget} reached (P&L: $${pnl.toFixed(2)})`;
            console.log(`[SENTRY] 💰 PROFIT TARGET HIT: ${trade.symbol} PNL $${pnl.toFixed(2)} >= target $${trade.profitTarget}`);
          }
        }

        if (shouldClose) {
          if (trade.mode === 'copilot' && !isStopLoss && reason !== '⏰ No response after 10 min — auto-closed.' && reason !== 'Manual Copilot Close') {
            // Don't auto close. Ask for approval.
            const pnl = trade.side === 'buy' ? (currentPrice - trade.entryPrice) * trade.quantity : (trade.entryPrice - currentPrice) * trade.quantity;
            await this.requestCopilotApproval(trade, doc.id, reason, pnl);
            continue;
          }

          console.log(`[SENTRY] Closing trade ${doc.id} for ${trade.userId}: ${reason}`);
          const result = await this.tradeExecutor.closePosition(trade.userId, doc.id);

          // Track outcome for circuit breaker
          await this.trackTradeOutcome(result.realizedPnl || 0, trade.userId);

          // FIRE POST-TRADE AUTOMATIONS
          try {
            const postMortemEngine = new PostMortemEngine(this.db);
            const strategyTracker = new StrategyTracker(this.db);
            const goalPlanner = new GoalPlanner(this.db);
            const confidenceEngine = new ConfidenceEngine(this.db);

            // 1. PostMortem Analysis
            await postMortemEngine.analyze({
              tradeId: doc.id,
              symbol: trade.symbol,
              side: trade.side,
              entryPrice: trade.entryPrice,
              exitPrice: result.exitPrice || trade.entryPrice,
              pnl: result.realizedPnl || 0,
              pnlPercent: trade.entryPrice > 0 ? ((result.realizedPnl || 0) / (trade.entryPrice * trade.quantity)) * 100 : 0,
              closeReason: reason,
            });

            // 2. Strategy Tracker
            await strategyTracker.recordOutcome({
              tradeId: doc.id,
              symbol: trade.symbol,
              side: trade.side as 'buy' | 'sell',
              entryPrice: trade.entryPrice,
              exitPrice: result.exitPrice || trade.entryPrice,
              quantity: trade.quantity,
              pnl: result.realizedPnl || 0,
              pnlPercent: trade.entryPrice > 0 ? ((result.realizedPnl || 0) / (trade.entryPrice * trade.quantity)) * 100 : 0,
              strategy: trade.mode || 'sentry',
              source: 'jarvis-auto',
              closedAt: new Date().toISOString(),
            });

            // 3. Goal Planner
            const activeGoals = await goalPlanner.getGoals(trade.userId);
            const activeGoal = activeGoals.find(g => g.status === 'active');
            if (activeGoal) {
              const newProgress = (activeGoal.currentProgress || 0) + (result.realizedPnl || 0);
              await goalPlanner.updateProgress(activeGoal.id, newProgress);
            }

            // 4. Confidence Engine
            if (trade.isPractice) {
              await confidenceEngine.evaluateAndNotify(trade.userId);
            }
          } catch (autoErr: any) {
            console.error('[SENTRY] Failed post-trade automations:', autoErr.message);
          }

        } else if (Object.keys(updateData).length > 0) {
          await doc.ref.update(updateData);
        }
      }

    } catch (e: any) {
      if (e.code === 16 || (e.details && e.details.includes('invalid authentication credentials')) || (e.message && e.message.includes('credentials'))) return;
      console.error('[SENTRY] Error in monitor loop:', e);
    }
  }

  private async requestCopilotApproval(trade: any, tradeId: string, reason: string, pnl: number) {
    try {
      await this.db.collection('trades').doc(tradeId).update({
        awaitingApproval: true,
        approvalRequestedAt: new Date().toISOString(),
        approvalReason: reason,
      });

      const message = formatCopilotApproval(trade.symbol, pnl, reason);
      await sendTelegramNotification(this.db, trade.userId, message);
      console.log(`[SENTRY] Copilot approval requested for ${trade.symbol}`);
    } catch (err: any) {
      console.error(`[SENTRY] Failed to request copilot approval:`, err.message);
    }
  }

  // New Autonomous LLM Loop
  async autonomousLoop() {
    try {
      // Circuit breaker check — don't enter new trades if we're on cooldown
      if (this.isCircuitBreakerActive()) {
        console.log('[AUTONOMOUS ENGINE] ⛔ Circuit breaker active — skipping autonomous loop.');
        return;
      }

      const activeConfigs = await this.db.collection('sentryConfigs')
        .where('active', '==', true)
        .where('isAutonomous', '==', true)
        .get();

      if (activeConfigs.empty) return;

      console.log(`[AUTONOMOUS ENGINE] Waking up to evaluate ${activeConfigs.size} active loops...`);
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const atrCalc = new ATRCalculator();

      for (const doc of activeConfigs.docs) {
        const config = doc.data();
        const userId = doc.id;
        const currentPrice = this.marketState[config.symbol]?.price;

        if (!currentPrice) {
          console.warn(`[AUTONOMOUS ENGINE] Missing market price for ${config.symbol}`);
          continue;
        }

        // 1. Fetch relevant memory & market narrative
        const memories = await this.memoryManager.recallMemories(userId, config.autonomousPrompt, 3);
        const globalMemories = await this.memoryManager.recallMemories('global_knowledge_base', config.symbol, 2);
        const combinedContext = [...memories, ...globalMemories].join('\n');

        // 2. Fetch basic MACD/RSI indicators (we will mock this since we don't have the historic candles tightly coupled without an API call, or just dynamically let the LLM decide based on the prompt alone for now)
        // For production, we'd hit /api/analysis.
        let indicators = "Currently trading at $" + currentPrice;

        const prompt = `You are Jarvis, an autonomous trading agent. 
        Evaluate the following trading instruction against current market conditions and determine if a trade should be executed right now.
        
        Instruction: "${config.autonomousPrompt}"
        Target Asset: ${config.symbol}
        Current Price: $${currentPrice}
        
        Recent Memories / Narratives:
        ${combinedContext}
        
        Decide if the conditions are met. Return a strict JSON response. If you want to execute a trade, "shouldTrade" must be true, and you must provide "setup" details.
        `;

        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                shouldTrade: { type: Type.BOOLEAN },
                reason: { type: Type.STRING },
                setup: {
                  type: Type.OBJECT,
                  properties: {
                    side: { type: Type.STRING, enum: ['buy', 'sell'] },
                    quantity: { type: Type.NUMBER },
                    stopLossPrice: { type: Type.NUMBER },
                    takeProfitPrice: { type: Type.NUMBER }
                  }
                }
              },
              required: ['shouldTrade', 'reason']
            }
          }
        });

        if (response.text) {
          try {
            const decision = JSON.parse(response.text);
            console.log(`[AUTONOMOUS ENGINE] Decision for ${userId}:`, decision.reason);

            if (decision.shouldTrade && decision.setup) {
              console.log(`[AUTONOMOUS ENGINE] Trade setup validated for ${config.symbol}. Executing LIVE immediately.`);
              
              const isPractice = config.isPractice !== undefined ? config.isPractice : false; // Default to LIVE fire-and-forget

              // Calculate ATR-based SL/TP if the LLM didn't provide them
              let finalStopLoss = decision.setup.stopLossPrice;
              let finalTakeProfit = decision.setup.takeProfitPrice;
              
              if (!finalStopLoss || !finalTakeProfit) {
                try {
                  const atrResult = await atrCalc.calculate(config.symbol, '1h');
                  if (!finalStopLoss) {
                    finalStopLoss = atrCalc.calculateStopLoss(currentPrice, atrResult.atr, decision.setup.side, 1.5);
                    console.log(`[AUTONOMOUS ENGINE] ATR SL calculated: $${finalStopLoss} (ATR: $${atrResult.atr.toFixed(4)}, ${atrResult.volatilityLevel} volatility)`);
                  }
                  if (!finalTakeProfit) {
                    finalTakeProfit = atrCalc.calculateTakeProfit(currentPrice, atrResult.atr, decision.setup.side, 2.5);
                    console.log(`[AUTONOMOUS ENGINE] ATR TP calculated: $${finalTakeProfit}`);
                  }
                } catch (atrErr: any) {
                  console.warn(`[AUTONOMOUS ENGINE] ATR calculation failed, using 1.5% fallback:`, atrErr.message);
                  finalStopLoss = decision.setup.side === 'buy' ? currentPrice * 0.985 : currentPrice * 1.015;
                  finalTakeProfit = decision.setup.side === 'buy' ? currentPrice * 1.025 : currentPrice * 0.975;
                }
              }

              // Execute directly into the market without a pending queue
              const executionResult = await this.tradeExecutor.execute({
                userId,
                symbol: config.symbol,
                side: decision.setup.side,
                quantity: decision.setup.quantity,
                market: config.market || 'crypto',
                mode: 'autonomous',
                isPractice: isPractice, // Unleashed live execution
                stopLossPrice: finalStopLoss,
                takeProfitPrice: finalTakeProfit,
              });

              // Alert the user on Telegram that execution actually happened
              const msg = `🚀 <b>Live Trade Executed by Jarvis</b>\n\nI evaluated your autonomous loop for <b>${config.symbol}</b> and fired an order autonomously.\n\nDecision: ${decision.reason}\n\nAction: ${decision.setup.side.toUpperCase()} ${decision.setup.quantity}\nFill Price: $${executionResult.fillPrice || currentPrice}\nMode: ${isPractice ? 'Paper Trading' : 'Live Real Money'}\n\nCheck your dashboard for active positions.`;
              await sendTelegramNotification(this.db, userId, msg);
              
              // Deactivate config after firing once to avoid 15m spam duplicates
              await doc.ref.update({ active: false, lastTriggered: new Date().toISOString() });
            }
          } catch (err) {
            console.error("Failed to parse LLM JSON decision", err);
          }
        }
      }

    } catch (e) {
      console.error('[AUTONOMOUS ENGINE] Error in loop:', e);
    }
  }
}
