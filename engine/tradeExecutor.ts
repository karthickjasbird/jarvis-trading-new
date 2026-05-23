import ccxt from 'ccxt';
import { KiteConnect } from 'kiteconnect';
import { sendTelegramNotification } from './telegram.ts';
import { AlpacaConnector, detectAssetClass } from './alpacaConnector.ts';

export class TradeExecutor {
  private db: FirebaseFirestore.Firestore;
  private marketState: any;

  constructor(db: any, marketState: any) {
    this.db = db;
    this.marketState = marketState;
  }

  /**
   * Resolve which asset class a trade params object refers to.
   * Explicit `market` field wins; otherwise infer from symbol shape.
   */
  private resolveAssetClass(market: string | undefined, symbol: string): 'crypto' | 'stock' {
    if (market === 'stock' || market === 'stocks' || market === 'equity') return 'stock';
    if (market === 'crypto') return 'crypto';
    return detectAssetClass(symbol);
  }

  /**
   * Read this user's Alpaca creds. Look-up order:
   *   1. `users/{userId}/secrets/apiKeys` (personal API keys vault)
   *   2. `users/{userId}/brokerConfigs` with brokerName === 'alpaca'
   *      (set via Broker Settings)
   *   3. `.env` fallback
   * Symmetric with `marketScanner.getAlpacaCreds`.
   */
  private async getAlpacaConnector(userId: string, isPaper: boolean): Promise<AlpacaConnector> {
    let apiKeyId = '';
    let secretKey = '';
    try {
      const doc = await this.db
        .collection('users').doc(userId)
        .collection('secrets').doc('apiKeys').get();
      if (doc.exists) {
        const data: any = doc.data() || {};
        apiKeyId = data.alpacaApiKeyId || '';
        secretKey = data.alpacaSecretKey || '';
      }
    } catch {}
    if (!apiKeyId || !secretKey) {
      try {
        const snap = await this.db
          .collection('users').doc(userId)
          .collection('brokerConfigs')
          .where('brokerName', '==', 'alpaca')
          .limit(1).get();
        if (!snap.empty) {
          const data: any = snap.docs[0].data() || {};
          apiKeyId = apiKeyId || data.apiKey || '';
          secretKey = secretKey || data.apiSecret || '';
        }
      } catch {}
    }
    apiKeyId = apiKeyId || process.env.ALPACA_API_KEY_ID || '';
    secretKey = secretKey || process.env.ALPACA_SECRET_KEY || '';
    if (!apiKeyId || !secretKey) {
      throw new Error('Alpaca credentials not configured. Add them under Broker Settings or set ALPACA_API_KEY_ID / ALPACA_SECRET_KEY in .env.');
    }
    return new AlpacaConnector({ apiKeyId, secretKey, paper: isPaper });
  }

  /**
   * Fetch a fill-quality price for paper trades. Crypto → public Binance
   * ticker; stocks → Alpaca latest trade. Returns null on failure so the
   * caller can fall back to last known marketState.
   */
  private async fetchMarketPrice(
    symbol: string,
    assetClass: 'crypto' | 'stock',
    userId: string,
    isPaper: boolean,
  ): Promise<number | null> {
    try {
      if (assetClass === 'stock') {
        const alpaca = await this.getAlpacaConnector(userId, isPaper);
        const quote = await alpaca.getQuote(symbol);
        return quote.price;
      }
      const cleanSymbol = (symbol || '').replace('/', '');
      if (!cleanSymbol) return null;
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cleanSymbol}`);
      const data = await res.json();
      const price = parseFloat(data.price);
      return isNaN(price) ? null : price;
    } catch {
      return null;
    }
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

  private async checkRiskManagement(userId: string, quantity: number, price: number, isPractice: boolean = true) {
    // Fetch global risk settings
    let riskConfig: any = {
      maxDailyLoss: 1000,
      maxPositionSizePct: 20,
      autoLiquidateThreshold: 500,
      maxOpenPositions: 5,
      maxLiveCapital: 50, // Default $50 hard cap on aggregate LIVE exposure
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

    // 3. Max Open Positions
    if (riskConfig.maxOpenPositions && riskConfig.maxOpenPositions > 0) {
      const openSnap = await this.db.collection('trades')
        .where('userId', '==', userId)
        .where('status', '==', 'open')
        .get();
      if (openSnap.size >= riskConfig.maxOpenPositions) {
        throw new Error(`RISK LIMIT EXCEEDED: Already at max open positions (${openSnap.size}/${riskConfig.maxOpenPositions}).`);
      }
    }

    // 4. LIVE-MONEY HARD CAP (independent of any per-trade % limit).
    // Sums the notional of every currently-open LIVE position + this
    // proposed trade's notional. Refuses if aggregate would breach
    // `maxLiveCapital`. Skipped entirely in Practice mode.
    if (!isPractice && (riskConfig.maxLiveCapital ?? 0) > 0) {
      let openLiveExposure = 0;
      try {
        const liveSnap = await this.db.collection('trades')
          .where('userId', '==', userId)
          .where('status', '==', 'open')
          .where('isPractice', '==', false)
          .get();
        for (const doc of liveSnap.docs) {
          const t: any = doc.data();
          // Prefer live mark price if we have it; fall back to entry. Either
          // way the aggregate is computed conservatively — entry is a known
          // floor, mark price would be more accurate but is best-effort.
          const px = this.marketState?.[t.symbol]?.price || t.entryPrice || 0;
          openLiveExposure += (Number(t.quantity) || 0) * Number(px || 0);
        }
      } catch (err: any) {
        // If we can't read live exposure, REFUSE — fail-closed on live money.
        throw new Error(`RISK LIMIT CHECK FAILED: Could not verify live exposure (${err.message}). Refusing live trade for safety.`);
      }
      const projected = openLiveExposure + tradeValue;
      if (projected > riskConfig.maxLiveCapital) {
        throw new Error(`LIVE CAP EXCEEDED: Open live exposure $${openLiveExposure.toFixed(2)} + this trade $${tradeValue.toFixed(2)} = $${projected.toFixed(2)} would breach the $${riskConfig.maxLiveCapital} live cap. Increase Max Live Capital in Risk Manager or close existing live positions.`);
      }
    }
  }

  async execute(params: any) {
    const { userId, symbol, side, quantity, market, mode, isPractice, stopLossPrice, takeProfitPrice, trailingStopDistance, profitTarget } = params;

    const assetClass = this.resolveAssetClass(market, symbol);

    // Stocks can only trade during market hours — bail early with a clear
    // message rather than letting Alpaca reject the order downstream.
    if (assetClass === 'stock') {
      try {
        const alpaca = await this.getAlpacaConnector(userId, isPractice !== false);
        const clock = await alpaca.getClock();
        if (!clock.is_open) {
          throw new Error(`US equity market is closed. Next open: ${clock.next_open}`);
        }
      } catch (err: any) {
        // Re-throw market-closed errors, but swallow auth/network so the
        // caller still gets a sensible execution error rather than a
        // surprise "credentials missing" partway through.
        if (/market is closed/i.test(err?.message || '')) throw err;
        throw new Error(`Alpaca pre-trade check failed: ${err.message}`);
      }
    }

    // Fetch REAL price for accurate fill pricing (Binance for crypto, Alpaca for stocks)
    let price = this.marketState[symbol]?.price || 100;
    const fetched = await this.fetchMarketPrice(symbol, assetClass, userId, isPractice !== false);
    if (fetched) {
      price = fetched;
      if (this.marketState[symbol]) {
        this.marketState[symbol].price = fetched;
      } else {
        this.marketState[symbol] = { price: fetched, lastChange: 0 };
      }
    }

    // Apply Risk Management Guardrails (incl. live-money hard cap)
    await this.checkRiskManagement(userId, Number(quantity), price, isPractice !== false);

    let fillPrice = price;
    let orderId = `paper-order-${Date.now()}`;
    let executedQuantity = Number(quantity);

    // SAFETY GUARD: Double-check before real money execution
    if (!isPractice && (mode === 'live' || mode === 'autonomous' || mode === 'sentry')) {
      console.log(`[SAFETY] ⚠️ REAL MONEY TRADE DETECTED: ${side} ${quantity} ${symbol} for user ${userId}`);
      
      // Log to audit trail BEFORE execution
      await this.db.collection('auditLog').add({
        userId,
        action: 'REAL_TRADE_ATTEMPT',
        symbol,
        side,
        quantity: Number(quantity),
        price,
        mode,
        timestamp: new Date().toISOString(),
        status: 'pending'
      });
    }

    if (!isPractice) {  // Use isPractice as the single source of truth — always real if NOT practice
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

          // LIVE MODE: Never use sandbox — user has explicitly switched to live/real money

          const order = await exchange.createMarketOrder(symbol, side, executedQuantity);
          orderId = order.id;
          fillPrice = order.average || order.price || price;
          executedQuantity = order.filled || executedQuantity;
        } else if (brokerConfig.brokerName === 'alpaca') {
          // brokerConfig.apiKey = Alpaca key ID, apiSecret = secret key.
          const alpaca = new AlpacaConnector({
            apiKeyId: brokerConfig.apiKey,
            secretKey: brokerConfig.apiSecret,
            paper: false,
          });
          const order = await alpaca.createMarketOrder(symbol, side, executedQuantity);
          orderId = order.id;
          fillPrice = order.average ?? price;
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
      market: market || assetClass,
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
      profitTarget: profitTarget || null,
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

    const closeAssetClass = this.resolveAssetClass(data.market, data.symbol);
    let currentPrice = this.marketState[data.symbol]?.price || data.entryPrice;
    const fetched = await this.fetchMarketPrice(data.symbol, closeAssetClass, userId, data.isPractice !== false);
    if (fetched) currentPrice = fetched;

    let exitOrderId = `paper-close-${Date.now()}`;

    if (!data.isPractice) {  // isPractice is the single source of truth for real vs paper
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

            // LIVE MODE: Never use sandbox — user has explicitly switched to live/real money

            const order = await exchange.createMarketOrder(data.symbol, closeSide, data.quantity);
            exitOrderId = order.id;
            currentPrice = order.average || order.price || currentPrice;
          } else if (brokerConfig.brokerName === 'alpaca') {
            const alpaca = new AlpacaConnector({
              apiKeyId: brokerConfig.apiKey,
              secretKey: brokerConfig.apiSecret,
              paper: false,
            });
            const order = await alpaca.createMarketOrder(data.symbol, closeSide, data.quantity);
            exitOrderId = order.id;
            currentPrice = order.average ?? currentPrice;
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
      if (!data.isPractice) {  // Update real portfolio balance when closing a live trade
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

  /**
   * Partially close a position (e.g., close 50% at TP1, let rest ride)
   * Returns the realized PnL from the closed portion.
   */
  async partialClosePosition(userId: string, tradeId: string, closePercent: number = 50) {
    const tradeRef = this.db.collection('trades').doc(tradeId);
    const doc = await tradeRef.get();
    
    if (!doc.exists) throw new Error("Trade not found");
    const data = doc.data()!;
    if (data.userId !== userId) throw new Error("Unauthorized");
    if (data.status !== 'open') throw new Error("Trade already closed");

    const closeQuantity = data.quantity * (closePercent / 100);
    const remainingQuantity = data.quantity - closeQuantity;

    // Fetch current price
    const partialAssetClass = this.resolveAssetClass(data.market, data.symbol);
    let currentPrice = this.marketState[data.symbol]?.price || data.entryPrice;
    const fetched = await this.fetchMarketPrice(data.symbol, partialAssetClass, userId, data.isPractice !== false);
    if (fetched) currentPrice = fetched;

    let exitOrderId = `paper-partial-${Date.now()}`;

    // Execute partial close on real broker if live
    if (!data.isPractice) {
      const brokerConfigsSnapshot = await this.db.collection('users').doc(userId).collection('brokerConfigs').where('isActive', '==', true).get();
      if (!brokerConfigsSnapshot.empty) {
        const brokerConfig = brokerConfigsSnapshot.docs[0].data();
        const closeSide = data.side === 'buy' ? 'sell' : 'buy';
        try {
          if (['binance', 'bybit'].includes(brokerConfig.brokerName)) {
            const exchangeClass = (ccxt as any)[brokerConfig.brokerName];
            const exchange = new exchangeClass({
              apiKey: brokerConfig.apiKey,
              secret: brokerConfig.apiSecret,
              enableRateLimit: true,
            });
            const order = await exchange.createMarketOrder(data.symbol, closeSide, closeQuantity);
            exitOrderId = order.id;
            currentPrice = order.average || order.price || currentPrice;
          } else if (brokerConfig.brokerName === 'alpaca') {
            const alpaca = new AlpacaConnector({
              apiKeyId: brokerConfig.apiKey,
              secretKey: brokerConfig.apiSecret,
              paper: false,
            });
            const order = await alpaca.createMarketOrder(data.symbol, closeSide, closeQuantity);
            exitOrderId = order.id;
            currentPrice = order.average ?? currentPrice;
          }
        } catch (error: any) {
          console.error("Live partial close failed:", error);
          throw new Error(`Live partial close failed: ${error.message}`);
        }
      }
    }

    // Calculate PnL for the closed portion
    const isLong = data.side === 'buy';
    const priceDiff = currentPrice - data.entryPrice;
    const partialPnl = isLong ? (priceDiff * closeQuantity) : (-priceDiff * closeQuantity);

    // Update trade: reduce quantity, move stop to breakeven, add trailing stop
    await tradeRef.update({
      quantity: remainingQuantity,
      originalQuantity: data.quantity,  // Preserve original for history
      partialExits: [...(data.partialExits || []), {
        quantity: closeQuantity,
        exitPrice: currentPrice,
        pnl: partialPnl,
        exitOrderId,
        closedAt: new Date().toISOString(),
      }],
      // Move stop to breakeven — risk-free on the remainder!
      stopLossPrice: data.entryPrice,
      // Enable trailing stop on remainder (use 1% of price as distance if not set)
      trailingStopDistance: data.trailingStopDistance || (currentPrice * 0.01),
      // Clear the take profit so it doesn't trigger a full close again
      takeProfitPrice: null,
      partialClosedAt: new Date().toISOString(),
    });

    // Update portfolio with partial profit
    const portRef = this.db.collection('portfolios').doc(userId);
    const portDoc = await portRef.get();
    if (portDoc.exists) {
      const portData = portDoc.data()!;
      if (!data.isPractice) {
        await portRef.update({
          liveBalance: (portData.liveBalance || 0) + partialPnl,
          liveRealizedPnl: (portData.liveRealizedPnl || 0) + partialPnl,
          updatedAt: new Date().toISOString()
        });
      } else {
        await portRef.update({
          paperBalance: (portData.paperBalance || 100000) + partialPnl,
          realizedPnl: (portData.realizedPnl || 0) + partialPnl,
          updatedAt: new Date().toISOString()
        });
      }
    }

    // Telegram notification
    const pnlEmoji = partialPnl >= 0 ? '✅' : '❌';
    const message = `📊 <b>Partial Close (${closePercent}%)</b>\n\n${data.side === 'buy' ? 'LONG' : 'SHORT'} ${data.symbol}\nClosed: ${closeQuantity} @ $${currentPrice.toFixed(2)}\nPartial PnL: ${pnlEmoji} $${partialPnl.toFixed(2)}\nRemaining: ${remainingQuantity} (stop moved to breakeven, trailing active)`;
    await sendTelegramNotification(this.db, userId, message);

    console.log(`[TRADE] Partial close ${closePercent}% of ${data.symbol}: PnL $${partialPnl.toFixed(2)}, remaining ${remainingQuantity}`);

    return {
      tradeId,
      exitPrice: currentPrice,
      closedQuantity: closeQuantity,
      remainingQuantity,
      partialPnl,
      status: 'partial_closed',
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
      .get();

    const trades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Sort in-memory by closedAt descending
    trades.sort((a: any, b: any) => {
      const aTime = a.closedAt ? (a.closedAt.toDate ? a.closedAt.toDate().getTime() : new Date(a.closedAt).getTime()) : 0;
      const bTime = b.closedAt ? (b.closedAt.toDate ? b.closedAt.toDate().getTime() : new Date(b.closedAt).getTime()) : 0;
      return bTime - aTime;
    });

    return trades.slice(0, limit);
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
