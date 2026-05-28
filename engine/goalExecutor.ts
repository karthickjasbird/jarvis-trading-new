/**
 * GoalExecutor — Campaign Manager for Multi-Trade Goal Achievement
 * 
 * This engine manages autonomous trading campaigns. When the user sets a goal
 * like "Make ₹3L from ₹1L in 1 week," the GoalExecutor:
 * 
 * 1. Creates a Campaign with deadline and target
 * 2. Scans the market for top opportunities
 * 3. Splits capital across multiple coin "slots" simultaneously
 * 4. Monitors all trades via Sentry Engine
 * 5. When trades close, re-scans and re-deploys (trade chaining)
 * 6. Compounds profits into subsequent trades
 * 7. Adjusts aggression based on deadline proximity
 * 8. Stops when target is reached or deadline expires
 */

import { sendTelegramNotification } from './telegram.ts';
import { RegimeDetector, RegimeResult } from './regimeDetector.ts';
import { KellyCalculator } from './kellyCalculator.ts';
import { detectAssetClass } from './alpacaConnector.ts';
import { isHalted } from './killSwitch.ts';

/**
 * Strategy profile picked by the deadline router (Phase 8.5). Maps a
 * campaign's remaining time-to-deadline onto:
 *   - which asset classes to scan (crypto / stocks / commodities)
 *   - which timeframe regime/TA should focus on
 *   - a Kelly multiplier (lever Kelly up for short deadlines, down for long)
 *   - a minimum score threshold for candidate inclusion
 *
 * Buckets (deadline-driven):
 *   scalp     <6h           crypto-only (24/7), 1H, Kelly ×1.3
 *   day       6h-3d         crypto + stocks (when US session open), 1H/4H, Kelly ×1.0-1.15
 *   swing     3-14d         crypto + stocks + commodities, 4H, Kelly ×0.9
 *   position  >14d          all classes, 1D, Kelly ×0.8
 */
export interface StrategyProfile {
  bucket: 'scalp' | 'day' | 'swing' | 'position';
  markets: Array<'crypto' | 'stocks' | 'commodities'>;
  regimeTimeframe: '1h' | '4h' | '1d';
  kellyMultiplier: number;
  minScore: number;
  reason: string;
}

export interface Campaign {
  id?: string;
  userId: string;
  goalId?: string;
  targetProfit: number;       // Total profit target in USD
  startingCapital: number;    // Initial capital deployed
  availableCapital: number;   // Current uninvested capital
  realizedProfit: number;     // Profit from closed trades
  unrealizedProfit: number;   // Profit from open trades (updated on each tick)
  status: 'active' | 'paused' | 'completed' | 'expired' | 'failed' | 'cancelled';
  isPractice: boolean;
  maxSlots: number;           // Max simultaneous trades (default: 3)
  activeTradeIds: string[];   // Currently open trade IDs
  completedTradeIds: string[];// Closed trade IDs from this campaign
  tradeLog: CampaignTrade[];  // Full trade history
  deadline: string;           // ISO deadline
  deadlineDays: number;       // Original deadline in days
  urgency: 'relaxed' | 'normal' | 'urgent' | 'critical';
  riskPerTrade: number;       // % of available capital per slot (dynamic)
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastScanAt?: string;
  scanIntervalMinutes: number; // How often to scan for new opportunities
}

export interface CampaignTrade {
  tradeId: string;
  symbol: string;
  side: 'buy' | 'sell';
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  capitalDeployed: number;
  pnl?: number;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt?: string;
}

export class GoalExecutor {
  private db: FirebaseFirestore.Firestore;
  private tradeExecutor: any;
  private marketScanner: any;
  private marketState: any;
  private ownerId?: string;
  private activeCampaigns: Map<string, Campaign> = new Map();
  private regimeDetector: RegimeDetector;
  private kellyCalculator: KellyCalculator;

  constructor(
    db: any,
    tradeExecutor: any,
    marketScanner: any,
    marketState: any,
    ownerId?: string
  ) {
    this.db = db;
    this.tradeExecutor = tradeExecutor;
    this.marketScanner = marketScanner;
    this.marketState = marketState;
    this.ownerId = ownerId;
    this.regimeDetector = new RegimeDetector();
    this.kellyCalculator = new KellyCalculator(db);
  }

  /**
   * Create a new trading campaign
   */
  async createCampaign(
    userId: string,
    targetProfit: number,
    capital: number,
    deadlineDays: number,
    isPractice: boolean,
    maxSlots: number = 3
  ): Promise<Campaign> {
    // ─── Phase 6 — Minimum-target sanity check ───
    // The campaign math distributes target profit across slots. If the target
    // is too small relative to the SL distance, the resulting TP placement
    // produces sub-1.5:1 R/R trades that lose money at any realistic win rate.
    //
    // Math: per-slot reward must be ≥ 1.5× per-slot risk. With a 2.5% SL on a
    // (capital/maxSlots) position, that requires target ≥ capital × 2.5% × 1.5
    // = capital × 3.75%. Reject below that floor with a clear message so the
    // user knows what target IS achievable.
    const SL_PCT = 0.025; // matches non-urgent default in scanAndDeploy
    const RR_FLOOR = 1.5;
    const minViableTarget = capital * SL_PCT * RR_FLOOR;
    if (targetProfit < minViableTarget) {
      const minPct = (SL_PCT * RR_FLOOR * 100).toFixed(1);
      throw new Error(
        `Campaign target $${targetProfit} too small for $${capital} capital. ` +
        `Minimum viable target is $${minViableTarget.toFixed(2)} (${minPct}% of capital) — ` +
        `below this, the TP placement is forced tighter than ${RR_FLOOR}:1 R/R against the SL, ` +
        `producing structurally losing trades. Suggest target $${minViableTarget.toFixed(0)} or higher, ` +
        `OR increase capital, OR set a longer deadline (longer deadlines allow looser SL).`
      );
    }

    // Phase 9 fix — millisecond arithmetic, NOT setDate(). setDate() truncates
    // to an integer day-of-month, so any sub-day deadline (deadlineDays < 1,
    // e.g. 0.25 = 6 hours) got rounded to 0 days added → deadline = now →
    // campaign expired the instant the expiry check ran. Scalp campaigns
    // (hours-long deadlines) were impossible before this fix.
    const deadline = new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000);

    // Calculate initial risk based on target aggressiveness
    const returnPct = (targetProfit / capital) * 100;
    let riskPerTrade = 30; // Default: 30% of capital per slot
    if (returnPct <= 10) riskPerTrade = 50;       // Conservative target → bigger positions
    else if (returnPct <= 50) riskPerTrade = 35;   // Moderate target
    else if (returnPct <= 100) riskPerTrade = 30;  // Aggressive target → diversify more
    else riskPerTrade = 25;                         // Very aggressive → spread risk across more trades

    const campaign: Campaign = {
      userId,
      targetProfit,
      startingCapital: capital,
      availableCapital: capital,
      realizedProfit: 0,
      unrealizedProfit: 0,
      status: 'active',
      isPractice,
      maxSlots,
      activeTradeIds: [],
      completedTradeIds: [],
      tradeLog: [],
      deadline: deadline.toISOString(),
      deadlineDays,
      urgency: this.calculateUrgency(deadline),
      riskPerTrade,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scanIntervalMinutes: 10,
    };

    const docRef = await this.db.collection('campaigns').add(campaign);
    campaign.id = docRef.id;
    this.activeCampaigns.set(docRef.id, campaign);

    // Log to brain activity
    await this.logBrainActivity(userId,
      `🎯 NEW CAMPAIGN: Target $${targetProfit} profit from $${capital} capital. Deadline: ${deadlineDays} days. Max ${maxSlots} simultaneous trades. ${isPractice ? '🧪 Practice' : '💰 LIVE'}`
    );

    // Send Telegram notification
    try {
      await sendTelegramNotification(this.db, userId,
        `🎯 <b>Campaign Started</b>\n\nTarget: $${targetProfit} profit\nCapital: $${capital}\nDeadline: ${deadlineDays} days\nSlots: ${maxSlots} simultaneous trades\nMode: ${isPractice ? '🧪 Practice' : '💰 LIVE'}`
      );
    } catch {}

    console.log(`[CAMPAIGN] 🎯 Created campaign ${docRef.id}: $${targetProfit} from $${capital} in ${deadlineDays} days`);

    // Immediately trigger first scan and deploy
    await this.scanAndDeploy(campaign);

    return campaign;
  }

  /**
   * Calculate urgency level based on how much time is left
   */
  private calculateUrgency(deadline: Date | string): Campaign['urgency'] {
    const deadlineDate = typeof deadline === 'string' ? new Date(deadline) : deadline;
    const hoursLeft = (deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60);

    if (hoursLeft > 72) return 'relaxed';       // More than 3 days
    if (hoursLeft > 24) return 'normal';         // 1-3 days
    if (hoursLeft > 6) return 'urgent';          // 6-24 hours
    return 'critical';                            // Less than 6 hours
  }

  /**
   * Deadline-Aware Strategy Router (Phase 8.5).
   *
   * Less time = quick profit / more time = more profit. Picks which
   * markets to scan, what timeframe to focus on, and how aggressively
   * to lever Kelly sizing based on time-to-deadline.
   *
   * Stock markets are only included when we have a positive signal that
   * US equities are tradable right now (so we don't burn slots on tickers
   * the executor would reject for being out-of-session).
   */
  private resolveStrategy(deadline: Date | string, stockMarketOpen: boolean | null): StrategyProfile {
    const deadlineDate = typeof deadline === 'string' ? new Date(deadline) : deadline;
    const hoursLeft = (deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60);
    const stocksOk = stockMarketOpen === true;

    if (hoursLeft < 6) {
      return {
        bucket: 'scalp',
        markets: ['crypto'],
        regimeTimeframe: '1h',
        kellyMultiplier: 1.3,
        minScore: 55,
        reason: `<6h to deadline (${hoursLeft.toFixed(1)}h) — scalp crypto on 1H, Kelly ×1.3`,
      };
    }
    if (hoursLeft < 24) {
      return {
        bucket: 'day',
        markets: stocksOk ? ['crypto', 'stocks'] : ['crypto'],
        regimeTimeframe: '1h',
        kellyMultiplier: 1.15,
        minScore: 60,
        reason: `<24h (${hoursLeft.toFixed(1)}h) — day-trade crypto${stocksOk ? ' + stocks' : ' (US closed)'}, 1H TF, Kelly ×1.15`,
      };
    }
    if (hoursLeft < 24 * 3) {
      return {
        bucket: 'day',
        markets: stocksOk ? ['crypto', 'stocks'] : ['crypto'],
        regimeTimeframe: '4h',
        kellyMultiplier: 1.0,
        minScore: 65,
        reason: `1-3 days (${(hoursLeft / 24).toFixed(1)}d) — day-trade crypto${stocksOk ? ' + stocks' : ' (US closed)'}, 4H TF, standard Kelly`,
      };
    }
    if (hoursLeft < 24 * 14) {
      return {
        bucket: 'swing',
        markets: stocksOk ? ['crypto', 'stocks', 'commodities'] : ['crypto'],
        regimeTimeframe: '4h',
        kellyMultiplier: 0.9,
        minScore: 65,
        reason: `3-14 days (${(hoursLeft / 24).toFixed(1)}d) — swing diversified${stocksOk ? ' across all classes' : ' (crypto-only while US closed)'}, 4H TF, Kelly ×0.9`,
      };
    }
    return {
      bucket: 'position',
      markets: stocksOk ? ['crypto', 'stocks', 'commodities'] : ['crypto'],
      regimeTimeframe: '1d',
      kellyMultiplier: 0.8,
      minScore: 70,
      reason: `>14 days (${(hoursLeft / 24).toFixed(1)}d) — position trade${stocksOk ? ', all classes' : ' (crypto-only while US closed)'}, 1D TF, Kelly ×0.8`,
    };
  }

  /**
   * Scan market and deploy capital into available slots.
   *
   * Phase 8.5: market selection, timeframe, and Kelly multiplier are now
   * resolved by `resolveStrategy()` from the campaign's remaining deadline.
   */
  async scanAndDeploy(campaign: Campaign): Promise<void> {
    if (campaign.status !== 'active') return;

    // Kill switch — skip deployment while trading is halted. Existing trades
    // continue to be managed by sentry; this only stops NEW exposure.
    const haltState = isHalted();
    if (haltState.halted) {
      console.log(`[CAMPAIGN ${campaign.id}] ⛔ Skipped — trading halted (${haltState.reason || 'manual halt'})`);
      try {
        await this.db.collection('brainActivity').add({
          userId: campaign.userId,
          type: 'kill_switch_triggered',
          timestamp: new Date().toISOString(),
          source: 'campaign_scan',
          campaignId: campaign.id,
          reason: haltState.reason || 'manual halt',
          haltedSince: haltState.since || null,
        });
      } catch {}
      return;
    }

    // Check deadline
    if (new Date(campaign.deadline) <= new Date()) {
      await this.expireCampaign(campaign);
      return;
    }

    // Check if target already reached
    if (campaign.realizedProfit >= campaign.targetProfit) {
      await this.completeCampaign(campaign);
      return;
    }

    // How many slots are available?
    const openSlots = campaign.maxSlots - campaign.activeTradeIds.length;
    if (openSlots <= 0) {
      console.log(`[CAMPAIGN ${campaign.id}] All ${campaign.maxSlots} slots occupied. Waiting for trades to close.`);
      return;
    }

    // Update urgency
    campaign.urgency = this.calculateUrgency(campaign.deadline);

    // Resolve deadline-aware strategy profile. Stock-market clock is gated
    // here so we only burn scan budget on tradable markets.
    const stockOpen = await this.marketScanner.isUSMarketOpen?.(campaign.userId) ?? null;
    const strategy = this.resolveStrategy(campaign.deadline, stockOpen);
    await this.logBrainActivity(campaign.userId, `🧭 STRATEGY: ${strategy.bucket.toUpperCase()} — ${strategy.reason}`);

    // Calculate capital per slot
    const totalAvailable = campaign.availableCapital;
    if (totalAvailable < 10) {
      console.log(`[CAMPAIGN ${campaign.id}] Insufficient capital ($${totalAvailable.toFixed(2)}). Waiting for trades to close.`);
      return;
    }
    const capitalPerSlot = totalAvailable / Math.min(openSlots, 3);

    // Gather candidates across the markets the strategy router selected.
    console.log(`[CAMPAIGN ${campaign.id}] 🔍 Scanning ${strategy.markets.join('+')} for ${openSlots} slots ($${capitalPerSlot.toFixed(0)}/slot)...`);
    const candidates: any[] = [];
    const activeSymbols = new Set(
      campaign.tradeLog.filter(t => t.status === 'open').map(t => t.symbol)
    );

    if (strategy.markets.includes('crypto')) {
      try {
        const cryptoScan = await this.marketScanner.scan();
        for (const opp of (cryptoScan.topOpportunities || [])) {
          if (activeSymbols.has(opp.symbol)) continue;
          if (opp.score < strategy.minScore) continue;
          if (opp.confluence !== 'buy' && opp.confluence !== 'strong_buy') continue;
          candidates.push(opp);
        }
      } catch (err: any) {
        console.error(`[CAMPAIGN ${campaign.id}] Crypto scan failed:`, err.message);
      }
    }

    const needStocks = strategy.markets.includes('stocks') || strategy.markets.includes('commodities');
    if (needStocks) {
      try {
        const stockScan = await this.marketScanner.scanStocks(campaign.userId);
        const wantCommoditiesOnly = strategy.markets.includes('commodities') && !strategy.markets.includes('stocks');
        const COMMODITY_SET = new Set(['GLD', 'SLV', 'USO', 'UNG', 'DBA', 'COPX']);
        for (const opp of (stockScan.allResults || [])) {
          if (activeSymbols.has(opp.symbol)) continue;
          if (opp.score < strategy.minScore) continue;
          if (opp.confluence !== 'buy' && opp.confluence !== 'strong_buy') continue;
          const isCommodity = COMMODITY_SET.has(opp.symbol);
          if (wantCommoditiesOnly && !isCommodity) continue;
          // If only "stocks" requested but not "commodities", drop the ETFs to avoid double-counting.
          if (strategy.markets.includes('stocks') && !strategy.markets.includes('commodities') && isCommodity) continue;
          candidates.push(opp);
        }
      } catch (err: any) {
        console.error(`[CAMPAIGN ${campaign.id}] Stock scan failed:`, err.message);
      }
    }

    // Sort merged candidates by score descending so the best across all
    // selected markets bubbles to the top.
    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));

    if (candidates.length === 0) {
      console.log(`[CAMPAIGN ${campaign.id}] No qualified opportunities (min score: ${strategy.minScore}, markets: ${strategy.markets.join('+')}). Will retry next scan.`);
      campaign.lastScanAt = new Date().toISOString();
      await this.saveCampaign(campaign);
      return;
    }

    // Default-neutral regime fallback for stocks/commodities (Binance-based
    // regime detector doesn't apply to US equities yet).
    const neutralRec = {
      shouldTrade: true,
      positionSizeMultiplier: 1.0,
      stopLossMultiplier: 1.0,
      takeProfitMultiplier: 1.0,
    };

    // Deploy into available slots
    const deployCount = Math.min(openSlots, candidates.length);
    for (let i = 0; i < deployCount; i++) {
      const opp = candidates[i];
      const slotCapital = capitalPerSlot;
      const assetClass = detectAssetClass(opp.symbol);

      try {
        // Regime detection only for crypto (uses Binance candles). For
        // stocks we use neutral defaults until TA goes source-agnostic.
        let regimeName = 'n/a';
        let regimeConfidence = 0.6;
        let rec: any = neutralRec;
        if (assetClass === 'crypto') {
          const regime = await this.regimeDetector.detectRegime(opp.symbol, strategy.regimeTimeframe);
          regimeName = regime.regime;
          regimeConfidence = regime.confidence;
          rec = regime.recommendations;
          if (!rec.shouldTrade) {
            console.log(`[CAMPAIGN ${campaign.id}] ⚠️ Skipping ${opp.symbol} — regime: ${regime.regime} (${rec.reason})`);
            await this.logBrainActivity(campaign.userId,
              `⚠️ REGIME SKIP: ${opp.symbol} is ${regime.regime} — ${rec.reason}`
            );
            continue;
          }
        }

        // Calculate dynamic TP based on remaining target and urgency
        const remainingTarget = campaign.targetProfit - campaign.realizedProfit;
        const slotsInPlay = campaign.activeTradeIds.length + (i + 1);
        const tpPerTrade = remainingTarget / Math.max(slotsInPlay, 2);

        // Get fresh price
        const price = opp.price;
        // Kelly-optimal sizing × strategy multiplier × regime multiplier.
        const kellyResult = await this.kellyCalculator.getOptimalPositionSize(
          campaign.userId,
          campaign.availableCapital,
          opp.symbol,
          regimeConfidence
        );
        const adjustedCapital = Math.min(
          kellyResult.size * rec.positionSizeMultiplier * strategy.kellyMultiplier,
          slotCapital
        );
        const quantity = adjustedCapital / price;
        const takeProfitPrice = price + ((tpPerTrade * rec.takeProfitMultiplier) / quantity);

        // Dynamic stop loss: regime-adjusted + urgency-adjusted
        const baseSl = campaign.urgency === 'critical' ? 0.015 : campaign.urgency === 'urgent' ? 0.02 : 0.025;
        const stopLossPrice = price * (1 - (baseSl * rec.stopLossMultiplier));

        // ─── Phase 6 — R/R floor for campaign trades ───
        // Mirrors the Sentinel check (Phase 3) so campaign deployments can't
        // bypass the 1.5:1 R/R discipline. If the campaign's target-derived
        // TP is too tight against the SL, skip this candidate and try the
        // next one. This is the same math the Sentinel applies to manual
        // swarm runs — campaigns now respect it too.
        const tpDistance = takeProfitPrice - price;
        const slDistance = price - stopLossPrice;
        const realizedRR = slDistance > 0 ? tpDistance / slDistance : 0;
        if (realizedRR < 1.5) {
          console.log(`[CAMPAIGN ${campaign.id}] ⏭ Skipping ${opp.symbol} — R/R ${realizedRR.toFixed(2)}:1 below 1.5:1 floor (TP $${takeProfitPrice.toFixed(4)} vs SL $${stopLossPrice.toFixed(4)})`);
          await this.logBrainActivity(campaign.userId,
            `⏭ R/R SKIP: ${opp.symbol} R/R ${realizedRR.toFixed(2)}:1 — campaign target too small for this SL distance`
          );
          continue;
        }

        // Execute trade — tag the market so tradeExecutor routes the
        // order to the right broker (Alpaca for stocks, ccxt for crypto).
        const result = await this.tradeExecutor.execute({
          userId: campaign.userId,
          symbol: opp.symbol,
          market: assetClass,
          side: 'buy',
          quantity,
          mode: 'sentry',
          isPractice: campaign.isPractice,
          takeProfitPrice,
          stopLossPrice,
          trailingStopDistance: price * 0.01, // 1% trailing stop
          profitTarget: tpPerTrade,
        });

        // Track in campaign
        const campaignTrade: CampaignTrade = {
          tradeId: result.tradeId,
          symbol: opp.symbol,
          side: 'buy',
          entryPrice: result.fillPrice,
          quantity: result.filledQuantity,
          capitalDeployed: slotCapital,
          status: 'open',
          openedAt: new Date().toISOString(),
        };

        campaign.activeTradeIds.push(result.tradeId);
        campaign.tradeLog.push(campaignTrade);
        campaign.availableCapital -= slotCapital;

        // Tag the trade in Firestore with the campaignId so we can link it
        await this.db.collection('trades').doc(result.tradeId).update({
          campaignId: campaign.id,
        });

        await this.logBrainActivity(campaign.userId,
          `🚀 CAMPAIGN TRADE [${strategy.bucket}/${assetClass}]: ${opp.symbol} — $${adjustedCapital.toFixed(0)} deployed (Kelly: ${(kellyResult.fraction * 100).toFixed(1)}% × ${strategy.kellyMultiplier}, regime: ${regimeName}, slot ${campaign.activeTradeIds.length}/${campaign.maxSlots}). TP: $${takeProfitPrice.toFixed(2)} | SL: $${stopLossPrice.toFixed(2)}`
        );

        console.log(`[CAMPAIGN ${campaign.id}] ✅ Deployed $${slotCapital.toFixed(0)} into ${opp.symbol} (${assetClass}) @ $${price}`);

      } catch (err: any) {
        console.error(`[CAMPAIGN ${campaign.id}] Failed to deploy into ${opp.symbol}:`, err.message);
      }
    }

    campaign.lastScanAt = new Date().toISOString();
    campaign.updatedAt = new Date().toISOString();
    await this.saveCampaign(campaign);
  }

  /**
   * Called when a trade closes — check if it belongs to a campaign and handle chaining
   */
  async onTradeClosed(tradeId: string, pnl: number, symbol: string): Promise<void> {
    // Find which campaign this trade belongs to
    let campaign: Campaign | null = null;

    // Check in-memory first
    for (const [, c] of this.activeCampaigns) {
      if (c.activeTradeIds.includes(tradeId)) {
        campaign = c;
        break;
      }
    }

    // If not in memory, check Firestore
    if (!campaign) {
      try {
        const tradeDoc = await this.db.collection('trades').doc(tradeId).get();
        if (tradeDoc.exists && tradeDoc.data()?.campaignId) {
          const campDoc = await this.db.collection('campaigns').doc(tradeDoc.data().campaignId).get();
          if (campDoc.exists) {
            campaign = { id: campDoc.id, ...campDoc.data() } as Campaign;
            this.activeCampaigns.set(campDoc.id, campaign);
          }
        }
      } catch {}
    }

    if (!campaign || campaign.status !== 'active') return;

    // Update trade log
    const trade = campaign.tradeLog.find(t => t.tradeId === tradeId);
    if (trade) {
      trade.status = 'closed';
      trade.pnl = pnl;
      trade.closedAt = new Date().toISOString();
      trade.exitPrice = trade.entryPrice + (pnl / trade.quantity);
    }

    // Move trade from active to completed
    campaign.activeTradeIds = campaign.activeTradeIds.filter(id => id !== tradeId);
    campaign.completedTradeIds.push(tradeId);

    // Update financials — compound profits back into available capital
    campaign.realizedProfit += pnl;
    const capitalReturned = (trade?.capitalDeployed || 0) + pnl;
    campaign.availableCapital += Math.max(0, capitalReturned);

    const progressPct = ((campaign.realizedProfit / campaign.targetProfit) * 100).toFixed(1);
    const pnlEmoji = pnl >= 0 ? '✅' : '❌';

    await this.logBrainActivity(campaign.userId,
      `${pnlEmoji} CAMPAIGN TRADE CLOSED: ${symbol} → $${pnl.toFixed(2)} | Progress: ${progressPct}% of $${campaign.targetProfit} target | Capital: $${campaign.availableCapital.toFixed(0)} available`
    );

    // Send Telegram update
    try {
      await sendTelegramNotification(this.db, campaign.userId,
        `${pnlEmoji} <b>Campaign Update</b>\n\n${symbol}: $${pnl.toFixed(2)}\nProgress: ${progressPct}% of $${campaign.targetProfit}\nOpen trades: ${campaign.activeTradeIds.length}/${campaign.maxSlots}\nCapital available: $${campaign.availableCapital.toFixed(0)}`
      );
    } catch {}

    // Check if target reached
    if (campaign.realizedProfit >= campaign.targetProfit) {
      await this.completeCampaign(campaign);
      return;
    }

    // Check if deadline expired
    if (new Date(campaign.deadline) <= new Date()) {
      await this.expireCampaign(campaign);
      return;
    }

    // Chain: scan for next opportunity and deploy available capital
    console.log(`[CAMPAIGN ${campaign.id}] 🔄 Trade closed. Chaining → scanning for next deployment...`);
    await this.saveCampaign(campaign);
    await this.scanAndDeploy(campaign);
  }

  /**
   * Campaign monitoring loop — called every N minutes from server.ts
   */
  async monitor(): Promise<void> {
    // Load active campaigns from Firestore
    try {
      let query = this.db.collection('campaigns').where('status', '==', 'active');
      if (this.ownerId) query = query.where('userId', '==', this.ownerId);
      const snapshot = await query.get();

      for (const doc of snapshot.docs) {
        const campaign = { id: doc.id, ...doc.data() } as Campaign;
        this.activeCampaigns.set(doc.id, campaign);

        // Check deadline
        if (new Date(campaign.deadline) <= new Date()) {
          await this.expireCampaign(campaign);
          continue;
        }

        // Check if it's time to scan for new trades
        const lastScan = campaign.lastScanAt ? new Date(campaign.lastScanAt).getTime() : 0;
        const now = Date.now();
        const scanInterval = campaign.scanIntervalMinutes * 60 * 1000;

        if (now - lastScan >= scanInterval) {
          // Update unrealized PnL from active trades
          await this.updateUnrealizedPnl(campaign);

          // Check if target reached including unrealized
          if (campaign.realizedProfit >= campaign.targetProfit) {
            await this.completeCampaign(campaign);
            continue;
          }

          // Scan and deploy into empty slots
          await this.scanAndDeploy(campaign);
        }
      }
    } catch (err: any) {
      console.error('[CAMPAIGN] Monitor error:', err.message);
    }
  }

  /**
   * Update unrealized PnL from market state
   */
  private async updateUnrealizedPnl(campaign: Campaign): Promise<void> {
    let totalUnrealized = 0;

    for (const trade of campaign.tradeLog.filter(t => t.status === 'open')) {
      const currentPrice = this.marketState[trade.symbol]?.price || trade.entryPrice;
      const pnl = (currentPrice - trade.entryPrice) * trade.quantity;
      totalUnrealized += pnl;
    }

    campaign.unrealizedProfit = totalUnrealized;
  }

  /**
   * Mark campaign as completed (target reached!)
   */
  private async completeCampaign(campaign: Campaign): Promise<void> {
    campaign.status = 'completed';
    campaign.completedAt = new Date().toISOString();
    campaign.updatedAt = new Date().toISOString();

    await this.saveCampaign(campaign);
    this.activeCampaigns.delete(campaign.id!);

    const totalTrades = campaign.completedTradeIds.length;
    const winTrades = campaign.tradeLog.filter(t => t.status === 'closed' && (t.pnl || 0) > 0).length;

    await this.logBrainActivity(campaign.userId,
      `🏆 CAMPAIGN COMPLETED! Target $${campaign.targetProfit} reached! Final P&L: $${campaign.realizedProfit.toFixed(2)} | ${totalTrades} trades (${winTrades} wins) | Started with $${campaign.startingCapital}`
    );

    try {
      await sendTelegramNotification(this.db, campaign.userId,
        `🏆 <b>CAMPAIGN COMPLETE!</b>\n\nTarget: $${campaign.targetProfit} ✅\nFinal P&L: $${campaign.realizedProfit.toFixed(2)}\nTrades: ${totalTrades} (${winTrades} wins)\nDuration: ${this.formatDuration(campaign.createdAt, campaign.completedAt)}`
      );
    } catch {}

    console.log(`[CAMPAIGN ${campaign.id}] 🏆 COMPLETED! $${campaign.realizedProfit.toFixed(2)} profit from $${campaign.startingCapital}`);
  }

  /**
   * Mark campaign as expired (deadline passed)
   */
  private async expireCampaign(campaign: Campaign): Promise<void> {
    campaign.status = 'expired';
    campaign.updatedAt = new Date().toISOString();

    await this.saveCampaign(campaign);
    this.activeCampaigns.delete(campaign.id!);

    const progressPct = ((campaign.realizedProfit / campaign.targetProfit) * 100).toFixed(1);

    await this.logBrainActivity(campaign.userId,
      `⏰ CAMPAIGN EXPIRED: Deadline reached. Progress: ${progressPct}% ($${campaign.realizedProfit.toFixed(2)} of $${campaign.targetProfit}). ${campaign.activeTradeIds.length} trades still open.`
    );

    try {
      await sendTelegramNotification(this.db, campaign.userId,
        `⏰ <b>Campaign Expired</b>\n\nProgress: ${progressPct}%\nRealized: $${campaign.realizedProfit.toFixed(2)}\nTarget was: $${campaign.targetProfit}\nOpen trades: ${campaign.activeTradeIds.length} (still monitored by Sentry)`
      );
    } catch {}

    console.log(`[CAMPAIGN ${campaign.id}] ⏰ Expired. Progress: ${progressPct}%`);
  }

  /**
   * Get campaign status
   */
  async getCampaign(campaignId: string): Promise<Campaign | null> {
    try {
      const doc = await this.db.collection('campaigns').doc(campaignId).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() } as Campaign;
    } catch {
      return null;
    }
  }

  /**
   * Get all campaigns for a user
   */
  async getUserCampaigns(userId: string): Promise<Campaign[]> {
    try {
      // Query without orderBy to avoid needing composite index (userId, createdAt)
      // — sort client-side instead. Previously this used orderBy and silently
      // returned empty when the index hadn't been deployed.
      const snapshot = await this.db.collection('campaigns')
        .where('userId', '==', userId)
        .get();
      const all = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      all.sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return all.slice(0, 20);
    } catch {
      return [];
    }
  }

  /**
   * Pause a campaign
   */
  async pauseCampaign(campaignId: string): Promise<void> {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) return;
    campaign.status = 'paused';
    campaign.updatedAt = new Date().toISOString();
    await this.saveCampaign(campaign);
    this.activeCampaigns.delete(campaignId);
    console.log(`[CAMPAIGN ${campaignId}] ⏸️ Paused`);
  }

  /**
   * Resume a paused campaign
   */
  async resumeCampaign(campaignId: string): Promise<void> {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign || campaign.status !== 'paused') return;
    campaign.status = 'active';
    campaign.updatedAt = new Date().toISOString();
    await this.saveCampaign(campaign);
    this.activeCampaigns.set(campaignId, campaign);
    await this.scanAndDeploy(campaign);
    console.log(`[CAMPAIGN ${campaignId}] ▶️ Resumed`);
  }

  /**
   * Cancel a campaign — force-closes every open position attached to it
   * and marks the campaign as 'cancelled'. Unlike pause (which only stops
   * new deployment), cancel actually frees the capital by closing positions
   * through the executor (which respects Practice vs Live routing).
   *
   * Returns a summary with per-trade close results so the caller can
   * report success/failure to the UI.
   */
  async cancelCampaign(campaignId: string): Promise<{ closed: number; failed: number; pnlReleased: number; errors: string[] }> {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
    if (campaign.status === 'cancelled' || campaign.status === 'completed' || campaign.status === 'expired') {
      // Idempotent for already-terminal campaigns — nothing to close.
      return { closed: 0, failed: 0, pnlReleased: 0, errors: [] };
    }

    const tradeIds = [...(campaign.activeTradeIds || [])];
    let closed = 0;
    let failed = 0;
    let pnlReleased = 0;
    const errors: string[] = [];

    for (const tradeId of tradeIds) {
      try {
        const result = await this.tradeExecutor.closePosition(campaign.userId, tradeId);
        closed += 1;
        pnlReleased += Number(result?.realizedPnl ?? 0);
      } catch (err: any) {
        failed += 1;
        const msg = `${tradeId}: ${err?.message || 'unknown error'}`;
        errors.push(msg);
        console.error(`[CAMPAIGN ${campaignId}] Failed to close ${tradeId} during cancel:`, err?.message);
      }
    }

    // Reload campaign — tradeExecutor.closePosition already updated each
    // trade doc + portfolio balance via onTradeClosed pathway. Refresh
    // local state before persisting the cancelled marker.
    const refreshed = await this.getCampaign(campaignId);
    const finalCampaign = refreshed || campaign;
    finalCampaign.status = 'cancelled';
    finalCampaign.updatedAt = new Date().toISOString();
    (finalCampaign as any).cancelledAt = new Date().toISOString();
    await this.saveCampaign(finalCampaign);
    this.activeCampaigns.delete(campaignId);

    await this.logBrainActivity(campaign.userId,
      `🛑 CAMPAIGN CANCELLED: ${closed} position${closed === 1 ? '' : 's'} closed, $${pnlReleased.toFixed(2)} P&L realized${failed ? `, ${failed} close failure(s)` : ''}`
    );

    console.log(`[CAMPAIGN ${campaignId}] 🛑 Cancelled — closed ${closed}/${tradeIds.length} positions (failed ${failed})`);
    return { closed, failed, pnlReleased, errors };
  }

  /**
   * Save campaign to Firestore
   */
  private async saveCampaign(campaign: Campaign): Promise<void> {
    if (!campaign.id) return;
    const { id, ...data } = campaign;
    await this.db.collection('campaigns').doc(id).set(data, { merge: true });
  }

  /**
   * Log to brainActivity collection
   */
  private async logBrainActivity(userId: string, message: string): Promise<void> {
    try {
      await this.db.collection('brainActivity').add({
        agent: 'CampaignManager',
        message,
        type: 'action',
        userId,
        timestamp: new Date().toISOString(),
      });
    } catch {}
  }

  /**
   * Format duration between two ISO dates
   */
  private formatDuration(start: string, end?: string): string {
    const ms = (new Date(end || Date.now()).getTime()) - new Date(start).getTime();
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (days > 0) return `${days}d ${remainingHours}h`;
    return `${hours}h`;
  }
}
