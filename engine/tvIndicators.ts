/**
 * TradingView Indicator Parsers — Project NEXUS Phase 5b
 *
 * Takes the raw legend data from `tradingViewBridge.ts` and produces typed,
 * structured indicator values that the rest of Jarvis (technicalAnalysis,
 * agentSwarm, etc.) can consume.
 *
 * Per-indicator parsers (one regex schema per indicator) — see PHASE.md plan.
 */
import { TradingViewBridge, ChartLegendItem } from './tradingViewBridge.ts';

// ─── Typed indicator readings ─────────────────────────────────────────────

export interface RSIReading {
  value: number;
  signalMA: number | null;   // Optional moving-average overlay on RSI
  period?: number;            // Parsed from title "RSI14close" → 14
  source?: string;            // e.g. "close" / "open"
}

export interface IchimokuReading {
  tenkan: number | null;     // Conversion Line
  kijun: number | null;      // Base Line
  chikou: number | null;     // Lagging Span (≈ current price)
  senkouA: number | null;    // Leading Span A (cloud edge 1)
  senkouB: number | null;    // Leading Span B (cloud edge 2)
}

export interface SupertrendReading {
  value: number;
  direction?: 'bullish' | 'bearish';
}

export interface VolumeReading {
  current: number;
}

export interface TVIndicatorReading {
  symbol: string | null;      // e.g. "ETHUSDT" (from tab title — most reliable)
  exchange: string | null;    // e.g. "Binance"
  timeframe: string | null;   // e.g. "4h"
  rsi: RSIReading | null;
  ichimoku: IchimokuReading | null;
  supertrend: SupertrendReading | null;
  volume: VolumeReading | null;
  rawLegend: ChartLegendItem[];
  parseErrors: string[];
  capturedAt: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const UNICODE_MINUS = /−/g;  // TradingView uses U+2212 instead of ASCII '-'

/**
 * Extract floating-point numbers from a TV value string.
 * Supports both comma-thousand-separated ("2,105.88") and plain decimal ("32.18").
 * Strict decimal-count avoids the greedy-match bug where ".882,107.75" gets eaten as one number.
 *
 * @param decimals - Exact decimal places to require. Default 2 (works for ETH/BTC/RSI).
 *                   Reduce to handle low-precision values; increase for low-price altcoins.
 */
export function extractFloats(text: string, decimals: number = 2): number[] {
  const t = text.replace(UNICODE_MINUS, '-');
  const re = new RegExp(
    `-?\\d{1,3}(?:,\\d{3})+\\.\\d{${decimals}}|-?\\d+\\.\\d{${decimals}}`,
    'g'
  );
  return (t.match(re) ?? [])
    .map(s => parseFloat(s.replace(/,/g, '')))
    .filter(n => !Number.isNaN(n));
}

// ─── Per-indicator parsers ────────────────────────────────────────────────

/** Parse the RSI legend item. Title looks like "RSI14close" (period=14, source=close). */
export function parseRSI(item: ChartLegendItem): RSIReading | null {
  const titleMatch = item.title.match(/RSI(\d+)?(\w+)?/i);
  const period = titleMatch?.[1] ? parseInt(titleMatch[1], 10) : undefined;
  const source = titleMatch?.[2] || undefined;

  const nums = extractFloats(item.values[0] ?? '');
  if (nums.length === 0) return null;
  return {
    value: nums[0],
    signalMA: nums[1] ?? null,
    period,
    source,
  };
}

/**
 * Parse Ichimoku Cloud. TV legend order: Tenkan, Kijun, Chikou, Senkou A, Senkou B.
 * Title looks like "Ichimoku9265226" — settings packed together (9/26/52/26).
 */
export function parseIchimoku(item: ChartLegendItem): IchimokuReading | null {
  const nums = extractFloats(item.values[0] ?? '');
  if (nums.length < 5) return null;
  return {
    tenkan: nums[0],
    kijun: nums[1],
    chikou: nums[2],
    senkouA: nums[3],
    senkouB: nums[4],
  };
}

/** Parse Supertrend — a single price-line value. */
export function parseSupertrend(item: ChartLegendItem): SupertrendReading | null {
  const nums = extractFloats(item.values[0] ?? '');
  if (nums.length === 0) return null;
  return { value: nums[0] };
}

/** Parse Volume — handles K/M/B suffixes, e.g. "28.94 K∅" → 28_940. */
export function parseVolume(item: ChartLegendItem): VolumeReading | null {
  const raw = (item.values[0] ?? '').replace(UNICODE_MINUS, '-');
  const m = raw.match(/-?\d+(?:\.\d+)?\s*([KMBkmb])?/);
  if (!m) return null;
  let num = parseFloat(m[0]);
  if (Number.isNaN(num)) return null;
  const suffix = m[1]?.toUpperCase();
  if (suffix === 'K') num *= 1_000;
  else if (suffix === 'M') num *= 1_000_000;
  else if (suffix === 'B') num *= 1_000_000_000;
  return { current: num };
}

/**
 * Parse the main symbol pane title for exchange + timeframe metadata.
 * Title is concatenated without spaces, e.g. "EEthereum / TetherUS4hBinance".
 * Ticker is NOT parsed here — use bridge.healthCheck().tabTitle which is more reliable.
 */
export function parseMainPane(item: ChartLegendItem): { exchange: string | null; timeframe: string | null } {
  const tfMatch = item.title.match(/(1m|3m|5m|15m|30m|1h|2h|4h|6h|12h|1D|1d|1W|1w|1M)/);
  const exchanges = ['Binance', 'Coinbase', 'Kraken', 'Bybit', 'KuCoin', 'OKX', 'Bitstamp', 'Bitfinex'];
  const exchange = exchanges.find(ex => item.title.includes(ex)) ?? null;
  return { exchange, timeframe: tfMatch?.[1] ?? null };
}

// ─── Main entry ───────────────────────────────────────────────────────────

/**
 * Read all known indicators from the bridge's active TradingView tab.
 * Returns a structured snapshot — never throws (errors are collected in parseErrors).
 */
export async function readTVIndicators(bridge: TradingViewBridge): Promise<TVIndicatorReading> {
  const out: TVIndicatorReading = {
    symbol: null,
    exchange: null,
    timeframe: null,
    rsi: null,
    ichimoku: null,
    supertrend: null,
    volume: null,
    rawLegend: [],
    parseErrors: [],
    capturedAt: Date.now(),
  };

  // 1. Symbol comes from the browser tab title — most reliable
  try {
    const status = await bridge.healthCheck();
    if (status.tabTitle) {
      const tickerMatch = status.tabTitle.match(/^([A-Z]+(?:\/[A-Z]+)?)\s/);
      if (tickerMatch) out.symbol = tickerMatch[1];
    }
  } catch (e: any) {
    out.parseErrors.push(`healthCheck: ${e.message}`);
  }

  // 2. Scrape the legend
  let legend: ChartLegendItem[];
  try {
    legend = await bridge.getChartLegend();
    out.rawLegend = legend;
  } catch (e: any) {
    out.parseErrors.push(`getChartLegend: ${e.message}`);
    return out;
  }

  // 3. Walk the legend and parse each known indicator by title prefix
  for (const item of legend) {
    if (item.isSymbol) {
      const meta = parseMainPane(item);
      out.exchange = meta.exchange;
      out.timeframe = meta.timeframe;
      continue;
    }
    const titleLower = item.title.toLowerCase();
    try {
      if (titleLower.startsWith('rsi')) {
        out.rsi = parseRSI(item);
        if (!out.rsi) out.parseErrors.push('RSI parser returned null');
      } else if (titleLower.startsWith('ichimoku')) {
        out.ichimoku = parseIchimoku(item);
        if (!out.ichimoku) out.parseErrors.push('Ichimoku parser returned null');
      } else if (titleLower.startsWith('supertrend')) {
        out.supertrend = parseSupertrend(item);
        if (!out.supertrend) out.parseErrors.push('Supertrend parser returned null');
      } else if (titleLower.startsWith('vol')) {
        out.volume = parseVolume(item);
      }
      // Unknown indicators are silently skipped — Phase 5 only parses the four above.
      // Future: add more parsers (MACD, Bollinger, Stochastic, Pine Scripts) as needed.
    } catch (e: any) {
      out.parseErrors.push(`${item.title}: ${e.message}`);
    }
  }

  return out;
}
