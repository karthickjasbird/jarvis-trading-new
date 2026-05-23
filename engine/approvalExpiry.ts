/**
 * ApprovalExpiry — auto-expires stale pending trade approvals.
 *
 * Two triggers, either one expires a proposal:
 *   - Age: pending for longer than `approvalTtlMinutes`
 *   - Drift: current mark price diverged from `entryPrice` by more than
 *     `approvalMaxDriftPercent`
 *
 * Both thresholds live on the user's `riskSettings` doc. Defaults are
 * 5 minutes and 0.5%. Expired proposals get `status: 'expired'` + a
 * `brainActivity` log entry explaining why so the user can see the queue
 * cleared instead of mysteriously emptying.
 *
 * Runs on a 30s cadence — frequent enough to catch a 5-min TTL with
 * <10% over-stay, infrequent enough to be cheap.
 */

import { AlpacaConnector, detectAssetClass } from './alpacaConnector.ts';

interface ExpirySettings {
  approvalTtlMinutes: number;
  approvalMaxDriftPercent: number;
}

const DEFAULT_TTL_MINUTES = 5;
const DEFAULT_MAX_DRIFT_PCT = 0.5;

export class ApprovalExpiry {
  private db: any;
  private marketState: any;
  private ownerId?: string;
  private alpacaQuoteCache: Map<string, { price: number; at: number }> = new Map();

  constructor(db: any, marketState: any, ownerId?: string) {
    this.db = db;
    this.marketState = marketState;
    this.ownerId = ownerId;
  }

  /**
   * Sweep all pending approvals for the configured owner and expire any
   * that exceed the time or drift thresholds. Safe to call repeatedly —
   * already-expired/approved trades are skipped by the status filter.
   */
  async sweep(): Promise<void> {
    if (!this.ownerId) return; // No owner set yet — nothing to scope to.

    let settings: ExpirySettings;
    try {
      const doc = await this.db.collection('riskSettings').doc(this.ownerId).get();
      const data: any = doc.exists ? (doc.data() || {}) : {};
      settings = {
        approvalTtlMinutes: data.approvalTtlMinutes ?? DEFAULT_TTL_MINUTES,
        approvalMaxDriftPercent: data.approvalMaxDriftPercent ?? DEFAULT_MAX_DRIFT_PCT,
      };
    } catch {
      settings = { approvalTtlMinutes: DEFAULT_TTL_MINUTES, approvalMaxDriftPercent: DEFAULT_MAX_DRIFT_PCT };
    }

    let snapshot;
    try {
      snapshot = await this.db.collection('trades')
        .where('userId', '==', this.ownerId)
        .where('status', '==', 'pending')
        .get();
    } catch (err: any) {
      console.error('[APPROVAL-EXPIRY] Failed to query pending trades:', err.message);
      return;
    }

    if (snapshot.empty) return;
    // Heartbeat only when there's something to evaluate. Keeps the log
    // quiet at idle while still surfacing each non-empty sweep.
    console.log(`[APPROVAL-EXPIRY] sweep tick — ${snapshot.size} pending (TTL ${settings.approvalTtlMinutes}min, drift ${settings.approvalMaxDriftPercent}%)`);

    const ttlMs = settings.approvalTtlMinutes * 60 * 1000;
    const maxDrift = settings.approvalMaxDriftPercent / 100;
    const now = Date.now();

    for (const doc of snapshot.docs) {
      const trade: any = doc.data();
      try {
        const createdAtMs = new Date(trade.createdAt || 0).getTime();
        const ageMs = now - createdAtMs;
        const ageMin = ageMs / 60000;

        let expireReason: string | null = null;

        // Time check first — cheap and definitive.
        if (ageMs > ttlMs) {
          expireReason = `age ${ageMin.toFixed(1)}min > TTL ${settings.approvalTtlMinutes}min`;
        }

        // Drift check — only when we can get a price. Skip silently on
        // failure rather than holding the trade hostage to a flaky lookup.
        if (!expireReason && trade.entryPrice) {
          const currentPrice = await this.fetchCurrentPrice(trade.symbol, trade.market);
          if (currentPrice !== null) {
            const driftAbs = Math.abs(currentPrice - trade.entryPrice) / trade.entryPrice;
            if (driftAbs > maxDrift) {
              const direction = currentPrice > trade.entryPrice ? 'up' : 'down';
              expireReason = `price drifted ${(driftAbs * 100).toFixed(2)}% ${direction} (proposed $${trade.entryPrice}, now $${currentPrice}) > max ${settings.approvalMaxDriftPercent}%`;
            }
          }
        }

        if (!expireReason) continue;

        await doc.ref.update({
          status: 'expired',
          expiredAt: new Date().toISOString(),
          expiryReason: expireReason,
        });

        await this.db.collection('brainActivity').add({
          agent: 'executor',
          message: `⌛ APPROVAL EXPIRED: ${(trade.side || '').toUpperCase()} ${trade.symbol} @ $${trade.entryPrice} — ${expireReason}`,
          type: 'action',
          userId: this.ownerId,
          timestamp: new Date().toISOString(),
        });

        console.log(`[APPROVAL-EXPIRY] ⌛ Expired ${trade.symbol} (${doc.id}): ${expireReason}`);
      } catch (err: any) {
        console.error(`[APPROVAL-EXPIRY] Error processing pending trade ${doc.id}:`, err.message);
      }
    }
  }

  /**
   * Best-effort current-price lookup. Crypto reads from the in-memory WS
   * mirror; stocks/ETFs use a 30s-cached Alpaca latest-trade fetch.
   * Returns null when nothing is available — caller skips drift check.
   */
  private async fetchCurrentPrice(symbol: string, market?: string): Promise<number | null> {
    const assetClass = market === 'stock' || market === 'crypto' ? market : detectAssetClass(symbol);

    if (assetClass === 'crypto') {
      const px = this.marketState?.[symbol]?.price;
      return typeof px === 'number' && isFinite(px) ? px : null;
    }

    // Stocks/ETFs — short-cached Alpaca call. Cache lives ~30s which is
    // shorter than the sweep cadence so each pending stock costs at most
    // one Alpaca request per sweep cycle even with many pending.
    const cached = this.alpacaQuoteCache.get(symbol);
    if (cached && Date.now() - cached.at < 30 * 1000) return cached.price;

    let apiKeyId = '';
    let secretKey = '';
    try {
      const doc = await this.db.collection('users').doc(this.ownerId)
        .collection('secrets').doc('apiKeys').get();
      if (doc.exists) {
        const data: any = doc.data() || {};
        apiKeyId = data.alpacaApiKeyId || '';
        secretKey = data.alpacaSecretKey || '';
      }
    } catch {}
    apiKeyId = apiKeyId || process.env.ALPACA_API_KEY_ID || '';
    secretKey = secretKey || process.env.ALPACA_SECRET_KEY || '';
    if (!apiKeyId || !secretKey) return null;

    try {
      const alpaca = new AlpacaConnector({ apiKeyId, secretKey, paper: true });
      const quote = await alpaca.getQuote(symbol);
      this.alpacaQuoteCache.set(symbol, { price: quote.price, at: Date.now() });
      return quote.price;
    } catch {
      return null;
    }
  }
}
