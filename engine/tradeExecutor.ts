import ccxt from 'ccxt';
import { KiteConnect } from 'kiteconnect';
import { sendTelegramNotification } from './telegram.ts';
import { AlpacaConnector, detectAssetClass } from './alpacaConnector.ts';
import { RiskGate } from './riskGate.ts';
import { MemoryManager } from './memory.ts';
import { PostMortemEngine } from './postMortem.ts';
import {
  classifyCloseErrorMessage,
  retryBackoffMs,
  MAX_CLOSE_ATTEMPTS,
  MAX_RETRIES_EXHAUSTED_CYCLES,
  isPermanentlyAbandoned,
  generateCloseClientOrderId,
  generatePartialClientOrderId,
  type CloseErrorClassification,
} from './closeRetry.ts';
import {
  placeEntryWithStopLoss,
  type BracketVenue,
  type BracketResult,
} from './brackets.ts';

export class TradeExecutor {
  private db: FirebaseFirestore.Firestore;
  private marketState: any;
  private riskGate: RiskGate;
  private memoryManager: MemoryManager | null;

  // Phase 9 (Tier B #3 hardening) — In-process per-tradeId lock for
  // closeWithRetry. Prevents the manual-vs-mid-retry double-order race:
  // if Sentry's closeWithRetry is mid-backoff (e.g., sleeping 2s before
  // attempt 2), and the user simultaneously hits the dashboard force-close
  // route, both callers should NOT fire separate exchange orders.
  // Both callers grab the same Promise; whichever fires the actual exchange
  // call wins, the other returns the same result. Cleaned up on completion.
  // Cross-process safety is item #11's job (clientOrderId at exchange layer).
  private closeInFlight: Map<string, Promise<any>> = new Map();

  constructor(db: any, marketState: any, riskGate: RiskGate, memoryManager: MemoryManager | null = null) {
    this.db = db;
    this.marketState = marketState;
    this.riskGate = riskGate;
    this.memoryManager = memoryManager;
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

  async execute(params: any) {
    const { userId, symbol, side, quantity, market, mode, isPractice, stopLossPrice, takeProfitPrice, trailingStopDistance, profitTarget, leverage } = params;

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

    // Risk Gate (Phase 9.3) — single audit point for every position-open.
    // Covers: kill switch, daily loss, notional %, concurrent positions,
    // live-capital cap, leverage cap. Codes returned so we can route the
    // rejection (kill_switch_triggered vs risk_gate_block) to brainActivity.
    const gateResult = await this.riskGate.checkOpen({
      userId,
      symbol,
      side,
      quantity: Number(quantity),
      price,
      assetClass,
      isPractice: isPractice !== false,
      leverage: typeof leverage === 'number' ? leverage : undefined,
    });
    if (!gateResult.allowed) {
      const activityType = gateResult.code === 'KILL_SWITCH' ? 'kill_switch_triggered' : 'risk_gate_block';
      try {
        await this.db.collection('brainActivity').add({
          userId,
          type: activityType,
          timestamp: new Date().toISOString(),
          symbol,
          side,
          quantity: Number(quantity),
          code: gateResult.code,
          reason: gateResult.reason,
          context: gateResult.context || null,
        });
      } catch {}
      throw new Error(`${gateResult.code}: ${gateResult.reason}`);
    }

    let fillPrice = price;
    let executedQuantity = Number(quantity);

    // Phase 9 (Tier B #1) — pre-reserve the trade doc ID so we can derive a
    // deterministic clientOrderIdPrefix from it BEFORE placing the entry.
    // This makes the bracket placement idempotent across retries.
    const tradeRef = this.db.collection('trades').doc();
    const tradeId = tradeRef.id;
    const clientOrderIdPrefix = `jve-${tradeId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`;
    let orderId = `paper-order-${Date.now()}`;
    let bracketResult: BracketResult | null = null;

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

      // Phase 9 (Tier B #1) — Map broker to bracket venue. Null = no native
      // brackets in v1 (Zerodha deferred to v1.5).
      let bracketVenue: BracketVenue | null = null;
      if (brokerConfig.brokerName === 'alpaca') bracketVenue = 'alpaca';
      else if (brokerConfig.brokerName === 'bybit') bracketVenue = 'bybit_linear';
      else if (brokerConfig.brokerName === 'binance') bracketVenue = 'binance_spot';

      try {
        if (brokerConfig.brokerName === 'zerodha') {
          // OLD PATH — Zerodha brackets deferred to v1.5 (no native primitive)
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
        } else if (bracketVenue) {
          // NEW PATH — bracket-aware entry placement.
          //
          // SAFETY: every live entry on a bracket-capable venue MUST have a
          // stopLossPrice. Without one, the position would have no SL — the
          // exact bug brackets exist to prevent. Refuse cleanly.
          if (!stopLossPrice) {
            throw new Error(`Live entry on ${bracketVenue} requires stopLossPrice — refusing to place a naked position`);
          }

          let exchange: any;
          if (bracketVenue === 'alpaca') {
            exchange = new AlpacaConnector({
              apiKeyId: brokerConfig.apiKey,
              secretKey: brokerConfig.apiSecret,
              paper: false,
            });
          } else {
            const exchangeClass = (ccxt as any)[brokerConfig.brokerName];
            exchange = new exchangeClass({
              apiKey: brokerConfig.apiKey,
              secret: brokerConfig.apiSecret,
              enableRateLimit: true,
            });
          }

          bracketResult = await placeEntryWithStopLoss({
            venue: bracketVenue,
            exchange,
            symbol,
            side,
            quantity: executedQuantity,
            stopLossPrice,
            clientOrderIdPrefix,
          });

          orderId = bracketResult.entryOrderId || `bracket-failed-${Date.now()}`;
          fillPrice = bracketResult.entryFillPrice ?? price;
          executedQuantity = bracketResult.entryFilledQty || executedQuantity;

          // Worst case — naked position AND emergency close failed. Alert loudly.
          // The trade write below tags the doc as needs_human so Sentry skips it.
          if (bracketResult.bracketPlacementStatus === 'sl_failed_emergency_failed') {
            console.error(`[EXECUTE] 💀 NAKED LIVE POSITION for ${symbol} ${side} ${executedQuantity}: ${bracketResult.errorDetail}`);
            try {
              await sendTelegramNotification(this.db, userId,
                `💀 <b>CRITICAL: NAKED LIVE POSITION</b>\n\n` +
                `${side.toUpperCase()} ${executedQuantity} ${symbol}\n` +
                `Entry order: <code>${orderId}</code>\n` +
                `SL placement FAILED AND emergency close FAILED.\n` +
                `Position is OPEN on the exchange WITHOUT stop-loss protection.\n\n` +
                `<b>MANUAL ACTION REQUIRED</b> — close the position on the exchange directly.\n\n` +
                `Error: ${bracketResult.errorDetail ?? 'unknown'}`
              );
            } catch {}
          }
        } else {
          throw new Error(`Unsupported live broker: ${brokerConfig.brokerName}`);
        }
      } catch (error: any) {
        console.error("Live execution failed:", error);
        throw new Error(`Live execution failed: ${error.message}`);
      }
    }

    // Phase 9 (Tier B #1) — Persist bracket placement state so Sentry +
    // closeWithRetry can act on it. needs_human flag for the worst-case
    // routes through the existing shouldSentrySkip + closeWithRetry guards.
    const isNakedNeedsHuman = bracketResult?.bracketPlacementStatus === 'sl_failed_emergency_failed';
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
      createdAt: new Date().toISOString(),
      // Phase 9 (Tier B #1) bracket fields
      bracketOrderIds: bracketResult ? {
        entry: bracketResult.entryOrderId,
        stopLoss: bracketResult.stopLossOrderId,
      } : null,
      bracketPlacementStatus: bracketResult?.bracketPlacementStatus ?? null,
      bracketErrorDetail: bracketResult?.errorDetail ?? null,
      // Worst-case: tag as needs_human so Sentry's shouldSentrySkip catches it
      ...(isNakedNeedsHuman ? {
        closeFailureClass: 'needs_human',
        closeFailureReason: 'Naked live position — bracket SL placement + emergency close BOTH failed. Manual exchange close required.',
        closeFailedAt: new Date().toISOString(),
      } : {}),
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

    return Promise.all(snapshot.docs.map(async doc => {
      const data = doc.data();
      // Prefer the live WS price (free); fall back to a fetched quote so
      // unrealized P&L survives a server restart and works for stocks (which
      // are never in the crypto-only WS feed), then to entryPrice.
      let currentPrice = this.marketState[data.symbol]?.price;
      if (!currentPrice) {
        const assetClass = this.resolveAssetClass(data.market, data.symbol);
        const fetched = await this.fetchMarketPrice(data.symbol, assetClass, userId, isPracticeMode);
        currentPrice = fetched || data.entryPrice;
      }
      const isLong = data.side === 'buy';
      const priceDiff = currentPrice - data.entryPrice;
      const unrealizedPnl = isLong ? (priceDiff * data.quantity) : (-priceDiff * data.quantity);

      return {
        id: doc.id,
        ...data,
        currentPrice,
        unrealizedPnl
      };
    }));
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

        // Phase 9 (#11) — Deterministic clientOrderId for exchange-layer
        // idempotency. Same tradeId → same ID → exchange rejects retries
        // as duplicates → classifier routes to already_closed → reconcile.
        const closeClientOrderId = generateCloseClientOrderId(tradeId);

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
              order_type: "MARKET",
              // Zerodha tag = client-side tracking only (no server-side dedup).
              // Max 20 chars. True idempotency on Zerodha requires application-
              // layer verify, deferred to Tier B item #2.
              tag: closeClientOrderId.slice(0, 20),
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

            const order = await exchange.createMarketOrder(
              data.symbol, closeSide, data.quantity, undefined,
              { newClientOrderId: closeClientOrderId }
            );
            exitOrderId = order.id;
            currentPrice = order.average || order.price || currentPrice;

            // Phase 9 (Tier B #1) — cancel resting SL leg after close fires.
            // Without this, the orphan SL could trigger on a later price tick
            // and create a phantom short. Cancel is best-effort: "order not
            // found" means already gone (filled or auto-cancelled), fine.
            const slLegId = data.bracketOrderIds?.stopLoss;
            if (slLegId) {
              try {
                await exchange.cancelOrder(slLegId, data.symbol);
              } catch (cancelErr: any) {
                const msg = String(cancelErr?.message ?? '').toLowerCase();
                if (!msg.includes('not found') && !msg.includes('does not exist') && !msg.includes('-2013')) {
                  console.warn(`[closePosition] SL leg ${slLegId} cancel failed: ${cancelErr.message}. Will reconcile on next boot (Tier B #2).`);
                }
              }
            }
          } else if (brokerConfig.brokerName === 'alpaca') {
            const alpaca = new AlpacaConnector({
              apiKeyId: brokerConfig.apiKey,
              secretKey: brokerConfig.apiSecret,
              paper: false,
            });
            const order = await alpaca.createMarketOrder(
              data.symbol, closeSide, data.quantity,
              { clientOrderId: closeClientOrderId }
            );
            exitOrderId = order.id;
            currentPrice = order.average ?? currentPrice;

            // Phase 9 (Tier B #1) — cancel resting SL leg, same rationale as above.
            const slLegId = data.bracketOrderIds?.stopLoss;
            if (slLegId) {
              try {
                await alpaca.cancelOrder(slLegId);
              } catch (cancelErr: any) {
                const msg = String(cancelErr?.message ?? '').toLowerCase();
                if (!msg.includes('404') && !msg.includes('not found')) {
                  console.warn(`[closePosition] Alpaca SL leg ${slLegId} cancel failed: ${cancelErr.message}. Will reconcile on next boot.`);
                }
              }
            }
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

    // Post-Mortem (Phase 1.audit-fix) — manual closes previously skipped this
    // entirely, losing the lesson. Now every closed trade flows into vector
    // memory so Scholar's recall finds it on the next decision.
    try {
      const pnlPercent = data.entryPrice > 0
        ? (realizedPnl / (data.entryPrice * data.quantity)) * 100
        : 0;
      const postMortemEngine = new PostMortemEngine(this.db, this.memoryManager || undefined);
      // Fire-and-forget — don't block the close response on AI analysis.
      postMortemEngine.analyze({
        tradeId,
        symbol: data.symbol,
        side: data.side,
        entryPrice: data.entryPrice,
        exitPrice: currentPrice,
        pnl: realizedPnl,
        pnlPercent,
        closeReason: 'manual close',
        userId,
      }).catch(err => console.error('[closePosition] PostMortem failed:', err.message));
    } catch (err: any) {
      console.error('[closePosition] PostMortem setup failed:', err.message);
    }

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
   * Phase 9 — closeWithRetry: the close path that can't silently give up
   * and can't pointlessly hammer a position that's already gone.
   *
   * Wraps closePosition with:
   *  - Error classification (transient | already_closed | permanent) via closeRetry.ts
   *  - Retry-with-backoff (up to MAX_CLOSE_ATTEMPTS) on transient errors only
   *  - Inline exchange-verify on deterministic "already_closed" classifications,
   *    so a real-but-misclassified open position is NOT marked closed in DB
   *  - Persistent closeFailedAt on terminal failure (sentry checks this to skip
   *    next-tick retry attempts during the retry-hold cooldown)
   *  - Telegram + brainActivity alerts on every terminal failure
   *
   * IDEMPOTENCY GAP (known, item #11 in plan): a successful exchange order
   * followed by a network blink that loses the response could currently cause
   * a duplicate order on the retry. Mitigations in v1: (a) inline verify
   * before each retry, (b) closePosition's "Trade already closed" Firestore
   * guard catches the duplicate at the DB layer if it succeeded once. Item
   * #11 (clientOrderId at the exchange layer) closes the remaining window.
   */
  async closeWithRetry(userId: string, tradeId: string): Promise<any> {
    // Phase 9 (Tier B #3 hardening) — in-process per-tradeId lock.
    // If another call is already running closeWithRetry for this trade
    // (Sentry mid-backoff + manual force-close arriving, for example),
    // both callers share the same Promise so only ONE exchange order fires.
    const existing = this.closeInFlight.get(tradeId);
    if (existing) {
      console.log(`[closeWithRetry] ${tradeId} already in-flight — joining existing call`);
      return existing;
    }

    const work = this._closeWithRetryUnlocked(userId, tradeId).finally(() => {
      this.closeInFlight.delete(tradeId);
    });
    this.closeInFlight.set(tradeId, work);
    return work;
  }

  private async _closeWithRetryUnlocked(userId: string, tradeId: string): Promise<any> {
    const tradeRef = this.db.collection('trades').doc(tradeId);
    const initialDoc = await tradeRef.get();
    if (!initialDoc.exists) throw new Error("Trade not found");
    const data = initialDoc.data()!;
    if (data.userId !== userId) throw new Error("Unauthorized");

    // Idempotent: if Firestore says it's already closed, return the existing state
    if (data.status !== 'open') {
      return {
        tradeId,
        exitPrice: data.exitPrice ?? data.entryPrice,
        realizedPnl: data.pnl ?? 0,
        status: 'already_closed_in_db',
        trade: data,
      };
    }

    // Phase 9 (Tier B #3 hardening) — terminal state guard.
    // Trades that hit MAX_RETRIES_EXHAUSTED_CYCLES enter permanent abandonment.
    // closeWithRetry refuses to attempt — user must close on the exchange directly.
    // This prevents the alert-spam-forever loop on the crypto path where
    // _verifyPositionGone returns null and an already-gone position would
    // otherwise retry-hold-retry-hold forever.
    if (isPermanentlyAbandoned(data.closeFailureClass)) {
      const reason = data.closeFailureReason ?? 'previous retries exhausted';
      throw new Error(`closeWithRetry: trade abandoned (needs_human) — ${reason}. Manual close on exchange required.`);
    }

    // Paper mode has no exchange call to retry — delegate directly.
    // closePosition handles paper-mode entirely in Firestore.
    if (data.isPractice !== false) {
      return await this.closePosition(userId, tradeId);
    }

    // Live mode — retry loop with classification + verify.
    let lastErr: any = null;
    let lastClassification: CloseErrorClassification | null = null;

    for (let attempt = 1; attempt <= MAX_CLOSE_ATTEMPTS; attempt++) {
      const backoff = retryBackoffMs(attempt);
      if (backoff > 0) {
        await new Promise(r => setTimeout(r, backoff));

        // Pre-retry verify: did the previous attempt actually succeed despite
        // throwing? If the exchange now reports no position, treat as success
        // and reconcile rather than double-order.
        const preVerify = await this._verifyPositionGone(data, userId);
        if (preVerify.gone === true) {
          console.warn(`[closeWithRetry] ${tradeId} verify says position gone before retry #${attempt} — previous attempt actually succeeded; reconciling.`);
          return await this._reconcileAsClosed(tradeRef, data, userId, tradeId,
            `Pre-retry verify confirmed position gone: ${preVerify.reason}`);
        }
      }

      try {
        const result = await this.closePosition(userId, tradeId);
        // Clear any prior failure flags (recovered from earlier failed attempt)
        await tradeRef.update({
          closeFailedAt: null,
          closeFailureReason: null,
          closeFailureClass: null,
        }).catch(() => {});
        return result;

      } catch (err: any) {
        lastErr = err;
        const errMsg = String(err?.message ?? '');

        // closePosition's own idempotency guard — concurrent close already updated DB
        if (errMsg.includes('Trade already closed')) {
          const freshDoc = await tradeRef.get();
          const freshData = freshDoc.data() ?? {};
          return {
            tradeId,
            exitPrice: freshData.exitPrice ?? data.entryPrice,
            realizedPnl: freshData.pnl ?? 0,
            status: 'already_closed_in_db',
            trade: freshData,
          };
        }

        const classification = classifyCloseErrorMessage(err);
        lastClassification = classification;

        // Permanent — no retry, escalate immediately
        if (classification.kind === 'permanent') {
          await this._markCloseFailed(tradeRef, 'permanent', classification.reason, errMsg);
          await this._alertCloseFailure(userId, tradeId, data, 'PERMANENT', classification.reason, errMsg);
          throw new Error(`closeWithRetry permanent failure: ${classification.reason} (orig: ${errMsg})`);
        }

        // Already-closed signal — do inline exchange-verify before reconciling.
        // CRITICAL: never mark a live position as closed on the error message
        // alone. Must have exchange confirmation.
        if (classification.kind === 'already_closed') {
          const verify = await this._verifyPositionGone(data, userId);
          if (verify.gone === true) {
            // Exchange confirms — safe to reconcile
            return await this._reconcileAsClosed(tradeRef, data, userId, tradeId,
              `Verify confirms gone after "${classification.reason}": ${verify.reason}`);
          }
          if (verify.gone === false) {
            // Exchange says position EXISTS. The "insufficient balance" type error
            // was misleading. Retry as transient.
            console.warn(`[closeWithRetry] ${tradeId} got "${classification.reason}" but exchange shows position still open — treating as transient`);
          }
          // verify.gone === null (couldn't verify) — fall through to retry, conservatively
        }

        console.warn(`[closeWithRetry] ${tradeId} attempt ${attempt}/${MAX_CLOSE_ATTEMPTS} failed (${classification.kind}: ${classification.reason})`);

        // If this was the last attempt, escalate
        if (attempt >= MAX_CLOSE_ATTEMPTS) {
          // Phase 9 (Tier B #3 hardening) — read prior cycle count + increment.
          // After MAX_RETRIES_EXHAUSTED_CYCLES, transition to terminal needs_human.
          const priorCount = Number(data.closeRetriesExhaustedCount ?? 0);
          const newCount = priorCount + 1;
          const escalateToNeedsHuman = newCount >= MAX_RETRIES_EXHAUSTED_CYCLES;

          if (escalateToNeedsHuman) {
            await this._markNeedsHuman(tradeRef, lastClassification?.reason ?? 'unknown', errMsg, newCount);
            await this._alertCloseFailure(userId, tradeId, data, 'NEEDS_HUMAN' as any,
              `${lastClassification?.reason ?? 'unknown'} (${newCount} cycles)`, errMsg);
            throw new Error(`closeWithRetry: NEEDS_HUMAN after ${newCount} cycles - ${errMsg}`);
          }

          await this._markCloseFailed(tradeRef, 'retries_exhausted', lastClassification?.reason ?? 'unknown', errMsg, newCount);
          await this._alertCloseFailure(userId, tradeId, data, 'RETRIES_EXHAUSTED',
            `${lastClassification?.reason ?? 'unknown'} (cycle ${newCount}/${MAX_RETRIES_EXHAUSTED_CYCLES})`, errMsg);
          throw new Error(`closeWithRetry: ${MAX_CLOSE_ATTEMPTS} attempts exhausted (cycle ${newCount}/${MAX_RETRIES_EXHAUSTED_CYCLES}) - ${errMsg}`);
        }
        // else: continue loop (backoff at top of next iteration)
      }
    }

    // Unreachable — loop either returns or throws on the last attempt
    throw new Error(`closeWithRetry: unreachable state, lastErr=${lastErr?.message}`);
  }

  /**
   * Mark a trade as closed via reconciliation (exchange says position is gone).
   * Uses last known prices since we don't have a real fill price for the
   * already-executed close.
   */
  private async _reconcileAsClosed(
    tradeRef: any, data: any, userId: string, tradeId: string, reason: string
  ): Promise<any> {
    // Best-effort current price for PnL display (entry price as fallback)
    const closeAssetClass = this.resolveAssetClass(data.market, data.symbol);
    let exitPrice = data.entryPrice;
    try {
      const fetched = await this.fetchMarketPrice(data.symbol, closeAssetClass, userId, false);
      if (fetched) exitPrice = fetched;
    } catch {}

    const isLong = data.side === 'buy';
    const priceDiff = exitPrice - data.entryPrice;
    const realizedPnl = isLong ? (priceDiff * data.quantity) : (-priceDiff * data.quantity);

    await tradeRef.update({
      status: 'closed',
      exitPrice,
      exitOrderId: `reconciled-${Date.now()}`,
      pnl: realizedPnl,
      closedAt: new Date().toISOString(),
      closeReconciled: true,
      closeReconcileReason: reason,
      closeFailedAt: null,
      closeFailureReason: null,
      closeFailureClass: null,
    });

    // Log to brainActivity
    this.db.collection('brainActivity').add({
      userId,
      agent: 'sentry',
      type: 'sentry_reconciled',
      message: `🔄 ${data.symbol} reconciled as closed — ${reason}`,
      timestamp: new Date().toISOString(),
      data: { tradeId, symbol: data.symbol, reason },
    }).catch(() => {});

    // Telegram alert — user should know we reconciled
    await sendTelegramNotification(this.db, userId,
      `🔄 <b>Trade Reconciled</b>\n\n` +
      `${data.side === 'buy' ? 'LONG' : 'SHORT'} ${data.quantity} ${data.symbol}\n` +
      `Status: marked closed after exchange confirmed no position.\n` +
      `Reason: ${reason}\n` +
      `Estimated PnL: $${realizedPnl.toFixed(2)} (using last known price $${exitPrice})`
    ).catch(() => {});

    return {
      tradeId,
      exitPrice,
      realizedPnl,
      status: 'reconciled',
      trade: { ...data, status: 'closed', exitPrice, pnl: realizedPnl },
    };
  }

  /**
   * Check the actual exchange for the position. Returns {gone: true} if the
   * exchange confirms no position, {gone: false} if a position is still open,
   * or {gone: null} if we couldn't verify (conservative — caller treats as
   * transient and retries rather than reconciling).
   *
   * v1: Alpaca only. Crypto verify (Binance/Bybit) intentionally returns null
   * to avoid wrong-reconcile risk on the untested code path. Item #2 of the
   * Tier B plan (bracket-leg-aware reconciliation) will extend this to crypto.
   */
  private async _verifyPositionGone(data: any, userId: string): Promise<{ gone: boolean | null; reason: string }> {
    const closeAssetClass = this.resolveAssetClass(data.market, data.symbol);

    if (closeAssetClass === 'stock') {
      try {
        const alpaca = await this.getAlpacaConnector(userId, false);
        const position = await alpaca.getPosition(data.symbol);
        const qty = parseFloat(String(position?.qty ?? '0'));
        if (qty === 0 || Math.abs(qty) < 1e-8) {
          return { gone: true, reason: 'Alpaca reports qty=0' };
        }
        return { gone: false, reason: `Alpaca reports qty=${qty}` };
      } catch (err: any) {
        const msg = String(err?.message ?? '').toLowerCase();
        if (msg.includes('not found') || msg.includes('404') || msg.includes('does not exist') || msg.includes('no position')) {
          return { gone: true, reason: 'Alpaca confirms no position (404/not found)' };
        }
        return { gone: null, reason: `Alpaca verify itself errored: ${err?.message ?? 'unknown'}` };
      }
    }

    // Phase 9 (Tier B #2) — Crypto verify now uses fetchPositionState from
    // reconciliation.ts. Closes the v1.6.0 known gap where _verifyPositionGone
    // returned null for crypto, forcing closeWithRetry to retry-hold loops
    // on the already-gone case until needs_human at ~15min.
    try {
      const brokerConfigsSnap = await this.db.collection('users').doc(userId).collection('brokerConfigs').where('isActive', '==', true).get();
      if (brokerConfigsSnap.empty) {
        return { gone: null, reason: 'no active broker config for crypto verify' };
      }
      const brokerConfig = brokerConfigsSnap.docs[0].data();
      let venue: 'binance_spot' | 'binance_futures' | 'bybit_linear' | null = null;
      let exchange: any = null;
      if (brokerConfig.brokerName === 'bybit') {
        venue = 'bybit_linear';
        const ExchangeClass = (ccxt as any).bybit;
        exchange = new ExchangeClass({
          apiKey: brokerConfig.apiKey,
          secret: brokerConfig.apiSecret,
          enableRateLimit: true,
        });
      } else if (brokerConfig.brokerName === 'binance') {
        venue = 'binance_spot';
        const ExchangeClass = (ccxt as any).binance;
        exchange = new ExchangeClass({
          apiKey: brokerConfig.apiKey,
          secret: brokerConfig.apiSecret,
          enableRateLimit: true,
        });
      } else {
        return { gone: null, reason: `verify unsupported for broker ${brokerConfig.brokerName}` };
      }
      const { fetchPositionState } = await import('./reconciliation.ts');
      const posState = await fetchPositionState(exchange, venue, data.symbol, Number(data.quantity ?? 0));
      if (!posState.exists) {
        return { gone: true, reason: posState.reason };
      }
      return { gone: false, reason: posState.reason };
    } catch (err: any) {
      return { gone: null, reason: `crypto verify error: ${err?.message ?? err}` };
    }
  }

  /**
   * Persist close-failure state to the trade doc so sentry's tick loop can
   * see it and skip retry attempts during the retry-hold cooldown.
   *
   * Phase 9 (Tier B #3 hardening): now also persists the cumulative
   * closeRetriesExhaustedCount, so the cap-at-MAX_RETRIES_EXHAUSTED_CYCLES
   * transition can fire from this counter on the next failure.
   */
  private async _markCloseFailed(
    tradeRef: any, failureClass: string, reason: string, errMessage: string,
    retriesExhaustedCount: number = 0
  ): Promise<void> {
    await tradeRef.update({
      closeFailedAt: new Date().toISOString(),
      closeFailureClass: failureClass,
      closeFailureReason: reason,
      closeFailureLastError: errMessage,
      closeRetriesExhaustedCount: retriesExhaustedCount,
    }).catch((err: any) => console.error('[closeWithRetry] failed to mark closeFailedAt:', err?.message));
  }

  /**
   * Phase 9 (Tier B #3 hardening) — transition a trade to terminal
   * `needs_human` state after MAX_RETRIES_EXHAUSTED_CYCLES futile cycles.
   * Sentry permanently skips trades in this state (no more retry attempts,
   * no more alerts). User must close the position on the exchange directly.
   */
  private async _markNeedsHuman(
    tradeRef: any, reason: string, errMessage: string, cycleCount: number
  ): Promise<void> {
    await tradeRef.update({
      closeFailedAt: new Date().toISOString(),
      closeFailureClass: 'needs_human',
      closeFailureReason: `Abandoned after ${cycleCount} retries_exhausted cycles: ${reason}`,
      closeFailureLastError: errMessage,
      closeRetriesExhaustedCount: cycleCount,
      needsHumanAt: new Date().toISOString(),
    }).catch((err: any) => console.error('[closeWithRetry] failed to mark needs_human:', err?.message));
  }

  /**
   * Loud escalation when a close terminally fails. Karthick needs to see this
   * — a stuck close means the position is still open with no automated
   * protection. brainActivity surfaces it in JarvisBrain; Telegram nudges him
   * out-of-band.
   */
  private async _alertCloseFailure(
    userId: string, tradeId: string, data: any,
    severity: 'PERMANENT' | 'RETRIES_EXHAUSTED' | 'NEEDS_HUMAN',
    classification: string, errMsg: string
  ): Promise<void> {
    const symbol = data.symbol ?? '?';
    const side = (data.side ?? '?').toUpperCase();
    const qty = data.quantity ?? '?';

    // brainActivity — shows in JarvisBrain UI
    this.db.collection('brainActivity').add({
      userId,
      agent: 'sentry',
      type: 'close_failed',
      message: `🚨 CLOSE FAILED (${severity}) — ${symbol} ${side} ${qty}: ${classification}`,
      timestamp: new Date().toISOString(),
      data: { tradeId, symbol, severity, classification, errMessage: errMsg.slice(0, 500) },
    }).catch(() => {});

    // Telegram — out-of-band, demands attention. The NEEDS_HUMAN case gets
    // a distinct, louder message because Sentry is no longer going to retry
    // — the user has to act on the exchange directly.
    const telegramMsg = severity === 'NEEDS_HUMAN'
      ? `🛑 <b>CLOSE ABANDONED — NEEDS HUMAN</b>\n\n` +
        `Trade: ${side} ${qty} ${symbol}\n` +
        `Classification: ${classification}\n` +
        `Last error: ${errMsg.slice(0, 200)}\n\n` +
        `Sentry tried ${classification.match(/\d+/)?.[0] ?? 'multiple'} cycles and gave up. ` +
        `It will NOT retry this trade again.\n\n` +
        `<b>Action required: close ${symbol} manually on the exchange.</b> ` +
        `Then mark the trade closed in the dashboard, or it will stay stuck.`
      : `🚨 <b>CLOSE FAILED (${severity})</b>\n\n` +
        `Trade: ${side} ${qty} ${symbol}\n` +
        `Classification: ${classification}\n` +
        `Last error: ${errMsg.slice(0, 200)}\n\n` +
        `Position remains OPEN on the exchange. Manual close may be required.\n` +
        `Sentry will retry in ~5 minutes; meanwhile no automated protection is active on this trade.`;
    await sendTelegramNotification(this.db, userId, telegramMsg).catch(() => {});

    console.error(`[closeWithRetry] 🚨 CLOSE FAILED (${severity}) for ${symbol} ${tradeId}: ${classification} — ${errMsg}`);
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
        // Phase 9 (#11) — Deterministic clientOrderId for partial close. Keyed
        // on (tradeId, partialIndex) so each distinct partial gets its own ID,
        // but retries within a single partial share the ID for exchange dedup.
        const partialIndex = (data.partialExits || []).length;
        const partialClientOrderId = generatePartialClientOrderId(tradeId, partialIndex);

        try {
          if (['binance', 'bybit'].includes(brokerConfig.brokerName)) {
            const exchangeClass = (ccxt as any)[brokerConfig.brokerName];
            const exchange = new exchangeClass({
              apiKey: brokerConfig.apiKey,
              secret: brokerConfig.apiSecret,
              enableRateLimit: true,
            });
            const order = await exchange.createMarketOrder(
              data.symbol, closeSide, closeQuantity, undefined,
              { newClientOrderId: partialClientOrderId }
            );
            exitOrderId = order.id;
            currentPrice = order.average || order.price || currentPrice;
          } else if (brokerConfig.brokerName === 'alpaca') {
            const alpaca = new AlpacaConnector({
              apiKeyId: brokerConfig.apiKey,
              secretKey: brokerConfig.apiSecret,
              paper: false,
            });
            const order = await alpaca.createMarketOrder(
              data.symbol, closeSide, closeQuantity,
              { clientOrderId: partialClientOrderId }
            );
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

    // Update trade: reduce quantity, move stop to breakeven, add trailing stop.
    // Phase 5 — "let winners run": trailing widened from 1% to 2% so the
    // remainder has room to breathe (was getting stopped on normal volatility),
    // and profitTarget is cleared so a re-hit doesn't fire another partial.
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
      // Move stop to breakeven — risk-free on the remainder
      stopLossPrice: data.entryPrice,
      // Wider trailing on remainder so volatility doesn't shake out the winner.
      // Use existing trailing if set; else 2% of current price.
      trailingStopDistance: data.trailingStopDistance || (currentPrice * 0.02),
      // Clear both take-profit triggers so this position can run on trailing alone
      takeProfitPrice: null,
      profitTarget: null,
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

    const openPositions = await this.getOpenPositions(userId, isPracticeMode);
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
