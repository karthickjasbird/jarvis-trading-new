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

export interface Campaign {
  id?: string;
  userId: string;
  goalId?: string;
  targetProfit: number;       // Total profit target in USD
  startingCapital: number;    // Initial capital deployed
  availableCapital: number;   // Current uninvested capital
  realizedProfit: number;     // Profit from closed trades
  unrealizedProfit: number;   // Profit from open trades (updated on each tick)
  status: 'active' | 'paused' | 'completed' | 'expired' | 'failed';
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
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + deadlineDays);

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
   * Scan market and deploy capital into available slots
   */
  async scanAndDeploy(campaign: Campaign): Promise<void> {
    if (campaign.status !== 'active') return;

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

    // Calculate capital per slot
    const totalAvailable = campaign.availableCapital;
    if (totalAvailable < 10) {
      console.log(`[CAMPAIGN ${campaign.id}] Insufficient capital ($${totalAvailable.toFixed(2)}). Waiting for trades to close.`);
      return;
    }
    const capitalPerSlot = totalAvailable / Math.min(openSlots, 3);

    // Scan market
    console.log(`[CAMPAIGN ${campaign.id}] 🔍 Scanning for ${openSlots} trade slots ($${capitalPerSlot.toFixed(0)}/slot)...`);
    const scanResult = await this.marketScanner.scan();

    // Filter for bullish opportunities with decent scores
    const minScore = campaign.urgency === 'critical' ? 55 : campaign.urgency === 'urgent' ? 60 : 65;
    const candidates = scanResult.topOpportunities.filter(
      (opp: any) => (opp.confluence === 'buy' || opp.confluence === 'strong_buy' || opp.score >= minScore)
        && !campaign.activeTradeIds.some((id: string) => {
          const activeTrade = campaign.tradeLog.find(t => t.tradeId === id);
          return activeTrade && activeTrade.symbol === opp.symbol;
        })
    );

    if (candidates.length === 0) {
      console.log(`[CAMPAIGN ${campaign.id}] No qualified opportunities (min score: ${minScore}). Will retry next scan.`);
      campaign.lastScanAt = new Date().toISOString();
      await this.saveCampaign(campaign);
      return;
    }

    // Deploy into available slots
    const deployCount = Math.min(openSlots, candidates.length);
    for (let i = 0; i < deployCount; i++) {
      const opp = candidates[i];
      const slotCapital = capitalPerSlot;

      try {
        // Detect regime for this specific coin before deploying
        const regime = await this.regimeDetector.detectRegime(opp.symbol, '4h');
        const rec = regime.recommendations;

        // Skip if regime says don't trade
        if (!rec.shouldTrade) {
          console.log(`[CAMPAIGN ${campaign.id}] ⚠️ Skipping ${opp.symbol} — regime: ${regime.regime} (${rec.reason})`);
          await this.logBrainActivity(campaign.userId,
            `⚠️ REGIME SKIP: ${opp.symbol} is ${regime.regime} — ${rec.reason}`
          );
          continue;
        }

        // Calculate dynamic TP based on remaining target and urgency
        const remainingTarget = campaign.targetProfit - campaign.realizedProfit;
        const slotsInPlay = campaign.activeTradeIds.length + (i + 1);
        const tpPerTrade = remainingTarget / Math.max(slotsInPlay, 2);

        // Get fresh price
        const price = opp.price;
        // Use Kelly-optimal position sizing instead of equal splitting
        const kellyResult = await this.kellyCalculator.getOptimalPositionSize(
          campaign.userId,
          campaign.remainingCapital,
          opp.symbol,
          regime.confidence
        );
        // Apply regime multiplier on top of Kelly sizing
        const adjustedCapital = Math.min(kellyResult.size * rec.positionSizeMultiplier, slotCapital);
        const quantity = adjustedCapital / price;
        const takeProfitPrice = price + ((tpPerTrade * rec.takeProfitMultiplier) / quantity);
        
        // Dynamic stop loss: regime-adjusted + urgency-adjusted
        const baseSl = campaign.urgency === 'critical' ? 0.015 : campaign.urgency === 'urgent' ? 0.02 : 0.025;
        const stopLossPrice = price * (1 - (baseSl * rec.stopLossMultiplier));

        // Execute trade
        const result = await this.tradeExecutor.execute({
          userId: campaign.userId,
          symbol: opp.symbol,
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
          `🚀 CAMPAIGN TRADE: ${opp.symbol} — $${adjustedCapital.toFixed(0)} deployed (Kelly: ${(kellyResult.fraction * 100).toFixed(1)}%, regime: ${regime.regime}, slot ${campaign.activeTradeIds.length}/${campaign.maxSlots}). TP: $${takeProfitPrice.toFixed(2)} | SL: $${stopLossPrice.toFixed(2)}`
        );

        console.log(`[CAMPAIGN ${campaign.id}] ✅ Deployed $${slotCapital.toFixed(0)} into ${opp.symbol} @ $${price}`);

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
      const snapshot = await this.db.collection('campaigns')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();
      return snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
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
