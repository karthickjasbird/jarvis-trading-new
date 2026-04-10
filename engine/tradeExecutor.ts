import ccxt from 'ccxt';
import { KiteConnect } from 'kiteconnect';
import { sendTelegramNotification } from './telegram.ts';

export class TradeExecutor {
  private db: FirebaseFirestore.Firestore;
  private marketState: any;

  constructor(db: any, marketState: any) {
    this.db = db;
    this.marketState = marketState;
  }

  private async getOrCreatePortfolio(userId: string) {
    const ref = this.db.collection('portfolios').doc(userId);
    const doc = await ref.get();
    if (!doc.exists) {
      const initial = {
        userId,
        paperBalance: 100000, // $100k starting balance
        realizedPnl: 0,
        updatedAt: new Date().toISOString()
      };
      await ref.set(initial);
      return initial;
    }
    return doc.data();
  }

  private async checkRiskManagement(userId: string, quantity: number, price: number) {
    // Fetch global risk settings
    let riskConfig = {
      maxDailyLoss: 1000,
      maxPositionSizePct: 20,
      autoLiquidateThreshold: 500
    };
    
    const riskDoc = await this.db.collection('riskSettings').doc(userId).get();
    if (riskDoc.exists) {
      riskConfig = { ...riskConfig, ...riskDoc.data() };
    }

    // 1. Check Max Daily Loss
    const dailyPnl = await this.getDailyPnl(userId);
    if (riskConfig.maxDailyLoss && dailyPnl.totalPnl <= -riskConfig.maxDailyLoss) {
      throw new Error(`RISK LIMIT EXCEEDED: Daily loss limit of $${riskConfig.maxDailyLoss} reached.`);
    }

    // 2. Position Sizing
    const portfolio = await this.getOrCreatePortfolio(userId);
    const tradeValue = quantity * price;
    const maxTradeValue = (portfolio?.paperBalance || 100000) * (riskConfig.maxPositionSizePct / 100);
    
    if (tradeValue > maxTradeValue) {
      throw new Error(`RISK LIMIT EXCEEDED: Trade value ($${tradeValue.toFixed(2)}) exceeds ${riskConfig.maxPositionSizePct}% of portfolio ($${maxTradeValue.toFixed(2)}).`);
    }
  }

  async execute(params: any) {
    const { userId, symbol, side, quantity, market, mode, isPractice, stopLossPrice, takeProfitPrice, trailingStopDistance } = params;
    const price = this.marketState[symbol]?.price || 100;
    
    // Apply Risk Management Guardrails
    await this.checkRiskManagement(userId, Number(quantity), price);

    let fillPrice = price;
    let orderId = `paper-order-${Date.now()}`;
    let executedQuantity = Number(quantity);

    if (mode === 'live' && !isPractice) {
      // Fetch active broker configs
      const brokerConfigsSnapshot = await this.db.collection('users').doc(userId).collection('brokerConfigs').where('isActive', '==', true).get();
      if (brokerConfigsSnapshot.empty) {
        throw new Error("No active broker configuration found for live trading.");
      }

      const brokerConfig = brokerConfigsSnapshot.docs[0].data();

      try {
        if (brokerConfig.brokerName === 'zerodha') {
          if (!brokerConfig.accessToken) throw new Error("Zerodha access token missing. Please login via settings.");
          const kc = new KiteConnect({ api_key: brokerConfig.apiKey });
          kc.setAccessToken(brokerConfig.accessToken);
          
          const order = await kc.placeOrder("regular", {
            exchange: "NSE",
            tradingsymbol: symbol,
            transaction_type: side.toUpperCase() as "BUY" | "SELL",
            quantity: executedQuantity,
            product: "MIS",
            order_type: "MARKET"
          });
          orderId = order.order_id;
          // In a real app, we'd fetch the actual fill price from the orderbook.
        } else if (['binance', 'bybit'].includes(brokerConfig.brokerName)) {
          const exchangeClass = (ccxt as any)[brokerConfig.brokerName];
          const exchange = new exchangeClass({
            apiKey: brokerConfig.apiKey,
            secret: brokerConfig.apiSecret,
            enableRateLimit: true,
          });
          
          // For safety in this demo, we'll use sandbox mode if available
          if (exchange.has['sandbox']) {
            exchange.setSandboxMode(true);
          }

          const order = await exchange.createMarketOrder(symbol, side, executedQuantity);
          orderId = order.id;
          fillPrice = order.average || order.price || price;
          executedQuantity = order.filled || executedQuantity;
        } else {
          throw new Error(`Unsupported live broker: ${brokerConfig.brokerName}`);
        }
      } catch (error: any) {
        console.error("Live execution failed:", error);
        throw new Error(`Live execution failed: ${error.message}`);
      }
    }

    const tradeRef = this.db.collection('trades').doc();
    const trade = {
      userId,
      symbol,
      market: market || 'crypto',
      side,
      quantity: executedQuantity,
      entryPrice: fillPrice,
      status: 'open',
      mode: mode || 'copilot',
      isPractice: isPractice || false,
      brokerOrderId: orderId,
      stopLossPrice: stopLossPrice || null,
      takeProfitPrice: takeProfitPrice || null,
      trailingStopDistance: trailingStopDistance || null,
      highestPrice: side === 'buy' ? fillPrice : null,
      lowestPrice: side === 'sell' ? fillPrice : null,
      createdAt: new Date().toISOString()
    };

    await tradeRef.set(trade);

    // Send Telegram Notification
    const modeText = mode === 'sentry' ? '🤖 <b>Sentry Mode</b>' : '👨‍💻 <b>Manual Trade</b>';
    const practiceText = isPractice ? ' 🧪 (PRACTICE)' : '';
    const sideText = side === 'buy' ? '🟢 LONG' : '🔴 SHORT';
    const message = `${modeText}${practiceText}\n\n${sideText} ${executedQuantity} ${symbol}\nEntry: $${fillPrice.toFixed(2)}\nOrder ID: <code>${orderId}</code>`;
    await sendTelegramNotification(this.db, userId, message);

    return {
      tradeId: tradeRef.id,
      orderId,
      ...trade,
      fillPrice,
      filledQuantity: executedQuantity,
    };
  }

  async getOpenPositions(userId: string, isPracticeMode: boolean = false) {
    const snapshot = await this.db.collection('trades')
      .where('userId', '==', userId)
      .where('status', '==', 'open')
      .where('isPractice', '==', isPracticeMode)
      .get();

    return snapshot.docs.map(doc => {
      const data = doc.data();
      const currentPrice = this.marketState[data.symbol]?.price || data.entryPrice;
      const isLong = data.side === 'buy';
      const priceDiff = currentPrice - data.entryPrice;
      const unrealizedPnl = isLong ? (priceDiff * data.quantity) : (-priceDiff * data.quantity);

      return {
        id: doc.id,
        ...data,
        currentPrice,
        unrealizedPnl
      };
    });
  }

  async closePosition(userId: string, tradeId: string) {
    const tradeRef = this.db.collection('trades').doc(tradeId);
    const doc = await tradeRef.get();
    
    if (!doc.exists) throw new Error("Trade not found");
    const data = doc.data()!;
    if (data.userId !== userId) throw new Error("Unauthorized");
    if (data.status !== 'open') throw new Error("Trade already closed");

    let currentPrice = this.marketState[data.symbol]?.price || data.entryPrice;
    let exitOrderId = `paper-close-${Date.now()}`;

    if (data.mode === 'live' && !data.isPractice) {
      const brokerConfigsSnapshot = await this.db.collection('users').doc(userId).collection('brokerConfigs').where('isActive', '==', true).get();
      if (!brokerConfigsSnapshot.empty) {
        const brokerConfig = brokerConfigsSnapshot.docs[0].data();
        const closeSide = data.side === 'buy' ? 'sell' : 'buy';

        try {
          if (brokerConfig.brokerName === 'zerodha') {
            if (!brokerConfig.accessToken) throw new Error("Zerodha access token missing.");
            const kc = new KiteConnect({ api_key: brokerConfig.apiKey });
            kc.setAccessToken(brokerConfig.accessToken);
            
            const order = await kc.placeOrder("regular", {
              exchange: "NSE",
              tradingsymbol: data.symbol,
              transaction_type: closeSide.toUpperCase() as "BUY" | "SELL",
              quantity: data.quantity,
              product: "MIS",
              order_type: "MARKET"
            });
            exitOrderId = order.order_id;
          } else if (['binance', 'bybit'].includes(brokerConfig.brokerName)) {
            const exchangeClass = (ccxt as any)[brokerConfig.brokerName];
            const exchange = new exchangeClass({
              apiKey: brokerConfig.apiKey,
              secret: brokerConfig.apiSecret,
              enableRateLimit: true,
            });
            
            if (exchange.has['sandbox']) {
              exchange.setSandboxMode(true);
            }

            const order = await exchange.createMarketOrder(data.symbol, closeSide, data.quantity);
            exitOrderId = order.id;
            currentPrice = order.average || order.price || currentPrice;
          }
        } catch (error: any) {
          console.error("Live close execution failed:", error);
          throw new Error(`Live close failed: ${error.message}`);
        }
      }
    }

    const isLong = data.side === 'buy';
    const priceDiff = currentPrice - data.entryPrice;
    const realizedPnl = isLong ? (priceDiff * data.quantity) : (-priceDiff * data.quantity);

    await tradeRef.update({
      status: 'closed',
      exitPrice: currentPrice,
      exitOrderId,
      pnl: realizedPnl,
      closedAt: new Date().toISOString()
    });

    // Update portfolio
    const portRef = this.db.collection('portfolios').doc(userId);
    const portDoc = await portRef.get();
    if (portDoc.exists) {
      const portData = portDoc.data()!;
      if (data.mode === 'live' && !data.isPractice) {
        await portRef.update({
          liveBalance: (portData.liveBalance || 0) + realizedPnl,
          liveRealizedPnl: (portData.liveRealizedPnl || 0) + realizedPnl,
          updatedAt: new Date().toISOString()
        });
      } else {
        await portRef.update({
          paperBalance: (portData.paperBalance || 100000) + realizedPnl,
          realizedPnl: (portData.realizedPnl || 0) + realizedPnl,
          updatedAt: new Date().toISOString()
        });
      }
    }

    // Send Telegram Notification
    const pnlEmoji = realizedPnl >= 0 ? '✅' : '❌';
    const message = `🔒 <b>Position Closed</b>\n\n${data.side === 'buy' ? 'LONG' : 'SHORT'} ${data.quantity} ${data.symbol}\nExit: $${currentPrice.toFixed(2)}\nPnL: ${pnlEmoji} $${realizedPnl.toFixed(2)}`;
    await sendTelegramNotification(this.db, userId, message);

    return { 
      tradeId, 
      exitPrice: currentPrice, 
      realizedPnl, 
      status: "closed",
      trade: {
        ...data,
        exitPrice: currentPrice,
        pnl: realizedPnl
      }
    };
  }

  async panicCloseAll(userId: string, isPracticeMode: boolean = false) {
    const positions = await this.getOpenPositions(userId, isPracticeMode);
    const results = [];
    for (const pos of positions) {
      try {
        const result = await this.closePosition(userId, pos.id);
        results.push(result);
      } catch (e) {
        console.error(`Failed to close ${pos.id}`, e);
      }
    }
    return results;
  }

  async getTradeHistory(userId: string, limit: number, isPracticeMode: boolean = false) {
    const snapshot = await this.db.collection('trades')
      .where('userId', '==', userId)
      .where('status', '==', 'closed')
      .where('isPractice', '==', isPracticeMode)
      .orderBy('closedAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async getDailyPnl(userId: string, isPracticeMode: boolean = false) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    const snapshot = await this.db.collection('trades')
      .where('userId', '==', userId)
      .where('status', '==', 'closed')
      .where('isPractice', '==', isPracticeMode)
      .where('closedAt', '>=', todayStr)
      .get();

    let realizedPnl = 0;
    let winCount = 0;
    let lossCount = 0;

    snapshot.docs.forEach(doc => {
      const pnl = doc.data().pnl || 0;
      realizedPnl += pnl;
      if (pnl > 0) winCount++;
      else if (pnl < 0) lossCount++;
    });

    const openPositions = await this.getOpenPositions(userId);
    const unrealizedPnl = openPositions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);

    return {
      realizedPnl,
      unrealizedPnl,
      totalPnl: realizedPnl + unrealizedPnl,
      tradesCount: snapshot.size,
      winCount,
      lossCount
    };
  }
}
