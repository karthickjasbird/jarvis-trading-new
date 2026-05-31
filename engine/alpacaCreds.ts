/**
 * Shared Alpaca credential resolution. Single source of truth for how the app
 * finds the user's Alpaca API key — used by tradeExecutor, marketScanner,
 * reconciliation, and the debug route. Was duplicated across all four; the drift
 * caused reconciliation to 401 while everything else worked.
 *
 * Look-up order (first non-empty wins):
 *   1. users/{uid}/secrets/apiKeys      → alpacaApiKeyId / alpacaSecretKey
 *   2. users/{uid}/brokerConfigs        → apiKey / apiSecret  (brokerName='alpaca')
 *   3. process.env                      → ALPACA_API_KEY_ID / ALPACA_SECRET_KEY
 */

import type { Firestore } from 'firebase-admin/firestore';
import { AlpacaConnector } from './alpacaConnector.ts';

export interface AlpacaCreds {
  apiKeyId: string;
  secretKey: string;
}

export interface ResolveOpts {
  /** If undefined, auto-detect from key prefix: PK*=paper, AK*=live. */
  paper?: boolean;
}

export async function resolveAlpacaCreds(db: Firestore, userId: string): Promise<AlpacaCreds | null> {
  let apiKeyId = '';
  let secretKey = '';
  if (userId) {
    try {
      const doc = await db.collection('users').doc(userId).collection('secrets').doc('apiKeys').get();
      if (doc.exists) {
        const data: any = doc.data() || {};
        apiKeyId = data.alpacaApiKeyId || '';
        secretKey = data.alpacaSecretKey || '';
      }
    } catch {}
    if (!apiKeyId || !secretKey) {
      try {
        const snap = await db.collection('users').doc(userId).collection('brokerConfigs')
          .where('brokerName', '==', 'alpaca').limit(1).get();
        if (!snap.empty) {
          const data: any = snap.docs[0].data() || {};
          apiKeyId = apiKeyId || data.apiKey || '';
          secretKey = secretKey || data.apiSecret || '';
        }
      } catch {}
    }
  }
  apiKeyId = apiKeyId || process.env.ALPACA_API_KEY_ID || '';
  secretKey = secretKey || process.env.ALPACA_SECRET_KEY || '';
  if (!apiKeyId || !secretKey) return null;
  return { apiKeyId, secretKey };
}

/** Alpaca paper keys start with "PK", live keys with "AK". */
export function detectPaper(apiKeyId: string): boolean {
  return !apiKeyId.startsWith('AK');
}

/** Resolve creds and return a constructed connector, or null if not configured. */
export async function resolveAlpacaConnector(
  db: Firestore,
  userId: string,
  opts: ResolveOpts = {},
): Promise<AlpacaConnector | null> {
  const creds = await resolveAlpacaCreds(db, userId);
  if (!creds) return null;
  const paper = opts.paper ?? detectPaper(creds.apiKeyId);
  return new AlpacaConnector({ ...creds, paper });
}

export const ALPACA_CREDS_NOT_CONFIGURED_MSG =
  'Alpaca credentials not configured. Add them under Broker Settings or set ALPACA_API_KEY_ID / ALPACA_SECRET_KEY in .env.';
