/**
 * Visual Chart Analyzer — Project NEXUS Phase 6 ("AI Eyes")
 *
 * Sends a TradingView chart screenshot to Gemini Vision and returns a
 * structured interpretation: chart patterns, support/resistance, market
 * structure, overall bias.
 *
 * This is the perceptual upgrade — Jarvis sees what a human trader sees,
 * catching multi-bar visual setups (head-and-shoulders, wedges, channels,
 * flag patterns, trendline breaks) that single-value indicators miss.
 *
 * Use:
 *   const analysis = await analyzeChart(tvBridge, { symbol: 'ETH/USDT', timeframe: '4h' });
 */
import { GoogleGenAI } from '@google/genai';
import { TradingViewBridge, Timeframe } from './tradingViewBridge.ts';

// ─── Output schema ────────────────────────────────────────────────────────

export type Direction = 'bullish' | 'bearish' | 'neutral';
export type Confidence = 'high' | 'medium' | 'low';
export type PatternType = 'reversal' | 'continuation' | 'consolidation';
export type MarketStructure = 'uptrend' | 'downtrend' | 'sideways' | 'transitional';

export interface DetectedPattern {
  name: string;              // e.g. "Head and Shoulders", "Ascending Triangle"
  type: PatternType;
  direction: Direction;
  confidence: Confidence;
  location: string;          // free-text where on chart, e.g. "forming in the last 8 candles"
}

export interface VisualChartAnalysis {
  symbol?: string;
  timeframe?: string;
  patterns: DetectedPattern[];
  support: number[];
  resistance: number[];
  structure: MarketStructure;
  bias: Direction;
  conviction: number;        // 0-100
  reasoning: string;
  raw?: string;              // Raw model output for debugging
  parseError?: string;
  capturedAt: number;
  model: string;
  latencyMs: number;
}

const DEFAULT_VISION_MODEL = 'gemini-2.5-flash';

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildAnalysisPrompt(symbol?: string, timeframe?: string): string {
  const context = [
    symbol ? `Symbol: ${symbol}` : null,
    timeframe ? `Timeframe: ${timeframe}` : null,
  ].filter(Boolean).join('\n');

  return `You are a professional technical chart analyst. Analyze this TradingView chart screenshot.

${context}

IDENTIFY (be CONSERVATIVE — do not invent patterns that aren't clearly visible):

1. CHART PATTERNS — head-and-shoulders (regular/inverse), double top/bottom, triangles (ascending/descending/symmetrical), wedges (rising/falling), flags, pennants, channels, cup-and-handle.
2. SUPPORT & RESISTANCE — Key price levels where price has clearly reacted. List up to 3 of each, in price units shown on the right-side y-axis.
3. MARKET STRUCTURE — higher highs/lows (uptrend), lower highs/lows (downtrend), sideways consolidation, or transitional/unclear.
4. OVERALL BIAS — bullish, bearish, or neutral, with a conviction percentage (0-100) based on how aligned the signals are.

Respond ONLY in this exact JSON format (no markdown fences, no commentary before or after):
{
  "patterns": [
    {"name": "string", "type": "reversal|continuation|consolidation", "direction": "bullish|bearish|neutral", "confidence": "high|medium|low", "location": "string"}
  ],
  "support": [number, ...],
  "resistance": [number, ...],
  "structure": "uptrend|downtrend|sideways|transitional",
  "bias": "bullish|bearish|neutral",
  "conviction": 0,
  "reasoning": "2-3 sentence summary explaining the bias"
}

If no clear patterns are visible, return an empty patterns array. If support/resistance levels aren't well-defined, return empty arrays. Honesty about uncertainty is more valuable than invented signals.`;
}

/**
 * Extract the first JSON object from the model's text response.
 * Strips ```json fences and leading/trailing prose if present.
 */
function extractJSON(text: string): any | null {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function asNumberArray(v: any): number[] {
  if (!Array.isArray(v)) return [];
  return v.filter((n: any) => typeof n === 'number' && !Number.isNaN(n));
}

function asPattern(v: any): DetectedPattern | null {
  if (!v || typeof v !== 'object') return null;
  if (typeof v.name !== 'string' || !v.name) return null;
  return {
    name: v.name,
    type: (['reversal', 'continuation', 'consolidation'].includes(v.type) ? v.type : 'continuation') as PatternType,
    direction: (['bullish', 'bearish', 'neutral'].includes(v.direction) ? v.direction : 'neutral') as Direction,
    confidence: (['high', 'medium', 'low'].includes(v.confidence) ? v.confidence : 'low') as Confidence,
    location: typeof v.location === 'string' ? v.location : '',
  };
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface AnalyzeChartOptions {
  symbol?: string;
  timeframe?: string;
  model?: string;            // Override default Gemini vision model
  userGeminiKey?: string;    // Per-user API key (overrides GEMINI_API_KEY env)
  chartOnly?: boolean;       // Crop to chart pane (default true — cleaner input)
}

/**
 * Analyze a screenshot buffer directly with Gemini Vision.
 * Use this if you already have the image; otherwise call analyzeChart(bridge).
 */
export async function analyzeChartImage(
  imageBuffer: Buffer,
  opts: AnalyzeChartOptions = {}
): Promise<VisualChartAnalysis> {
  const model = opts.model ?? DEFAULT_VISION_MODEL;
  const apiKey = opts.userGeminiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildAnalysisPrompt(opts.symbol, opts.timeframe);
  const base64 = imageBuffer.toString('base64');

  console.log(`[Vision] Analyzing chart${opts.symbol ? ` (${opts.symbol} ${opts.timeframe ?? ''})` : ''} via ${model} — ${imageBuffer.length} bytes`);

  const t0 = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/png', data: base64 } },
        ],
      },
    ],
  });
  const latencyMs = Date.now() - t0;

  const raw = response.text ?? '';
  const parsed = extractJSON(raw);

  const base: VisualChartAnalysis = {
    symbol: opts.symbol,
    timeframe: opts.timeframe,
    patterns: [],
    support: [],
    resistance: [],
    structure: 'transitional',
    bias: 'neutral',
    conviction: 0,
    reasoning: '',
    raw,
    capturedAt: Date.now(),
    model,
    latencyMs,
  };

  if (!parsed) {
    return { ...base, parseError: 'Could not extract JSON from model response' };
  }

  const patterns: DetectedPattern[] = Array.isArray(parsed.patterns)
    ? (parsed.patterns.map(asPattern).filter(Boolean) as DetectedPattern[])
    : [];

  return {
    ...base,
    patterns,
    support: asNumberArray(parsed.support),
    resistance: asNumberArray(parsed.resistance),
    structure: (['uptrend', 'downtrend', 'sideways', 'transitional'].includes(parsed.structure) ? parsed.structure : 'transitional') as MarketStructure,
    bias: (['bullish', 'bearish', 'neutral'].includes(parsed.bias) ? parsed.bias : 'neutral') as Direction,
    conviction: typeof parsed.conviction === 'number' ? Math.max(0, Math.min(100, parsed.conviction)) : 0,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  };
}

/**
 * Take a screenshot of the current TradingView chart via bridge,
 * then analyze it with Gemini Vision.
 */
export async function analyzeChart(
  bridge: TradingViewBridge,
  opts: AnalyzeChartOptions = {}
): Promise<VisualChartAnalysis> {
  const buffer = await bridge.screenshot({ chartOnly: opts.chartOnly ?? true });
  return analyzeChartImage(buffer, opts);
}

/**
 * Analyze multiple timeframes in sequence. Switches the active TV chart
 * between captures, so the user's view WILL flicker. Returns one analysis
 * per requested timeframe.
 */
export async function analyzeChartMultiTimeframe(
  bridge: TradingViewBridge,
  timeframes: Timeframe[],
  opts: Omit<AnalyzeChartOptions, 'timeframe'> = {}
): Promise<VisualChartAnalysis[]> {
  const results: VisualChartAnalysis[] = [];
  for (const tf of timeframes) {
    await bridge.setTimeframe(tf);
    await new Promise(r => setTimeout(r, 1500)); // let TV render
    results.push(await analyzeChart(bridge, { ...opts, timeframe: tf }));
  }
  return results;
}
