/**
 * Phase 9 — closeWithRetry support module.
 *
 * Pure functions only — no Firestore, no exchange calls, no side effects.
 * Everything here is unit-testable without mocks because nothing reaches
 * outside the module. tradeExecutor.ts wires these into the real close path.
 *
 * Why this exists: sentry.ts currently swallows exchange errors and lets the
 * next price tick re-trigger the same failing close, creating either a silent
 * black hole or a fast loop of real orders. closeWithRetry classifies each
 * failure, retries only what's safely retryable, reconciles deterministic
 * "position already gone" errors against the actual exchange state, and
 * persists a retry-hold so terminally-failed closes don't hammer.
 *
 * SAFETY: a wrong classification here is the kind of bug that moves real
 * money. Every code path in this file has a corresponding test case in
 * scratch/verify-closeRetry.ts. Run the harness before changing this file.
 */

export type CloseErrorClassification =
  | { kind: 'transient'; reason: string }        // network/rate-limit/5xx — retry with backoff
  | { kind: 'already_closed'; reason: string }   // exchange confirms position gone — reconcile, do NOT retry
  | { kind: 'permanent'; reason: string };       // symbol halted / auth / config — alert + give up

/**
 * First-pass classification from the error message alone. This is the
 * QUICK pattern match used to decide whether to call the exchange-verify
 * helper (expensive — an API round-trip) or skip it.
 *
 * Important: anything matched as `already_closed` here is ONLY a HINT.
 * The caller MUST then run the inline exchange-verify before treating
 * the position as gone. Never act on this classification alone — that's
 * how we'd accidentally mark an open position as closed.
 */
export function classifyCloseErrorMessage(rawErr: any): CloseErrorClassification {
  const msg = String(rawErr?.message ?? rawErr ?? '').toLowerCase();

  // Empty/missing message — treat as transient so the next attempt has a chance
  if (!msg.trim()) {
    return { kind: 'transient', reason: 'empty error message' };
  }

  // ─── Deterministic "position already gone" patterns ──────
  // ccxt: InsufficientFunds, "insufficient balance"
  // Binance:    -2010 "Account has insufficient balance for requested action"
  // Bybit:      "ab not enough for new order", "current position is zero"
  // Alpaca:     422 "insufficient buying power", 404 "position does not exist"
  if (/insufficient (balance|funds|buying power|margin)/.test(msg)) {
    return { kind: 'already_closed', reason: 'insufficient balance (position likely already closed)' };
  }
  if (/position (does ?not exist|not found)|no.*position.*found|position.*is.*zero|no position to close/.test(msg)) {
    return { kind: 'already_closed', reason: 'exchange reports no position' };
  }
  if (/quantity.*(less than|below).*min|qty.*too.*small/.test(msg)) {
    return { kind: 'already_closed', reason: 'remaining quantity below minimum (position likely already partial-closed)' };
  }

  // ─── Transient: retry with backoff ──────
  // ccxt: NetworkError, RequestTimeout, ExchangeNotAvailable, RateLimitExceeded
  if (/rate ?limit|too many requests|429/.test(msg)) {
    return { kind: 'transient', reason: 'rate-limited' };
  }
  if (/timeout|timed out|etimedout|network|econnreset|enotfound|eai_again|ehostunreach/.test(msg)) {
    return { kind: 'transient', reason: 'network error' };
  }
  if (/\b5(0[0-9]|1[0-9]|2[0-9]|3[0-9])\b|service.*unavailable|gateway|bad gateway/.test(msg)) {
    return { kind: 'transient', reason: 'exchange 5xx / unavailable' };
  }
  if (/temporarily|try again later|retry later/.test(msg)) {
    return { kind: 'transient', reason: 'exchange asked to retry later' };
  }

  // ─── Permanent: alert + give up ──────
  // Symbol halted, auth bad, account banned — retrying won't help
  if (/unauthorized|forbidden|api.*key.*invalid|authentication|signature/.test(msg)) {
    return { kind: 'permanent', reason: 'authentication / API key issue' };
  }
  if (/symbol.*(halted|suspended|delisted|trading.*disabled)/.test(msg)) {
    return { kind: 'permanent', reason: 'symbol halted / delisted' };
  }
  if (/market.*closed|outside.*trading.*hours/.test(msg)) {
    return { kind: 'permanent', reason: 'market closed' };
  }
  if (/account.*(banned|suspended|restricted|liquidat)/.test(msg)) {
    return { kind: 'permanent', reason: 'account restricted' };
  }
  if (/bad.*symbol|invalid.*symbol|symbol.*not.*found/.test(msg)) {
    return { kind: 'permanent', reason: 'invalid symbol' };
  }

  // ─── Default ──────
  // Unknown errors classify as transient + retry. The retry-with-backoff
  // gives the exchange another chance; if every retry fails the same way,
  // the retries-exhausted path takes over and escalates.
  //
  // Rationale: erring toward transient means a bad classification at most
  // wastes N retries. Erring toward already_closed would mark a live
  // position as closed in Firestore — that's the dangerous direction.
  return { kind: 'transient', reason: `unclassified (\"${msg.slice(0, 100)}\")` };
}

/**
 * Backoff schedule for the retry loop. Returns ms to sleep BEFORE attempt N
 * (1-indexed). attempt 1 = 0ms (first try), attempt 2 = 2000ms, attempt 3 = 5000ms.
 *
 * Intentionally short. We're inside a SL/TP enforcement path — the longer we
 * wait between retries, the further the price moves past the stop. If the
 * exchange is having transient issues, 2s + 5s = 7s total. If it's a deeper
 * outage, we escalate fast rather than sit in a long backoff.
 */
export function retryBackoffMs(attempt: number): number {
  if (attempt <= 1) return 0;
  if (attempt === 2) return 2000;
  if (attempt === 3) return 5000;
  // Should never reach attempt 4+ given MAX_ATTEMPTS=3, but cap anyway.
  return 10000;
}

export const MAX_CLOSE_ATTEMPTS = 3;

/**
 * Time window (ms) during which a trade with a recent closeFailedAt
 * is in "retry-hold" — sentry should skip attempting another close.
 * 5 minutes is short enough to recover from transient exchange issues
 * but long enough to avoid hammering on a real outage.
 */
export const CLOSE_RETRY_HOLD_MS = 5 * 60 * 1000;

/**
 * Returns true if the trade's closeFailedAt is recent enough that we
 * should NOT attempt another close yet. Use this in sentry's tick loop
 * BEFORE calling closeWithRetry, so we don't waste an exchange round-trip.
 *
 * Pure function — takes the trade's closeFailedAt (ISO string or null)
 * and the current time. Easy to unit-test.
 */
export function isInRetryHold(closeFailedAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!closeFailedAt) return false;
  const failedMs = new Date(closeFailedAt).getTime();
  if (!Number.isFinite(failedMs)) return false;
  return (nowMs - failedMs) < CLOSE_RETRY_HOLD_MS;
}

/**
 * Max consecutive `retries_exhausted` cycles before a trade is marked
 * permanently abandoned by Sentry. After this many cycles (each cycle =
 * 3 retries + 5min hold = ~15 minutes of futile attempts), the trade
 * transitions to closeFailureClass='needs_human' and Sentry stops trying.
 *
 * Reason: on the crypto path, _verifyPositionGone returns null (verify
 * not yet implemented), so an already-closed position will retry-then-hold
 * forever. Without this cap, the same dead trade would alert every 5 minutes
 * indefinitely, training the user to mute the alert channel. With it,
 * alerts max out at MAX_RETRIES_EXHAUSTED_CYCLES + 1 (the final needs_human
 * escalation), then go silent until user intervention.
 *
 * Set to 3 cycles (~15 min total) — long enough to recover from real
 * exchange outages but short enough that a dead position doesn't pollute
 * the alert channel for an hour.
 */
export const MAX_RETRIES_EXHAUSTED_CYCLES = 3;

/**
 * Returns true if a trade has been permanently abandoned by the close-retry
 * machinery (closeFailureClass='needs_human'). Sentry MUST skip these
 * trades — they require user intervention on the exchange directly.
 *
 * Pure function — checks the trade's closeFailureClass field.
 */
export function isPermanentlyAbandoned(closeFailureClass: string | null | undefined): boolean {
  return closeFailureClass === 'needs_human';
}

/**
 * Combined check: should Sentry skip this trade on the current tick?
 * True if the trade is either in time-bounded retry hold OR permanently
 * abandoned (needs_human terminal state).
 */
export function shouldSentrySkip(trade: { closeFailedAt?: string | null; closeFailureClass?: string | null }, nowMs: number = Date.now()): boolean {
  if (isPermanentlyAbandoned(trade.closeFailureClass)) return true;
  if (isInRetryHold(trade.closeFailedAt, nowMs)) return true;
  return false;
}
