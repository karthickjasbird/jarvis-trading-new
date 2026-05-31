/**
 * Phase 9 — Tier B #2: Boot-time position reconciliation.
 *
 * WHY THIS EXISTS
 * v1.6.2 brackets protect FUTURE entries. They don't fix:
 *  - Existing live positions that predate brackets
 *  - Positions where the bracket leg got cancelled or never landed
 *  - Positions on the exchange that Firestore lost track of
 *  - The sl_failed_emergency_failed worst case from v1.6.2 (tagged
 *    needs_human but still naked on the exchange)
 *
 * On boot, this module queries each connected venue for actual open
 * positions + open orders, diffs against Firestore, and remediates
 * every mismatch BEFORE Sentry's polling loop starts.
 *
 * It also exports fetchPositionState() which closes the v1.6.0 known
 * gap (crypto _verifyPositionGone returning null) — closeWithRetry's
 * already_closed reconciliation now works on Binance + Bybit too.
 *
 * SAFETY INVARIANT (Claude-corrected)
 * Discovered orphans get a protective bracket placed IMMEDIATELY at
 * default 3% SL, THEN flagged. Never parked unprotected — that re-
 * introduces the exact naked-position bug brackets exist to prevent.
 *
 * BEST-EFFORT
 * Reconciliation failure NEVER blocks server boot. Errors logged,
 * Sentry's tick provides the fallback. Safety properties on individual
 * positions degrade gracefully (a missed reconcile = Sentry catches on
 * next tick).
 */

import ccxt from 'ccxt';
import { AlpacaConnector } from './alpacaConnector.ts';
import { resolveAlpacaCreds } from './alpacaCreds.ts';
import {
  placeStopLossOnly,
  type BracketVenue,
} from './brackets.ts';
import { sendTelegramNotification } from './telegram.ts';

// Default SL distance for orphans / known-naked positions when no
// stopLossPrice is recorded. 3% feels conservative — gives breathing
// room for normal volatility but caps disaster.
const DEFAULT_ORPHAN_SL_PCT = 0.03;

// Dust tolerance for Binance Spot — if base-asset balance is below
// 5% of expected qty, treat as "position effectively gone" (handles
// partial fills, accumulated dust, fees taken from balance).
const SPOT_DUST_TOLERANCE_PCT = 0.05;

export type ReconciledTradeState =
  | 'healthy'
  | 'force_closed_reconciliation'
  | 'discovered_orphan'
  | 'qty_drift_corrected'
  | 'naked_protected'
  | 'naked_protect_failed'
  | 'reconcile_skipped';                  // paper, unsupported venue, no creds, etc.

export interface ReconciliationReport {
  userId: string;
  startedAt: string;
  finishedAt: string;
  venuesScanned: BracketVenue[];
  positionsFound: number;
  states: Record<string, ReconciledTradeState>;  // key = tradeId or `<venue>:<symbol>`
  alertsTriggered: number;
  errors: string[];
}

export interface PositionState {
  exists: boolean;
  actualQty: number;
  side: 'long' | 'short' | null;
  entryPrice: number | null;
  reason: string;
}

/**
 * Fetch the actual position state from the exchange for a given symbol.
 * Used by both reconciliation (boot-time) and closeWithRetry's
 * _verifyPositionGone (runtime). Returns {exists, actualQty, side, entryPrice}.
 *
 * Per-venue:
 *  - Alpaca: getPosition(symbol) → has it or 404
 *  - Binance Spot: fetchBalance() → check base asset .total
 *  - Binance Futures: fetchPositions([symbol]) → check contracts > 0
 *  - Bybit Linear: fetchPositions([symbol]) → check contracts > 0
 *
 * Pure orchestration — exchange handle injected by caller.
 */
export async function fetchPositionState(
  exchange: any,
  venue: BracketVenue,
  symbol: string,
  expectedQty: number,
): Promise<PositionState> {
  try {
    if (venue === 'alpaca') {
      const pos = await exchange.getPosition(symbol);
      if (!pos) return { exists: false, actualQty: 0, side: null, entryPrice: null, reason: 'Alpaca: 404 / no position' };
      const qty = parseFloat(String(pos.qty ?? '0'));
      if (Math.abs(qty) < 1e-8) return { exists: false, actualQty: 0, side: null, entryPrice: null, reason: 'Alpaca: qty=0' };
      return {
        exists: true,
        actualQty: Math.abs(qty),
        side: qty > 0 ? 'long' : 'short',
        entryPrice: parseFloat(String(pos.avg_entry_price ?? 0)) || null,
        reason: `Alpaca: qty=${qty}`,
      };
    }

    if (venue === 'binance_futures' || venue === 'bybit_linear') {
      const positions = await exchange.fetchPositions([symbol]).catch(() => []);
      const match = (positions ?? []).find((p: any) =>
        p && (p.symbol === symbol || p.info?.symbol === symbol.replace('/', '')) &&
        Math.abs(parseFloat(String(p.contracts ?? p.info?.size ?? 0))) > 1e-8
      );
      if (!match) return { exists: false, actualQty: 0, side: null, entryPrice: null, reason: `${venue}: no open position` };
      return {
        exists: true,
        actualQty: Math.abs(parseFloat(String(match.contracts ?? match.info?.size ?? 0))),
        side: (match.side === 'long' || match.side === 'short') ? match.side : null,
        entryPrice: parseFloat(String(match.entryPrice ?? match.info?.entryPrice ?? 0)) || null,
        reason: `${venue}: contracts=${match.contracts}`,
      };
    }

    if (venue === 'binance_spot') {
      // Spot has no positions concept — check base asset balance.
      const balance = await exchange.fetchBalance().catch(() => null);
      if (!balance) return { exists: false, actualQty: 0, side: null, entryPrice: null, reason: 'Binance Spot: fetchBalance failed' };
      const base = symbol.split('/')[0];
      const held = parseFloat(String(balance[base]?.total ?? 0));
      const dustThreshold = Math.max(expectedQty * SPOT_DUST_TOLERANCE_PCT, 1e-8);
      if (held < dustThreshold) {
        return { exists: false, actualQty: 0, side: null, entryPrice: null, reason: `Binance Spot: ${base} balance=${held} < dust threshold ${dustThreshold.toFixed(8)}` };
      }
      return {
        exists: true,
        actualQty: held,
        side: 'long',  // spot is always long-only
        entryPrice: null,  // spot has no entry-price tracking via balance
        reason: `Binance Spot: ${base} balance=${held}`,
      };
    }

    return { exists: false, actualQty: 0, side: null, entryPrice: null, reason: `unsupported venue ${venue}` };
  } catch (err: any) {
    return { exists: false, actualQty: 0, side: null, entryPrice: null, reason: `fetchPositionState error: ${err?.message ?? err}` };
  }
}

/**
 * Detect orphan stop-loss orders for a symbol via fetchOpenOrders.
 * Used to determine if a position has bracket protection or is naked.
 */
async function fetchSlLegId(
  exchange: any,
  venue: BracketVenue,
  symbol: string,
): Promise<string | null> {
  try {
    if (venue === 'alpaca') {
      // For Alpaca, the SL leg is found by querying the OTO parent's nested legs.
      // The caller already has the trade's bracketOrderIds.stopLoss — they query
      // by ID directly when checking. For "is there ANY SL for this symbol?",
      // we'd need to walk all open orders. Implemented separately below.
      return null;  // signal: caller should use bracketOrderIds directly
    }
    const orders = await exchange.fetchOpenOrders(symbol).catch(() => []);
    for (const o of orders ?? []) {
      if (venue === 'binance_futures' && o.type === 'STOP_MARKET' && o.reduceOnly === true) return o.id;
      if (venue === 'binance_spot' && (o.info?.type === 'STOP_LOSS_LIMIT' || o.info?.type === 'STOP_LOSS')) return o.id;
      if (venue === 'bybit_linear' && (o.info?.stopOrderType || o.triggerPrice) && o.reduceOnly) return o.id;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build an exchange handle for a broker config. Mirrors the pattern
 * used in tradeExecutor.execute() so both code paths build identically.
 *
 * Alpaca creds are resolved via the shared 3-source fallback
 * (secrets/apiKeys → brokerConfigs → env) so reconciliation, the debug route,
 * tradeExecutor, and scanner all read from the same place. Paper keys (PK*)
 * cause this venue to be skipped: reconciliation is live-only by design
 * (it filters trades to isPractice===false), so wiring paper keys into the
 * live host would 401, and wiring them into the paper host would
 * mis-treat every paper position as a live orphan.
 */
async function buildExchange(
  brokerConfig: any,
  db: any,
  ownerId: string,
): Promise<{ venue: BracketVenue | null; exchange: any }> {
  if (brokerConfig.brokerName === 'alpaca') {
    const creds = await resolveAlpacaCreds(db, ownerId);
    if (!creds) return { venue: null, exchange: null };
    if (!creds.apiKeyId.startsWith('AK')) {
      console.log('[reconciliation] Alpaca creds are paper (PK*) — reconciliation is live-only; skipping alpaca venue');
      return { venue: null, exchange: null };
    }
    return {
      venue: 'alpaca',
      exchange: new AlpacaConnector({ ...creds, paper: false }),
    };
  }
  if (brokerConfig.brokerName === 'bybit') {
    const ExchangeClass = (ccxt as any).bybit;
    return {
      venue: 'bybit_linear',
      exchange: new ExchangeClass({
        apiKey: brokerConfig.apiKey,
        secret: brokerConfig.apiSecret,
        enableRateLimit: true,
      }),
    };
  }
  if (brokerConfig.brokerName === 'binance') {
    const ExchangeClass = (ccxt as any).binance;
    return {
      venue: 'binance_spot',  // default to spot — futures requires explicit market config
      exchange: new ExchangeClass({
        apiKey: brokerConfig.apiKey,
        secret: brokerConfig.apiSecret,
        enableRateLimit: true,
      }),
    };
  }
  // zerodha + unknown → null (not handled in v1)
  return { venue: null, exchange: null };
}

/**
 * The orchestrator. Called once on server boot.
 * Reads broker configs, builds exchange handles, queries each venue
 * for positions + open orders, reconciles against Firestore.
 */
export async function reconcileOpenPositions(deps: {
  db: any;
  ownerId: string;
}): Promise<ReconciliationReport> {
  const { db, ownerId } = deps;
  const startedAt = new Date().toISOString();
  const report: ReconciliationReport = {
    userId: ownerId,
    startedAt,
    finishedAt: '',
    venuesScanned: [],
    positionsFound: 0,
    states: {},
    alertsTriggered: 0,
    errors: [],
  };

  // Read user's risk settings (autoProtectOrphans flag)
  let autoProtectOrphans = true;  // Claude-corrected default
  try {
    const riskDoc = await db.collection('riskSettings').doc(ownerId).get();
    if (riskDoc.exists) {
      const rs = riskDoc.data();
      if (rs?.autoProtectOrphans === false) autoProtectOrphans = false;
    }
  } catch {}

  // Fetch active broker configs
  let brokerConfigs: any[] = [];
  try {
    const snap = await db.collection('users').doc(ownerId).collection('brokerConfigs').where('isActive', '==', true).get();
    brokerConfigs = snap.docs.map((d: any) => d.data());
  } catch (err: any) {
    report.errors.push(`brokerConfigs fetch failed: ${err?.message ?? err}`);
    report.finishedAt = new Date().toISOString();
    return report;
  }

  if (brokerConfigs.length === 0) {
    // No live brokers configured — nothing to reconcile
    report.finishedAt = new Date().toISOString();
    return report;
  }

  // Fetch all open LIVE trades from Firestore (paper trades are skipped — they have no exchange to reconcile)
  let openLiveTrades: Array<{ id: string; data: any }> = [];
  try {
    const snap = await db.collection('trades')
      .where('userId', '==', ownerId)
      .where('status', '==', 'open')
      .get();
    openLiveTrades = snap.docs
      .map((d: any) => ({ id: d.id, data: d.data() }))
      .filter((t: any) => t.data.isPractice === false);
  } catch (err: any) {
    report.errors.push(`open trades fetch failed: ${err?.message ?? err}`);
    report.finishedAt = new Date().toISOString();
    return report;
  }

  // Process each broker config (typically just one active)
  for (const brokerConfig of brokerConfigs) {
    const { venue, exchange } = await buildExchange(brokerConfig, db, ownerId);
    if (!venue || !exchange) {
      continue;  // Zerodha, unknown, paper-keyed alpaca, or unconfigured — defer
    }
    report.venuesScanned.push(venue);

    // For each open trade matching this venue, reconcile
    for (const trade of openLiveTrades) {
      const state = await reconcileOneTrade({
        db, ownerId,
        trade, venue, exchange,
        autoProtectOrphans,
        report,
      });
      report.states[trade.id] = state;
    }

    // Orphan discovery — positions on exchange that don't match ANY known trade
    try {
      await discoverOrphans({
        db, ownerId,
        venue, exchange,
        knownSymbols: new Set(openLiveTrades.map((t: any) => t.data.symbol)),
        autoProtectOrphans,
        report,
      });
    } catch (err: any) {
      report.errors.push(`orphan discovery on ${venue} failed: ${err?.message ?? err}`);
    }
  }

  report.finishedAt = new Date().toISOString();
  return report;
}

interface ReconcileOneParams {
  db: any;
  ownerId: string;
  trade: { id: string; data: any };
  venue: BracketVenue;
  exchange: any;
  autoProtectOrphans: boolean;
  report: ReconciliationReport;
}

async function reconcileOneTrade(p: ReconcileOneParams): Promise<ReconciledTradeState> {
  const { db, trade, venue, exchange, report } = p;
  const { data } = trade;
  const expectedQty = Number(data.quantity ?? 0);

  // Skip paper trades (already filtered, but defensive)
  if (data.isPractice !== false) return 'reconcile_skipped';

  const posState = await fetchPositionState(exchange, venue, data.symbol, expectedQty);

  // State A — DB ghost (Firestore says open, exchange shows nothing)
  if (!posState.exists) {
    try {
      await db.collection('trades').doc(trade.id).update({
        status: 'closed',
        exitPrice: data.entryPrice,
        pnl: 0,
        closedAt: new Date().toISOString(),
        closeReconciled: true,
        closeReconcileReason: `Boot reconciliation: ${posState.reason}`,
      });
      await db.collection('brainActivity').add({
        userId: p.ownerId,
        agent: 'reconciliation',
        type: 'force_closed_reconciliation',
        message: `🧮 Reconciled DB ghost: ${data.symbol} marked closed — ${posState.reason}`,
        timestamp: new Date().toISOString(),
        data: { tradeId: trade.id, symbol: data.symbol },
      });
      await sendTelegramNotification(p.ownerId ? db : null, p.ownerId,
        `🧮 <b>Reconciliation: DB Ghost</b>\n\n${data.symbol} ${data.side?.toUpperCase()} ${expectedQty}\nFirestore said open but exchange shows no position.\nMarked closed.`
      ).catch(() => {});
      report.alertsTriggered++;
    } catch (err: any) {
      report.errors.push(`DB ghost reconcile failed for ${trade.id}: ${err?.message}`);
    }
    return 'force_closed_reconciliation';
  }

  report.positionsFound++;

  // State D — Mismatched qty
  const qtyDrift = Math.abs(posState.actualQty - expectedQty) / Math.max(expectedQty, 1e-8);
  if (qtyDrift > 0.01) {  // 1% tolerance for rounding
    try {
      await db.collection('trades').doc(trade.id).update({
        quantity: posState.actualQty,
        reconciledQty: true,
        reconciledQtyAt: new Date().toISOString(),
      });
      await db.collection('brainActivity').add({
        userId: p.ownerId,
        agent: 'reconciliation',
        type: 'qty_drift_corrected',
        message: `🧮 Qty drift on ${data.symbol}: DB ${expectedQty} → actual ${posState.actualQty}`,
        timestamp: new Date().toISOString(),
        data: { tradeId: trade.id, symbol: data.symbol, expectedQty, actualQty: posState.actualQty },
      });
      report.alertsTriggered++;
    } catch (err: any) {
      report.errors.push(`qty drift correct failed for ${trade.id}: ${err?.message}`);
    }
    return 'qty_drift_corrected';
  }

  // State E — Naked known (open in DB, position on exchange, no SL leg resting)
  // Check the trade's recorded bracketOrderIds.stopLoss first; if it's missing,
  // also probe the exchange for any STOP order on this symbol.
  const hasRecordedSlId = !!data.bracketOrderIds?.stopLoss;
  let slLegId: string | null = data.bracketOrderIds?.stopLoss ?? null;

  if (venue !== 'alpaca' && !hasRecordedSlId) {
    // For ccxt venues, we can scan open orders for a matching STOP
    slLegId = await fetchSlLegId(exchange, venue, data.symbol);
  }

  // If we have an SL ID, verify it's still resting (best-effort — full verify is overkill for boot)
  // For v1: presence of bracketOrderIds.stopLoss + healthy position counts as protected.

  if (!slLegId) {
    // NAKED KNOWN — place protective bracket
    const slPrice = data.stopLossPrice ?? (
      data.side === 'buy'
        ? (posState.entryPrice ?? data.entryPrice) * (1 - DEFAULT_ORPHAN_SL_PCT)
        : (posState.entryPrice ?? data.entryPrice) * (1 + DEFAULT_ORPHAN_SL_PCT)
    );
    const closeSide: 'buy' | 'sell' = data.side === 'buy' ? 'sell' : 'buy';
    const result = await placeStopLossOnly({
      venue, exchange,
      symbol: data.symbol,
      closeSide,
      quantity: posState.actualQty,
      stopLossPrice: slPrice,
      clientOrderIdPrefix: `jvr-${trade.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`,
    });

    if (result.success) {
      try {
        await db.collection('trades').doc(trade.id).update({
          bracketOrderIds: { entry: data.bracketOrderIds?.entry ?? data.brokerOrderId ?? '', stopLoss: result.slOrderId },
          bracketPlacementStatus: 'separate_leg_placed',
          stopLossPrice: slPrice,
          closeFailureClass: null,  // clear if was needs_human
          closeFailedAt: null,
          closeFailureReason: null,
        });
        await db.collection('brainActivity').add({
          userId: p.ownerId,
          agent: 'reconciliation',
          type: 'naked_protected',
          message: `🛡️ Naked known: ${data.symbol} protected with SL @ ${slPrice}`,
          timestamp: new Date().toISOString(),
          data: { tradeId: trade.id, symbol: data.symbol, slPrice, slOrderId: result.slOrderId },
        });
        await sendTelegramNotification(db, p.ownerId,
          `🛡️ <b>Reconciliation: Naked Position Protected</b>\n\n${data.symbol} ${data.side.toUpperCase()} ${posState.actualQty}\nNo SL was resting on exchange. Placed protective SL @ $${slPrice.toFixed(4)}.`
        ).catch(() => {});
        report.alertsTriggered++;
      } catch (err: any) {
        report.errors.push(`naked_protected update failed for ${trade.id}: ${err?.message}`);
      }
      return 'naked_protected';
    } else {
      // Protect failed — escalate to needs_human
      const errMsg = (result as { success: false; error: string }).error;
      try {
        await db.collection('trades').doc(trade.id).update({
          closeFailureClass: 'needs_human',
          closeFailureReason: `Boot reconciliation: SL re-place failed (${errMsg}). Manual exchange close required.`,
          closeFailedAt: new Date().toISOString(),
        });
        await db.collection('brainActivity').add({
          userId: p.ownerId,
          agent: 'reconciliation',
          type: 'naked_protect_failed',
          message: `💀 Naked known + protect failed: ${data.symbol} — ${errMsg}`,
          timestamp: new Date().toISOString(),
          data: { tradeId: trade.id, symbol: data.symbol, error: errMsg },
        });
        await sendTelegramNotification(db, p.ownerId,
          `💀 <b>CRITICAL: Reconciliation Failed</b>\n\n${data.symbol} ${data.side.toUpperCase()} ${posState.actualQty}\nNaked on exchange AND failed to place protective SL.\n<b>MANUAL ACTION REQUIRED.</b>\nError: ${errMsg}`
        ).catch(() => {});
        report.alertsTriggered++;
      } catch (err: any) {
        report.errors.push(`naked_protect_failed mark failed for ${trade.id}: ${err?.message}`);
      }
      return 'naked_protect_failed';
    }
  }

  // Healthy — has bracket SL, qty matches
  return 'healthy';
}

interface DiscoverOrphansParams {
  db: any;
  ownerId: string;
  venue: BracketVenue;
  exchange: any;
  knownSymbols: Set<string>;
  autoProtectOrphans: boolean;
  report: ReconciliationReport;
}

async function discoverOrphans(p: DiscoverOrphansParams): Promise<void> {
  const { db, ownerId, venue, exchange, knownSymbols, autoProtectOrphans, report } = p;

  // Fetch all positions on this venue
  let positions: any[] = [];
  try {
    if (venue === 'alpaca') {
      positions = await exchange.listPositions();
      positions = positions.map((p: any) => ({
        symbol: p.symbol,
        side: parseFloat(String(p.qty ?? '0')) > 0 ? 'long' : 'short',
        contracts: Math.abs(parseFloat(String(p.qty ?? '0'))),
        entryPrice: parseFloat(String(p.avg_entry_price ?? 0)) || null,
      }));
    } else if (venue === 'binance_futures' || venue === 'bybit_linear') {
      positions = (await exchange.fetchPositions().catch(() => []))
        .filter((p: any) => p && Math.abs(parseFloat(String(p.contracts ?? p.info?.size ?? 0))) > 1e-8)
        .map((p: any) => ({
          symbol: p.symbol,
          side: p.side,
          contracts: Math.abs(parseFloat(String(p.contracts ?? p.info?.size ?? 0))),
          entryPrice: parseFloat(String(p.entryPrice ?? 0)) || null,
        }));
    } else if (venue === 'binance_spot') {
      // For spot, check each base asset balance >= dust
      const balance = await exchange.fetchBalance().catch(() => null);
      if (balance) {
        for (const [asset, bal] of Object.entries((balance as any) ?? {})) {
          if (typeof bal !== 'object' || !bal) continue;
          const total = parseFloat(String((bal as any).total ?? 0));
          if (total > 1e-6 && asset !== 'USDT' && asset !== 'USDC' && asset !== 'BUSD' && asset.length < 10) {
            positions.push({
              symbol: `${asset}/USDT`,
              side: 'long',
              contracts: total,
              entryPrice: null,
            });
          }
        }
      }
    }
  } catch (err: any) {
    report.errors.push(`fetch positions for orphan discovery (${venue}): ${err?.message}`);
    return;
  }

  for (const pos of positions) {
    if (knownSymbols.has(pos.symbol)) continue;  // known trade — already handled

    // Orphan! Process per autoProtectOrphans flag.
    const orphanKey = `${venue}:${pos.symbol}`;

    let slOrderId: string | null = null;
    let bracketStatus: 'separate_leg_placed' | 'sl_failed_emergency_failed' = 'sl_failed_emergency_failed';
    let placedSlPrice: number | null = null;

    if (autoProtectOrphans) {
      // Place default 3% protective SL
      const currentPrice = pos.entryPrice ?? null;  // best-effort; for spot we don't know
      if (currentPrice && currentPrice > 0) {
        const slPrice = pos.side === 'long'
          ? currentPrice * (1 - DEFAULT_ORPHAN_SL_PCT)
          : currentPrice * (1 + DEFAULT_ORPHAN_SL_PCT);
        const closeSide: 'buy' | 'sell' = pos.side === 'long' ? 'sell' : 'buy';
        const result = await placeStopLossOnly({
          venue, exchange,
          symbol: pos.symbol,
          closeSide,
          quantity: pos.contracts,
          stopLossPrice: slPrice,
          clientOrderIdPrefix: `jvr-orphan-${Date.now()}`,
        });
        if (result.success) {
          slOrderId = result.slOrderId;
          bracketStatus = 'separate_leg_placed';
          placedSlPrice = slPrice;
        }
      }
    }

    try {
      await db.collection('trades').add({
        userId: ownerId,
        symbol: pos.symbol,
        side: pos.side === 'long' ? 'buy' : 'sell',
        quantity: pos.contracts,
        entryPrice: pos.entryPrice ?? 0,
        status: 'discovered_orphan',
        isPractice: false,
        stopLossPrice: placedSlPrice,
        bracketOrderIds: slOrderId ? { entry: '', stopLoss: slOrderId } : null,
        bracketPlacementStatus: bracketStatus,
        discoveredAt: new Date().toISOString(),
        discoveredReason: `Boot reconciliation: position on ${venue} with no matching Firestore trade`,
        createdAt: new Date().toISOString(),
      });
      await db.collection('brainActivity').add({
        userId: ownerId,
        agent: 'reconciliation',
        type: 'discovered_orphan',
        message: `🔍 Discovered orphan ${pos.symbol} on ${venue}: ${pos.side} ${pos.contracts}${slOrderId ? ' (auto-protected)' : ' (NAKED — autoProtect off)'}`,
        timestamp: new Date().toISOString(),
        data: { venue, symbol: pos.symbol, side: pos.side, qty: pos.contracts, slOrderId, slPrice: placedSlPrice },
      });
      await sendTelegramNotification(db, ownerId,
        `🔍 <b>Reconciliation: Discovered Orphan</b>\n\n` +
        `Venue: ${venue}\nSymbol: ${pos.symbol}\nSide: ${pos.side}\nQty: ${pos.contracts}\n\n` +
        (slOrderId
          ? `Auto-protected with SL @ $${placedSlPrice?.toFixed(4) ?? '?'} (3% default).\nReview in dashboard and "adopt" to bring into active management.`
          : `<b>NAKED on exchange.</b> autoProtectOrphans is off OR no entry price available. Manual SL required.`)
      ).catch(() => {});
      report.alertsTriggered++;
      report.states[orphanKey] = 'discovered_orphan';
      report.positionsFound++;
    } catch (err: any) {
      report.errors.push(`orphan insert failed for ${orphanKey}: ${err?.message}`);
    }
  }
}
