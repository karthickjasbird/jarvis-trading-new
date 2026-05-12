import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
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
 */
export async function generateText(model: string, prompt: string, userGeminiKey?: string): Promise<string> {
  const isGroq = model.startsWith('groq/');
  const actualModel = isGroq ? model.slice(5) : model;

  // Try primary provider
  try {
    if (isGroq) {
      return await callGroq(actualModel, prompt);
    } else {
      return await callGemini(actualModel, prompt, userGeminiKey);
    }
  } catch (primaryError: any) {
    console.warn(`[Router] Primary provider failed (${isGroq ? 'Groq' : 'Gemini'}): ${primaryError.message}`);

    // Automatic fallback to the other provider
    try {
      if (isGroq) {
        console.log('[Router] Falling back to Gemini...');
        return await callGemini('gemini-2.5-flash', prompt, userGeminiKey);
      } else {
        if (!GROQ_API_KEY) throw primaryError; // No Groq key, can't fallback
        console.log('[Router] Falling back to Groq llama-3.3-70b-versatile...');
        return await callGroq('llama-3.3-70b-versatile', prompt);
      }
    } catch (fallbackError: any) {
      console.error(`[Router] Fallback also failed: ${fallbackError.message}`);
      throw primaryError; // Throw the original error
    }
  }
}

async function callGemini(model: string, prompt: string, userKey?: string): Promise<string> {
  const ai = getGeminiInstance(userKey);
  console.log(`[Router] Using Gemini: ${model}${userKey ? ' (user key)' : ' (default key)'}`);
  const response = await ai.models.generateContent({
    model,
    contents: prompt
  });
  const text = response.text;
  if (!text) throw new Error('Gemini returned empty response');
  return text;
}

async function callGroq(model: string, prompt: string): Promise<string> {
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
  return text;
}
