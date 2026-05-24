/**
 * Cost Meter — tracks API spend per LLM/embedding call.
 *
 * Architecture:
 *   - Pricing table (per 1M tokens USD) is in PRICING below — update when
 *     providers change rates.
 *   - In-memory rolling 24h buffer for fast UI reads.
 *   - Async fire-and-forget Firestore write to `apiUsage` collection for
 *     durable history (caller does NOT await, so LLM latency is unaffected).
 *
 * Usage from modelRouter:
 *   import { recordCall } from './costMeter.ts';
 *   ... after response ...
 *   recordCall({
 *     provider: 'gemini', model: 'gemini-2.5-flash', purpose: 'scout',
 *     inputTokens, outputTokens, userId
 *   });
 */

export type Provider = 'gemini' | 'groq' | 'embedding';

export interface RecordOpts {
  provider: Provider;
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  userId?: string;
}

export interface CallRecord extends RecordOpts {
  cost: number;
  timestamp: string;
}

/**
 * USD cost per 1M tokens. Update when providers change rates.
 * Last updated: 2026-05-24.
 */
const PRICING: Record<string, { in: number; out: number }> = {
  // Gemini 2.5 family
  'gemini-2.5-pro': { in: 1.25, out: 5.00 },
  'gemini-2.5-flash': { in: 0.075, out: 0.30 },
  'gemini-2.5-flash-lite': { in: 0.04, out: 0.12 },

  // Gemini 2.0 family (legacy)
  'gemini-2.0-flash': { in: 0.10, out: 0.40 },
  'gemini-2.0-flash-exp': { in: 0.10, out: 0.40 },

  // Gemini 1.5 family (legacy)
  'gemini-1.5-flash': { in: 0.075, out: 0.30 },
  'gemini-1.5-pro': { in: 1.25, out: 5.00 },

  // Gemini embeddings (priced per 1M tokens)
  'gemini-embedding-001': { in: 0.025, out: 0 },
  'text-embedding-004': { in: 0.025, out: 0 },

  // Groq Llama (current public pricing — verify before relying)
  'llama-3.3-70b-versatile': { in: 0.59, out: 0.79 },
  'llama-3.1-70b-versatile': { in: 0.59, out: 0.79 },
  'llama-3.1-8b-instant': { in: 0.05, out: 0.08 },
};

/** Sensible fallback for unknown models — Flash-ish pricing. */
const FALLBACK_PRICE = { in: 0.10, out: 0.40 };

let db: FirebaseFirestore.Firestore | null = null;
let inMemory: CallRecord[] = [];

export function init(firestore: FirebaseFirestore.Firestore): void {
  db = firestore;
}

/**
 * Compute USD cost for a given model + token counts.
 * Unknown models fall back to Flash-ish pricing so we don't silently report $0.
 */
export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model] ?? FALLBACK_PRICE;
  const cost = (inputTokens / 1_000_000) * price.in + (outputTokens / 1_000_000) * price.out;
  return Math.round(cost * 1_000_000) / 1_000_000; // 6 decimal precision
}

/**
 * Synchronous from the caller's perspective. Computes cost, appends to memory,
 * prunes >24h, then fires async Firestore write (errors logged, not thrown).
 */
export function recordCall(opts: RecordOpts): void {
  const cost = calculateCost(opts.model, opts.inputTokens, opts.outputTokens);
  const record: CallRecord = {
    ...opts,
    cost,
    timestamp: new Date().toISOString(),
  };

  inMemory.push(record);

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  inMemory = inMemory.filter(r => new Date(r.timestamp).getTime() > cutoff);

  if (db) {
    db.collection('apiUsage').add(record).catch((err: any) => {
      console.error('[costMeter] Firestore write failed:', err?.message || err);
    });
  }
}

export function getRecentCalls(): CallRecord[] {
  return [...inMemory];
}

export function getDailyTotal(): number {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startMs = startOfDay.getTime();
  return inMemory
    .filter(r => new Date(r.timestamp).getTime() >= startMs)
    .reduce((sum, r) => sum + r.cost, 0);
}

export function getLast24hTotal(): number {
  return inMemory.reduce((sum, r) => sum + r.cost, 0);
}

export function getByPurpose(): Record<string, { cost: number; calls: number; tokens: number }> {
  const out: Record<string, { cost: number; calls: number; tokens: number }> = {};
  for (const r of inMemory) {
    if (!out[r.purpose]) out[r.purpose] = { cost: 0, calls: 0, tokens: 0 };
    out[r.purpose].cost += r.cost;
    out[r.purpose].calls += 1;
    out[r.purpose].tokens += r.inputTokens + r.outputTokens;
  }
  return out;
}

export function getByModel(): Record<string, { cost: number; calls: number }> {
  const out: Record<string, { cost: number; calls: number }> = {};
  for (const r of inMemory) {
    if (!out[r.model]) out[r.model] = { cost: 0, calls: 0 };
    out[r.model].cost += r.cost;
    out[r.model].calls += 1;
  }
  return out;
}

export function getSummary() {
  return {
    today: getDailyTotal(),
    last24h: getLast24hTotal(),
    totalCalls: inMemory.length,
    byPurpose: getByPurpose(),
    byModel: getByModel(),
  };
}
