import fs from 'fs';
import path from 'path';

/**
 * ManifestGenerator — Auto-scans the Jarvis codebase on server startup
 * and produces a structured manifest of all capabilities. This manifest
 * is injected into Jarvis's Gemini Live system prompt so he automatically
 * knows about every engine, API route, and recent change.
 */

export interface AppManifest {
  version: string;
  buildDate: string;
  changelog: string;
  engines: EngineInfo[];
  apiRouteCount: number;
  apiCategories: { category: string; routes: string[] }[];
  recentChanges: string[];
  capabilities: string[];
  generatedAt: string;
}

interface EngineInfo {
  name: string;
  file: string;
  description: string;
  isOwnerScoped: boolean;
}

/**
 * Scan engine directory and extract class names + descriptions from file headers.
 */
function scanEngines(projectRoot: string): EngineInfo[] {
  const engineDir = path.join(projectRoot, 'engine');
  const engines: EngineInfo[] = [];

  const engineDescriptions: Record<string, string> = {
    'sentry.ts': 'Real-time trade monitoring — TP/SL/Trailing Stops/Kill Switch',
    'tradeExecutor.ts': 'Trade execution (Paper + Live via Binance/Zerodha)',
    'agentSwarm.ts': '6-agent autonomous intelligence pipeline (Scout→Analyst→Scholar→Strategist→Sentinel→Executor)',
    'positionMonitor.ts': 'Stale trade detection and auto-close',
    'portfolioIntel.ts': 'Portfolio-wide risk analysis, correlation guard, circuit breaker',
    'postMortem.ts': 'AI analysis of closed trades — lessons and grading',
    'strategyTracker.ts': 'Win rate tracking and auto-disable of losing strategies',
    'memory.ts': 'Vector Memory Bank — embeddings + semantic search',
    'modelRouter.ts': 'Smart model routing: Gemini (primary) → Groq (fallback)',
    'marketScanner.ts': 'Multi-pair market scanner with TA scoring',
    'technicalAnalysis.ts': 'RSI, MACD, EMA, Bollinger Bands, ATR analysis',
    'confidenceEngine.ts': 'Trade confidence scoring system',
    'binancePriceFeed.ts': 'Real-time Binance WebSocket price feed',
    'telegram.ts': 'Telegram notification sender',
    'telegramListener.ts': 'Two-way Telegram chat with Jarvis AI',
    'alertEngine.ts': 'Proactive price alert system',
    'marketIntel.ts': 'News + whale activity aggregation',
    'scraper.ts': 'Background market data scraping',
    'webAgent.ts': 'Web page scraping + learning (Targeted Learning)',
    'goalPlanner.ts': 'Autonomous trading goal management',
    'correlationGuard.ts': 'Position correlation detection',
    'atrCalculator.ts': 'ATR-based dynamic position sizing',
    'backtestEngine.ts': 'Historical backtesting engine',
    'userSecrets.ts': 'Per-user encrypted API key storage',
    'goalExecutor.ts': 'Autonomous campaign manager — multi-trade goal execution with trade chaining, slot management, auto-compounding, and Deadline-Aware Strategy Router (scalp/day/swing/position buckets that pick markets, timeframe, and Kelly multiplier from time-to-deadline)',
    'regimeDetector.ts': 'Market regime detection — classifies markets as trending_up, trending_down, ranging, or volatile using ADX/ATR/EMA',
    'kellyCalculator.ts': 'Kelly Criterion position sizing — mathematically optimal bet sizes based on historical win rate and payoff ratios',
    'manifestGenerator.ts': 'Self-awareness system — auto-scans codebase to generate Jarvis knowledge manifest',
    'alpacaConnector.ts': 'Alpaca REST connector — US stocks and commodity ETFs (paper + live). Mirrors ccxt return shape for the executor; provides market clock, latest quote, bars, market orders, position queries',
    'tradeDiary.ts': 'Decision audit trail — logs every swarm decision (incl. vetoes, rejections, regime skips) and serves lessons-learned to the Sentinel for symbol-specific risk recall',
    'tradingViewBridge.ts': 'TradingView Bridge — puppeteer-core CDP attach to a user-launched Chrome. setSymbol/setTimeframe/screenshot/evaluate plus a chart-legend reader',
    'tvIndicators.ts': 'TradingView indicator parsers — reads RSI, Ichimoku, Supertrend, Volume from the TV chart legend DOM and overlays values onto local snapshots',
    'tvVision.ts': 'AI Vision chart analysis — Gemini 2.5-flash reads TradingView screenshots for patterns, S/R levels, and directional bias. Single-TF + multi-TF entry points',
  };

  const ownerScopedEngines = ['sentry.ts', 'agentSwarm.ts', 'positionMonitor.ts', 'portfolioIntel.ts'];

  try {
    const files = fs.readdirSync(engineDir).filter(f => f.endsWith('.ts'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(engineDir, file), 'utf-8');
      const classMatch = content.match(/export class (\w+)/);
      engines.push({
        name: classMatch ? classMatch[1] : file.replace('.ts', ''),
        file: `engine/${file}`,
        description: engineDescriptions[file] || 'Backend engine module',
        isOwnerScoped: ownerScopedEngines.includes(file),
      });
    }
  } catch {
    // Engine directory not found
  }

  return engines;
}

/**
 * Scan server.ts and extract API route categories.
 */
function scanApiRoutes(projectRoot: string): { count: number; categories: { category: string; routes: string[] }[] } {
  const serverPath = path.join(projectRoot, 'server.ts');
  const routesByCategory: Record<string, string[]> = {};

  try {
    const content = fs.readFileSync(serverPath, 'utf-8');
    const routePattern = /app\.(get|post|put|delete|patch)\s*\(\s*["'`](\/api\/[^"'`]+)["'`]/g;
    let match;

    while ((match = routePattern.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const routePath = match[2];
      const category = routePath.split('/')[2] || 'system'; // e.g., /api/trade → "trade"
      
      if (!routesByCategory[category]) routesByCategory[category] = [];
      routesByCategory[category].push(`${method} ${routePath}`);
    }
  } catch {
    // server.ts not found
  }

  const categories = Object.entries(routesByCategory).map(([category, routes]) => ({
    category,
    routes,
  }));

  return {
    count: categories.reduce((sum, c) => sum + c.routes.length, 0),
    categories,
  };
}

/**
 * Get recent git commits.
 */
function getRecentGitCommits(projectRoot: string, limit: number = 5): string[] {
  try {
    const { execSync } = require('child_process');
    const output = execSync(`git log --oneline -${limit}`, { cwd: projectRoot, encoding: 'utf-8' });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return ['Git history unavailable'];
  }
}

/**
 * Generate the full app manifest.
 */
export function generateAppManifest(projectRoot: string): AppManifest {
  // Read version info
  let version = 'unknown';
  let buildDate = '';
  let changelog = '';
  try {
    const versionFile = JSON.parse(fs.readFileSync(path.join(projectRoot, 'version.json'), 'utf-8'));
    version = versionFile.version || 'unknown';
    buildDate = versionFile.buildDate || '';
    changelog = versionFile.changelog || '';
  } catch {}

  const engines = scanEngines(projectRoot);
  const { count: apiRouteCount, categories: apiCategories } = scanApiRoutes(projectRoot);
  const recentChanges = getRecentGitCommits(projectRoot);

  // Derive human-readable capabilities
  const capabilities = [
    // Asset universe
    'Multi-market trading: 48 curated crypto pairs (Binance) + 33 US stocks + 6 commodity ETFs (Alpaca) — 87 instruments scanned',
    'Crypto sectors covered: L1, L2, DeFi, AI, Meme, RWA, Gaming, Utility, DEX/Oracle infra',
    'US equity sectors covered: mega-cap tech, semis/AI hardware, software/cloud, finance/payments, consumer/retail, index ETFs, commodity ETFs (GLD/SLV/USO/UNG/DBA/COPX)',
    // Broker paths
    'Live broker routing: Binance + Bybit (crypto via ccxt), Zerodha (Indian equities via Kite), Alpaca (US stocks + commodity ETFs)',
    'Paper trading with $100K virtual balance — same code path as live, just isPractice=true',
    'Market-hours guard: stock orders pre-check Alpaca clock and reject cleanly when US session closed',
    // Pipeline
    '7-step autonomous decision pipeline: Regime → Scout → Analyst + Scholar → Holistic (Gemini Vision + TV legend) → Strategist → Sentinel → Executor',
    'TradingView Bridge: puppeteer CDP attach to a user-launched Chrome — Jarvis can read the same chart you are looking at (symbol/timeframe/screenshot/legend values)',
    'AI Vision chart analysis: Gemini 2.5-flash reads TradingView screenshots for patterns, S/R levels, and directional bias',
    'Trade Diary: every decision (including vetoes and regime skips) is logged; the Sentinel queries past losses on the symbol to inject lessons learned before the next entry',
    // Risk math
    'Kelly Criterion position sizing × Regime multiplier × Deadline-aware Strategy multiplier',
    'Deadline-Aware Strategy Router: maps remaining time-to-deadline to one of 4 buckets — scalp (<6h, crypto only, 1H, Kelly ×1.3), day (6h-3d, +stocks when US open, 1H/4H), swing (3-14d, +commodities, 4H, Kelly ×0.9), position (>14d, 1D, Kelly ×0.8)',
    'Market Regime Detection: ADX/ATR/EMA-based trending/ranging/volatile classification with per-regime position-size and SL/TP multipliers',
    'TA-driven crypto scanner: OBV, VWAP, RSI, MACD, EMA, Bollinger Bands, ATR, ADX across 1H/4H/1D — bearish coins capped at score 45, only BUY signals reach Jarvis Picks',
    'Risk management: daily loss limits, max position size %, max open positions, correlation guard, circuit breaker',
    // Learning + memory
    'Vector Memory Bank with semantic search (Gemini embeddings) — Jarvis remembers trade lessons across sessions',
    'PostMortem grader: A-F grades on closed trades with extracted lessons',
    'Strategy tracker: per-strategy win rates with auto-disable of losers',
    'Confidence Engine: 0-100% live-ready readiness score derived from track record',
    // Interfaces
    'Voice-first: Gemini Live tool-calling — Jarvis can be talked to and asked to trade, scan, explain, or check status',
    'Two-way Telegram bot: trade notifications, approval replies, status queries',
    'Self-awareness: this manifest is auto-regenerated on every startup so Jarvis knows about every engine, route, and capability without manual prompt-engineering',
    // Infra
    `${engines.length} specialized engines running concurrently`,
    `${apiRouteCount} API endpoints available`,
    'Multi-tenant: each user is isolated by OWNER_USER_ID with per-user encrypted API key storage',
    'Auto-updating: version checker compares local vs GitHub',
  ];

  return {
    version,
    buildDate,
    changelog,
    engines,
    apiRouteCount,
    apiCategories,
    recentChanges,
    capabilities,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format the manifest into a concise string for injection into the Gemini system prompt.
 * Keeps it under ~2000 tokens while covering everything Jarvis needs.
 */
export function formatManifestForPrompt(manifest: AppManifest): string {
  const engineList = manifest.engines
    .map(e => `• ${e.name}: ${e.description}`)
    .join('\n');

  const routeSummary = manifest.apiCategories
    .map(c => `• ${c.category}: ${c.routes.length} endpoints`)
    .join('\n');

  const recentChanges = manifest.recentChanges
    .slice(0, 5)
    .map(c => `• ${c}`)
    .join('\n');

  const capabilities = manifest.capabilities
    .map(c => `• ${c}`)
    .join('\n');

  return `
[APPLICATION SELF-AWARENESS — Auto-Generated on Startup]
You are running Jarvis Trading Platform v${manifest.version} (built ${manifest.buildDate}).
This section was auto-generated by scanning the codebase. You know about every feature below.

ENGINES (${manifest.engines.length} active):
${engineList}

API ENDPOINTS (${manifest.apiRouteCount} total):
${routeSummary}

CAPABILITIES:
${capabilities}

RECENT GIT CHANGES:
${recentChanges}

CHANGELOG: ${manifest.changelog}

You can use the "inspectSystem" tool to get live details about any aspect of the system.
If the user asks about features, engines, or capabilities — you know them all from the list above.
If the user asks about recent updates, reference the git changes above.
`.trim();
}
