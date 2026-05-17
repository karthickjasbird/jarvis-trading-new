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
    'goalExecutor.ts': 'Autonomous campaign manager — multi-trade goal execution with trade chaining, slot management, and auto-compounding',
    'regimeDetector.ts': 'Market regime detection — classifies markets as trending_up, trending_down, ranging, or volatile using ADX/ATR/EMA',
    'kellyCalculator.ts': 'Kelly Criterion position sizing — mathematically optimal bet sizes based on historical win rate and payoff ratios',
    'manifestGenerator.ts': 'Self-awareness system — auto-scans codebase to generate Jarvis knowledge manifest',
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
    'Real-time cryptocurrency price monitoring via Binance WebSocket',
    'Paper trading with $100K virtual balance',
    'Live trading via Binance and Zerodha broker APIs',
    `${engines.length} specialized engines running concurrently`,
    `${apiRouteCount} API endpoints available`,
    '6-agent autonomous trading pipeline (Agent Swarm)',
    'Vector memory bank with semantic search (remembers trade lessons)',
    'Two-way Telegram bot for trade notifications and chat',
    'Technical analysis: RSI, MACD, EMA, Bollinger Bands, ATR',
    'Historical backtesting and strategy optimization',
    'Risk management: daily loss limits, position sizing, circuit breaker',
    'Web scraping and targeted learning from any URL',
    'Multi-tenant: each user runs their own isolated instance',
    'Auto-updating: version checker compares local vs GitHub',
    'Campaign Manager: autonomous multi-trade goal campaigns with trade chaining and auto-compounding',
    'Market Regime Detection: ADX/ATR/EMA-based trending/ranging/volatile classification',
    'Kelly Position Sizing: mathematically optimal bet sizing from historical trade data',
    'TA-driven market scoring: bearish coins can never score above 45, only BUY signals in Jarvis Picks',
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
