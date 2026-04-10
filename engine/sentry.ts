import { TradeExecutor } from './tradeExecutor.ts';

export class SentryEngine {
  private db: FirebaseFirestore.Firestore;
  private tradeExecutor: TradeExecutor;
  private marketState: any;

  constructor(db: any, tradeExecutor: TradeExecutor, marketState: any) {
    this.db = db;
    this.tradeExecutor = tradeExecutor;
    this.marketState = marketState;
  }

  async monitor() {
    try {
      // 1. Monitor Daily Drawdown / Target Profit (Account Level)
      const sentryDocs = await this.db.collection('sentryConfigs').where('active', '==', true).get();
      
      for (const doc of sentryDocs.docs) {
        const config = doc.data();
        const userId = doc.id;
        
        const dailyPnl = await this.tradeExecutor.getDailyPnl(userId);
        const totalPnl = dailyPnl.totalPnl;

        let shouldClose = false;
        let reason = '';

        if (config.maxDailyLoss && totalPnl <= -config.maxDailyLoss) {
          shouldClose = true;
          reason = `Max daily loss of $${config.maxDailyLoss} reached.`;
        } else if (config.targetDailyProfit && totalPnl >= config.targetDailyProfit) {
          shouldClose = true;
          reason = `Target daily profit of $${config.targetDailyProfit} reached.`;
        }

        if (shouldClose) {
          console.log(`[SENTRY] Triggering panic close for ${userId}: ${reason}`);
          await this.tradeExecutor.panicCloseAll(userId);
          await doc.ref.update({ 
            active: false, 
            lastTriggered: new Date().toISOString(), 
            triggerReason: reason 
          });
        }
      }

      // 2. Monitor Individual Positions (SL, TP, Trailing Stop)
      const openPositionsSnapshot = await this.db.collection('trades').where('status', '==', 'open').get();
      
      for (const doc of openPositionsSnapshot.docs) {
        const trade = doc.data();
        const currentPrice = this.marketState[trade.symbol]?.price;
        if (!currentPrice) continue;

        let shouldClose = false;
        let reason = '';
        let updateData: any = {};

        // Update highest/lowest price for trailing stops
        if (trade.side === 'buy' && currentPrice > (trade.highestPrice || trade.entryPrice)) {
          updateData.highestPrice = currentPrice;
        } else if (trade.side === 'sell' && currentPrice < (trade.lowestPrice || trade.entryPrice)) {
          updateData.lowestPrice = currentPrice;
        }

        // Check Take Profit
        if (trade.takeProfitPrice) {
          if ((trade.side === 'buy' && currentPrice >= trade.takeProfitPrice) ||
              (trade.side === 'sell' && currentPrice <= trade.takeProfitPrice)) {
            shouldClose = true;
            reason = `Take Profit hit at $${currentPrice}`;
          }
        }

        // Check Stop Loss
        if (!shouldClose && trade.stopLossPrice) {
          if ((trade.side === 'buy' && currentPrice <= trade.stopLossPrice) ||
              (trade.side === 'sell' && currentPrice >= trade.stopLossPrice)) {
            shouldClose = true;
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
              reason = `Trailing Stop hit at $${currentPrice} (Highest: $${highest})`;
            }
          } else if (trade.side === 'sell') {
            const lowest = updateData.lowestPrice || trade.lowestPrice || trade.entryPrice;
            const trailingStop = lowest + trade.trailingStopDistance;
            if (currentPrice >= trailingStop) {
              shouldClose = true;
              reason = `Trailing Stop hit at $${currentPrice} (Lowest: $${lowest})`;
            }
          }
        }

        if (shouldClose) {
          console.log(`[SENTRY] Closing trade ${doc.id} for ${trade.userId}: ${reason}`);
          await this.tradeExecutor.closePosition(trade.userId, doc.id);
        } else if (Object.keys(updateData).length > 0) {
          await doc.ref.update(updateData);
        }
      }

    } catch (e) {
      console.error('[SENTRY] Error in monitor loop:', e);
    }
  }
}
