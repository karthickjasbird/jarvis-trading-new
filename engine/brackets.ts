/**
 * Phase 9 — Tier B #1: Native exchange-side stop-loss legs.
 *
 * WHY THIS EXISTS
 * Every stop-loss in Jarvis today is SYNTHETIC — only a Firestore value
 * polled by Sentry every 5s. The instant the process dies (laptop sleeps,
 * Node crashes, network drops), the position is naked: no downside
 * protection. This module places a native SL on the exchange itself,
 * which survives process death.
 *
 * Sentry's synthetic SL polling INTENTIONALLY stays active after this
 * ships — defense-in-depth. The native SL is the "process is dead"
 * guarantee; Sentry is the "process is alive but the exchange's LIMIT
 * SL didn't fill in a gap" guarantee. Complementary, not redundant.
 *
 * SAFETY INVARIANT
 * The 2-call venues (Binance Spot, Binance Futures) place SL AFTER the
 * entry fills. If SL placement fails post-entry, the position is naked.
 * The emergency-close pattern handles this — see _placeWithSeparateLeg.
 * Mistakes here recreate the exact bug brackets exist to prevent.
 *
 * Per-venue mechanics (web-researched 2026-05-28):
 *  - Alpaca:           order_class: 'oto' + stop_loss.stop_price (sequential)
 *  - Bybit Linear:     atomic via params.stopLoss.triggerPrice
 *  - Binance Spot:     2-call, STOP_LOSS_LIMIT with slippage buffer
 *  - Binance Futures:  2-call, STOP_MARKET with closePosition:true + workingType:MARK_PRICE
 *  - Bybit Spot, Zerodha: DEFERRED to v1.5
 */

export type BracketVenue =
  | 'alpaca'
  | 'bybit_linear'
  | 'binance_spot'
  | 'binance_futures';

export type BracketPlacementStatus =
  | 'attached_atomic'              // Bybit Linear: SL attached to position in one call
  | 'separate_leg_placed'          // 2-call success: entry filled + SL placed
  | 'sl_failed_emergency_closed'   // 2-call: entry filled, SL failed, emergency close fired
  | 'sl_failed_emergency_failed'   // WORST CASE: naked + emergency close ALSO failed
  | 'unsupported_venue';

export interface BracketResult {
  entryOrderId: string;
  entryFillPrice: number | null;
  entryFilledQty: number;          // Actual fill, used for SL leg
  stopLossOrderId: string | null;  // null = attached_atomic or unsupported
  bracketPlacementStatus: BracketPlacementStatus;
  errorDetail?: string;
}

export interface PlaceBracketParams {
  venue: BracketVenue;
  exchange: any;                   // ccxt instance OR AlpacaConnector
  symbol: string;
  side: 'buy' | 'sell';            // entry side
  quantity: number;
  stopLossPrice: number;
  slippageBufferPct?: number;      // Default 1% — for Binance Spot LIMIT SL
  clientOrderIdPrefix: string;     // base ID; SL leg appends '-sl'
}

const DEFAULT_SLIPPAGE_BUFFER_PCT = 0.01; // 1%

/**
 * Compute the LIMIT price for a STOP_LOSS_LIMIT order on Binance Spot.
 *
 * For a SELL stop-loss (closing a LONG position): limit < stop, so the
 * resting order fills even if price gaps down past stop_price.
 * For a BUY stop-loss (closing a SHORT): limit > stop.
 *
 * Without this buffer, a STOP_LOSS_LIMIT might not fill in a flash gap
 * (price drops below limit_price before the order can match).
 *
 * Pure function — easy to unit-test.
 */
export function computeStopLossLimitPrice(
  stopPrice: number,
  closeSide: 'buy' | 'sell',
  bufferPct: number = DEFAULT_SLIPPAGE_BUFFER_PCT
): number {
  if (!Number.isFinite(stopPrice) || stopPrice <= 0) {
    throw new Error(`computeStopLossLimitPrice: invalid stopPrice ${stopPrice}`);
  }
  if (!Number.isFinite(bufferPct) || bufferPct < 0) {
    throw new Error(`computeStopLossLimitPrice: invalid bufferPct ${bufferPct}`);
  }
  // closeSide is the direction OPPOSITE to the entry. Closing a long = 'sell'.
  if (closeSide === 'sell') {
    return parseFloat((stopPrice * (1 - bufferPct)).toFixed(8));
  }
  return parseFloat((stopPrice * (1 + bufferPct)).toFixed(8));
}

/**
 * Opposite side helper. Closing a long = sell; closing a short = buy.
 */
export function getCloseSide(entrySide: 'buy' | 'sell'): 'buy' | 'sell' {
  return entrySide === 'buy' ? 'sell' : 'buy';
}

/**
 * Main orchestrator. Dispatches to the per-venue path. Each path
 * returns a BracketResult with a status that callers should persist
 * to Firestore + alert on (especially sl_failed_emergency_failed).
 *
 * NEVER throws on a brokered failure — always returns a BracketResult
 * with the appropriate status. Throws only for programmer errors
 * (invalid venue, missing params, etc.).
 */
export async function placeEntryWithStopLoss(params: PlaceBracketParams): Promise<BracketResult> {
  if (!params.exchange) throw new Error('placeEntryWithStopLoss: exchange handle required');
  if (!params.symbol) throw new Error('placeEntryWithStopLoss: symbol required');
  if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
    throw new Error(`placeEntryWithStopLoss: invalid quantity ${params.quantity}`);
  }
  if (!Number.isFinite(params.stopLossPrice) || params.stopLossPrice <= 0) {
    throw new Error(`placeEntryWithStopLoss: invalid stopLossPrice ${params.stopLossPrice}`);
  }

  switch (params.venue) {
    case 'alpaca':
      return _placeAlpacaOto(params);
    case 'bybit_linear':
      return _placeBybitLinearAtomic(params);
    case 'binance_spot':
      return _placeBinanceSpotSeparateLeg(params);
    case 'binance_futures':
      return _placeBinanceFuturesSeparateLeg(params);
    default:
      return {
        entryOrderId: '',
        entryFillPrice: null,
        entryFilledQty: 0,
        stopLossOrderId: null,
        bracketPlacementStatus: 'unsupported_venue',
        errorDetail: `venue=${params.venue} not supported in v1`,
      };
  }
}

/* ────────────────────────────────────────────────────────────────────
   Alpaca — OTO (One-Triggers-Other) order class
   Sequential, not atomic. SL leg activates only after entry fills.
   ──────────────────────────────────────────────────────────────────── */

async function _placeAlpacaOto(params: PlaceBracketParams): Promise<BracketResult> {
  const { exchange, symbol, side, quantity, stopLossPrice, clientOrderIdPrefix } = params;
  try {
    // alpacaConnector.createMarketOrder must accept { clientOrderId, stopLossPrice }
    // and pass through to placeMarketOrder which builds the OTO JSON body.
    const order = await exchange.createMarketOrder(symbol, side, quantity, {
      clientOrderId: clientOrderIdPrefix,
      stopLossPrice,
    });
    // Alpaca returns a parent order with `legs` array; SL leg is legs[0].
    const legs = order.raw?.legs ?? [];
    const slLegId = legs[0]?.id ?? null;
    return {
      entryOrderId: order.id,
      entryFillPrice: order.average ?? null,
      entryFilledQty: order.filled ?? quantity,
      stopLossOrderId: slLegId,
      bracketPlacementStatus: 'separate_leg_placed', // Alpaca handles SL activation server-side
    };
  } catch (err: any) {
    // If the entire OTO call failed, no entry was placed — clean state.
    return {
      entryOrderId: '',
      entryFillPrice: null,
      entryFilledQty: 0,
      stopLossOrderId: null,
      bracketPlacementStatus: 'sl_failed_emergency_closed', // semantically: nothing entered, nothing to close
      errorDetail: `Alpaca OTO placement failed: ${err?.message ?? err}`,
    };
  }
}

/* ────────────────────────────────────────────────────────────────────
   Bybit Linear — atomic SL attached via createOrder params
   ──────────────────────────────────────────────────────────────────── */

async function _placeBybitLinearAtomic(params: PlaceBracketParams): Promise<BracketResult> {
  const { exchange, symbol, side, quantity, stopLossPrice, clientOrderIdPrefix } = params;
  try {
    const order = await exchange.createOrder(symbol, 'market', side, quantity, undefined, {
      newClientOrderId: clientOrderIdPrefix,
      stopLoss: { triggerPrice: stopLossPrice },
      positionIdx: 0, // one-way mode default
    });
    return {
      entryOrderId: order.id,
      entryFillPrice: order.average || order.price || null,
      entryFilledQty: order.filled ?? quantity,
      stopLossOrderId: null, // attaches to the position, not a separate order entity
      bracketPlacementStatus: 'attached_atomic',
    };
  } catch (err: any) {
    return {
      entryOrderId: '',
      entryFillPrice: null,
      entryFilledQty: 0,
      stopLossOrderId: null,
      bracketPlacementStatus: 'sl_failed_emergency_closed', // atomic = nothing entered if call failed
      errorDetail: `Bybit Linear atomic bracket failed: ${err?.message ?? err}`,
    };
  }
}

/* ────────────────────────────────────────────────────────────────────
   Binance Spot — 2-call pattern with slippage buffer + emergency close
   STOP_LOSS_LIMIT (not STOP_MARKET — doesn't exist on spot)
   ──────────────────────────────────────────────────────────────────── */

async function _placeBinanceSpotSeparateLeg(params: PlaceBracketParams): Promise<BracketResult> {
  const { exchange, symbol, side, quantity, stopLossPrice, clientOrderIdPrefix } = params;
  const bufferPct = params.slippageBufferPct ?? DEFAULT_SLIPPAGE_BUFFER_PCT;
  const closeSide = getCloseSide(side);

  // 1. Place entry market order
  let entry: any;
  try {
    entry = await exchange.createMarketOrder(symbol, side, quantity, undefined, {
      newClientOrderId: clientOrderIdPrefix,
    });
  } catch (err: any) {
    // Entry itself failed — nothing entered, nothing to clean up
    return {
      entryOrderId: '',
      entryFillPrice: null,
      entryFilledQty: 0,
      stopLossOrderId: null,
      bracketPlacementStatus: 'sl_failed_emergency_closed',
      errorDetail: `Binance Spot entry failed: ${err?.message ?? err}`,
    };
  }

  const filledQty = parseFloat(String(entry.filled ?? entry.amount ?? quantity));
  const fillPrice = entry.average || entry.price || null;
  const limitPrice = computeStopLossLimitPrice(stopLossPrice, closeSide, bufferPct);

  // 2. Place STOP_LOSS_LIMIT
  try {
    const slLeg = await exchange.createOrder(
      symbol,
      'STOP_LOSS_LIMIT',
      closeSide,
      filledQty,
      limitPrice,
      {
        stopPrice: stopLossPrice,
        newClientOrderId: `${clientOrderIdPrefix}-sl`,
        timeInForce: 'GTC',
      }
    );
    return {
      entryOrderId: entry.id,
      entryFillPrice: fillPrice,
      entryFilledQty: filledQty,
      stopLossOrderId: slLeg.id,
      bracketPlacementStatus: 'separate_leg_placed',
    };
  } catch (slErr: any) {
    // SL placement failed AFTER entry filled. Emergency-close.
    return _emergencyCloseAndReport({
      exchange,
      symbol,
      closeSide,
      filledQty,
      entryId: entry.id,
      entryFillPrice: fillPrice,
      clientOrderIdPrefix,
      slErrMessage: String(slErr?.message ?? slErr),
      isCcxt: true,
    });
  }
}

/* ────────────────────────────────────────────────────────────────────
   Binance Futures — 2-call pattern with closePosition:true
   STOP_MARKET (futures HAS this; spot does not)
   ──────────────────────────────────────────────────────────────────── */

async function _placeBinanceFuturesSeparateLeg(params: PlaceBracketParams): Promise<BracketResult> {
  const { exchange, symbol, side, quantity, stopLossPrice, clientOrderIdPrefix } = params;
  const closeSide = getCloseSide(side);

  // 1. Entry
  let entry: any;
  try {
    entry = await exchange.createMarketOrder(symbol, side, quantity, undefined, {
      newClientOrderId: clientOrderIdPrefix,
    });
  } catch (err: any) {
    return {
      entryOrderId: '',
      entryFillPrice: null,
      entryFilledQty: 0,
      stopLossOrderId: null,
      bracketPlacementStatus: 'sl_failed_emergency_closed',
      errorDetail: `Binance Futures entry failed: ${err?.message ?? err}`,
    };
  }

  const filledQty = parseFloat(String(entry.filled ?? entry.amount ?? quantity));
  const fillPrice = entry.average || entry.price || null;

  // 2. STOP_MARKET with closePosition:true — implicitly closes whatever's open
  //    when triggered. Cleaner than reduceOnly+quantity (no qty mismatch risk).
  try {
    const slLeg = await exchange.createOrder(
      symbol,
      'STOP_MARKET',
      closeSide,
      undefined,      // qty omitted with closePosition:true
      undefined,      // no limit price
      {
        stopPrice: stopLossPrice,
        closePosition: true,
        workingType: 'MARK_PRICE',     // avoid wick-triggers from last-trade
        newClientOrderId: `${clientOrderIdPrefix}-sl`,
      }
    );
    return {
      entryOrderId: entry.id,
      entryFillPrice: fillPrice,
      entryFilledQty: filledQty,
      stopLossOrderId: slLeg.id,
      bracketPlacementStatus: 'separate_leg_placed',
    };
  } catch (slErr: any) {
    return _emergencyCloseAndReport({
      exchange,
      symbol,
      closeSide,
      filledQty,
      entryId: entry.id,
      entryFillPrice: fillPrice,
      clientOrderIdPrefix,
      slErrMessage: String(slErr?.message ?? slErr),
      isCcxt: true,
    });
  }
}

/* ────────────────────────────────────────────────────────────────────
   Emergency close — last-resort liquidation after SL placement failed.
   If THIS also fails, the position is genuinely naked AND we can't fix
   it programmatically. The caller must treat sl_failed_emergency_failed
   as an immediate needs_human escalation.
   ──────────────────────────────────────────────────────────────────── */

interface EmergencyCloseParams {
  exchange: any;
  symbol: string;
  closeSide: 'buy' | 'sell';
  filledQty: number;
  entryId: string;
  entryFillPrice: number | null;
  clientOrderIdPrefix: string;
  slErrMessage: string;
  isCcxt: boolean;
}

async function _emergencyCloseAndReport(p: EmergencyCloseParams): Promise<BracketResult> {
  console.error(
    `[BRACKET] 🚨 SL placement failed after entry fill (${p.entryId} qty=${p.filledQty}). ` +
    `Emergency-closing. SL err: ${p.slErrMessage}`
  );
  const emergencyOrderId = `${p.clientOrderIdPrefix}-emergency`;
  try {
    if (p.isCcxt) {
      await p.exchange.createMarketOrder(p.symbol, p.closeSide, p.filledQty, undefined, {
        newClientOrderId: emergencyOrderId,
      });
    } else {
      // Alpaca path — uses our extended connector
      await p.exchange.createMarketOrder(p.symbol, p.closeSide, p.filledQty, {
        clientOrderId: emergencyOrderId,
      });
    }
    return {
      entryOrderId: p.entryId,
      entryFillPrice: p.entryFillPrice,
      entryFilledQty: p.filledQty,
      stopLossOrderId: null,
      bracketPlacementStatus: 'sl_failed_emergency_closed',
      errorDetail: `SL failed (${p.slErrMessage}) — entry was emergency-closed`,
    };
  } catch (emergencyErr: any) {
    console.error(
      `[BRACKET] 💀 EMERGENCY CLOSE ALSO FAILED for ${p.entryId}. ` +
      `Position is NAKED. Manual intervention required. Err: ${emergencyErr?.message}`
    );
    return {
      entryOrderId: p.entryId,
      entryFillPrice: p.entryFillPrice,
      entryFilledQty: p.filledQty,
      stopLossOrderId: null,
      bracketPlacementStatus: 'sl_failed_emergency_failed',
      errorDetail: `SL: ${p.slErrMessage} | EMERGENCY: ${emergencyErr?.message ?? emergencyErr}`,
    };
  }
}
