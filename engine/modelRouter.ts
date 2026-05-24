import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { recordCall } from './costMeter.ts';
dotenv.config();

// Default instance (uses .env key)
const defaultGeminiAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Cache per-user GoogleGenAI instances to avoid re-creating on every call
const userGeminiInstances = new Map<string, GoogleGenAI>();

function getGeminiInstance(apiKey?: string): GoogleGenAI {
  if (!apiKey) return defaultGeminiAI;

  if (!userGeminiInstances.has(apiKey)) {
    userGeminiInstances.set(apiKey, new GoogleGenAI({ apiKey }));
  }
  return userGeminiInstances.get(apiKey)!;
}

/**
 * Cost telemetry tagging. Callers should pass `purpose` so cost can be
 * attributed (scout / analyst / scholar / strategist / sentinel / executor /
 * chat / voice / sentiment / embedding / etc.).
 */
export interface CallOpts {
  userId?: string;
  purpose?: string;
}

/**
 * Phase 9.4 — Cheap-Fast vs Expensive-Slow Model Split.
 *
 * Routing table: which purpose runs on which model. Tweak here — every
 * caller goes through `generateTextForPurpose(purpose, prompt)` so the
 * split lives in one place.
 *
 * Pro tier (slow, ~17x more expensive than Flash on output): purposes that
 * genuinely benefit from deeper reasoning — synthesis, multi-factor
 * judgments, building plans with specific numbers.
 *
 * Flash (default): everything else. Rule-driven checks, structured outputs,
 * single-step generation, chat replies, summaries.
 *
 * Last reviewed: 2026-05-24. Baseline cost data via /api/cost/summary.
 */
const MODEL_ROUTING: Record<string, string> = {
  analyst: 'gemini-2.5-pro',
  holistic: 'gemini-2.5-pro',
  strategist: 'gemini-2.5-pro',
};
const DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Resolve a purpose tag to a model id. Unknown purposes fall back to Flash.
 */
export function selectModel(purpose: string): string {
  return MODEL_ROUTING[purpose] || DEFAULT_MODEL;
}

/**
 * Preferred public entry point — caller names a purpose, router picks the
 * model. Cleaner than callers hard-coding model strings + a purpose tag.
 *
 * @param purpose - Routing key (analyst, scholar, holistic, strategist, etc.)
 * @param prompt - The prompt to generate text for
 * @param opts.userId - Cost-attribution
 * @param opts.userGeminiKey - Per-user Gemini API key (overrides .env default)
 * @param opts.model - Explicit override (skips MODEL_ROUTING lookup)
 */
export async function generateTextForPurpose(
  purpose: string,
  prompt: string,
  opts: { userId?: string; userGeminiKey?: string; model?: string } = {},
): Promise<string> {
  const model = opts.model || selectModel(purpose);
  return generateText(model, prompt, opts.userGeminiKey, {
    userId: opts.userId,
    purpose,
  });
}

/**
 * Smart Model Router — picks the right provider based on model prefix.
 *
 * "groq/llama-3.3-70b-versatile" → Groq API
 * "gemini-2.5-flash"             → Google GenAI
 * "gemma-4-31b-it"               → Google GenAI
 *
 * If the primary provider fails, automatically falls back to the other.
 *
 * @param model - Model identifier (e.g., "gemini-2.5-flash" or "groq/llama-3.3-70b")
 * @param prompt - The prompt to generate text for
 * @param userGeminiKey - Optional per-user Gemini API key (overrides .env default)
 * @param opts - Cost-telemetry tagging: { userId, purpose }
 */
export async function generateText(
  model: string,
  prompt: string,
  userGeminiKey?: string,
  opts: CallOpts = {},
): Promise<string> {
  const isGroq = model.startsWith('groq/');
  const actualModel = isGroq ? model.slice(5) : model;
  const purpose = opts.purpose || 'unknown';
  const userId = opts.userId;

  // Try primary provider
  try {
    if (isGroq) {
      return await callGroq(actualModel, prompt, { userId, purpose });
    } else {
      return await callGemini(actualModel, prompt, userGeminiKey, { userId, purpose });
    }
  } catch (primaryError: any) {
    console.warn(`[Router] Primary provider failed (${isGroq ? 'Groq' : 'Gemini'}): ${primaryError.message}`);

    // Automatic fallback to the other provider
    try {
      if (isGroq) {
        console.log('[Router] Falling back to Gemini...');
        return await callGemini('gemini-2.5-flash', prompt, userGeminiKey, { userId, purpose: `${purpose}-fallback` });
      } else {
        if (!GROQ_API_KEY) throw primaryError; // No Groq key, can't fallback
        console.log('[Router] Falling back to Groq llama-3.3-70b-versatile...');
        return await callGroq('llama-3.3-70b-versatile', prompt, { userId, purpose: `${purpose}-fallback` });
      }
    } catch (fallbackError: any) {
      console.error(`[Router] Fallback also failed: ${fallbackError.message}`);
      throw primaryError; // Throw the original error
    }
  }
}

async function callGemini(model: string, prompt: string, userKey?: string, opts: CallOpts = {}): Promise<string> {
  const ai = getGeminiInstance(userKey);
  console.log(`[Router] Using Gemini: ${model}${userKey ? ' (user key)' : ' (default key)'}`);
  const response: any = await ai.models.generateContent({
    model,
    contents: prompt
  });
  const text = response.text;
  if (!text) throw new Error('Gemini returned empty response');

  // Telemetry (fire-and-forget — never blocks the response)
  try {
    const usage = response.usageMetadata || {};
    recordCall({
      provider: 'gemini',
      model,
      purpose: opts.purpose || 'unknown',
      inputTokens: Number(usage.promptTokenCount) || 0,
      outputTokens: Number(usage.candidatesTokenCount) || 0,
      userId: opts.userId,
    });
  } catch (err: any) {
    console.error('[Router] cost record failed (gemini):', err?.message);
  }

  return text;
}

async function callGroq(model: string, prompt: string, opts: CallOpts = {}): Promise<string> {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');
  console.log(`[Router] Using Groq: ${model}`);

  const res = await fetch(GROQ_BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
      temperature: 0.3
    })
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Groq HTTP ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq returned empty response');

  // Telemetry (fire-and-forget)
  try {
    const usage = data.usage || {};
    recordCall({
      provider: 'groq',
      model,
      purpose: opts.purpose || 'unknown',
      inputTokens: Number(usage.prompt_tokens) || 0,
      outputTokens: Number(usage.completion_tokens) || 0,
      userId: opts.userId,
    });
  } catch (err: any) {
    console.error('[Router] cost record failed (groq):', err?.message);
  }

  return text;
}
