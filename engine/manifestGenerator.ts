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
    'killSwitch.ts': 'Kill Switch — file-based panic button. Watches $HOME/.jarvis-halt and ./HALT_TRADING; when either is present, blocks ALL new exposure (entries + campaign deploys). Closes/partial-closes remain unblocked so users can still exit positions while halted. UI toggle in JarvisBrain header. POST /api/halt to halt, POST /api/resume to clear.',
    'costMeter.ts': 'Cost Telemetry — tracks USD spend per LLM call with purpose tags (scout/analyst/scholar/holistic/strategist/sentinel/sentiment/scanner-signal/etc). In-memory rolling 24h buffer + fire-and-forget Firestore writes to apiUsage. Powers the amber $X.XX pill + breakdown popover in JarvisBrain.',
    'riskGate.ts': 'Risk Gate — single audit point for every position-opening write. Runs 6 checks (KILL_SWITCH / DAILY_LOSS / NOTIONAL_CAP / CONCURRENT_CAP / LIVE_CAPITAL_CAP / LEVERAGE_CAP) and returns a structured RiskCheckResult with code + reason. tradeExecutor.execute calls this before any side effect.',
    'curriculum.ts': 'Trading Curriculum — 21 dense, keyword-rich lessons across 10 classes (foundation, ta, risk, entry, exit, psych, regime, crypto, meta). Embedded into vector memory via POST /api/memory/learn-curriculum so Scholar surfaces them on every recall. Examples: "RSI lies in trending markets", "Counter-trend traps in bearish regimes", "Let winners run".',
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

  // Derive human-readable capabilities (refreshed for v1.5.0 — 2026-05-26)
  const capabilities = [
    // ─── Asset universe ───
    'Multi-market: 48 curated crypto pairs (Binance) + 33 US stocks + 6 commodity ETFs (Alpaca) — 87 instruments scanned every cycle',
    'Live broker routing: Binance + Bybit (ccxt), Zerodha (KiteConnect), Alpaca (US stocks/ETFs). Paper trading uses same code path with isPractice=true.',
    'Market-hours guard: stock orders pre-check Alpaca clock and reject cleanly when US session is closed',

    // ─── Decision pipeline ───
    '7-step autonomous pipeline: Regime → Scout → Analyst + Scholar (parallel) → Holistic (full-context + Vision) → Strategist (ATR sizing) → Sentinel (gate) → Executor',
    'Per-symbol regime override (Phase 7): the symbol Scout picks may be in a different regime than the overall market — Strategist uses the symbol\'s own regime for SL/TP sizing (verified: NEAR sized as VOLATILE/breakout even when overall market is RANGING)',
    'TradingView Bridge with auto-connect on startup + auto-navigate before vision: when Karthick has Chrome running with --remote-debugging-port=9222, Jarvis attaches to that chart, flips it to whatever symbol he is analyzing, and reads it visually',
    'Gemini Vision chart analysis: takes screenshots of the live TV chart and extracts bias, patterns, support/resistance levels',

    // ─── Risk + execution rules (live-enforced) ───
    'Risk Gate with 6 structured codes (Phase 9.3): KILL_SWITCH / DAILY_LOSS / NOTIONAL_CAP / CONCURRENT_CAP / LIVE_CAPITAL_CAP / LEVERAGE_CAP — every veto returns a code + human reason, no silent rejections',
    'Sentinel enforces 1.5:1 R/R floor + 60% confidence floor on every proposal; Strategist auto-corrects sub-1.5:1 R/R by widening TP before Sentinel sees it (Phase 7 Fix C — defense-in-depth)',
    'Bleed-hour filter: configurable IST AM/PM window (default 5 PM → 12 AM IST) requires ≥75% confidence — derived from track-record analysis showing those hours bleed money',
    'Kill switch (Phase 9.1): file-based panic button. `touch HALT_TRADING` or click the red pill in JarvisBrain — all new entries refuse, existing positions still exit normally',
    'Live-money cap: $50 maxLiveCapital default — total live exposure must stay under this before any new live trade clears Risk Gate',
    'Campaign R/R parity (Phase 6): autonomous campaigns reject impossibly small profit targets at creation (min = capital × 3.75%, math floor for 1.5:1 R/R at 2.5% SL) AND skip individual deploys with bad R/R during scanAndDeploy',

    // ─── Exit + learn-from-each-trade ───
    'Let-winners-run exits (Phase 5): dollar profit target fires a 50% partial close (not 100%), then SL → breakeven, trailing → 2% on the remainder. Winners can ride to multi-R targets instead of getting capped at the first $X gain.',
    'Closed-loop learning (Phase 1 fix): every closed trade (sentry + manual UI close) writes a graded post-mortem A-F into the user\'s vector memory with embeddings. Scholar pulls past lessons by semantic match on every next scan ("Found N past trade lessons for SYMBOL").',
    'PostMortem grader: A-F grades on closed trades with extracted lessons',
    'Trade Diary UI at /diary: every swarm decision (executed / pending_approval / vetoed_* / no_opportunity / pipeline_error) browsable with filters, indicator snapshot at decision time, regime + risk state, post-mortem outcome when linked',
    'Strategy Tracker: per-strategy win rates with auto-disable of losing strategies',
    'Confidence Engine: 0-100% live-ready readiness score derived from track record',

    // ─── Knowledge + memory ───
    'Vector Memory Bank with semantic search (Gemini embeddings) — 207+ user memories, 97 global knowledge entries',
    'Trading Curriculum (Phase 4): 21 dense lessons across 10 classes (foundation/ta/risk/entry/exit/psych/regime/crypto/meta) embedded into vector memory — Scholar surfaces them on every relevant recall (e.g., "RSI lies in trending markets", "Counter-trend traps in bearish regimes")',
    'TradeDiary: structured audit trail — Sentinel queries past failures on the symbol to inject "lessons learned" before the next entry',

    // ─── Math + sizing ───
    'Kelly Criterion position sizing × Regime multiplier × Deadline-aware Strategy multiplier',
    'Deadline-Aware Strategy Router: maps remaining time-to-deadline to scalp/day/swing/position buckets — picks markets, timeframe, and Kelly multiplier accordingly',
    'Market Regime Detection: ADX/ATR/EMA-based trending_up / trending_down / ranging / volatile classification with per-regime SL/TP multipliers',
    'TA-driven scanner: OBV, VWAP, RSI, MACD, EMA, Bollinger Bands, ATR, ADX across 1H/4H/1D — SCORE now scales by confluence confidence (Phase 5.5), so a coin with 1D:SELL drops in rank even if 1H/4H agree',

    // ─── Cost + observability ───
    'Cost Telemetry (Phase 9.2): per-LLM-call USD tracking with purpose tags. Pro/Flash routing keeps swarm cost ~$0.008/run. Cost pill in JarvisBrain shows today\'s spend; click for per-purpose breakdown.',
    'Model split (Phase 9.4): analyst + holistic + strategist run on gemini-2.5-pro; everything else (scout/scholar/sentinel/sentiment) on gemini-2.5-flash — 97% of spend goes to the 3 reasoning-critical agents',

    // ─── Interfaces ───
    'Voice-first: Gemini Live tool-calling — talk to Jarvis to trade, scan, explain, or check status',
    'Two-way Telegram bot: trade notifications, approval replies, status queries',
    'JarvisBrain header status pills: 🛑 HALT (kill switch), 💵 $X.XX (cost today), 👁️ TV SYMBOL (vision bridge), AUTO ON/OFF, PRACTICE/LIVE',
    'Self-awareness: this manifest is auto-regenerated on every server boot — Jarvis sees every engine, route, behavior, and recent commit without manual prompt updates',

    // ─── Infra ───
    `${engines.length} specialized engines running concurrently`,
    `${apiRouteCount} API endpoints available`,
    'Multi-tenant: each user isolated by OWNER_USER_ID with per-user encrypted API key storage',
    'Auto-updating: version checker compares local vs GitHub remote',
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

CURRENT BEHAVIORS (the live rules Jarvis enforces on every trade — refresh these answers when someone asks "why won't you trade?" or "how do you decide?"):
• R/R minimum: 1.5:1 — Sentinel vetoes anything tighter; Strategist auto-widens TP if AI proposes sub-1.5:1
• Confidence floor: 60% — Sentinel vetoes below this. The AI Strategist sets confidence honestly based on regime + Holistic + past lessons; we no longer override low confidence with Scout's surface-level TA score.
• Bleed-hour filter: 12-19 UTC (default = 5 PM → 12 AM IST) requires ≥75% confidence. Configurable in Risk Manager.
• Per-symbol regime override: Strategist uses the picked coin's OWN regime (e.g., NEAR's VOLATILE/breakout) not the overall market regime (e.g., RANGING when BTC is sideways)
• Strategist TP rule: 3× ATR × tpMultiplier — the "let it run" target, not the half-mark TP1
• Strategist SL rule: 1.5× ATR × slMultiplier from entry — regime-adjusted
• Partial close at profit target: when sentry hits the dollar profit target, 50% closes immediately, SL → entry (breakeven), trailing → 2% on the remainder. Set profitTarget=0 in Risk Manager to disable entirely.
• Counter-trend trades in bearish regime require ≥75% conviction (curriculum Class 3 rule, taught to Holistic)
• Campaigns reject targets below capital × 3.75% at creation (math floor for 1.5:1 R/R at 2.5% SL); each individual deploy also rejected if R/R < 1.5
• Kill switch: HALT_TRADING file at repo root OR ~/.jarvis-halt blocks all new entries. Closes/partial-closes still work.
• Live trading cap: $50 maxLiveCapital — total live exposure must stay under this. Defaults safe; configurable.
• Vision auto-navigation: when TV bridge is connected and the swarm picks a symbol different from what's on screen, Jarvis flips the chart automatically before running Gemini Vision (Risk Manager → autoNavigateTV toggle)
• Closed-loop learning: every closed trade (sentry close, manual UI close, stale auto-close) generates a graded post-mortem and embeds the lesson into vector memory. Scholar pulls past lessons by symbol on every next scan.

RECENT GIT CHANGES:
${recentChanges}

CHANGELOG: ${manifest.changelog}

You can use the "inspectSystem" tool to get live details about any aspect of the system.
If the user asks about features, engines, or capabilities — you know them all from the list above.
If the user asks about recent updates, reference the git changes above.
`.trim();
}
